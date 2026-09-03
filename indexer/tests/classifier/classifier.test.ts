import { describe, expect, it } from "vitest";
import type { Hash } from "viem";
import {
  classifyDeposit,
  classifyTransaction,
  RegistryCache,
} from "../../src/classifier/index.js";
import { pairDepositsFromLogs } from "../../src/pairer/hopPairer.js";
import {
  buildDirectToMasterFixtureLogs,
  buildNonTip20StuckFixtureLogs,
  buildSelfForwardFixtureLogs,
  buildTransferFixtureLogs,
} from "../fixtures/logBuilders.js";

describe("classifier", () => {
  it("classifies a normal deposit", () => {
    const logs = buildTransferFixtureLogs();
    const paired = pairDepositsFromLogs(logs, "0xabc" as Hash);
    const registry = new RegistryCache();
    registry.register("0xb1977b69", "0xD79c4cF03a2244F599200073ac704392dd6a84a0");

    const result = classifyDeposit(paired.deposits[0]!, registry);
    expect(result.kind).toBe("deposit");
    if (result.kind === "deposit") {
      expect(result.isSelfForward).toBe(false);
      expect(result.masterAddress).toBe(
        "0xD79c4cF03a2244F599200073ac704392dd6a84a0",
      );
    }
  });

  it("flags self-forward deposits", () => {
    const logs = buildSelfForwardFixtureLogs();
    const paired = pairDepositsFromLogs(logs, "0x333" as Hash);
    const registry = new RegistryCache();
    registry.register("0xb1977b69", "0xD79c4cF03a2244F599200073ac704392dd6a84a0");

    const result = classifyDeposit(paired.deposits[0]!, registry);
    expect(result.kind).toBe("deposit");
    if (result.kind === "deposit") {
      expect(result.isSelfForward).toBe(true);
    }
  });

  it("classifies stranded non-TIP-20 as anomaly", () => {
    const logs = buildNonTip20StuckFixtureLogs();
    const paired = pairDepositsFromLogs(logs, "0x222" as Hash);
    const registry = new RegistryCache();

    const results = classifyTransaction(
      paired.deposits,
      paired.unpairedHops,
      registry,
      { blockNumber: 103n, txHash: "0x222" as Hash },
    );

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      kind: "anomaly",
      anomalyKind: "stranded_non_tip20",
    });
  });

  it("returns no classifications for direct-to-master transfers", () => {
    const logs = buildDirectToMasterFixtureLogs();
    const paired = pairDepositsFromLogs(logs, "0x444" as Hash);
    const registry = new RegistryCache();

    const results = classifyTransaction(
      paired.deposits,
      paired.unpairedHops,
      registry,
      { blockNumber: 105n, txHash: "0x444" as Hash },
    );

    expect(results).toHaveLength(0);
  });

  it("rejects deposits when masterId is missing from the registry", () => {
    const logs = buildTransferFixtureLogs();
    const paired = pairDepositsFromLogs(logs, "0xabc" as Hash);
    const registry = new RegistryCache();

    const result = classifyDeposit(paired.deposits[0]!, registry);
    expect(result).toMatchObject({
      kind: "anomaly",
      anomalyKind: "unregistered_master",
    });
  });

  it("rejects deposits when hop-2 recipient mismatches registry", () => {
    const logs = buildTransferFixtureLogs();
    const paired = pairDepositsFromLogs(logs, "0xabc" as Hash);
    const registry = new RegistryCache();
    registry.register(
      "0xb1977b69",
      "0x9999999999999999999999999999999999999999",
    );

    const result = classifyDeposit(paired.deposits[0]!, registry);
    expect(result).toMatchObject({
      kind: "anomaly",
      anomalyKind: "master_mismatch",
    });
  });
});
