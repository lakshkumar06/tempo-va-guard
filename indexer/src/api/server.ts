import express from "express";
import type { SqliteDepositRepository } from "../db/repository.js";

export type ApiState = {
  repo: SqliteDepositRepository;
  blocksBehindTip: () => number;
};

export function createApiServer(state: ApiState) {
  const app = express();

  app.get("/healthz", (_req, res) => {
    const behind = state.blocksBehindTip();
    const healthy = behind <= 50;
    res.status(healthy ? 200 : 503).json({
      ok: healthy,
      blocksBehindTip: behind,
    });
  });

  app.get("/deposits", (_req, res) => {
    const deposits = state.repo.listDeposits().map((deposit) => ({
      ...deposit,
      blockNumber: deposit.blockNumber.toString(),
      amount: deposit.amount,
    }));
    res.json({ deposits });
  });

  app.get("/deposits/:id", (req, res) => {
    const deposit = state.repo
      .listDeposits()
      .find((item) => item.id === req.params.id);
    if (!deposit) {
      res.status(404).json({ error: "not found" });
      return;
    }
    res.json({
      ...deposit,
      blockNumber: deposit.blockNumber.toString(),
    });
  });

  app.get("/metrics", (_req, res) => {
    const deposits = state.repo.listDeposits();
    const byStatus = deposits.reduce<Record<string, number>>((acc, deposit) => {
      acc[deposit.status] = (acc[deposit.status] ?? 0) + 1;
      return acc;
    }, {});

    res.type("text/plain").send(
      [
        `blocks_behind_tip ${state.blocksBehindTip()}`,
        `deposits_total ${deposits.length}`,
        ...Object.entries(byStatus).map(
          ([status, count]) => `deposits_${status} ${count}`,
        ),
      ].join("\n"),
    );
  });

  return app;
}
