import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type {
  DepositStatus,
  SqliteDepositRepository,
} from "../db/repository.js";

export type ApiState = {
  repo: SqliteDepositRepository;
  blocksBehindTip: () => number;
  /**
   * When set, /deposits and /metrics require `Authorization: Bearer <token>`.
   * /healthz stays public for probes.
   */
  apiToken?: string;
};

function serializeDeposit(
  deposit: ReturnType<SqliteDepositRepository["listDeposits"]>[number],
) {
  return {
    ...deposit,
    blockNumber: deposit.blockNumber.toString(),
    amount: deposit.amount,
  };
}

function requireAuth(apiToken: string | undefined) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!apiToken) {
      res.status(401).json({
        error: "API token required — set INDEXER_API_TOKEN before exposing the API",
      });
      return;
    }

    const header = req.header("authorization");
    const expected = `Bearer ${apiToken}`;
    if (header !== expected) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
    next();
  };
}

export function createApiServer(state: ApiState) {
  const app = express();
  const auth = requireAuth(state.apiToken);

  app.get("/healthz", (_req, res) => {
    const behind = state.blocksBehindTip();
    const healthy = behind <= 50;
    res.status(healthy ? 200 : 503).json({
      ok: healthy,
      blocksBehindTip: behind,
    });
  });

  app.get("/deposits", auth, (req, res) => {
    const limit = Number.parseInt(String(req.query.limit ?? "50"), 10);
    const offset = Number.parseInt(String(req.query.offset ?? "0"), 10);
    const status =
      typeof req.query.status === "string"
        ? (req.query.status as DepositStatus)
        : undefined;

    const safeLimit = Number.isFinite(limit) ? limit : 50;
    const safeOffset = Number.isFinite(offset) ? offset : 0;
    const deposits = state.repo
      .listDepositsPage({
        limit: safeLimit,
        offset: safeOffset,
        status,
      })
      .map(serializeDeposit);

    res.json({
      deposits,
      limit: Math.min(Math.max(safeLimit, 1), 100),
      offset: Math.max(safeOffset, 0),
      total: state.repo.countDeposits(status),
    });
  });

  app.get("/deposits/:id", auth, (req, res) => {
    const deposit = state.repo.getDepositById(String(req.params.id));
    if (!deposit) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json(serializeDeposit(deposit));
  });

  // Metrics are internal — same auth gate as deposits.
  app.get("/metrics", auth, (_req, res) => {
    const total = state.repo.countDeposits();
    const detected = state.repo.countDeposits("detected");
    const confirmed = state.repo.countDeposits("confirmed");
    const orphaned = state.repo.countDeposits("orphaned");

    res.type("text/plain").send(
      [
        `blocks_behind_tip ${state.blocksBehindTip()}`,
        `deposits_total ${total}`,
        `deposits_detected ${detected}`,
        `deposits_confirmed ${confirmed}`,
        `deposits_orphaned ${orphaned}`,
      ].join("\n"),
    );
  });

  return app;
}
