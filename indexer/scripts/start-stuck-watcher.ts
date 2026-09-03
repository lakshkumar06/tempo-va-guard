/**
 * Runnable stuck-token guard service.
 *
 * Terminal 1:
 *   cd indexer && npm run watch:stuck
 *
 * Terminal 2:
 *   node scripts/send-non-supported-token.js
 *
 * Optional env:
 *   RPC_URL, VIRTUAL_ADDRESSES, PORT, POLL_MS, LOOKBACK_BLOCKS, INDEXER_API_TOKEN
 */
import express from "express";
import type { Address } from "viem";
import { LiveRpcChainSource } from "../src/chain/liveRpc.js";
import { loadConfig } from "../src/config.js";
import { StuckWatcher, type StuckAlert } from "../src/watch/stuckWatcher.js";

function bannerStuck(alert: StuckAlert): void {
  console.log("");
  console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.log("!!  STUCK NON-TIP-20 TOKEN DETECTED         !!");
  console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.log("  time:    ", alert.detectedAt);
  console.log("  block:   ", alert.blockNumber);
  console.log("  tx:      ", alert.txHash);
  console.log("  token:   ", alert.token);
  console.log("  virtual: ", alert.virtualAddress);
  console.log("  amount:  ", alert.amount);
  console.log("  detail:  ", alert.detail.message);
  console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.log("");
}

async function main(): Promise<void> {
  const config = loadConfig();
  const source = new LiveRpcChainSource({ rpcUrl: config.rpcUrl });
  const chainId = await source.getChainId();
  const tip = await source.getBlockNumber("latest");

  const watcher = new StuckWatcher({
    source,
    virtualAddresses: config.virtualAddresses as Address[],
    pollIntervalMs: config.pollIntervalMs,
    lookbackBlocks: BigInt(config.lookbackBlocks),
    onStuck: bannerStuck,
  });

  const app = express();

  app.get("/healthz", (_req, res) => {
    const status = watcher.getStatus();
    res.json({ ok: status.running, ...status });
  });

  app.get("/anomalies", (req, res) => {
    if (config.apiToken) {
      const header = req.header("authorization");
      if (header !== `Bearer ${config.apiToken}`) {
        res.status(401).json({ error: "unauthorized" });
        return;
      }
    }
    res.json({ anomalies: watcher.getAlerts() });
  });

  app.get("/", (_req, res) => {
    const status = watcher.getStatus();
    const alerts = watcher.getAlerts();
    res.type("html").send(`<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="refresh" content="2" />
  <title>Tempo VA Guard — Stuck Watcher</title>
  <style>
    body { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; margin: 2rem; background: #0b0f14; color: #e8eef7; }
    h1 { color: #ff6b6b; }
    .ok { color: #6bffb0; }
    .card { border: 1px solid #334; padding: 1rem; margin: 1rem 0; background: #121821; }
    .meta { color: #9ab; }
    a { color: #7ec8ff; }
  </style>
</head>
<body>
  <h1>Tempo VA Guard — Stuck Token Watcher</h1>
  <p class="ok">running=${status.running} · tip=${status.tip} · cursor=${status.cursor ?? "-"} · stuck=${status.stuckCount}</p>
  <p class="meta">watching: ${status.watching.join(", ")}</p>
  <p class="meta">Send illegal tx: <code>node scripts/send-non-supported-token.js</code></p>
  <p><a href="/anomalies">/anomalies</a> · <a href="/healthz">/healthz</a></p>
  ${
    alerts.length === 0
      ? "<p>No stuck tokens yet. Waiting...</p>"
      : alerts
          .map(
            (a) => `<div class="card">
    <strong>STUCK NON-TIP-20</strong><br/>
    time: ${a.detectedAt}<br/>
    block: ${a.blockNumber}<br/>
    tx: ${a.txHash}<br/>
    token: ${a.token}<br/>
    virtual: ${a.virtualAddress}<br/>
    amount: ${a.amount}<br/>
  </div>`,
          )
          .join("")
  }
</body>
</html>`);
  });

  const server = app.listen(config.port, () => {
    console.log("=== Tempo VA Guard — Stuck Token Watcher ===");
    console.log("chainId:   ", chainId);
    console.log("rpc:       ", config.rpcUrl);
    console.log("tip:       ", tip.toString());
    console.log("watching:  ", config.virtualAddresses.join(", "));
    console.log("poll:      ", `${config.pollIntervalMs}ms`);
    console.log("server:    ", `http://localhost:${config.port}`);
    console.log("");
    console.log("In another terminal, send the illegal tx:");
    console.log("  node scripts/send-non-supported-token.js");
    console.log("");
  });

  const shutdown = (signal: string) => {
    console.log(`\n[shutdown] received ${signal}, stopping watcher...`);
    watcher.stop();
    server.close(() => {
      console.log("[shutdown] http server closed");
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  await watcher.start();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
