# ADR 001: Continuity guard instead of full reorg handling

## Status
Accepted (amended)

## Context
Tempo Moderato advertises ~0.5s deterministic finality with no reorganizations.
Building a full reorg replayer is expensive and unlikely to be exercised in production.
Depth-based confirmation (fallback when RPC has no `finalized` tag) can still be
wrong if a discontinuity deeper than the configured depth appears.

## Decision
1. Prefer explicit `rpc_finalized` finality mode when the RPC exposes it.
2. Track parent-hash linkage for recent blocks.
3. Default rollback orphans only `detected` deposits (pre-webhook).
4. When using depth-based finality, discontinuities may orphan `confirmed`
   deposits and enqueue compensating `deposit.orphaned` webhook events so
   consumers can reverse credits.

## Consequences
- Consumers must handle `deposit.orphaned` idempotently, just like confirms.
- Real Tempo reorgs are not expected; discontinuity is tested via `FakeChainSource`.
- Depth is never treated as stronger than true RPC finality.
