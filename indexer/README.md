# Tempo VA Indexer

Long-running service that watches Tempo for TIP-20 virtual-address deposits, persists them with idempotent block commits, and delivers signed webhooks on confirmation.

## Quick start

```bash
cd indexer
npm install
npm test
npm run typecheck
```

Probe live Moderato RPC (requires network):

```bash
npx tsx scripts/probe-chain.ts
```

## Architecture

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
| `src/pairer/` | Two-hop deposit detection (tolerates interleaved logs) |
| `src/classifier/` | Self-forward, stranded non-TIP-20, registry cache |
| `src/db/` | SQLite schema, migrations, idempotent commits |
| `src/ingest/` | Block processor, confirmation gate, continuity guard |
| `src/webhook/` | Transactional outbox, HMAC signing, retry dispatcher |
| `src/api/` | Read API and health endpoints |

## Tests

35 unit/integration tests covering codec property tests, golden fixtures, crash recovery, outbox idempotency, and webhook retry/dead-letter behavior.

E2E against Moderato testnet is planned (see `tempo-va-indexer-plan.md` in repo root).
