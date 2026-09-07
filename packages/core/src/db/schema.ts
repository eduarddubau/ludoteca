// Bump when SCHEMA changes so a shell opening an older file can tell.
export const SCHEMA_VERSION = 5

// One row per game per store. The same title arriving from two stores stays two rows;
// merging is a presentation concern, and a wrong merge is worse than a duplicate.
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS game (
  store            TEXT NOT NULL,
  store_game_id    TEXT NOT NULL,
  title            TEXT NOT NULL,
  ownership_kind   TEXT NOT NULL,
  owner_account_id TEXT,
  exclude_reason   INTEGER,
  play_status      TEXT NOT NULL DEFAULT 'unknown',
  playtime_minutes INTEGER,

  -- Enrichment, all nullable until a metadata source fills them.
  -- genres is a JSON array: the library is small enough that filtering happens in
  -- memory, so a join table would be structure without a payer.
  genres           TEXT NOT NULL DEFAULT '[]',
  release_year     INTEGER,
  developer        TEXT,
  publisher        TEXT,
  critic_score     INTEGER,
  metacritic_url   TEXT,
  store_url        TEXT,
  user_rating      INTEGER,
  last_played_at   TEXT,
  icon_url         TEXT,
  cover_url        TEXT,
  notes            TEXT,
  enriched_at      TEXT,
  added_manually   INTEGER NOT NULL DEFAULT 0,

  PRIMARY KEY (store, store_game_id)
);

-- User intent, kept out of \`game\` because every import truncates that table. Overrides
-- are per-field so a refetch still updates what the user did not touch.
CREATE TABLE IF NOT EXISTS user_data (
  store         TEXT NOT NULL,
  store_game_id TEXT NOT NULL,
  overrides     TEXT NOT NULL DEFAULT '{}',
  hidden        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (store, store_game_id)
);

CREATE TABLE IF NOT EXISTS sync_state (
  store          TEXT PRIMARY KEY,
  last_synced_at TEXT,
  last_error     TEXT,
  account_name   TEXT,
  retry_after    TEXT
);
`

/** Tables reconciled column-by-column against SCHEMA when a database is opened. */
export const TABLES = ['game', 'user_data', 'sync_state'] as const

/**
 * Non-additive changes only — anything a column comparison cannot work out for itself,
 * such as a rename, a type change or a backfill.
 *
 * Additive columns need no entry here: the shell diffs the live table against SCHEMA and
 * adds whatever is missing. That is deliberate. Hand-written additive migrations have to
 * be kept in step with SCHEMA by memory, and on 2026-09-06 they were not — SCHEMA_VERSION
 * went to 2 for `metacritic_url` and `store_url` with no migration written, so every
 * insert failed against an existing database with an error naming only the first missing
 * column.
 */
export const MIGRATIONS: { version: number; sql: string }[] = []
