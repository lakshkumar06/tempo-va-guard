import { describe, expect, it } from "vitest";
import type { Hash } from "viem";
import { openDatabase } from "../../src/db/migrate.js";
import { SqliteDepositRepository } from "../../src/db/repository.js";
import { FakeClock } from "../../src/webhook/clock.js";
import { OutboxDispatcher } from "../../src/webhook/dispatcher.js";
import { OutboxRepository } from "../../src/webhook/outbox.js";
import { RecordingWebhookTransport } from "../../src/webhook/transport.js";
import { asMasterId, asUserTag } from "../../src/types/brands.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const ENDPOINT = "https://example.com/webhook";
const SECRET = "test-secret";

function tempDb() {
  const dir = mkdtempSync(join(tmpdir(), "tempo-outbox-"));
  const path = join(dir, "test.db");
  const db = openDatabase(path);
  return {
    db,
    repo: new SqliteDepositRepository(db),
    outbox: new OutboxRepository(db),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

describe("outbox", () => {
  it("enqueues once per confirmed deposit", () => {
    const { repo, outbox, cleanup } = tempDb();
    const now = "2026-01-01T00:00:00.000Z";

    repo.commitBlock({
      chainId: 42431,
      block: {
        number: 1n,
        hash: "0xb1" as Hash,
        parentHash: "0xb0" as Hash,
      },
      deposits: [
        {
          kind: "deposit",
          isSelfForward: false,
          masterAddress: "0xD79c4cF03a2244F599200073ac704392dd6a84a0",
          deposit: {
            depositor: "0x1111111111111111111111111111111111111111",
            master: "0xD79c4cF03a2244F599200073ac704392dd6a84a0",
            masterId: asMasterId("0xb1977b69"),
            userTag: asUserTag("0x000000000001"),
            virtualAddress: "0xB1977b69FDFdfDFDfDFDFdFdFDFd000000000001",
            token: "0x20c0000000000000000000000000000000000000",
            amount: 100n,
            txHash: "0xtx" as Hash,
            hop1LogIndex: 0,
            hop2LogIndex: 1,
            entrypoint: "transfer",
          },
        },
      ],
      anomalies: [],
    });

    const first = outbox.confirmAndEnqueue(1n, ENDPOINT, now);
    const second = outbox.confirmAndEnqueue(1n, ENDPOINT, now);

    expect(first.confirmed).toBe(1);
    expect(first.enqueued).toBe(1);
    expect(second.enqueued).toBe(0);
    cleanup();
  });
});

describe("dispatcher", () => {
  it("retries with backoff then delivers", async () => {
    const { repo, outbox, cleanup } = tempDb();
    const clock = new FakeClock(Date.parse("2026-01-01T00:00:00.000Z"));
    const transport = new RecordingWebhookTransport();
    transport.queueResponses(
      { ok: false, status: 500, error: "boom", retryable: true },
      { ok: true, status: 200 },
    );

    const now = clock.nowIso();
    repo.commitBlock({
      chainId: 42431,
      block: {
        number: 2n,
        hash: "0xb2" as Hash,
        parentHash: "0xb1" as Hash,
      },
      deposits: [
        {
          kind: "deposit",
          isSelfForward: false,
          masterAddress: "0xD79c4cF03a2244F599200073ac704392dd6a84a0",
          deposit: {
            depositor: "0x1111111111111111111111111111111111111111",
            master: "0xD79c4cF03a2244F599200073ac704392dd6a84a0",
            masterId: asMasterId("0xb1977b69"),
            userTag: asUserTag("0x000000000001"),
            virtualAddress: "0xB1977b69FDFdfDFDfDFDFdFdFDFd000000000001",
            token: "0x20c0000000000000000000000000000000000000",
            amount: 200n,
            txHash: "0xtx2" as Hash,
            hop1LogIndex: 0,
            hop2LogIndex: 1,
            entrypoint: "transfer",
          },
        },
      ],
      anomalies: [],
    });
    outbox.confirmAndEnqueue(2n, ENDPOINT, now);

    const dispatcher = new OutboxDispatcher(outbox, transport, clock, {
      workerId: "worker-1",
      endpoint: ENDPOINT,
      secret: SECRET,
      maxAttempts: 3,
    });

    expect(await dispatcher.runOnce()).toBe(true);
    clock.advance(5_000);
    expect(await dispatcher.runOnce()).toBe(true);

    expect(transport.deliveries).toHaveLength(2);
    expect(transport.deliveries[0]?.idempotencyKey).toBe(
      "42431:0xtx2:1",
    );
    cleanup();
  });

  it("dead-letters poison pills", async () => {
    const { repo, outbox, cleanup } = tempDb();
    const clock = new FakeClock(Date.parse("2026-01-01T00:00:00.000Z"));
    const transport = new RecordingWebhookTransport();
    transport.queueResponses(
      { ok: false, status: 500, error: "always fails", retryable: true },
      { ok: false, status: 500, error: "always fails", retryable: true },
    );

    const now = clock.nowIso();
    repo.commitBlock({
      chainId: 42431,
      block: {
        number: 3n,
        hash: "0xb3" as Hash,
        parentHash: "0xb2" as Hash,
      },
      deposits: [
        {
          kind: "deposit",
          isSelfForward: false,
          masterAddress: "0xD79c4cF03a2244F599200073ac704392dd6a84a0",
          deposit: {
            depositor: "0x1111111111111111111111111111111111111111",
            master: "0xD79c4cF03a2244F599200073ac704392dd6a84a0",
            masterId: asMasterId("0xb1977b69"),
            userTag: asUserTag("0x000000000001"),
            virtualAddress: "0xB1977b69FDFdfDFDfDFDFdFdFDFd000000000001",
            token: "0x20c0000000000000000000000000000000000000",
            amount: 300n,
            txHash: "0xtx3" as Hash,
            hop1LogIndex: 0,
            hop2LogIndex: 1,
            entrypoint: "transfer",
          },
        },
      ],
      anomalies: [],
    });
    outbox.confirmAndEnqueue(3n, ENDPOINT, now);

    const dispatcher = new OutboxDispatcher(outbox, transport, clock, {
      workerId: "worker-1",
      endpoint: ENDPOINT,
      secret: SECRET,
      maxAttempts: 2,
    });

    await dispatcher.runOnce();
    clock.advance(60_000);
    await dispatcher.runOnce();

    expect(outbox.pendingCount(ENDPOINT)).toBe(0);
    cleanup();
  });
});
