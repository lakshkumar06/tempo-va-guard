import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Hash } from "viem";
import { createApiServer } from "../../src/api/server.js";
import { openDatabase } from "../../src/db/migrate.js";
import { SqliteDepositRepository } from "../../src/db/repository.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("api", () => {
  it("returns deposits and health", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tempo-api-"));
    const db = openDatabase(join(dir, "api.db"));
    const repo = new SqliteDepositRepository(db);

    repo.commitBlock({
      chainId: 1,
      block: {
        number: 1n,
        hash: "0xb1" as Hash,
        parentHash: "0xb0" as Hash,
      },
      deposits: [],
      anomalies: [],
    });

    const app = createApiServer({
      repo,
      blocksBehindTip: () => 3,
    });

    const health = await request(app).get("/healthz");
    expect(health.status).toBe(200);

    const deposits = await request(app).get("/deposits");
    expect(deposits.status).toBe(200);

    rmSync(dir, { recursive: true, force: true });
  });

  it("reports unhealthy when too far behind tip", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tempo-api-"));
    const db = openDatabase(join(dir, "api.db"));
    const repo = new SqliteDepositRepository(db);
    const app = createApiServer({
      repo,
      blocksBehindTip: () => 500,
    });

    const health = await request(app).get("/healthz");
    expect(health.status).toBe(503);

    rmSync(dir, { recursive: true, force: true });
  });
});
