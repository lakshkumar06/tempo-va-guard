import {
  createPublicClient,
  http,
  parseAbiItem,
  type Address,
  type Hash,
  type Log,
} from "viem";
import { tempoModerato } from "viem/chains";
import {
  ChainSourceError,
  type BlockHeader,
  type BlockTag,
  type ChainSource,
  type IndexedLog,
  type MasterTransferQuery,
  type TransactionReceipt,
  type TransfersToAddressesQuery,
  TEMPO_MODERATO_RPC_URL,
  TIP20_TOKENS,
} from "./types.js";

function toIndexedLog(log: Log): IndexedLog {
  if (
    log.blockNumber === null ||
    log.blockHash === null ||
    !log.transactionHash ||
    log.transactionIndex === null
  ) {
    throw new ChainSourceError(
      "RPC returned a log without block/transaction metadata",
      "RPC_ERROR",
    );
  }

  return {
    ...log,
    blockNumber: log.blockNumber,
    blockHash: log.blockHash,
    transactionHash: log.transactionHash,
    transactionIndex: log.transactionIndex,
  };
}

function classifyRpcError(error: unknown): ChainSourceError {
  const message =
    error instanceof Error ? error.message : "Unknown RPC error";
  const lower = message.toLowerCase();

  if (
    lower.includes("too many") ||
    lower.includes("exceed") ||
    lower.includes("limit")
  ) {
    return new ChainSourceError(message, "TOO_MANY_RESULTS", error);
  }
  if (lower.includes("rate") || lower.includes("429")) {
    return new ChainSourceError(message, "RATE_LIMITED", error);
  }
  return new ChainSourceError(message, "RPC_ERROR", error);
}

export type LiveRpcChainSourceOptions = {
  rpcUrl?: string;
  chainId?: number;
};

const TRANSFER_EVENT = parseAbiItem(
  "event Transfer(address indexed from, address indexed to, uint256 value)",
);

export class LiveRpcChainSource implements ChainSource {
  private readonly client;

  constructor(options: LiveRpcChainSourceOptions = {}) {
    const chain = {
      ...tempoModerato,
      id: options.chainId ?? tempoModerato.id,
    };

    this.client = createPublicClient({
      chain,
      transport: http(options.rpcUrl ?? TEMPO_MODERATO_RPC_URL),
    });
  }

  async getChainId(): Promise<number> {
    return this.client.getChainId();
  }

  async getBlockNumber(tag: BlockTag = "latest"): Promise<bigint> {
    if (tag === "latest") {
      return this.client.getBlockNumber();
    }
    const block = await this.client.getBlock({ blockTag: tag });
    return block.number;
  }

  async getBlock(number: bigint): Promise<BlockHeader | null> {
    try {
      const block = await this.client.getBlock({ blockNumber: number });
      return {
        number: block.number,
        hash: block.hash,
        parentHash: block.parentHash,
      };
    } catch (error) {
      throw classifyRpcError(error);
    }
  }

  async getMasterTransferLogs(
    query: MasterTransferQuery,
  ): Promise<IndexedLog[]> {
    if (query.masterAddresses.length === 0) {
      return [];
    }

    const tokens = query.tokenAddresses ?? TIP20_TOKENS;
    const toFilter =
      query.masterAddresses.length === 1
        ? query.masterAddresses[0]
        : [...query.masterAddresses];

    try {
      const logs = await this.client.getLogs({
        address: [...tokens] as Address[],
        fromBlock: query.fromBlock,
        toBlock: query.toBlock,
        event: TRANSFER_EVENT,
        args: {
          to: toFilter,
        },
      });

      return logs.map(toIndexedLog);
    } catch (error) {
      throw classifyRpcError(error);
    }
  }

  async getTransfersToAddresses(
    query: TransfersToAddressesQuery,
  ): Promise<IndexedLog[]> {
    if (query.toAddresses.length === 0) {
      return [];
    }

    const toFilter =
      query.toAddresses.length === 1
        ? query.toAddresses[0]
        : [...query.toAddresses];

    try {
      const logs = await this.client.getLogs({
        fromBlock: query.fromBlock,
        toBlock: query.toBlock,
        event: TRANSFER_EVENT,
        args: {
          to: toFilter,
        },
      });

      return logs.map(toIndexedLog);
    } catch (error) {
      throw classifyRpcError(error);
    }
  }

  async getTransactionReceipt(hash: Hash): Promise<TransactionReceipt | null> {
    try {
      const receipt = await this.client.getTransactionReceipt({ hash });
      if (!receipt) {
        return null;
      }

      return {
        transactionHash: receipt.transactionHash,
        blockNumber: receipt.blockNumber,
        blockHash: receipt.blockHash,
        status: receipt.status,
        logs: receipt.logs.map(toIndexedLog),
      };
    } catch (error) {
      throw classifyRpcError(error);
    }
  }
}
