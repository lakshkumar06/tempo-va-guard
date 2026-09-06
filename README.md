# tempo-va-guard

Toolkit for Tempo virtual addresses on Moderato testnet: proof-of-work master registration, hands-on deposit experiments, and a TypeScript indexer/guard library with a live stuck-token watcher.

## What works today

| Piece | Status |
|-------|--------|
| PoW master salt grinder (`pow/`) | Ready — local + GitHub Actions |
| Manual testnet scripts (`scripts/`) | Ready — TIP-20 hops, unregistered revert, stranded ERC-20 |
| Stuck-token watcher (`indexer` → `npm run watch:stuck`) | Ready — live poller + HTTP UI |
| Deposit indexer library (pairer, SQLite, webhooks, API) | Implemented + unit-tested; not yet one long-running worker |

## Layout

```
tempo-va-guard/
├── indexer/          # TypeScript VA indexer library + stuck watcher
├── pow/              # Rust PoW grinder + registration helpers
├── scripts/          # Moderato experiment scripts
├── sample-token/     # Plain ERC-20 used to reproduce stranded deposits
└── tempo-va-indexer-plan.md
```

## Quick start

```bash
# Root scripts (ethers)
npm install
cp sample-token/.env.example sample-token/.env   # set PRIVATE_KEY=

# Indexer
cd indexer && npm install && npm test
```

Scripts and PoW helpers read `PRIVATE_KEY` from `sample-token/.env` (KEY=value, not KEY: value).

## Stuck-token watcher

Watches configured virtual addresses on Moderato, classifies inbound transfers, and surfaces stranded non-TIP-20 deposits.

```bash
cd indexer
VIRTUAL_ADDRESSES=0xB1977b69FDFdfDFDfDFDFdFdFDFd000000000001 npm run watch:stuck
```

Then, in another terminal, strand a plain ERC-20:

```bash
node scripts/send-non-supported-token.js
```

HTTP surface (default `:8787`): `/`, `/healthz`, `/anomalies`.

More detail: [indexer/README.md](indexer/README.md).

## Indexer library

Deposit pipeline modules are in place and covered by tests:

```
ChainSource → RangeScanner → HopPairer → Classifier → SQLite
                                              ↓
                                    ConfirmationGate → Outbox → Webhook dispatcher
                                              ↓
                                         Express API (/deposits, /healthz, /metrics)
```

```bash
cd indexer
npm run typecheck
npm run lint
npm test
npm run detect:stuck                 # offline fixture
npm run detect:stuck -- 0xTX_HASH    # live receipt
```

A single tip-follow worker that wires these together for confirmed deposits + webhooks is the next major milestone. Design notes: [tempo-va-indexer-plan.md](tempo-va-indexer-plan.md).

## PoW registration

### GitHub Actions (recommended)

1. Actions → **Grind Tempo Master Salt** → Run workflow
2. Paste your wallet address
3. Read `salt:` and `masterId:` from the job logs

### Local

```bash
cd pow
cargo build --release
./target/release/tempo-grinder 0xYOUR_ADDRESS
```

Uses all CPU cores via rayon. Then register with:

```bash
node pow/submit-registration.js
```

## Testnet scripts

Run from the repo root after `npm install` and a funded `sample-token/.env`:

| Script | What it checks |
|--------|----------------|
| `node scripts/derive-address.js` | `masterId + magic + userTag` → VA |
| `node scripts/send-to-virtual.js` | Successful TIP-20 two-hop deposit |
| `node scripts/test-new-address.js` | TIP-20 to a fresh `userTag` under the same master |
| `node scripts/test-unregistered.js` | Revert `VirtualAddressUnregistered()` |
| `node scripts/send-non-supported-token.js` | Non-TIP-20 stranded at the VA |
| `node scripts/check-balance.js` | Token balances |

Default registered master used in scripts: `masterId 0xb1977b69`.

## Safety

- Never commit `sample-token/.env` or live private keys
- Treat Moderato keys as disposable; rotate if they were ever pasted into chat or committed
- Indexer API routes can require `INDEXER_API_TOKEN` when set
