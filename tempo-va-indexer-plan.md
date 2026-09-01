# Tempo VA Indexer — Build Plan (v2)

## What it is

A long-running service that watches Tempo for TIP-20 virtual-address deposits,
attributes each one to a customer `userTag`, survives crashes without
double-counting or dropping deposits, and reliably delivers a signed webhook to a
business's backend once the deposit is final.

It also acts as a **guard**: it detects the two failure modes we reproduced by hand
that no explorer surfaces — non-TIP-20 tokens permanently stranded at a virtual
address, and payments reverting because a `masterId` is unregistered.

---

## Ground truth

### Verified by hand in this repo
- Virtual address derivation: `masterId(4) + 0xFDFD…FD(10) + userTag(6)` → `scripts/derive-address.js`
- Two-hop `Transfer` pattern on a successful TIP-20 deposit → `scripts/send-to-virtual.js`
- Revert on unregistered master, selector `0xda56842c` = `VirtualAddressUnregistered()` → `scripts/test-unregistered.js`
- Silent stuck failure on non-TIP-20 tokens: one hop, funds stranded → `scripts/send-non-supported-token.js`
- Registered master: `masterId 0xb1977b69`, registry precompile `0xFDC0…0000`

### From TIP-1022 and the Tempo docs
| Fact | Consequence for this design |
|---|---|
| Finality ~0.5s, **no reorgs** | Reorg logic is a safety net, not the core problem |
| ~0.5s blocks ≈ 172,800 blocks/day | Throughput and storage growth are the real constraints |
| Magic occupies bytes `[4:14]`, not a prefix | Codec must slice the middle, not `startsWith` |
| Hops are **not always adjacent** | Pairing must tolerate interleaved logs (see below) |
| Mint path emits `Transfer(0x0, virtual, amt)` as hop 1 | A deposit's sender can legitimately be `address(0)` |
| Self-forwarding emits the same two hops | Must not be counted as inflow when `from == master` |
| Many `masterId`s MAY map to one master address | Key attribution off `masterId`, not master address |
| TIP-20 tokens use 6 decimals; canonical set is `0x20c0…0000`–`0003` | Token list is small and known at config time |
| Registry emits `MasterRegistered(masterId, masterAddress)` | Masters are discoverable from chain, not just config |

### The non-adjacency problem (this is the correctness trap)

Per TIP-1022's "Entrypoint-Specific Event Ordering", the log sequence differs per entrypoint:

```
transfer / transferFrom / systemTransferFrom
  1. Transfer(sender, virtual, amt)
  2. Transfer(virtual, master, amt)

transferWithMemo / transferFromWithMemo
  1. Transfer(sender, virtual, amt)
  2. TransferWithMemo(sender, virtual, amt, memo)   <-- interleaved
  3. Transfer(virtual, master, amt)

mint
  1. Transfer(0x0, virtual, amt)
  2. Mint(virtual, amt)                             <-- interleaved
  3. Transfer(virtual, master, amt)

mintWithMemo
  1. Transfer(0x0, virtual, amt)
  2. TransferWithMemo(0x0, virtual, amt, memo)      <-- interleaved
  3. Mint(virtual, amt)                             <-- interleaved
  4. Transfer(virtual, master, amt)
```

Any implementation that pairs `logs[i]` with `logs[i+1]` parses `transfer` correctly
and silently drops every memo and mint deposit. All four orderings become golden
fixtures in the test suite.

---

## Five corrections to v1 of this plan

1. **Reorg detection is demoted from "the hardest commit" to a cheap invariant guard.**
   Tempo does not reorg. But parent-hash linkage still catches the failure that *does*
   happen in practice: a load-balanced RPC endpoint serving responses from a lagging or
   resyncing node. Same code, honest framing, and it stays fully unit-tested.

2. **Throughput is promoted to the primary design constraint.** At 2 blocks/sec, a
   per-block `getBlock` + `getLogs` loop cannot backfill. See "Scalability".

3. **Filter logs by master address, not by token.** The volume of TIP-20 `Transfer`
   events chain-wide is unbounded; the volume of transfers *crediting our masters* is
   bounded by our own business. This is the difference between O(chain) and O(us).

4. **"Exactly-once webhook delivery" is renamed to what it actually is:** at-least-once
   delivery with a stable idempotency key, so the *receiver* can dedupe. Exactly-once
   over a network is not achievable and claiming it is a liability.

