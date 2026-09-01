import type { Address, Hash, Hex, Log } from "viem";

export const TEMPO_MODERATO_CHAIN_ID = 42_431;
export const TEMPO_MODERATO_RPC_URL = "https://rpc.moderato.tempo.xyz";

/** Canonical TIP-20 stablecoins on Tempo (mainnet + testnet share addresses). */
export const TIP20_TOKENS = [
  "0x20c0000000000000000000000000000000000000",
  "0x20c0000000000000000000000000000000000001",
  "0x20c0000000000000000000000000000000000002",
  "0x20c0000000000000000000000000000000000003",
] as const satisfies readonly Address[];

export const TRANSFER_EVENT_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef" as const;

export const REGISTRY_ADDRESS =
  "0xFDC0000000000000000000000000000000000000" as const;

export type BlockTag = "latest" | "finalized" | "safe";

export type BlockHeader = {
  number: bigint;
  hash: Hash;
  parentHash: Hash;
};

export type IndexedLog = Log & {
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
  transactionIndex: number;
};

export type TransactionReceipt = {
  transactionHash: Hash;
  blockNumber: bigint;
  blockHash: Hash;
  status: "success" | "reverted";
  logs: IndexedLog[];
};

export type LogRange = {
  fromBlock: bigint;
  toBlock: bigint;
};

export type MasterTransferQuery = LogRange & {
  masterAddresses: readonly Address[];
  tokenAddresses?: readonly Address[];
};

export class ChainSourceError extends Error {
  constructor(
    message: string,
    readonly code: "RATE_LIMITED" | "TOO_MANY_RESULTS" | "RPC_ERROR",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "ChainSourceError";
  }
}

export interface ChainSource {
  getChainId(): Promise<number>;
  getBlockNumber(tag?: BlockTag): Promise<bigint>;
  getBlock(number: bigint): Promise<BlockHeader | null>;
  getMasterTransferLogs(query: MasterTransferQuery): Promise<IndexedLog[]>;
  getTransactionReceipt(hash: Hash): Promise<TransactionReceipt | null>;
}

export function padAddressTopic(address: Address): Hex {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}` as Hex;
}

export function uniqueTransactionHashes(logs: readonly IndexedLog[]): Hash[] {
  const seen = new Set<string>();
  const hashes: Hash[] = [];
  for (const log of logs) {
    const key = log.transactionHash.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      hashes.push(log.transactionHash);
    }
  }
  return hashes;
}
