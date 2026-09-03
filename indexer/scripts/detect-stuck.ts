/**
 * Stuck non-TIP-20 detection smoke test.
 *
 * Fixture (offline):
 *   npx tsx scripts/detect-stuck.ts
 *
 * Live receipt (needs network + tx hash):
 *   npx tsx scripts/detect-stuck.ts 0xYOUR_TX_HASH
 */
import type { Hash } from "viem";
import { LiveRpcChainSource } from "../src/chain/liveRpc.js";
import type { IndexedLog } from "../src/chain/types.js";
import {
  classifyTransaction,
  RegistryCache,
} from "../src/classifier/index.js";
import { pairDepositsFromLogs } from "../src/pairer/hopPairer.js";
import { buildNonTip20StuckFixtureLogs } from "../tests/fixtures/logBuilders.js";

function printVerdict(
  txHash: string,
  logs: readonly IndexedLog[],
  blockNumber: bigint,
): void {
  const paired = pairDepositsFromLogs(logs, txHash as Hash);
  const classified = classifyTransaction(
    paired.deposits,
    paired.unpairedHops,
    new RegistryCache(),
    { blockNumber, txHash: txHash as Hash },
  );

  console.log("=== DETECTION RESULT ===");
  console.log("tx:           ", txHash);
  console.log("transfer logs:", logs.length);
  console.log("deposits:     ", paired.deposits.length);
  console.log("unpaired hops:", paired.unpairedHops.length);
  console.log("");

  const stranded = classified.filter(
    (item) =>
      item.kind === "anomaly" && item.anomalyKind === "stranded_non_tip20",
  );

  if (stranded.length > 0) {
    console.log("VERDICT: STUCK NON-TIP-20 TOKEN DETECTED");
    for (const item of stranded) {
      if (item.kind !== "anomaly") continue;
      console.log("  token:   ", item.token);
      console.log("  virtual: ", item.virtualAddress);
      console.log("  amount:  ", item.amount?.toString());
      console.log("  detail:  ", item.detail.message);
    }
    return;
  }

  if (paired.deposits.length > 0) {
    console.log("VERDICT: OK — normal TIP-20 deposit (forwarded)");
    for (const deposit of paired.deposits) {
      console.log("  amount:  ", deposit.amount.toString());
      console.log("  userTag: ", deposit.userTag);
      console.log("  master:  ", deposit.master);
    }
    return;
  }

  console.log("VERDICT: no virtual-address deposit pattern found");
}

async function fromFixture(): Promise<void> {
  console.log("Mode: fixture (offline stuck-token pattern)\n");
  const logs = buildNonTip20StuckFixtureLogs();
  printVerdict("0x222", logs, 103n);
}

async function fromLiveTx(txHash: Hash): Promise<void> {
  console.log("Mode: live Moderato receipt\n");
  const source = new LiveRpcChainSource();
  const receipt = await source.getTransactionReceipt(txHash);
  if (!receipt) {
    throw new Error(`Receipt not found for ${txHash}`);
  }
  printVerdict(txHash, receipt.logs, receipt.blockNumber);
}

async function main(): Promise<void> {
  const arg = process.argv[2];
  if (!arg) {
    await fromFixture();
    return;
  }
  if (!arg.startsWith("0x") || arg.length !== 66) {
    throw new Error("Pass a 32-byte tx hash (0x...) or no args for the fixture");
  }
  await fromLiveTx(arg as Hash);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
