import type { Address, Hash } from "viem";
import type { ChainSource } from "../chain/types.js";
import { uniqueTransactionHashes } from "../chain/types.js";
import {
  classifyTransaction,
  RegistryCache,
} from "../classifier/index.js";
import { pairDepositsFromLogs } from "../pairer/hopPairer.js";

export type StuckAlert = {
  id: string;
  detectedAt: string;
  blockNumber: string;
  txHash: Hash;
  token?: Address;
  virtualAddress?: Address;
  amount?: string;
  detail: Record<string, unknown>;
};

export type StuckWatcherOptions = {
  source: ChainSource;
  virtualAddresses: readonly Address[];
  pollIntervalMs?: number;
  lookbackBlocks?: bigint;
  onStuck?: (alert: StuckAlert) => void;
  onTick?: (info: { fromBlock: bigint; toBlock: bigint; tip: bigint }) => void;
};

export class StuckWatcher {
  private readonly source: ChainSource;
  private readonly virtualAddresses: readonly Address[];
  private readonly pollIntervalMs: number;
  private readonly lookbackBlocks: bigint;
  private readonly onStuck?: (alert: StuckAlert) => void;
  private readonly onTick?: StuckWatcherOptions["onTick"];
  private readonly registry = new RegistryCache();
  private readonly seenTx = new Set<string>();
  private readonly alerts: StuckAlert[] = [];
  private cursor: bigint | null = null;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private tip = 0n;

  constructor(options: StuckWatcherOptions) {
    this.source = options.source;
    this.virtualAddresses = options.virtualAddresses;
    this.pollIntervalMs = options.pollIntervalMs ?? 1_000;
    this.lookbackBlocks = options.lookbackBlocks ?? 20n;
    this.onStuck = options.onStuck;
    this.onTick = options.onTick;
  }

  getAlerts(): StuckAlert[] {
    return [...this.alerts];
  }

  getStatus(): {
    running: boolean;
    tip: string;
    cursor: string | null;
    watching: readonly Address[];
    stuckCount: number;
  } {
    return {
      running: this.running,
      tip: this.tip.toString(),
      cursor: this.cursor?.toString() ?? null,
      watching: this.virtualAddresses,
      stuckCount: this.alerts.length,
    };
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    this.tip = await this.source.getBlockNumber("latest");
    this.cursor =
      this.tip > this.lookbackBlocks ? this.tip - this.lookbackBlocks : 0n;
    await this.tick();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (!this.running) {
      return;
    }
    this.timer = setTimeout(() => {
      void this.tick();
    }, this.pollIntervalMs);
  }

  private async tick(): Promise<void> {
    try {
      this.tip = await this.source.getBlockNumber("latest");
      if (this.cursor === null) {
        this.cursor = this.tip;
      }

      if (this.cursor > this.tip) {
        this.scheduleNext();
        return;
      }

      // Keep ranges small for tip-following (Tempo ~0.5s blocks).
      const toBlock =
        this.cursor + 200n > this.tip ? this.tip : this.cursor + 200n;

      this.onTick?.({
        fromBlock: this.cursor,
        toBlock,
        tip: this.tip,
      });

      const inbound = await this.source.getTransfersToAddresses({
        fromBlock: this.cursor,
        toBlock,
        toAddresses: this.virtualAddresses,
      });

      const hashes = uniqueTransactionHashes(inbound);
      for (const hash of hashes) {
        await this.inspectTx(hash, toBlock);
      }

      this.cursor = toBlock + 1n;
    } catch (error) {
      console.error(
        "[watcher] poll error:",
        error instanceof Error ? error.message : error,
      );
    } finally {
      this.scheduleNext();
    }
  }

  private async inspectTx(txHash: Hash, fallbackBlock: bigint): Promise<void> {
    const key = txHash.toLowerCase();
    if (this.seenTx.has(key)) {
      return;
    }
    this.seenTx.add(key);

    const receipt = await this.source.getTransactionReceipt(txHash);
    if (!receipt || receipt.status !== "success") {
      return;
    }

    const paired = pairDepositsFromLogs(receipt.logs, txHash);
    const classified = classifyTransaction(
      paired.deposits,
      paired.unpairedHops,
      this.registry,
      { blockNumber: receipt.blockNumber ?? fallbackBlock, txHash },
    );

    for (const item of classified) {
      if (item.kind !== "anomaly" || item.anomalyKind !== "stranded_non_tip20") {
        continue;
      }

      const alert: StuckAlert = {
        id: `${txHash.toLowerCase()}:${String(item.detail.logIndex ?? 0)}`,
        detectedAt: new Date().toISOString(),
        blockNumber: (item.blockNumber ?? receipt.blockNumber).toString(),
        txHash,
        token: item.token,
        virtualAddress: item.virtualAddress,
        amount: item.amount?.toString(),
        detail: item.detail,
      };

      this.alerts.unshift(alert);
      this.onStuck?.(alert);
    }
  }
}
