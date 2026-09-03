import { describe, expect, it } from "vitest";
import type { Hash } from "viem";
import {
  ConfirmationGate,
  ContinuityGuard,
  resolveFinalizedBlock,
} from "../../src/ingest/confirmation.js";
import { createTempRepository } from "../../src/ingest/processor.js";
import { asMasterId, asUserTag } from "../../src/types/brands.js";

describe("confirmation and continuity", () => {
  it("promotes detected deposits up to finalized block", () => {
    const { repo, cleanup } = createTempRepository();
    const gate = new ConfirmationGate(repo);

    repo.commitBlock({
      chainId: 1,
      block: {
        number: 10n,
        hash: "0xb10" as Hash,
        parentHash: "0xb9" as Hash,
      },
      deposits: [
        {
          kind: "deposit",
          isSelfForward: false,
          masterAddress: "0xD79c4cF03a2244F599200073ac704392dd6a84a0",
          deposit: {
            depositor: "0x1111111111111111111111111111111111111111",
            master: "0xD79c4cF03a2244F599200073ac704392dd6a84a0",
            masterId: asMasterId("0xb1977b69"),
            userTag: asUserTag("0x000000000001"),
            virtualAddress:
              "0xB1977b69FDFdfDFDfDFDFdFdFDFd000000000001",
            token: "0x20c0000000000000000000000000000000000000",
            amount: 100n,
            txHash: "0xtx1" as Hash,
            hop1LogIndex: 0,
            hop2LogIndex: 1,
            entrypoint: "transfer",
          },
        },
      ],
      anomalies: [],
    });

    expect(gate.promoteToConfirmed(10n)).toBe(1);
    expect(repo.listDeposits()[0]?.status).toBe("confirmed");
    cleanup();
  });

  it("detects parent hash mismatch", () => {
    const { repo, cleanup } = createTempRepository();
    const guard = new ContinuityGuard(repo);

    repo.commitBlock({
      chainId: 1,
      block: {
        number: 5n,
        hash: "0xb5" as Hash,
        parentHash: "0xb4" as Hash,
      },
      deposits: [],
      anomalies: [],
    });

    const result = guard.verify({
      number: 6n,
      hash: "0xb6" as Hash,
      parentHash: "0xwrong" as Hash,
    });

    expect(result.ok).toBe(false);
    cleanup();
  });

  it("orphans detected deposits on rollback", () => {
    const { repo, cleanup } = createTempRepository();
    const guard = new ContinuityGuard(repo);

    repo.commitBlock({
      chainId: 1,
      block: {
        number: 20n,
        hash: "0xb20" as Hash,
        parentHash: "0xb19" as Hash,
      },
      deposits: [
        {
          kind: "deposit",
          isSelfForward: false,
          masterAddress: "0xD79c4cF03a2244F599200073ac704392dd6a84a0",
          deposit: {
            depositor: "0x1111111111111111111111111111111111111111",
            master: "0xD79c4cF03a2244F599200073ac704392dd6a84a0",
            masterId: asMasterId("0xb1977b69"),
            userTag: asUserTag("0x000000000001"),
            virtualAddress:
              "0xB1977b69FDFdfDFDfDFDFdFdFDFd000000000001",
            token: "0x20c0000000000000000000000000000000000000",
            amount: 100n,
            txHash: "0xtx2" as Hash,
            hop1LogIndex: 0,
            hop2LogIndex: 1,
            entrypoint: "transfer",
          },
        },
      ],
      anomalies: [],
    });

    expect(guard.rollbackFrom(20n).orphaned).toBe(1);
    expect(repo.listDeposits()[0]?.status).toBe("orphaned");
    cleanup();
  });

  it("can orphan confirmed deposits and report them for compensation", () => {
    const { repo, cleanup } = createTempRepository();
    const gate = new ConfirmationGate(repo);
    const guard = new ContinuityGuard(repo);

    repo.commitBlock({
      chainId: 1,
      block: {
        number: 30n,
        hash: "0xb30" as Hash,
        parentHash: "0xb29" as Hash,
      },
      deposits: [
        {
          kind: "deposit",
          isSelfForward: false,
          masterAddress: "0xD79c4cF03a2244F599200073ac704392dd6a84a0",
          deposit: {
            depositor: "0x1111111111111111111111111111111111111111",
            master: "0xD79c4cF03a2244F599200073ac704392dd6a84a0",
            masterId: asMasterId("0xb1977b69"),
            userTag: asUserTag("0x000000000001"),
            virtualAddress:
              "0xB1977b69FDFdfDFDfDFDFdFdFDFd000000000001",
            token: "0x20c0000000000000000000000000000000000000",
            amount: 100n,
            txHash: "0xtx3" as Hash,
            hop1LogIndex: 0,
            hop2LogIndex: 1,
            entrypoint: "transfer",
          },
        },
      ],
      anomalies: [],
    });
    gate.promoteToConfirmed(30n);

    const result = guard.rollbackFrom(30n, { includeConfirmed: true });
    expect(result.orphaned).toBe(1);
    expect(result.previouslyConfirmed).toHaveLength(1);
    expect(repo.listDeposits()[0]?.status).toBe("orphaned");
    cleanup();
  });

  it("prefers explicit rpc_finalized finality mode", () => {
    expect(
      resolveFinalizedBlock({ kind: "rpc_finalized", finalizedBlock: 90n }),
    ).toBe(90n);
    expect(
      resolveFinalizedBlock({ kind: "depth", latestBlock: 100n, depth: 20n }),
    ).toBe(80n);
  });

  it("falls back to depth when finalized tag unavailable", () => {
    expect(resolveFinalizedBlock(100n, false, null, 20n)).toBe(80n);
  });
});
