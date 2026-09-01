import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Hash } from "viem";
import { makeTransferLog } from "../../src/chain/fakeChain.js";
import { TIP20_TOKENS } from "../../src/chain/types.js";
import { encodeVirtualAddress } from "../../src/codec/virtualAddress.js";
import {
  pairDepositsFromLogs,
  sumDepositAmounts,
  sumHop2Amounts,
} from "../../src/pairer/hopPairer.js";
import { asMasterId, asUserTag } from "../../src/types/brands.js";
import {
  buildDirectToMasterFixtureLogs,
  buildMintFixtureLogs,
  buildNonTip20StuckFixtureLogs,
  buildSelfForwardFixtureLogs,
  buildTransferFixtureLogs,
  buildTransferWithMemoFixtureLogs,
} from "../fixtures/logBuilders.js";

const TOKEN = TIP20_TOKENS[0];
const MASTER = "0xD79c4cF03a2244F599200073ac704392dd6a84a0" as const;
const SENDER = "0x1111111111111111111111111111111111111111" as const;
const VIRTUAL = encodeVirtualAddress(
  asMasterId("0xb1977b69"),
  asUserTag("0x000000000001"),
);

describe("hop pairer", () => {
  it("parses a plain transfer deposit", () => {
    const logs = buildTransferFixtureLogs();
    const result = pairDepositsFromLogs(logs, "0xabc" as Hash);

    expect(result.deposits).toHaveLength(1);
    expect(result.deposits[0]).toMatchObject({
      depositor: SENDER,
      master: MASTER,
      masterId: "0xb1977b69",
      userTag: "0x000000000001",
      virtualAddress: VIRTUAL,
      amount: 5_000_000n,
      entrypoint: "transfer",
      hop1LogIndex: 0,
      hop2LogIndex: 1,
    });
    expect(result.unpairedHops).toHaveLength(0);
  });

  it("parses transferWithMemo with interleaved memo log", () => {
    const logs = buildTransferWithMemoFixtureLogs();
    const result = pairDepositsFromLogs(logs, "0xdef" as Hash);

    expect(result.deposits).toHaveLength(1);
    expect(result.deposits[0]?.entrypoint).toBe("transfer_with_memo");
    expect(result.deposits[0]?.memo).toBeDefined();
  });

  it("parses mint path with interleaved Mint log", () => {
    const logs = buildMintFixtureLogs();
    const result = pairDepositsFromLogs(logs, "0x111" as Hash);

    expect(result.deposits).toHaveLength(1);
    expect(result.deposits[0]?.entrypoint).toBe("mint");
    expect(result.deposits[0]?.depositor).toBe(
      "0x0000000000000000000000000000000000000000",
    );
  });

  it("flags stranded non-TIP-20 as unpaired hop 1", () => {
    const logs = buildNonTip20StuckFixtureLogs();
    const result = pairDepositsFromLogs(logs, "0x222" as Hash);

    expect(result.deposits).toHaveLength(0);
    expect(result.unpairedHops).toHaveLength(1);
    expect(result.unpairedHops[0]).toMatchObject({ hop: 1 });
  });

  it("still pairs self-forward hops (classifier filters later)", () => {
    const logs = buildSelfForwardFixtureLogs();
    const result = pairDepositsFromLogs(logs, "0x333" as Hash);

    expect(result.deposits).toHaveLength(1);
    expect(result.deposits[0]?.depositor).toBe(MASTER);
  });

  it("ignores direct-to-master transfers", () => {
    const logs = buildDirectToMasterFixtureLogs();
    const result = pairDepositsFromLogs(logs, "0x444" as Hash);

    expect(result.deposits).toHaveLength(0);
    expect(result.unpairedHops).toHaveLength(0);
  });

  it("conserves amounts against hop-2 totals", () => {
    const logs = buildTransferFixtureLogs();
    const result = pairDepositsFromLogs(logs, "0xabc" as Hash);
    expect(sumDepositAmounts(result.deposits)).toBe(sumHop2Amounts(logs, MASTER));
  });

  it("remains stable when unrelated logs are injected between hops", () => {
    const base = buildTransferFixtureLogs();
    const noise = makeTransferLog({
      token: TOKEN,
      from: SENDER,
      to: "0x2222222222222222222222222222222222222222",
      amount: 99n,
      logIndex: 1,
      blockNumber: base[0]!.blockNumber,
      blockHash: base[0]!.blockHash,
      transactionHash: base[0]!.transactionHash,
    });

    const logs = [base[0]!, noise, { ...base[1]!, logIndex: 2 }];
    const result = pairDepositsFromLogs(logs, base[0]!.transactionHash);

    expect(result.deposits).toHaveLength(1);
    expect(result.deposits[0]?.hop2LogIndex).toBe(2);
  });

  it("property: injected noise does not change paired deposit count", () => {
    fc.assert(
      fc.property(fc.nat({ max: 5 }), (noiseCount) => {
        const base = buildTransferFixtureLogs();
        const logs = [...base];
        for (let i = 0; i < noiseCount; i++) {
          logs.splice(1 + i, 0, makeTransferLog({
            token: TOKEN,
            from: SENDER,
            to: "0x3333333333333333333333333333333333333333",
            amount: BigInt(i + 1),
            logIndex: 100 + i,
            blockNumber: base[0]!.blockNumber,
            blockHash: base[0]!.blockHash,
            transactionHash: base[0]!.transactionHash,
          }));
        }
        const result = pairDepositsFromLogs(logs, base[0]!.transactionHash);
        expect(result.deposits).toHaveLength(1);
      }),
    );
  });
});
