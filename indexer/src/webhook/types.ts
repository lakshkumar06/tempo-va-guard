import type { StoredDeposit } from "../db/repository.js";

export type WebhookEventType = "deposit.confirmed" | "anomaly.detected";

export type WebhookPayload = {
  event: WebhookEventType;
  id: string;
  timestamp: string;
  data: Record<string, unknown>;
};

export type OutboxRow = {
  id: string;
  eventType: WebhookEventType;
  subjectId: string;
  endpoint: string;
  payload: string;
  status: "pending" | "inflight" | "delivered" | "dead";
  attempts: number;
  nextAttemptAt: string;
  claimedUntil?: string;
  claimedBy?: string;
  lastError?: string;
  createdAt: string;
  deliveredAt?: string;
};

export function buildDepositPayload(deposit: StoredDeposit): WebhookPayload {
  return {
    event: "deposit.confirmed",
    id: deposit.id,
    timestamp: new Date().toISOString(),
    data: {
      txHash: deposit.txHash,
      blockNumber: deposit.blockNumber.toString(),
      masterId: deposit.masterId,
      userTag: deposit.userTag,
      amount: deposit.amount,
      token: deposit.token,
      virtualAddress: deposit.virtualAddress,
      isSelfForward: deposit.isSelfForward,
    },
  };
}
