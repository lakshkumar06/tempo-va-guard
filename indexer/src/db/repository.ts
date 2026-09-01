import type { Address, Hash } from "viem";
import type { DatabaseSync } from "node:sqlite";
import type { ClassifiedAnomaly, ClassifiedDeposit } from "../classifier/index.js";
import type { DepositEntrypoint } from "../pairer/hopPairer.js";

export type DepositStatus = "detected" | "confirmed" | "orphaned";

export type StoredDeposit = {
  id: string;
  chainId: number;
  blockNumber: bigint;
  blockHash: Hash;
  txHash: Hash;
  hop1LogIndex: number;
  hop2LogIndex: number;
  token: Address;
  masterId: string;
  masterAddress: Address;
  userTag: string;
  virtualAddress: Address;
  fromAddress: Address;
  amount: string;
  memo?: string;
  entrypoint: DepositEntrypoint;
  isSelfForward: boolean;
  status: DepositStatus;
  detectedAt: string;
  confirmedAt?: string;
};

export type StoredAnomaly = {
  id: string;
  kind: string;
  blockNumber: bigint;
  txHash?: Hash;
  token?: Address;
  virtualAddress?: Address;
  amount?: string;
  detail: string;
  status: "open" | "acknowledged";
  detectedAt: string;
};

export type CursorState = {
  lastBlock: bigint;
  lastHash: Hash;
  updatedAt: string;
};

export type BlockCommitInput = {
  chainId: number;
  block: {
    number: bigint;
    hash: Hash;
    parentHash: Hash;
  };
  deposits: ClassifiedDeposit[];
  anomalies: ClassifiedAnomaly[];
};

export interface DepositRepository {
  getCursor(): CursorState | null;
  commitBlock(input: BlockCommitInput): void;
  listDeposits(): StoredDeposit[];
  countDeposits(): number;
  pruneBlockHashes(keepLatest: number): void;
}

export function depositId(
  chainId: number,
  txHash: Hash,
  hop2LogIndex: number,
): string {
  return `${chainId}:${txHash.toLowerCase()}:${hop2LogIndex}`;
}

export function anomalyId(
  kind: string,
  txHash: Hash | undefined,
  logIndex: number | undefined,
): string {
  return `${kind}:${txHash?.toLowerCase() ?? "none"}:${logIndex ?? -1}`;
}

export class SqliteDepositRepository implements DepositRepository {
  constructor(private readonly db: DatabaseSync) {}

  getCursor(): CursorState | null {
    const row = this.db
      .prepare(
        "SELECT last_block, last_hash, updated_at FROM cursor WHERE id = 1",
      )
      .get() as
      | { last_block: number; last_hash: string; updated_at: string }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      lastBlock: BigInt(row.last_block),
      lastHash: row.last_hash as Hash,
      updatedAt: row.updated_at,
    };
  }

  commitBlock(input: BlockCommitInput): void {
    const now = new Date().toISOString();
    const insertDeposit = this.db.prepare(`
      INSERT INTO deposits (
        id, chain_id, block_number, block_hash, tx_hash,
        hop1_log_index, hop2_log_index, token, master_id, master_address,
        user_tag, virtual_address, from_address, amount, memo, entrypoint,
        is_self_forward, status, detected_at
      ) VALUES (
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?,
        ?, 'detected', ?
      )
      ON CONFLICT(id) DO NOTHING
    `);

    const insertAnomaly = this.db.prepare(`
      INSERT INTO anomalies (
        id, kind, block_number, tx_hash, token, virtual_address, amount,
        detail, status, detected_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
      ON CONFLICT(id) DO NOTHING
    `);

    const upsertBlock = this.db.prepare(`
      INSERT INTO block_hashes (number, hash, parent_hash)
      VALUES (?, ?, ?)
      ON CONFLICT(number) DO UPDATE SET
        hash = excluded.hash,
        parent_hash = excluded.parent_hash
    `);

    const upsertCursor = this.db.prepare(`
      INSERT INTO cursor (id, last_block, last_hash, updated_at)
      VALUES (1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        last_block = excluded.last_block,
        last_hash = excluded.last_hash,
        updated_at = excluded.updated_at
    `);

    this.db.exec("BEGIN");
    try {
      for (const item of input.deposits) {
        if (item.kind !== "deposit") {
          continue;
        }
        const { deposit } = item;
        insertDeposit.run(
          depositId(input.chainId, deposit.txHash, deposit.hop2LogIndex),
          input.chainId,
          Number(input.block.number),
          input.block.hash,
          deposit.txHash,
          deposit.hop1LogIndex,
          deposit.hop2LogIndex,
          deposit.token,
          deposit.masterId,
          item.masterAddress,
          deposit.userTag,
          deposit.virtualAddress,
          deposit.depositor,
          deposit.amount.toString(),
          deposit.memo ?? null,
          deposit.entrypoint,
          item.isSelfForward ? 1 : 0,
          now,
        );
      }

      for (const item of input.anomalies) {
        if (item.kind !== "anomaly") {
          continue;
        }
        const logIndex =
          typeof item.detail.logIndex === "number"
            ? item.detail.logIndex
            : undefined;
        insertAnomaly.run(
          anomalyId(item.anomalyKind, item.txHash, logIndex),
          item.anomalyKind,
          Number(input.block.number),
          item.txHash ?? null,
          item.token ?? null,
          item.virtualAddress ?? null,
          item.amount?.toString() ?? null,
          JSON.stringify(item.detail),
          now,
        );
      }

      upsertBlock.run(
        Number(input.block.number),
        input.block.hash,
        input.block.parentHash,
      );
      upsertCursor.run(
        Number(input.block.number),
        input.block.hash,
        now,
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listDeposits(): StoredDeposit[] {
    const rows = this.db
      .prepare("SELECT * FROM deposits ORDER BY block_number, hop2_log_index")
      .all() as Array<Record<string, unknown>>;

    return rows.map((row) => ({
      id: String(row.id),
      chainId: Number(row.chain_id),
      blockNumber: BigInt(row.block_number as number),
      blockHash: row.block_hash as Hash,
      txHash: row.tx_hash as Hash,
      hop1LogIndex: Number(row.hop1_log_index),
      hop2LogIndex: Number(row.hop2_log_index),
      token: row.token as Address,
      masterId: String(row.master_id),
      masterAddress: row.master_address as Address,
      userTag: String(row.user_tag),
      virtualAddress: row.virtual_address as Address,
      fromAddress: row.from_address as Address,
      amount: String(row.amount),
      memo: row.memo ? String(row.memo) : undefined,
      entrypoint: row.entrypoint as DepositEntrypoint,
      isSelfForward: Boolean(row.is_self_forward),
      status: row.status as DepositStatus,
      detectedAt: String(row.detected_at),
      confirmedAt: row.confirmed_at ? String(row.confirmed_at) : undefined,
    }));
  }

  countDeposits(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS count FROM deposits")
      .get() as { count: number };
    return row.count;
  }

  pruneBlockHashes(keepLatest: number): void {
    this.db.prepare(
      `
      DELETE FROM block_hashes
      WHERE number < (
        SELECT MAX(number) - ? FROM block_hashes
      )
    `,
    ).run(keepLatest);
  }
}
