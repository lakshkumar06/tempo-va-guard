# Tempo VA Indexer / Guard

Library + runnable **stuck-token watcher** for Tempo virtual addresses.

## What runs today

```bash
cd indexer
npm install
npm test
npm run watch:stuck   # live Moderato watcher + HTTP UI on :8787
```

`npm run watch:stuck` is the operational entrypoint right now. It:
- validates config via zod (`RPC_URL`, `VIRTUAL_ADDRESSES`, `PORT`, …)
- polls Tempo for transfers to watched virtual addresses
- classifies stranded non-TIP-20 deposits
- serves `/`, `/healthz`, `/anomalies`
- shuts down cleanly on SIGINT/SIGTERM

The deposit indexer modules (pairer, SQLite, outbox, confirmation) are implemented
and tested as a library. A full tip-follow + webhook worker composition is not
wired into a single long-running process yet.

## Quick checks

```bash
npm run typecheck
npm test
npm run detect:stuck                 # offline fixture
npm run detect:stuck -- 0xTX_HASH    # live receipt
```

## Architecture (library)

```
ChainSource → RangeScanner → HopPairer → Classifier → SQLite
                                              ↓
                                    ConfirmationGate → Outbox → Webhook dispatcher
                                              ↓
                                         Express API (/deposits, /healthz, /metrics)
```

## Modules

| Module | Role |
|--------|------|
| `src/codec/` | TIP-1022 virtual address encode/decode |
| `src/chain/` | RPC + fake chain + adaptive range scanner |
| `src/pairer/` | Two-hop deposit detection (TIP-20 allowlisted) |
| `src/classifier/` | Registry-verified deposits + stranded non-TIP-20 |
| `src/db/` | SQLite schema (embedded migrations), idempotent commits |
| `src/ingest/` | Block processor, confirmation gate, continuity guard |
| `src/webhook/` | Transactional outbox, HMAC signing, retry dispatcher |
| `src/api/` | Authenticated read API |
| `src/watch/` | Live stuck-token watcher |

## Env

| Variable | Purpose |
|----------|---------|
| `RPC_URL` | Tempo RPC (default Moderato public) |
| `VIRTUAL_ADDRESSES` | Comma-separated virtual addresses to watch |
| `PORT` | HTTP port (default 8787) |
| `POLL_MS` | Poll interval |
| `INDEXER_API_TOKEN` | Bearer token for `/anomalies` when set |

See `tempo-va-indexer-plan.md` in the repo root for the full design plan.
