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
};

export type ScanMasterTransfersOptions = RangeScannerOptions & {
  masterAddresses: MasterTransferQuery["masterAddresses"];
  tokenAddresses?: MasterTransferQuery["tokenAddresses"];
  onRange?: (range: LogRange, logCount: number) => void;
};

/**
 * Fetches master-crediting Transfer logs using adaptive range sizing.
 * Halves the range on TOO_MANY_RESULTS, grows slowly on success.
 */
export class RangeScanner {
  private rangeSize: bigint;

  constructor(
    private readonly source: ChainSource,
    options: RangeScannerOptions = {},
  ) {
    this.rangeSize = options.initialRangeSize ?? 2_000n;
    this.minRangeSize = options.minRangeSize ?? 1n;
    this.maxRangeSize = options.maxRangeSize ?? 2_000n;
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
        const logs = await this.source.getMasterTransferLogs(query);
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

    for (const hash of hashes) {
      receipts.set(hash, await this.source.getTransactionReceipt(hash));
    }

    return receipts;
  }
}