5. **The guard features become a first-class subsystem.** Stranded non-TIP-20 funds and
   unregistered-master reverts are the part of this project no off-the-shelf indexer does.

---

## Architecture

```
                    ┌──────────────────────────────────────────┐
                    │            ChainSource (iface)           │
                    │   LiveRpc  |  FakeChain  |  Replay        │
                    └────────────────────┬─────────────────────┘
                                         │ block ranges + logs
            ┌────────────────────────────▼─────────────────────────────┐
            │                    Ingest pipeline                        │
            │                                                           │
            │  RangeScanner ──> HopPairer ──> Classifier ──> Committer  │
            │  (getLogs on     (pure fn:     (deposit /     (one SQLite │
            │   master filter)  tx logs ->    anomaly /      txn per    │
            │                   deposits)     self-fwd)      range)     │
            └────────────────────────────┬─────────────────────────────┘
                                         │
                    ┌────────────────────▼─────────────────────┐
                    │        SQLite (WAL, single writer)        │
                    │  cursor · block_hashes(ring) · deposits   │
                    │  anomalies · webhook_deliveries (outbox)  │
                    └───────┬───────────────────────┬───────────┘
                            │                       │
            ┌───────────────▼──────────┐  ┌─────────▼──────────────┐
            │   ConfirmationGate       │  │   OutboxDispatcher     │
            │  detected -> confirmed   │  │  lease · backoff ·     │
            │  (finalized block tag)   │  │  HMAC sign · dead-letter│
            │  enqueues outbox rows    │  └─────────┬──────────────┘
            └──────────────────────────┘            │ POST
                                                    ▼
                            ┌──────────────────────────────────┐
                            │  Read API (Express, thin)         │
                            │  /deposits /anomalies /healthz    │
                            │  /metrics                         │
                            └──────────────────────────────────┘
```

**Pure core, imperative shell.** `HopPairer`, `Classifier`, the address codec, the
backoff schedule, and the reorg-rollback decision are pure functions over plain data.
Everything that touches the network, the clock, or the disk sits behind an injected
interface. That is what makes the test pyramid below possible.

### Tech stack
- **TypeScript** (strict, `noUncheckedIndexedAccess`) on Node 22
- **viem** for RPC — it ships first-class Tempo support, including virtual-address helpers
- **better-sqlite3** — synchronous API makes single-writer transaction reasoning trivial
- **vitest** for tests, **fast-check** for property tests
- **zod** for config and webhook payload schemas, validated at boot
- **pino** for structured JSON logs
- **Express** for the read API — deliberately thin, no business logic in handlers

---

## Data model

Amounts are **always** `bigint` in code and `TEXT` (decimal string) in SQLite. Never
`number`, never SQLite `REAL`. 6-decimal stablecoins would fit in an integer today;
relying on that is how indexers silently corrupt balances later.

```sql
CREATE TABLE cursor (                    -- exactly one row
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  last_block INTEGER NOT NULL,
  last_hash  TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

CREATE TABLE block_hashes (              -- bounded ring, pruned to N most recent
  number      INTEGER PRIMARY KEY,
  hash        TEXT NOT NULL,
  parent_hash TEXT NOT NULL
);

CREATE TABLE deposits (
  id              TEXT PRIMARY KEY,      -- `${chainId}:${txHash}:${hop2LogIndex}`
  chain_id        INTEGER NOT NULL,
  block_number    INTEGER NOT NULL,
  block_hash      TEXT    NOT NULL,
  tx_hash         TEXT    NOT NULL,
  hop1_log_index  INTEGER NOT NULL,
  hop2_log_index  INTEGER NOT NULL,
  token           TEXT    NOT NULL,
  master_id       TEXT    NOT NULL,
  master_address  TEXT    NOT NULL,
  user_tag        TEXT    NOT NULL,
  virtual_address TEXT    NOT NULL,
  from_address    TEXT    NOT NULL,      -- 0x0 on the mint path
  amount          TEXT    NOT NULL,      -- decimal string
  memo            TEXT,
  entrypoint      TEXT    NOT NULL,      -- transfer | transfer_with_memo | mint | mint_with_memo
  is_self_forward INTEGER NOT NULL DEFAULT 0,
  status          TEXT    NOT NULL,      -- detected | confirmed | orphaned
  detected_at     TEXT    NOT NULL,
  confirmed_at    TEXT
);
CREATE UNIQUE INDEX deposits_dedupe ON deposits(chain_id, tx_hash, hop2_log_index);
CREATE INDEX deposits_by_status ON deposits(status, block_number);
CREATE INDEX deposits_by_tag    ON deposits(master_id, user_tag);

CREATE TABLE anomalies (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,   -- stranded_non_tip20 | unregistered_revert
                                   -- | unpaired_hop | virtual_balance_nonzero
  block_number    INTEGER NOT NULL,
  tx_hash         TEXT,
  token           TEXT,
  virtual_address TEXT,
  amount          TEXT,
  detail          TEXT NOT NULL,   -- JSON blob
  status          TEXT NOT NULL,   -- open | acknowledged
  detected_at     TEXT NOT NULL
);

CREATE TABLE webhook_deliveries (        -- transactional outbox
  id              TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,         -- deposit.confirmed | anomaly.detected
  subject_id      TEXT NOT NULL,         -- deposit.id or anomaly.id
  endpoint        TEXT NOT NULL,
  payload         TEXT NOT NULL,         -- frozen at enqueue time, never recomputed
  status          TEXT NOT NULL,         -- pending | inflight | delivered | dead
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  claimed_until   TEXT,
  claimed_by      TEXT,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  delivered_at    TEXT
);
CREATE UNIQUE INDEX webhook_once  ON webhook_deliveries(event_type, subject_id, endpoint);
CREATE INDEX       webhook_queue ON webhook_deliveries(status, next_attempt_at);
```

