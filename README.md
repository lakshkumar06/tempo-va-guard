# tempo-va-guard

Proof-of-work registration and testnet experiments for Tempo virtual addresses.

## Layout

```
tempo-va-guard/
├── indexer/          # Tempo VA indexer service (TypeScript)
├── pow/              # proof-of-work registration tooling
├── scripts/          # testnet experiments / hands-on tests
└── sample-token/     # non-TIP20 test contract
```

## Indexer

See [indexer/README.md](indexer/README.md) for the virtual-address deposit indexer.

```bash
cd indexer && npm install && npm test
```

## Run the grinder in the cloud (recommended)

1. Push this repo to GitHub
2. Go to Actions tab → "Grind Tempo Master Salt" → "Run workflow"
3. Paste your wallet address, run it
4. Check the job logs for `salt:` and `masterId:` when it finishes

## Run the grinder locally

```bash
cd pow
cargo build --release
./target/release/tempo-grinder 0xYOUR_ADDRESS
```

Multi-threaded automatically (uses all CPU cores via rayon).
On a single core: ~2.2M attempts/sec. Expect several minutes to
a couple hours locally depending on core count and luck; GitHub
Actions runners (4 cores) typically finish in well under 30 min.

## Scripts

Run from the repo root:

```bash
node scripts/derive-address.js
node scripts/send-to-virtual.js
node scripts/test-unregistered.js
node pow/submit-registration.js
```

Scripts that need a wallet read `PRIVATE_KEY` from `sample-token/.env`.
