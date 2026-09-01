import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Hash } from "viem";
import { classifyTransaction, RegistryCache } from "../classifier/index.js";
import type { BlockHeader } from "../chain/types.js";
import { pairDepositsFromLogs } from "../pairer/hopPairer.js";
import { openDatabase } from "../db/migrate.js";
import { SqliteDepositRepository } from "../db/repository.js";

export type BlockProcessorInput = {
  chainId: number;
  block: BlockHeader;
  receipts: Array<{
    transactionHash: Hash;
    logs: Parameters<typeof pairDepositsFromLogs>[0];
  }>;
  registry: RegistryCache;
};

export class BlockProcessor {
  constructor(private readonly repo: SqliteDepositRepository) {}

  processBlock(input: BlockProcessorInput): void {
    const deposits = [];
    const anomalies = [];

    for (const receipt of input.receipts) {
      const paired = pairDepositsFromLogs(
        receipt.logs,
        receipt.transactionHash,
      );
      const classified = classifyTransaction(
        paired.deposits,
        paired.unpairedHops,
        input.registry,
        { blockNumber: input.block.number, txHash: receipt.transactionHash },
      );

      for (const item of classified) {
        if (item.kind === "deposit") {
          deposits.push(item);
        } else {
          anomalies.push(item);
        }
      }
    }

    this.repo.commitBlock({
      chainId: input.chainId,
      block: input.block,
      deposits,
      anomalies,
    });
  }
}

export function createTempRepository(): {
  path: string;
  repo: SqliteDepositRepository;
  cleanup: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), "tempo-indexer-"));
  const path = join(dir, "indexer.db");
  const db = openDatabase(path);
  const repo = new SqliteDepositRepository(db);
  return {
    path,
    repo,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}
