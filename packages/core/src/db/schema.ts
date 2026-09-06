// Bump when SCHEMA changes so a shell opening an older file can tell.
export const SCHEMA_VERSION = 3

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

  PRIMARY KEY (store, store_game_id)
);

CREATE TABLE IF NOT EXISTS sync_state (
  store          TEXT PRIMARY KEY,
  last_synced_at TEXT,
  last_error     TEXT
);
`

/** Applied in order to any database older than SCHEMA_VERSION. Fresh ones get SCHEMA. */
export const MIGRATIONS: { version: number; sql: string }[] = [
  { version: 3, sql: `ALTER TABLE game ADD COLUMN enriched_at TEXT;` }
]
