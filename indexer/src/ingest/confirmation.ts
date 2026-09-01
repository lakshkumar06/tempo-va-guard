import type { Hash } from "viem";
import type { BlockHeader } from "../chain/types.js";
import type { SqliteDepositRepository } from "../db/repository.js";

export type ContinuityResult =
  | { ok: true }
  | { ok: false; reason: "parent_mismatch"; atBlock: bigint };

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

  rollbackFrom(blockNumber: bigint): number {
    return this.repo.orphanDetectedFromBlock(blockNumber);
  }
}

export class ConfirmationGate {
  constructor(private readonly repo: SqliteDepositRepository) {}

  promoteToConfirmed(finalizedBlock: bigint): number {
    return this.repo.confirmDepositsUpTo(finalizedBlock);
  }
}

export function resolveFinalizedBlock(
  latest: bigint,
  finalizedTagSupported: boolean,
  finalizedFromRpc: bigint | null,
  fallbackDepth = 20n,
): bigint {
  if (finalizedTagSupported && finalizedFromRpc !== null) {
    return finalizedFromRpc;
  }
  return latest > fallbackDepth ? latest - fallbackDepth : 0n;
}
