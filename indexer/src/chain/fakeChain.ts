import type { Address, Hash } from "viem";
import {
  type BlockHeader,
  type BlockTag,
  type ChainSource,
  type IndexedLog,
  type MasterTransferQuery,
  type TransactionReceipt,
  TIP20_TOKENS,
  TRANSFER_EVENT_TOPIC,
  padAddressTopic,
} from "./types.js";

type FakeReceipt = TransactionReceipt;

export type FakeBlock = BlockHeader & {
  receipts: FakeReceipt[];
};

export class FakeChainSource implements ChainSource {
  private readonly chainId: number;
  private readonly blocks = new Map<bigint, FakeBlock>();
  private tip: bigint = 0n;

  constructor(chainId = 42_431) {
    this.chainId = chainId;
  }

  reset(blocks: FakeBlock[]): void {
    this.blocks.clear();
    for (const block of blocks) {
      this.blocks.set(block.number, block);
      if (block.number > this.tip) {
        this.tip = block.number;
      }
    }
  }

  appendBlock(block: FakeBlock): void {
    this.blocks.set(block.number, block);
    if (block.number > this.tip) {
      this.tip = block.number;
    }
  }

  rewriteFrom(number: bigint, blocks: FakeBlock[]): void {
    for (const key of [...this.blocks.keys()]) {
      if (key >= number) {
        this.blocks.delete(key);
      }
    }
    for (const block of blocks) {
      this.appendBlock(block);
    }
  }

  setTip(number: bigint): void {
    this.tip = number;
  }

  async getChainId(): Promise<number> {
    return this.chainId;
  }

  async getBlockNumber(_tag: BlockTag = "latest"): Promise<bigint> {
    return this.tip;
  }

  async getBlock(number: bigint): Promise<BlockHeader | null> {
    const block = this.blocks.get(number);
    if (!block) {
      return null;
    }
    return {
      number: block.number,
      hash: block.hash,
      parentHash: block.parentHash,
    };
  }

  async getMasterTransferLogs(
    query: MasterTransferQuery,
  ): Promise<IndexedLog[]> {
    const tokens = new Set(
      (query.tokenAddresses ?? TIP20_TOKENS).map((t) => t.toLowerCase()),
    );
    const masters = new Set(
      query.masterAddresses.map((a) => padAddressTopic(a).toLowerCase()),
    );

    const results: IndexedLog[] = [];

    for (let n = query.fromBlock; n <= query.toBlock; n++) {
      const block = this.blocks.get(n);
      if (!block) {
        continue;
      }

      for (const receipt of block.receipts) {
        for (const log of receipt.logs) {
          if (!log.address || !tokens.has(log.address.toLowerCase())) {
            continue;
          }
          if (!log.topics[0] || log.topics[0].toLowerCase() !== TRANSFER_EVENT_TOPIC) {
            continue;
          }
          const toTopic = log.topics[2]?.toLowerCase();
          if (!toTopic || !masters.has(toTopic)) {
            continue;
          }
          results.push(log);
        }
      }
    }

    return results;
  }

  async getTransactionReceipt(hash: Hash): Promise<TransactionReceipt | null> {
    for (const block of this.blocks.values()) {
      for (const receipt of block.receipts) {
        if (receipt.transactionHash.toLowerCase() === hash.toLowerCase()) {
          return receipt;
        }
      }
    }
    return null;
  }
}

export function makeTransferLog(params: {
  token: Address;
  from: Address;
  to: Address;
  amount: bigint;
  logIndex: number;
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
  transactionIndex?: number;
}): IndexedLog {
  return {
    address: params.token,
    blockHash: params.blockHash,
    blockNumber: params.blockNumber,
    data: `0x${params.amount.toString(16).padStart(64, "0")}` as `0x${string}`,
    logIndex: params.logIndex,
    removed: false,
    topics: [
      TRANSFER_EVENT_TOPIC,
      padAddressTopic(params.from),
      padAddressTopic(params.to),
    ],
    transactionHash: params.transactionHash,
    transactionIndex: params.transactionIndex ?? 0,
  };
}
