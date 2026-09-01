import type { OutboxRepository } from "./outbox.js";
import type { Clock } from "./clock.js";
import { fullJitterBackoffMs, signWebhookBody } from "./crypto.js";
import type { WebhookTransport } from "./transport.js";

export type DispatcherOptions = {
  workerId: string;
  endpoint: string;
  secret: string;
  maxAttempts?: number;
  leaseSeconds?: number;
};

export class OutboxDispatcher {
  private readonly maxAttempts: number;
  private readonly leaseSeconds: number;

  constructor(
    private readonly outbox: OutboxRepository,
    private readonly transport: WebhookTransport,
    private readonly clock: Clock,
    options: DispatcherOptions,
  ) {
    this.workerId = options.workerId;
    this.endpoint = options.endpoint;
    this.secret = options.secret;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.leaseSeconds = options.leaseSeconds ?? 30;
  }

  private readonly workerId: string;
  private readonly endpoint: string;
  private readonly secret: string;

  async runOnce(): Promise<boolean> {
    const now = this.clock.nowIso();
    this.outbox.reclaimExpired(now);

    const job = this.outbox.claimNext(
      this.workerId,
      this.endpoint,
      now,
      this.leaseSeconds,
    );
    if (!job) {
      return false;
    }

    const timestamp = this.clock.nowIso();
    const signature = signWebhookBody(this.secret, timestamp, job.payload);

    const result = await this.transport.deliver({
      endpoint: this.endpoint,
      idempotencyKey: job.subjectId,
      timestamp,
      signature,
      body: job.payload,
    });

    if (result.ok) {
      this.outbox.markDelivered(job.id, this.clock.nowIso());
      return true;
    }

    const attempts = job.attempts + 1;
    if (!result.retryable || attempts >= this.maxAttempts) {
      this.outbox.markDead(job.id, result.error);
      return true;
    }

    const delayMs = fullJitterBackoffMs(attempts);
    const nextAttemptAt = new Date(
      this.clock.now().getTime() + delayMs,
    ).toISOString();
    this.outbox.markRetry(job.id, attempts, nextAttemptAt, result.error);
    return true;
  }
}
