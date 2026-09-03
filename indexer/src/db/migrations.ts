/**
 * Embedded migrations so `tsc` dist builds do not need a separate SQL copy step.
 * Keep `migrations/*.sql` as the human-editable source of truth and mirror here.
 */
export const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS cursor (
  id         INTEGER PRIMARY KEY CHECK (id = 1),
  last_block INTEGER NOT NULL,
  last_hash  TEXT    NOT NULL,
  updated_at TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS block_hashes (
  number      INTEGER PRIMARY KEY,
  hash        TEXT NOT NULL,
  parent_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS deposits (
  id              TEXT PRIMARY KEY,
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
  from_address    TEXT    NOT NULL,
  amount          TEXT    NOT NULL,
  memo            TEXT,
  entrypoint      TEXT    NOT NULL,
  is_self_forward INTEGER NOT NULL DEFAULT 0,
  status          TEXT    NOT NULL,
  detected_at     TEXT    NOT NULL,
  confirmed_at    TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS deposits_dedupe
  ON deposits(chain_id, tx_hash, hop2_log_index);
CREATE INDEX IF NOT EXISTS deposits_by_status
  ON deposits(status, block_number);
CREATE INDEX IF NOT EXISTS deposits_by_tag
  ON deposits(master_id, user_tag);

CREATE TABLE IF NOT EXISTS anomalies (
  id              TEXT PRIMARY KEY,
  kind            TEXT NOT NULL,
  block_number    INTEGER NOT NULL,
  tx_hash         TEXT,
  token           TEXT,
  virtual_address TEXT,
  amount          TEXT,
  detail          TEXT NOT NULL,
  status          TEXT NOT NULL,
  detected_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id              TEXT PRIMARY KEY,
  event_type      TEXT NOT NULL,
  subject_id      TEXT NOT NULL,
  endpoint        TEXT NOT NULL,
  payload         TEXT NOT NULL,
  status          TEXT NOT NULL,
  attempts        INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  claimed_until   TEXT,
  claimed_by      TEXT,
  last_error      TEXT,
  created_at      TEXT NOT NULL,
  delivered_at    TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS webhook_once
  ON webhook_deliveries(event_type, subject_id, endpoint);
CREATE INDEX IF NOT EXISTS webhook_queue
  ON webhook_deliveries(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
`,
  },
];
