import { decodeEventLog, type Address, type Hash } from "viem";
import type { IndexedLog } from "../chain/types.js";
import { TIP20_TOKENS, REGISTRY_ADDRESS } from "../chain/types.js";
import type { ParsedDeposit, UnpairedHop } from "../pairer/hopPairer.js";

export const MASTER_REGISTERED_EVENT_ABI = {
  type: "event",
  name: "MasterRegistered",
  inputs: [
    { indexed: true, name: "masterId", type: "bytes4" },
    { indexed: true, name: "masterAddress", type: "address" },
  ],
} as const;

export type ClassifiedDeposit = {
  kind: "deposit";
  deposit: ParsedDeposit;
  isSelfForward: boolean;
  masterAddress: Address;
};

export type ClassifiedAnomaly = {
  kind: "anomaly";
  anomalyKind: "stranded_non_tip20" | "unpaired_hop";
  detail: Record<string, unknown>;
  blockNumber?: bigint;
  txHash?: Hash;
  token?: Address;
  virtualAddress?: Address;
  amount?: bigint;
};

export type Classification = ClassifiedDeposit | ClassifiedAnomaly;

export class RegistryCache {
  private readonly masters = new Map<string, Address>();

  register(masterId: string, masterAddress: Address): void {
    this.masters.set(masterId.toLowerCase(), masterAddress);
  }

  getMaster(masterId: string): Address | undefined {
    return this.masters.get(masterId.toLowerCase());
  }

  entries(): Array<{ masterId: string; masterAddress: Address }> {
    return [...this.masters.entries()].map(([masterId, masterAddress]) => ({
      masterId,
      masterAddress,
    }));
  }
}

export function parseMasterRegisteredLog(
  log: IndexedLog,
): { masterId: string; masterAddress: Address } | null {
  if (log.address.toLowerCase() !== REGISTRY_ADDRESS.toLowerCase()) {
    return null;
  }

  try {
    const decoded = decodeEventLog({
      abi: [MASTER_REGISTERED_EVENT_ABI],
      data: log.data,
      topics: log.topics,
    });
    if (decoded.eventName !== "MasterRegistered") {
      return null;
    }
    return {
      masterId: decoded.args.masterId.toLowerCase(),
      masterAddress: decoded.args.masterAddress,
    };
  } catch {
    return null;
  }
}

export function warmRegistryFromLogs(
  cache: RegistryCache,
  logs: readonly IndexedLog[],
): void {
  for (const log of logs) {
    const registered = parseMasterRegisteredLog(log);
    if (registered) {
      cache.register(registered.masterId, registered.masterAddress);
    }
  }
}

const tip20Set = new Set(TIP20_TOKENS.map((token) => token.toLowerCase()));

export function isTip20Token(token: Address): boolean {
  return tip20Set.has(token.toLowerCase());
}

export function classifyDeposit(
  deposit: ParsedDeposit,
  registry: RegistryCache,
): Classification {
  const masterAddress =
    registry.getMaster(deposit.masterId) ?? deposit.master;
  const isSelfForward =
    deposit.depositor.toLowerCase() === masterAddress.toLowerCase();

  return {
    kind: "deposit",
    deposit,
    isSelfForward,
    masterAddress,
  };
}

export function classifyUnpairedHop(
  hop: UnpairedHop,
  context: { blockNumber: bigint; txHash: Hash },
): ClassifiedAnomaly {
  if (hop.hop === 1 && !isTip20Token(hop.token)) {
    return {
      kind: "anomaly",
      anomalyKind: "stranded_non_tip20",
      blockNumber: context.blockNumber,
      txHash: context.txHash,
      token: hop.token,
      virtualAddress: hop.virtualAddress,
      amount: hop.amount,
      detail: {
        hop: hop.hop,
        logIndex: hop.logIndex,
        message: "Non-TIP-20 token transferred to virtual address with no hop-2",
      },
    };
  }

  return {
    kind: "anomaly",
    anomalyKind: "unpaired_hop",
    blockNumber: context.blockNumber,
    txHash: context.txHash,
    token: hop.token,
    virtualAddress: hop.virtualAddress,
    amount: hop.amount,
    detail: {
      hop: hop.hop,
      logIndex: hop.logIndex,
      master: hop.master,
    },
  };
}

export function classifyTransaction(
  deposits: readonly ParsedDeposit[],
  unpairedHops: readonly UnpairedHop[],
  registry: RegistryCache,
  context: { blockNumber: bigint; txHash: Hash },
): Classification[] {
  const results: Classification[] = [];

  for (const deposit of deposits) {
    results.push(classifyDeposit(deposit, registry));
  }

  for (const hop of unpairedHops) {
    results.push(classifyUnpairedHop(hop, context));
  }

  return results;
}
