import { decodeEventLog, type Address, type Hash, type Hex } from "viem";
import { isVirtualAddress, decodeVirtualAddress } from "../codec/virtualAddress.js";
import type { MasterId, UserTag } from "../types/brands.js";
import { TIP20_TOKENS, type IndexedLog } from "../chain/types.js";

export const TRANSFER_EVENT_ABI = {
  type: "event",
  name: "Transfer",
  inputs: [
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: false, name: "value", type: "uint256" },
  ],
} as const;

export const TRANSFER_WITH_MEMO_EVENT_ABI = {
  type: "event",
  name: "TransferWithMemo",
  inputs: [
    { indexed: true, name: "from", type: "address" },
    { indexed: true, name: "to", type: "address" },
    { indexed: false, name: "amount", type: "uint256" },
    { indexed: false, name: "memo", type: "bytes32" },
  ],
} as const;

export const MINT_EVENT_ABI = {
  type: "event",
  name: "Mint",
  inputs: [
    { indexed: true, name: "to", type: "address" },
    { indexed: false, name: "amount", type: "uint256" },
  ],
} as const;

export type DepositEntrypoint =
  | "transfer"
  | "transfer_with_memo"
  | "mint"
  | "mint_with_memo";

export type ParsedDeposit = {
  depositor: Address;
  master: Address;
  masterId: MasterId;
  userTag: UserTag;
  virtualAddress: Address;
  token: Address;
  amount: bigint;
  txHash: Hash;
  hop1LogIndex: number;
  hop2LogIndex: number;
  memo?: Hex;
  entrypoint: DepositEntrypoint;
};

export type UnpairedHop = {
  kind: "unpaired_hop";
  hop: 1 | 2;
  token: Address;
  virtualAddress?: Address;
  master?: Address;
  amount: bigint;
  logIndex: number;
};

export type PairDepositsResult = {
  deposits: ParsedDeposit[];
  unpairedHops: UnpairedHop[];
};

type ParsedTransfer = {
  kind: "transfer";
  token: Address;
  from: Address;
  to: Address;
  amount: bigint;
  logIndex: number;
};

type ParsedTransferWithMemo = {
  kind: "transfer_with_memo";
  token: Address;
  from: Address;
  to: Address;
  amount: bigint;
  memo: Hex;
  logIndex: number;
};

type ParsedMint = {
  kind: "mint";
  token: Address;
  to: Address;
  amount: bigint;
  logIndex: number;
};

type ParsedEvent = ParsedTransfer | ParsedTransferWithMemo | ParsedMint;

type Hop1Candidate = ParsedTransfer & { virtualAddress: Address };
type Hop2Candidate = ParsedTransfer & {
  virtualAddress: Address;
  master: Address;
};

function tryDecodeTransfer(log: IndexedLog): ParsedTransfer | null {
  try {
    const decoded = decodeEventLog({
      abi: [TRANSFER_EVENT_ABI],
      data: log.data,
      topics: log.topics,
    });
    if (decoded.eventName !== "Transfer") {
      return null;
    }
    return {
      kind: "transfer",
      token: log.address,
      from: decoded.args.from,
      to: decoded.args.to,
      amount: decoded.args.value,
      logIndex: log.logIndex ?? 0,
    };
  } catch {
    return null;
  }
}

function tryDecodeTransferWithMemo(log: IndexedLog): ParsedTransferWithMemo | null {
  try {
    const decoded = decodeEventLog({
      abi: [TRANSFER_WITH_MEMO_EVENT_ABI],
      data: log.data,
      topics: log.topics,
    });
    if (decoded.eventName !== "TransferWithMemo") {
      return null;
    }
    return {
      kind: "transfer_with_memo",
      token: log.address,
      from: decoded.args.from,
      to: decoded.args.to,
      amount: decoded.args.amount,
      memo: decoded.args.memo,
      logIndex: log.logIndex ?? 0,
    };
  } catch {
    return null;
  }
}

function tryDecodeMint(log: IndexedLog): ParsedMint | null {
  try {
    const decoded = decodeEventLog({
      abi: [MINT_EVENT_ABI],
      data: log.data,
      topics: log.topics,
    });
    if (decoded.eventName !== "Mint") {
      return null;
    }
    return {
      kind: "mint",
      token: log.address,
      to: decoded.args.to,
      amount: decoded.args.amount,
      logIndex: log.logIndex ?? 0,
    };
  } catch {
    return null;
  }
}

function parseEvents(logs: readonly IndexedLog[]): ParsedEvent[] {
  const events: ParsedEvent[] = [];
  for (const log of logs) {
    const transfer = tryDecodeTransfer(log);
    if (transfer) {
      events.push(transfer);
      continue;
    }
    const transferWithMemo = tryDecodeTransferWithMemo(log);
    if (transferWithMemo) {
      events.push(transferWithMemo);
      continue;
    }
    const mint = tryDecodeMint(log);
    if (mint) {
      events.push(mint);
    }
  }
  return events.sort((a, b) => a.logIndex - b.logIndex);
}

