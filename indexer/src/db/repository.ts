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

export type BlockHashRecord = {
  number: bigint;
  hash: Hash;
  parentHash: Hash;
};

export interface DepositRepository {
  getCursor(): CursorState | null;
  commitBlock(input: BlockCommitInput): void;
  listDeposits(): StoredDeposit[];
  listDepositsPage(options: {
    limit: number;
    offset: number;
    status?: DepositStatus;
  }): StoredDeposit[];
  getDepositById(id: string): StoredDeposit | null;
  countDeposits(status?: DepositStatus): number;
  pruneBlockHashes(keepLatest: number): void;
  getBlockHash(number: bigint): BlockHashRecord | null;
  confirmDepositsUpTo(blockNumber: bigint): number;
  orphanDetectedFromBlock(fromBlock: bigint): number;
  orphanFromBlock(
    fromBlock: bigint,
    statuses: readonly DepositStatus[],
  ): { orphaned: number; previouslyConfirmed: StoredDeposit[] };
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

    return rows.map(mapStoredDepositRow);
  }

  listDepositsPage(options: {
    limit: number;
    offset: number;
    status?: DepositStatus;
  }): StoredDeposit[] {
    const limit = Math.min(Math.max(options.limit, 1), 100);
    const offset = Math.max(options.offset, 0);

    if (options.status) {
      const rows = this.db
        .prepare(
          `
          SELECT * FROM deposits
          WHERE status = ?
          ORDER BY block_number, hop2_log_index
          LIMIT ? OFFSET ?
        `,
        )
        .all(options.status, limit, offset) as Array<Record<string, unknown>>;
      return rows.map(mapStoredDepositRow);
    }

    const rows = this.db
      .prepare(
        `
        SELECT * FROM deposits
        ORDER BY block_number, hop2_log_index
        LIMIT ? OFFSET ?
      `,
      )
      .all(limit, offset) as Array<Record<string, unknown>>;
    return rows.map(mapStoredDepositRow);
  }

  getDepositById(id: string): StoredDeposit | null {
    const row = this.db
      .prepare("SELECT * FROM deposits WHERE id = ?")
      .get(id) as Record<string, unknown> | undefined;
    return row ? mapStoredDepositRow(row) : null;
  }

  countDeposits(status?: DepositStatus): number {
    if (status) {
      const row = this.db
        .prepare("SELECT COUNT(*) AS count FROM deposits WHERE status = ?")
        .get(status) as { count: number };
      return row.count;
    }
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

  getBlockHash(number: bigint): BlockHashRecord | null {
    const row = this.db
      .prepare(
        "SELECT number, hash, parent_hash FROM block_hashes WHERE number = ?",
      )
      .get(Number(number)) as
      | { number: number; hash: string; parent_hash: string }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      number: BigInt(row.number),
      hash: row.hash as Hash,
      parentHash: row.parent_hash as Hash,
    };
  }

  confirmDepositsUpTo(blockNumber: bigint): number {
    const now = new Date().toISOString();
    const result = this.db.prepare(
      `
      UPDATE deposits
      SET status = 'confirmed', confirmed_at = ?
      WHERE status = 'detected' AND block_number <= ?
    `,
    ).run(now, Number(blockNumber));
    return Number(result.changes);
  }

  orphanDetectedFromBlock(fromBlock: bigint): number {
    return this.orphanFromBlock(fromBlock, ["detected"]).orphaned;
  }

  orphanFromBlock(
    fromBlock: bigint,
    statuses: readonly DepositStatus[],
  ): { orphaned: number; previouslyConfirmed: StoredDeposit[] } {
    if (statuses.length === 0) {
      return { orphaned: 0, previouslyConfirmed: [] };
    }

    this.db.exec("BEGIN");
    try {
      const placeholders = statuses.map(() => "?").join(", ");
      const previouslyConfirmed = this.db
        .prepare(
          `
          SELECT * FROM deposits
          WHERE status = 'confirmed' AND block_number >= ?
        `,
        )
        .all(Number(fromBlock)) as Array<Record<string, unknown>>;

      const confirmedRows = statuses.includes("confirmed")
        ? previouslyConfirmed.map(mapStoredDepositRow)
        : [];

      const result = this.db
        .prepare(
          `
          UPDATE deposits
          SET status = 'orphaned'
          WHERE block_number >= ? AND status IN (${placeholders})
        `,
        )
        .run(Number(fromBlock), ...statuses);

      this.db.exec("COMMIT");
      return {
        orphaned: Number(result.changes),
        previouslyConfirmed: confirmedRows,
      };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

function mapStoredDepositRow(row: Record<string, unknown>): StoredDeposit {
  return {
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
  };
}
