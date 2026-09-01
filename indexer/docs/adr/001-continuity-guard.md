# ADR 001: Continuity guard instead of full reorg handling

## Status
Accepted

## Context
Tempo Moderato advertises ~0.5s deterministic finality with no reorganizations.
Building a full reorg replayer is expensive and unlikely to be exercised in production.

## Decision
Track parent-hash linkage for recent blocks and roll back only `detected` deposits
when a discontinuity is observed (typically from a lagging RPC endpoint).

## Consequences
- Confirmed deposits are never rolled back, keeping webhook delivery safe.
- Real reorgs are not tested on testnet; discontinuity is tested via `FakeChainSource`.
