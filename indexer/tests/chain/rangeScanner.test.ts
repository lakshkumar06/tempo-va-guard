import { describe, expect, it, vi } from "vitest";
import { RangeScanner } from "../../src/chain/rangeScanner.js";
import { ChainSourceError, type ChainSource } from "../../src/chain/types.js";

describe("RangeScanner retries", () => {
  it("retries transient RPC errors then succeeds", async () => {
    let attempts = 0;
    const source = {
      getMasterTransferLogs: vi.fn(async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new ChainSourceError("temporary", "RATE_LIMITED");
        }
        return [];
      }),
    } as unknown as ChainSource;

    const scanner = new RangeScanner(source, {
      initialRangeSize: 10n,
      maxRangeSize: 10n,
      maxRetries: 5,
    });

    const logs = await scanner.scanMasterTransfers(1n, 5n, {
      masterAddresses: ["0xD79c4cF03a2244F599200073ac704392dd6a84a0"],
    });

    expect(logs).toEqual([]);
    expect(attempts).toBe(3);
  });
});
