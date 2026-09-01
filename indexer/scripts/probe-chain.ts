/**
 * Manual probe against Moderato testnet. Requires network access.
 *
 *   npx tsx scripts/probe-chain.ts
 */
import { LiveRpcChainSource, RangeScanner } from "../src/chain/index.js";

const MASTER = "0xD79c4cF03a2244F599200073ac704392dd6a84a0" as const;

async function main() {
  const source = new LiveRpcChainSource();
  const chainId = await source.getChainId();
  const tip = await source.getBlockNumber("latest");
  const fromBlock = tip > 5_000n ? tip - 5_000n : 0n;

  console.log("chainId:", chainId);
  console.log("tip:", tip.toString());
  console.log("scanning blocks", fromBlock.toString(), "->", tip.toString());

  const scanner = new RangeScanner(source);
  const logs = await scanner.scanMasterTransfers(fromBlock, tip, {
    masterAddresses: [MASTER],
    onRange: (range, count) => {
      if (count > 0) {
        console.log(
          `  blocks ${range.fromBlock}-${range.toBlock}: ${count} hop-2 logs`,
        );
      }
    },
  });

  console.log("total master-crediting logs:", logs.length);
  if (logs[0]) {
    console.log("sample tx:", logs[0].transactionHash);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
