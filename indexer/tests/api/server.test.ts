import { describe, expect, it } from "vitest";
import request from "supertest";
import type { Hash } from "viem";
import { createApiServer } from "../../src/api/server.js";
import { openDatabase } from "../../src/db/migrate.js";
import { SqliteDepositRepository } from "../../src/db/repository.js";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const TOKEN = "test-api-token";

describe("api", () => {
  it("keeps healthz public and protects deposits/metrics", async () => {
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
      apiToken: TOKEN,
    });

    const health = await request(app).get("/healthz");
    expect(health.status).toBe(200);

    const denied = await request(app).get("/deposits");
    expect(denied.status).toBe(401);

    const deposits = await request(app)
      .get("/deposits?limit=10&offset=0")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(deposits.status).toBe(200);
    expect(deposits.body).toMatchObject({ limit: 10, offset: 0, total: 0 });

    const metrics = await request(app)
      .get("/metrics")
      .set("Authorization", `Bearer ${TOKEN}`);
    expect(metrics.status).toBe(200);

    rmSync(dir, { recursive: true, force: true });
  });

  it("reports unhealthy when too far behind tip", async () => {
    const dir = mkdtempSync(join(tmpdir(), "tempo-api-"));
    const db = openDatabase(join(dir, "api.db"));
    const repo = new SqliteDepositRepository(db);
    const app = createApiServer({
      repo,
      blocksBehindTip: () => 500,
      apiToken: TOKEN,
    });

    const health = await request(app).get("/healthz");
    expect(health.status).toBe(503);

    rmSync(dir, { recursive: true, force: true });
  });
});
