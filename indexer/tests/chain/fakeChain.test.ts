import { describe, expect, it } from "vitest";
import type { Hash } from "viem";
import {
  FakeChainSource,
  makeTransferLog,
  padAddressTopic,
  TIP20_TOKENS,
} from "../../src/chain/index.js";
import { RangeScanner } from "../../src/chain/rangeScanner.js";

const TOKEN = TIP20_TOKENS[0];
const MASTER = "0xD79c4cF03a2244F599200073ac704392dd6a84a0" as const;
const VIRTUAL = "0xB1977b69FDFdfDFDfDFDFdFdFDFd000000000001" as const;
const SENDER = "0x1111111111111111111111111111111111111111" as const;

describe("FakeChainSource", () => {
  it("returns master-crediting transfer logs in range", async () => {
    const source = new FakeChainSource();
    const blockHash = "0xaaaa" as Hash;
    const txHash = "0xbbbb" as Hash;

    source.reset([
      {
        number: 100n,
        hash: blockHash,
        parentHash: "0x0001" as Hash,
        receipts: [
          {
            transactionHash: txHash,
            blockNumber: 100n,
            blockHash,
            status: "success",
            logs: [
              makeTransferLog({
                token: TOKEN,
                from: SENDER,
                to: VIRTUAL,
                amount: 5_000_000n,
                logIndex: 0,
                blockNumber: 100n,
                blockHash,
                transactionHash: txHash,
              }),
              makeTransferLog({
                token: TOKEN,
                from: VIRTUAL,
                to: MASTER,
                amount: 5_000_000n,
                logIndex: 1,
                blockNumber: 100n,
                blockHash,
                transactionHash: txHash,
              }),
            ],
          },
        ],
      },
    ]);

    const logs = await source.getMasterTransferLogs({
      fromBlock: 100n,
      toBlock: 100n,
      masterAddresses: [MASTER],
    });

    expect(logs).toHaveLength(1);
    expect(logs[0]?.topics[2]).toBe(padAddressTopic(MASTER));
  });

  it("supports rewriting history from a block height", async () => {
    const source = new FakeChainSource();
    source.reset([
      {
        number: 1n,
        hash: "0x01" as Hash,
        parentHash: "0x00" as Hash,
        receipts: [],
      },
    ]);

    source.rewriteFrom(1n, [
      {
        number: 1n,
        hash: "0x01fork" as Hash,
        parentHash: "0x00" as Hash,
        receipts: [],
      },
      {
        number: 2n,
        hash: "0x02" as Hash,
        parentHash: "0x01fork" as Hash,
        receipts: [],
      },
    ]);

    expect(await source.getBlock(1n)).toMatchObject({ hash: "0x01fork" });
    expect(await source.getBlockNumber()).toBe(2n);
  });
});

describe("RangeScanner", () => {
  it("scans across multiple adaptive ranges", async () => {
    const source = new FakeChainSource();
    const blockHash = "0xcccc" as Hash;
    const txHash = "0xdddd" as Hash;

    source.reset([
      {
        number: 10n,
        hash: blockHash,
        parentHash: "0x09" as Hash,
        receipts: [
          {
            transactionHash: txHash,
            blockNumber: 10n,
            blockHash,
            status: "success",
            logs: [
              makeTransferLog({
                token: TOKEN,
                from: VIRTUAL,
                to: MASTER,
                amount: 1n,
                logIndex: 0,
                blockNumber: 10n,
                blockHash,
                transactionHash: txHash,
              }),
            ],
          },
        ],
      },
    ]);

    const scanner = new RangeScanner(source, {
      initialRangeSize: 2n,
      maxRangeSize: 2n,
    });

    const ranges: string[] = [];
    const logs = await scanner.scanMasterTransfers(9n, 11n, {
      masterAddresses: [MASTER],
      onRange: (range) => {
        ranges.push(`${range.fromBlock}-${range.toBlock}`);
      },
    });

    expect(logs).toHaveLength(1);
    expect(ranges.length).toBeGreaterThan(0);
  });
});