Two indexes carry most of the correctness weight. `deposits_dedupe` makes
reprocessing a block a no-op. `webhook_once` makes enqueueing the same event twice
impossible at the database level rather than by application convention.

---

## Correctness model

Four properties, each enforced by one mechanism:

**1. Reprocessing a block is a no-op.** Deposit `id` is derived from
`(chainId, txHash, hop2LogIndex)` — content-addressed, not sequence-addressed. Writes
use `INSERT … ON CONFLICT DO NOTHING`. Restarting mid-range re-runs work but changes
nothing.

**2. No deposit is detected without its webhook being enqueued.** Transactional
outbox: the deposit row, the anomaly rows, the block-hash ring update, and the cursor
advance all commit in **one** SQLite transaction. There is no window where the cursor
has moved past a block whose side effects were lost. The dispatcher is a separate loop
reading the outbox table; it cannot lose work the ingest loop committed.

**3. A rollback can never un-send a webhook.** Webhooks are only enqueued when a
deposit crosses `detected → confirmed`, and confirmation requires the block to be at
or below the chain's `finalized` tag. Rollback therefore only ever touches `detected`
rows. This is what makes reorg handling safe *by construction* rather than by careful
ordering.

**4. Delivery is at-least-once; the receiver dedupes.** Every POST carries
`Idempotency-Key: <deposit.id>` and an `X-Tempo-Signature` HMAC over
`timestamp + "." + body`, with the timestamp inside the signed material to block replay.
Retries use exponential backoff with full jitter, capped, then dead-letter with an alert.
A worker claims a job with a lease (`claimed_by`, `claimed_until`) so a crashed worker's
in-flight job is reclaimed rather than stranded.

---

## Scalability

The binding constraint is 172,800 blocks/day, not deposit volume.

**Filter on the master address.** Hop 2 is always `Transfer(virtual, master, amt)`, and
we know our master addresses. So the scanner requests:

```ts
getLogs({
  fromBlock, toBlock,
  address: TIP20_TOKENS,                    // small, known set
  topics: [TRANSFER_TOPIC, null, ourMastersPadded],   // topic2 == indexed `to`
})
```

This returns only transfers crediting our masters — bounded by our business volume, not
by chain traffic. For each distinct `txHash` in the result we fetch the receipt to
recover hop 1 (and the memo), so receipt fetches are also O(our deposits). A naive
"all TIP-20 `Transfer` events" filter is O(chain) and will not survive mainnet.

Transfers that credit a master *directly* (no virtual hop) also match this filter. That
is a feature: they get classified as `direct` and are ignored for attribution, and the
same query gives us a complete picture of master inflow.

**Range scanning, not block-by-block.** `getLogs` over ranges, with adaptive sizing:
start at 2,000 blocks, halve on a provider "too many results" error, grow back slowly on
success. Backfilling a day of chain becomes ~90 requests rather than ~345,000.

