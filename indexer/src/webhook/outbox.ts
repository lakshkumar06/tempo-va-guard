import type { DatabaseSync } from "node:sqlite";
import type { StoredDeposit } from "../db/repository.js";
import { buildDepositPayload, type OutboxRow, type WebhookEventType } from "./types.js";

export class OutboxRepository {
  constructor(private readonly db: DatabaseSync) {}

  enqueueDepositConfirmed(
    deposit: StoredDeposit,
    endpoint: string,
    now: string,
  ): void {
    const payload = JSON.stringify(buildDepositPayload(deposit));
    this.db.prepare(
      `
      INSERT INTO webhook_deliveries (
        id, event_type, subject_id, endpoint, payload, status,
        attempts, next_attempt_at, created_at
      ) VALUES (?, 'deposit.confirmed', ?, ?, ?, 'pending', 0, ?, ?)
      ON CONFLICT(event_type, subject_id, endpoint) DO NOTHING
    `,
    ).run(
      `delivery:${deposit.id}:${endpoint}`,
      deposit.id,
      endpoint,
      payload,
      now,
      now,
    );
  }

  confirmAndEnqueue(
    finalizedBlock: bigint,
    endpoint: string,
    now: string,
  ): { confirmed: number; enqueued: number } {
    this.db.exec("BEGIN");
    try {
      const confirmed = this.db.prepare(
        `
        UPDATE deposits
        SET status = 'confirmed', confirmed_at = ?
        WHERE status = 'detected' AND block_number <= ?
      `,
      ).run(now, Number(finalizedBlock));

      const deposits = this.db.prepare(
        `
        SELECT * FROM deposits
        WHERE status = 'confirmed' AND confirmed_at = ?
      `,
      ).all(now) as Array<Record<string, unknown>>;

      let enqueued = 0;
      for (const row of deposits) {
        const deposit = mapDepositRow(row);
        const before = this.db.prepare(
          "SELECT COUNT(*) AS count FROM webhook_deliveries WHERE subject_id = ?",
        ).get(deposit.id) as { count: number };
        this.enqueueDepositConfirmed(deposit, endpoint, now);
        const after = this.db.prepare(
          "SELECT COUNT(*) AS count FROM webhook_deliveries WHERE subject_id = ?",
        ).get(deposit.id) as { count: number };
        if (after.count > before.count) {
          enqueued += 1;
        }
      }

      this.db.exec("COMMIT");
      return { confirmed: Number(confirmed.changes), enqueued };
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  claimNext(
    workerId: string,
    endpoint: string,
    now: string,
    leaseSeconds: number,
  ): OutboxRow | null {
    const row = this.db.prepare(
      `
      SELECT * FROM webhook_deliveries
      WHERE endpoint = ? AND status = 'pending' AND next_attempt_at <= ?
      ORDER BY next_attempt_at
      LIMIT 1
    `,
    ).get(endpoint, now) as Record<string, unknown> | undefined;

    if (!row) {
      return null;
    }

    const claimedUntil = new Date(
      Date.parse(now) + leaseSeconds * 1000,
    ).toISOString();

    const result = this.db.prepare(
      `
      UPDATE webhook_deliveries
      SET status = 'inflight', claimed_by = ?, claimed_until = ?
      WHERE id = ? AND status = 'pending'
    `,
    ).run(workerId, claimedUntil, String(row.id));

    if (Number(result.changes) === 0) {
      return null;
    }

    return mapOutboxRow({ ...row, status: "inflight", claimed_by: workerId, claimed_until: claimedUntil });
  }

  markDelivered(id: string, now: string): void {
    this.db.prepare(
      `
      UPDATE webhook_deliveries
      SET status = 'delivered', delivered_at = ?, claimed_by = NULL, claimed_until = NULL
      WHERE id = ?
    `,
    ).run(now, id);
  }

  markRetry(
    id: string,
    attempts: number,
    nextAttemptAt: string,
    lastError: string,
  ): void {
    this.db.prepare(
      `
      UPDATE webhook_deliveries
      SET status = 'pending', attempts = ?, next_attempt_at = ?, last_error = ?,
          claimed_by = NULL, claimed_until = NULL
      WHERE id = ?
    `,
    ).run(attempts, nextAttemptAt, lastError, id);
  }

  markDead(id: string, lastError: string): void {
    this.db.prepare(
      `
      UPDATE webhook_deliveries
      SET status = 'dead', last_error = ?, claimed_by = NULL, claimed_until = NULL
      WHERE id = ?
    `,
    ).run(lastError, id);
  }

  reclaimExpired(now: string): number {
    const result = this.db.prepare(
      `
      UPDATE webhook_deliveries
      SET status = 'pending', claimed_by = NULL, claimed_until = NULL
      WHERE status = 'inflight' AND claimed_until IS NOT NULL AND claimed_until < ?
    `,
    ).run(now);
    return Number(result.changes);
  }

  pendingCount(endpoint: string): number {
    const row = this.db.prepare(
      "SELECT COUNT(*) AS count FROM webhook_deliveries WHERE endpoint = ? AND status IN ('pending', 'inflight')",
    ).get(endpoint) as { count: number };
    return row.count;
  }
}

function mapDepositRow(row: Record<string, unknown>): StoredDeposit {
  return {
    id: String(row.id),
    chainId: Number(row.chain_id),
    blockNumber: BigInt(row.block_number as number),
    blockHash: row.block_hash as StoredDeposit["blockHash"],
    txHash: row.tx_hash as StoredDeposit["txHash"],
    hop1LogIndex: Number(row.hop1_log_index),
    hop2LogIndex: Number(row.hop2_log_index),
    token: row.token as StoredDeposit["token"],
    masterId: String(row.master_id),
    masterAddress: row.master_address as StoredDeposit["masterAddress"],
    userTag: String(row.user_tag),
    virtualAddress: row.virtual_address as StoredDeposit["virtualAddress"],
    fromAddress: row.from_address as StoredDeposit["fromAddress"],
    amount: String(row.amount),
    memo: row.memo ? String(row.memo) : undefined,
    entrypoint: row.entrypoint as StoredDeposit["entrypoint"],
    isSelfForward: Boolean(row.is_self_forward),
    status: row.status as StoredDeposit["status"],
    detectedAt: String(row.detected_at),
    confirmedAt: row.confirmed_at ? String(row.confirmed_at) : undefined,
  };
}

function mapOutboxRow(row: Record<string, unknown>): OutboxRow {
  return {
    id: String(row.id),
    eventType: row.event_type as WebhookEventType,
    subjectId: String(row.subject_id),
    endpoint: String(row.endpoint),
    payload: String(row.payload),
    status: row.status as OutboxRow["status"],
    attempts: Number(row.attempts),
    nextAttemptAt: String(row.next_attempt_at),
    claimedUntil: row.claimed_until ? String(row.claimed_until) : undefined,
    claimedBy: row.claimed_by ? String(row.claimed_by) : undefined,
    lastError: row.last_error ? String(row.last_error) : undefined,
    createdAt: String(row.created_at),
    deliveredAt: row.delivered_at ? String(row.delivered_at) : undefined,
  };
}
