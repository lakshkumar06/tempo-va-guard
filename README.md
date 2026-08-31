# Tempo Master Salt Grinder

Finds a valid salt for `IAddressRegistry.registerVirtualMaster(bytes32 salt)`
on Tempo. The registry requires proof-of-work: `keccak256(address ++ salt)`
must start with 4 zero bytes (~4 billion average attempts).

## Run in the cloud (recommended)

1. Push this repo to GitHub
2. Go to Actions tab -> "Grind Tempo Master Salt" -> "Run workflow"
3. Paste your wallet address, run it
4. Check the job logs for `salt:` and `masterId:` when it finishes

## Run locally

```bash
cargo build --release
./target/release/tempo-grinder 0xYOUR_ADDRESS
```

Multi-threaded automatically (uses all CPU cores via rayon).
On a single core: ~2.2M attempts/sec. Expect several minutes to
a couple hours locally depending on core count and luck; GitHub
Actions runners (4 cores) typically finish in well under 30 min.