**Two modes, one code path.** *Backfill* uses large ranges and does not care about
latency. *Tip-follow* uses small ranges polled at ~500ms. Same scanner, different range
policy — no second implementation to keep in sync.

**Bounded storage.** The v1 plan's `processed_blocks` table would grow by 172,800 rows
per day forever to support reorg detection that Tempo does not need. `block_hashes` is
instead a ring pruned to the most recent 256 blocks, which is far beyond any plausible
discontinuity window. Deposits and anomalies grow with business volume, which is the
only thing that *should* grow.

**Deliberately deferred, with the seam left open.** Parallel backfill workers
(out-of-order fetch, contiguous-prefix commit) and multi-worker dispatch are both
supported by the schema — the outbox lease columns exist precisely so dispatch can scale
horizontally later. Neither gets built until a benchmark shows it is needed. All SQL sits
behind a `DepositRepository` interface, so the Postgres migration is a new implementation
of a known interface rather than a rewrite; it is not abstracted further than that today.

**Backpressure.** A bounded channel sits between scanner and committer. If the outbox
backlog exceeds a threshold, the scanner pauses rather than growing the queue without
limit. Falling behind visibly is better than falling over silently.

---

## Testing strategy

Five layers, fastest and most numerous at the bottom. Layers 1–4 run in CI on every push
with no network and no credentials; only layer 5 needs a funded testnet key.

### Layer 1 — Pure unit tests (milliseconds, no I/O)
The whole reason for pure-core/imperative-shell. Covers the address codec, the hop
pairer, the classifier, the backoff schedule, the rollback decision, and signature
generation.

### Layer 2 — Property-based tests (fast-check)
Where example-based tests are weakest:
- **Codec round-trip:** for all `(masterId, userTag)`, `decode(encode(m, t)) === (m, t)`,
  and `isVirtual(encode(m, t))` holds for every value including `0x000000000000`.
- **Differential test against viem:** our codec and viem's Tempo helpers must agree on
  random inputs. Two independent implementations disagreeing is a real bug signal.
- **Pairer conservation:** for any generated log sequence, the sum of paired deposit
  amounts equals the sum of hop-2 amounts crediting a master. Nothing invented, nothing
  dropped.
- **Pairer robustness:** injecting arbitrary unrelated logs between hops must not change
  the output. This is the non-adjacency bug, encoded as a property.

### Layer 3 — Golden fixtures from the real chain
A `scripts/capture-fixture.ts` writes real receipts to `fixtures/*.json` so they are
reproducible rather than hand-copied. Required fixtures:

| Fixture | Asserts |
|---|---|
| `transfer.json` | baseline two-hop → 1 deposit |
| `transfer-with-memo.json` | interleaved `TransferWithMemo` → 1 deposit, memo captured |
| `mint.json` | interleaved `Mint`, `from == 0x0` → 1 deposit |
| `mint-with-memo.json` | two interleaved events → 1 deposit |
| `batch-multi-deposit.json` | several deposits in one tx, correctly separated |
| `self-forward.json` | `from == master` → flagged, excluded from inflow |
| `non-tip20-stuck.json` | one hop only → `stranded_non_tip20` anomaly, 0 deposits |
| `unregistered-revert.json` | selector `0xda56842c` → `unregistered_revert` anomaly |
| `direct-to-master.json` | no virtual hop → classified `direct`, 0 deposits |

`batch-multi-deposit` and `self-forward` are the two that most implementations get wrong.

### Layer 4 — Integration tests against a scriptable fake chain
`FakeChainSource` implements the same interface as the live RPC and can be driven
deterministically: append blocks, rewrite history from height N, serve a stale tip,
duplicate logs, throw rate-limit errors, or return a range with a broken parent-hash
link. This is what makes the reorg and crash-recovery work testable **without waiting
for a testnet reorg that will never happen** — the gap the v1 plan flagged as unsolved.

Scenarios, each against a real temp-file SQLite:
- **Crash recovery:** kill the process mid-range, restart, assert no duplicates and no
  gaps. Repeat with the kill point fuzzed across the range.
- **Replay determinism:** process blocks `[A, B]` twice from scratch; assert
  byte-identical database contents. A strong invariant that catches ordering and
  timestamp leakage cheaply.
- **Discontinuity rollback:** rewrite history below the confirmation depth; assert
  `detected` rows are orphaned, `confirmed` rows are untouched, and no outbox row is
  deleted.
