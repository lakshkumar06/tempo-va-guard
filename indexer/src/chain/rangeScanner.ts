import {
  ChainSourceError,
  type ChainSource,
  type IndexedLog,
  type LogRange,
  type MasterTransferQuery,
  uniqueTransactionHashes,
} from "./types.js";

export type RangeScannerOptions = {
  initialRangeSize?: bigint;
  minRangeSize?: bigint;
  maxRangeSize?: bigint;
  maxRetries?: number;
  receiptConcurrency?: number;
};

export type ScanMasterTransfersOptions = RangeScannerOptions & {
  masterAddresses: MasterTransferQuery["masterAddresses"];
  tokenAddresses?: MasterTransferQuery["tokenAddresses"];
  onRange?: (range: LogRange, logCount: number) => void;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number): number {
  const base = Math.min(30_000, 250 * 2 ** attempt);
  return Math.floor(Math.random() * base);
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number,
): Promise<T> {
  let attempt = 0;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      const retryable =
        error instanceof ChainSourceError &&
        (error.code === "RATE_LIMITED" || error.code === "RPC_ERROR");
      if (!retryable || attempt >= maxRetries) {
        throw error;
      }
      await sleep(retryDelayMs(attempt));
      attempt += 1;
    }
  }
}

async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function run(): Promise<void> {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index]!);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, Math.max(items.length, 1)) },
    () => run(),
  );
  await Promise.all(runners);
  return results;
}

/**
 * Fetches master-crediting Transfer logs using adaptive range sizing.
 * Halves the range on TOO_MANY_RESULTS, retries transient RPC/rate-limit errors.
 */
export class RangeScanner {
  private rangeSize: bigint;
  private readonly maxRetries: number;
  private readonly receiptConcurrency: number;

  constructor(
    private readonly source: ChainSource,
    options: RangeScannerOptions = {},
  ) {
    this.rangeSize = options.initialRangeSize ?? 2_000n;
    this.minRangeSize = options.minRangeSize ?? 1n;
    this.maxRangeSize = options.maxRangeSize ?? 2_000n;
    this.maxRetries = options.maxRetries ?? 5;
    this.receiptConcurrency = options.receiptConcurrency ?? 4;
  }

  private readonly minRangeSize: bigint;
  private readonly maxRangeSize: bigint;

  async scanMasterTransfers(
    fromBlock: bigint,
    toBlock: bigint,
    options: ScanMasterTransfersOptions,
  ): Promise<IndexedLog[]> {
    const allLogs: IndexedLog[] = [];
    let cursor = fromBlock;

    while (cursor <= toBlock) {
      const rangeEnd =
        cursor + this.rangeSize - 1n > toBlock
          ? toBlock
          : cursor + this.rangeSize - 1n;

      const query: MasterTransferQuery = {
        fromBlock: cursor,
        toBlock: rangeEnd,
        masterAddresses: options.masterAddresses,
        tokenAddresses: options.tokenAddresses,
      };

      try {
        const logs = await withRetry(
          () => this.source.getMasterTransferLogs(query),
          this.maxRetries,
        );
        allLogs.push(...logs);
        options.onRange?.({ fromBlock: cursor, toBlock: rangeEnd }, logs.length);

        if (this.rangeSize < this.maxRangeSize) {
          this.rangeSize = this.rangeSize + this.rangeSize / 4n || 1n;
          if (this.rangeSize > this.maxRangeSize) {
            this.rangeSize = this.maxRangeSize;
          }
        }

        cursor = rangeEnd + 1n;
      } catch (error) {
        if (
          error instanceof ChainSourceError &&
          error.code === "TOO_MANY_RESULTS" &&
          this.rangeSize > this.minRangeSize
        ) {
          this.rangeSize = this.rangeSize / 2n || 1n;
          continue;
        }
        throw error;
      }
    }

    return allLogs;
  }

  async scanUniqueReceipts(
    fromBlock: bigint,
    toBlock: bigint,
    options: ScanMasterTransfersOptions,
  ): Promise<Map<string, Awaited<ReturnType<ChainSource["getTransactionReceipt"]>>>> {
    const logs = await this.scanMasterTransfers(fromBlock, toBlock, options);
    const hashes = uniqueTransactionHashes(logs);
    const receipts = new Map<
      string,
      Awaited<ReturnType<ChainSource["getTransactionReceipt"]>>
    >();

    const fetched = await mapPool(
      hashes,
      this.receiptConcurrency,
      async (hash) => {
        const receipt = await withRetry(
          () => this.source.getTransactionReceipt(hash),
          this.maxRetries,
        );
        return [hash, receipt] as const;
      },
    );

    for (const [hash, receipt] of fetched) {
      receipts.set(hash, receipt);
    }

    return receipts;
  }
}
