import { describe, expect, it } from "vitest";
import type { Hash } from "viem";
import { RegistryCache } from "../../src/classifier/index.js";
import { makeTransferLog } from "../../src/chain/fakeChain.js";
import { TIP20_TOKENS } from "../../src/chain/types.js";
import { encodeVirtualAddress } from "../../src/codec/virtualAddress.js";
import { BlockProcessor, createTempRepository } from "../../src/ingest/processor.js";
import { asMasterId, asUserTag } from "../../src/types/brands.js";

const TOKEN = TIP20_TOKENS[0];
const MASTER = "0xD79c4cF03a2244F599200073ac704392dd6a84a0" as const;
const SENDER = "0x1111111111111111111111111111111111111111" as const;
const VIRTUAL = encodeVirtualAddress(
  asMasterId("0xb1977b69"),
  asUserTag("0x000000000001"),
);

describe("persistence", () => {
  it("applies migrations on open", () => {
    const { repo, cleanup } = createTempRepository();
    expect(repo.countDeposits()).toBe(0);
    cleanup();
  });

  it("is idempotent when reprocessing the same block", () => {
    const { repo, cleanup } = createTempRepository();
    const processor = new BlockProcessor(repo);
    const registry = new RegistryCache();
    registry.register("0xb1977b69", MASTER);

    const block = {
      number: 200n,
      hash: "0xblock200" as Hash,
      parentHash: "0xblock199" as Hash,
    };
    const txHash = "0xdeposit1" as Hash;
    const logs = [
      makeTransferLog({
        token: TOKEN,
        from: SENDER,
        to: VIRTUAL,
        amount: 1_000_000n,
        logIndex: 0,
        blockNumber: block.number,
        blockHash: block.hash,
        transactionHash: txHash,
      }),
      makeTransferLog({
        token: TOKEN,
        from: VIRTUAL,
        to: MASTER,
        amount: 1_000_000n,
        logIndex: 1,
        blockNumber: block.number,
        blockHash: block.hash,
        transactionHash: txHash,
      }),
    ];

    const input = {
      chainId: 42431,
      block,
      receipts: [{ transactionHash: txHash, logs }],
      registry,
    };

    processor.processBlock(input);
    processor.processBlock(input);

    expect(repo.countDeposits()).toBe(1);
    cleanup();
  });

  it("recovers after simulated crash without duplicates", () => {
    const { repo, cleanup } = createTempRepository();
    const processor = new BlockProcessor(repo);
    const registry = new RegistryCache();
    registry.register("0xb1977b69", MASTER);

    const makeBlock = (number: bigint, txSuffix: string) => {
      const hash = `0xblock${number}` as Hash;
      const txHash = `0xtx${txSuffix}` as Hash;
      return {
        block: {
          number,
          hash,
          parentHash: `0xparent${number}` as Hash,
        },
        receipt: {
          transactionHash: txHash,
          logs: [
            makeTransferLog({
              token: TOKEN,
              from: SENDER,
              to: VIRTUAL,
              amount: 1_000_000n,
              logIndex: 0,
              blockNumber: number,
              blockHash: hash,
              transactionHash: txHash,
            }),
            makeTransferLog({
              token: TOKEN,
              from: VIRTUAL,
              to: MASTER,
              amount: 1_000_000n,
              logIndex: 1,
              blockNumber: number,
              blockHash: hash,
              transactionHash: txHash,
            }),
          ],
        },
      };
    };

    const block1 = makeBlock(301n, "a");
    processor.processBlock({
      chainId: 42431,
      block: block1.block,
      receipts: [block1.receipt],
      registry,
    });

    // Simulate restart: same repo, reprocess block 301 and continue to 302.
    processor.processBlock({
      chainId: 42431,
      block: block1.block,
      receipts: [block1.receipt],
      registry,
    });

    const block2 = makeBlock(302n, "b");
    processor.processBlock({
      chainId: 42431,
      block: block2.block,
      receipts: [block2.receipt],
      registry,
    });

    expect(repo.countDeposits()).toBe(2);
    expect(repo.getCursor()?.lastBlock).toBe(302n);
    cleanup();
  });
});