- **Confirmation gate:** assert no outbox row is ever created for a deposit above the
  finalized tag.
- **Outbox semantics:** a receiver that 500s, then times out, then succeeds → exactly one
  `delivered` row, attempts recorded, backoff respected (with an injected `Clock`, so the
  test runs in milliseconds rather than minutes).
- **Lease reclaim:** a worker claims a job and dies; assert another worker reclaims it
  after the lease expires and the receiver sees the same `Idempotency-Key`.
- **Poison pill:** a receiver that always 500s → dead-letter after max attempts, alert
  raised, and the ingest loop is unaffected.

### Layer 5 — End-to-end against Moderato testnet
Re-runs the three real scenarios already proven by hand through the live indexer.
Tagged `@e2e`, excluded from the default run, triggered via manual workflow dispatch —
matching the pattern already established in `.github/workflows/grind.yml`.

### What is deliberately not tested
Express route plumbing beyond a smoke test, and viem's own RPC layer. Coverage is
reported but not gated on a percentage; the gate is that every fixture and every
layer-4 scenario passes.

---

## Maintainability

- **Interfaces at every I/O boundary:** `ChainSource`, `DepositRepository`,
  `WebhookTransport`, `Clock`. Injected at composition root, never imported directly by
  the core. This is what makes layer 1 and layer 4 possible, and it is the only
  abstraction budget being spent.
- **Branded types** for `Address`, `Hex`, `MasterId`, `UserTag` so a `masterId` cannot be
  passed where an address is expected. Cheap at compile time, catches a real class of bug.
- **Numbered SQL migrations** applied on boot inside a transaction, with a test that
  migrates an empty database and asserts the resulting schema.
- **Config validated by zod at startup.** Missing RPC URL, malformed master address, or
  unparseable webhook URL fails the process immediately with a readable error rather than
  at 3am on the first deposit.
- **Structured logging** with `txHash` as the correlation ID across scanner → pairer →
  committer → dispatcher, so one deposit's full lifecycle is a single log query.
- **Metrics** on `/metrics`: blocks behind tip, deposits by status, outbox depth, delivery
  attempts, anomalies open. "Blocks behind tip" is the one number that tells you whether
  the service is healthy.
- **ADRs in `docs/adr/`** for the four decisions worth revisiting: SQLite over Postgres,
  master-address log filtering, at-least-once delivery, and demoting reorg handling.
  Recording *why* is what stops the next person from re-litigating it.
- **CI** runs typecheck, lint, unit, property, and integration on every push. E2E is
  manual dispatch.

---

## Commit plan

Each commit is independently reviewable and ends in a green test suite. "Done when" is
the acceptance criterion, not a vibe.

### Phase 0 — Foundation

**Commit 0 — repo hygiene and scaffolding**
`pow/register.js` and `pow/submit-registration.js` contain a hardcoded private key
committed to git. Even on testnet this is the wrong habit in a repo meant to be read by
others. Move it to env, rotate the key, add a `.env.example`.
Then: TypeScript strict config, vitest, eslint, `src/` layout, CI workflow.
*Done when:* `npm test` and `npm run typecheck` pass on an empty suite, and no secret
appears in `git ls-files | xargs grep`.

**Commit 1 — address codec (pure, no RPC)**
`isVirtualAddress`, `encodeVirtualAddress`, `decodeVirtualAddress` — slicing bytes
`[0:4]`, `[4:14]`, `[14:20]`. Branded types.
*Done when:* property tests pass, including the differential test against viem and the
`userTag = 0x000000000000` edge case.

**Commit 2 — `ChainSource` interface + live RPC implementation**
Range-based `getLogs` with the master-address topic filter, adaptive range sizing, typed
errors. Plus `FakeChainSource` with the same interface.
*Done when:* a manual run prints logs for a known historical range containing our real
test deposit, and `FakeChainSource` can serve a scripted history.

### Phase 1 — Correctness core

**Commit 3 — hop pairer (pure)**
Consumes one transaction's logs, emits `Deposit[]`. Tolerates interleaved
`TransferWithMemo` and `Mint`. Handles multiple deposits per transaction. Emits
`unpaired_hop` for a hop 1 with no matching hop 2.
*Done when:* all nine golden fixtures parse to the expected output and the conservation
and robustness properties hold.