function detectEntrypoint(
  events: readonly ParsedEvent[],
  hop1: Hop1Candidate,
  hop2: Hop2Candidate,
): { entrypoint: DepositEntrypoint; memo?: Hex } {
  const between = events.filter(
    (event) => event.logIndex > hop1.logIndex && event.logIndex < hop2.logIndex,
  );

  const memoEvent = between.find(
    (event): event is ParsedTransferWithMemo => event.kind === "transfer_with_memo",
  );
  const hasMint = between.some((event) => event.kind === "mint");
  const isMintPath =
    hop1.from.toLowerCase() ===
    "0x0000000000000000000000000000000000000000";

  if (isMintPath && memoEvent) {
    return { entrypoint: "mint_with_memo", memo: memoEvent.memo };
  }
  if (isMintPath && hasMint) {
    return { entrypoint: "mint" };
  }
  if (memoEvent) {
    return { entrypoint: "transfer_with_memo", memo: memoEvent.memo };
  }
  return { entrypoint: "transfer" };
}

function pairKey(token: Address, virtual: Address, amount: bigint): string {
  return `${token.toLowerCase()}:${virtual.toLowerCase()}:${amount}`;
}

export type PairDepositsOptions = {
  /**
   * Only emit deposits for these token contracts (default: canonical TIP-20 set).
   * Non-allowlisted transfers to virtual addresses remain unpaired hops so the
   * guard can flag stranded unsupported tokens.
   */
  tip20Allowlist?: readonly Address[];
};

function isAllowlistedToken(
  token: Address,
  allowlist: ReadonlySet<string>,
): boolean {
  return allowlist.has(token.toLowerCase());
}

/**
 * Pair hop-1 (→virtual) and hop-2 (virtual→master) Transfer events within one tx.
 * Tolerates interleaved TransferWithMemo and Mint logs per TIP-1022.
 *
 * Deposit records require an allowlisted TIP-20 token. Arbitrary ERC-20-shaped
 * Transfer logs cannot produce deposits.
 */
export function pairDepositsFromLogs(
  logs: readonly IndexedLog[],
  txHash: Hash,
  options: PairDepositsOptions = {},
): PairDepositsResult {
  const allowlist = new Set(
    (options.tip20Allowlist ?? TIP20_TOKENS).map((token) =>
      token.toLowerCase(),
    ),
  );
  const events = parseEvents(logs);
  const transfers = events.filter(
    (event): event is ParsedTransfer => event.kind === "transfer",
  );

  const hop1Candidates: Hop1Candidate[] = [];
  const hop2Candidates: Hop2Candidate[] = [];

  for (const transfer of transfers) {
    if (isVirtualAddress(transfer.to)) {
      hop1Candidates.push({
        ...transfer,
        virtualAddress: transfer.to,
      });
    }
    if (
      isVirtualAddress(transfer.from) &&
      !isVirtualAddress(transfer.to)
    ) {
      hop2Candidates.push({
        ...transfer,
        virtualAddress: transfer.from,
        master: transfer.to,
      });
    }
  }

  const usedHop1 = new Set<number>();
  const usedHop2 = new Set<number>();
  const deposits: ParsedDeposit[] = [];

  for (const hop2 of hop2Candidates) {
    // Spoofed two-hop patterns on non-TIP-20 contracts must not become deposits.
    if (!isAllowlistedToken(hop2.token, allowlist)) {
      continue;
    }

    const match = hop1Candidates.find(
      (hop1) =>
        !usedHop1.has(hop1.logIndex) &&
        hop1.token.toLowerCase() === hop2.token.toLowerCase() &&
        hop1.virtualAddress.toLowerCase() === hop2.virtualAddress.toLowerCase() &&
        hop1.amount === hop2.amount,
    );

    if (!match) {
      continue;
    }

    usedHop1.add(match.logIndex);
    usedHop2.add(hop2.logIndex);

    const { masterId, userTag } = decodeVirtualAddress(hop2.virtualAddress);
    const { entrypoint, memo } = detectEntrypoint(events, match, hop2);

    deposits.push({
      depositor: match.from,
      master: hop2.master,
      masterId,
      userTag,
      virtualAddress: hop2.virtualAddress,
      token: hop2.token,
      amount: hop2.amount,
      txHash,
      hop1LogIndex: match.logIndex,
      hop2LogIndex: hop2.logIndex,
      memo,
      entrypoint,
    });
  }

  const unpairedHops: UnpairedHop[] = [];

  for (const hop1 of hop1Candidates) {
    if (usedHop1.has(hop1.logIndex)) {
      continue;
    }
    unpairedHops.push({
      kind: "unpaired_hop",
      hop: 1,
      token: hop1.token,
      virtualAddress: hop1.virtualAddress,
      amount: hop1.amount,
      logIndex: hop1.logIndex,
    });
  }

  for (const hop2 of hop2Candidates) {
    if (usedHop2.has(hop2.logIndex)) {
      continue;
    }
    unpairedHops.push({
      kind: "unpaired_hop",
      hop: 2,
      token: hop2.token,
      virtualAddress: hop2.virtualAddress,
      master: hop2.master,
      amount: hop2.amount,
      logIndex: hop2.logIndex,
    });
  }

  return { deposits, unpairedHops };
}

/** Sum of paired deposit amounts (conservation check helper). */
export function sumDepositAmounts(deposits: readonly ParsedDeposit[]): bigint {
  return deposits.reduce((sum, deposit) => sum + deposit.amount, 0n);
}

export function sumHop2Amounts(
  logs: readonly IndexedLog[],
  master: Address,
): bigint {
  const events = parseEvents(logs);
  return events
    .filter(
      (event): event is ParsedTransfer =>
        event.kind === "transfer" &&
        isVirtualAddress(event.from) &&
        event.to.toLowerCase() === master.toLowerCase(),
    )
    .reduce((sum, event) => sum + event.amount, 0n);
}

// pairKey exported for tests
export { pairKey };
