import type { BlockHeader } from "../chain/types.js";
import type {
  DepositStatus,
  SqliteDepositRepository,
  StoredDeposit,
} from "../db/repository.js";

export type ContinuityResult =
  | { ok: true }
  | { ok: false; reason: "parent_mismatch"; atBlock: bigint };

export type RollbackOptions = {
  /**
   * When true, also orphan confirmed deposits in the discontinuity window.
   * Use this when finality was depth-based and a deeper discontinuity appears.
   * Callers should enqueue compensating `deposit.orphaned` webhooks for any
   * previously confirmed rows.
   */
  includeConfirmed?: boolean;
};

export type FinalityMode =
  | { kind: "rpc_finalized"; finalizedBlock: bigint }
  | { kind: "depth"; latestBlock: bigint; depth: bigint };

export class ContinuityGuard {
  constructor(private readonly repo: SqliteDepositRepository) {}

  verify(block: BlockHeader): ContinuityResult {
    if (block.number === 0n) {
      return { ok: true };
    }

    const parent = this.repo.getBlockHash(block.number - 1n);
    if (!parent) {
      return { ok: true };
    }

    if (parent.hash.toLowerCase() !== block.parentHash.toLowerCase()) {
      return { ok: false, reason: "parent_mismatch", atBlock: block.number };
    }

    return { ok: true };
  }

  /**
   * Orphan deposits from `blockNumber` upward.
   * Default only touches `detected` rows (safe when confirmation uses true
   * RPC finality). Pass `{ includeConfirmed: true }` for depth-based finality
   * discontinuities and emit compensating events for returned confirmed rows.
   */
  rollbackFrom(
    blockNumber: bigint,
    options: RollbackOptions = {},
  ): { orphaned: number; previouslyConfirmed: StoredDeposit[] } {
    const statuses: DepositStatus[] = options.includeConfirmed
      ? ["detected", "confirmed"]
      : ["detected"];
    return this.repo.orphanFromBlock(blockNumber, statuses);
  }
}

export class ConfirmationGate {
  constructor(private readonly repo: SqliteDepositRepository) {}

  promoteToConfirmed(finalizedBlock: bigint): number {
    return this.repo.confirmDepositsUpTo(finalizedBlock);
  }
}

/**
 * Resolve the confirmation tip from an explicit finality policy.
 * Prefer `rpc_finalized` on Tempo; `depth` is a fallback when the RPC has no
 * finalized tag — never treat depth as stronger than true finality.
 */
export function resolveFinalizedBlock(mode: FinalityMode): bigint;
/** @deprecated Prefer FinalityMode overload. */
export function resolveFinalizedBlock(
  latest: bigint,
  finalizedTagSupported: boolean,
  finalizedFromRpc: bigint | null,
  fallbackDepth?: bigint,
): bigint;
export function resolveFinalizedBlock(
  modeOrLatest: FinalityMode | bigint,
  finalizedTagSupported?: boolean,
  finalizedFromRpc?: bigint | null,
  fallbackDepth = 20n,
): bigint {
  if (typeof modeOrLatest === "object") {
    if (modeOrLatest.kind === "rpc_finalized") {
      return modeOrLatest.finalizedBlock;
    }
    const { latestBlock, depth } = modeOrLatest;
    return latestBlock > depth ? latestBlock - depth : 0n;
  }

  if (finalizedTagSupported && finalizedFromRpc != null) {
    return finalizedFromRpc;
  }
  return modeOrLatest > fallbackDepth ? modeOrLatest - fallbackDepth : 0n;
}