**Commit 4 — classifier**
Deposit vs. self-forward (`from == master`) vs. direct-to-master vs. anomaly. Resolves
`masterId → masterAddress` via the registry with a cache warmed from `MasterRegistered`
events.
*Done when:* the self-forward and direct-to-master fixtures classify correctly and the
registry cache is exercised by a fake.

**Commit 5 — persistence, migrations, and idempotency**
Schema above, `DepositRepository`, migration runner. Committer writes deposits,
anomalies, block-hash ring, and cursor in a single transaction.
*Done when:* the crash-recovery and replay-determinism tests pass, including the fuzzed
kill point.

**Commit 6 — confirmation gate and continuity guard**
Track the `finalized` block tag; promote `detected → confirmed`. Parent-hash linkage
check with rollback of unconfirmed rows on discontinuity.
*Done when:* the discontinuity-rollback and confirmation-gate scenarios pass against
`FakeChainSource`, and the ADR explaining the demotion is written.

### Phase 2 — Delivery and interface

**Commit 7 — transactional outbox**
Enqueue on confirmation, inside the confirming transaction. Frozen payload. Unique index
enforcing single enqueue.
*Done when:* no code path can create a deposit without its outbox row, proven by a test
that fuzzes crash points across the confirmation transaction.

**Commit 8 — dispatcher**
Lease-based claim, HMAC signing with timestamp, backoff with full jitter, dead-letter.
Injected `Clock`.
*Done when:* the outbox-semantics, lease-reclaim, and poison-pill scenarios pass in
milliseconds of wall time.

**Commit 9 — guard subsystem**
Stranded non-TIP-20 detection, `0xda56842c` revert detection by scanning failed
transactions, periodic `balanceOf(virtual) != 0` sweep. Anomalies flow through the same
outbox as `anomaly.detected`.
*Done when:* both hand-verified failure scenarios produce the right anomaly with zero
false positives across the full fixture set.

**Commit 10 — read API and observability**
`GET /deposits` (filter by `masterId`, `userTag`, `status`, cursor-paginated),
`GET /deposits/:id`, `GET /anomalies`, `/healthz`, `/metrics`.
*Done when:* smoke tests pass and `/healthz` reports unhealthy when blocks-behind-tip
exceeds the threshold.

### Phase 3 — Proof

**Commit 11 — benchmark**
Measure sustained backfill throughput in blocks/sec and the p99 tip-follow lag. Record
the numbers in the README.
*Done when:* there is a real number justifying the decision to skip parallel backfill —
or evidence that it is needed, in which case it gets its own commit.

**Commit 12 — end-to-end against testnet**
The three real scenarios through the live service.
*Done when:* each is handled correctly: deposit recorded and webhook delivered, revert
flagged, stranded funds flagged.

**Commit 13 — docs and demo**
README with the architecture diagram, setup, and the design rationale from the ADRs.
Recorded demo of a live deposit firing a webhook.

---

## Risks and open questions

- **Does Tempo's RPC expose the `finalized` block tag?** The confirmation gate is
  cleaner if yes. If not, fall back to a fixed depth (~20 blocks ≈ 10s) — this is worth
  resolving in commit 2, since it changes commit 6.
- **Provider `getLogs` range and result limits are unknown.** Adaptive sizing handles
  this at runtime, but the starting range of 2,000 is a guess until measured in
  commit 11.
- **Detecting `VirtualAddressUnregistered` reverts requires scanning failed
  transactions**, which the master-address log filter cannot see — reverted transactions
  emit no logs at all. This likely needs full block bodies plus receipt status checks,
  which is O(chain) and undermines the filtering strategy. Options: scope it to a
  configurable watchlist of our own virtual addresses, or accept it as a sampled
  best-effort check. **Resolve before committing to commit 9's scope.**
- **`masterId` is immutable by design.** If the key behind a master is compromised there
  is no rotation path, so the indexer should treat a master address as permanent and
  surface the many-to-one masterId relationship in the API.

---

## Non-goals

- Not multi-chain — Tempo only, though `chain_id` is in the schema so it is not a rewrite.
- Not horizontally scaled today — single process, single writer. The lease columns and
  repository interface are the seams for when that changes.
- Not a custody or settlement system — it observes and notifies, it never moves funds.
- Not real-reorg-tested — Tempo does not reorg, so the continuity guard is validated
  against a scripted fake chain, which is the honest and more thorough option anyway.
