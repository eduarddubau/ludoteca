import { type EditableField, type OwnedGame, type Platform, type PlayStatus, type StoreId, type UserData } from '@ludoteca/core'

interface GameRow {
  store: string
  store_game_id: string
  title: string
  ownership_kind: string
  owner_account_id: string | null
  exclude_reason: number | null
  play_status: string
  playtime_minutes: number | null
  genres: string
  release_year: number | null
  developer: string | null
  publisher: string | null
  critic_score: number | null
  metacritic_url: string | null
  store_url: string | null
  user_rating: number | null
  last_played_at: string | null
  icon_url: string | null
  cover_url: string | null
  notes: string | null
  enriched_at: string | null
  added_manually: number
}

function toGame(row: GameRow): OwnedGame {
  return {
    store: row.store as StoreId,
    storeGameId: row.store_game_id,
    title: row.title,
    ownership:
      row.ownership_kind === 'familyShared'
        ? {
            kind: 'familyShared',
            ownerAccountId: row.owner_account_id ?? '',
            ...(row.exclude_reason !== null ? { excludeReason: row.exclude_reason } : {})
          }
        : { kind: 'owned' },
    playStatus: row.play_status as PlayStatus,
    playtimeMinutes: row.playtime_minutes ?? undefined,
    genres: JSON.parse(row.genres || '[]') as string[],
    releaseYear: row.release_year ?? undefined,
    developer: row.developer ?? undefined,
    publisher: row.publisher ?? undefined,
    criticScore: row.critic_score ?? undefined,
    metacriticUrl: row.metacritic_url ?? undefined,
    storeUrl: row.store_url ?? undefined,
    userRating: row.user_rating ?? undefined,
    lastPlayedAt: row.last_played_at ?? undefined,
    iconUrl: row.icon_url ?? undefined,
    coverUrl: row.cover_url ?? undefined,
    notes: row.notes ?? undefined,
    enrichedAt: row.enriched_at ?? undefined,
    addedManually: row.added_manually === 1
  }
}

export async function loadGames(platform: Platform): Promise<OwnedGame[]> {
  const rows = await platform.db.query<GameRow>('SELECT * FROM game ORDER BY title COLLATE NOCASE')
  return rows.map(toGame)
}

async function insertRow(platform: Platform, game: OwnedGame): Promise<void> {
  await platform.db.run(
    `INSERT OR REPLACE INTO game (
       store, store_game_id, title, ownership_kind, owner_account_id, exclude_reason,
       play_status, playtime_minutes, genres, release_year,
       developer, publisher, critic_score, metacritic_url, store_url,
       user_rating, last_played_at, icon_url, cover_url, notes, enriched_at,
       added_manually
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      game.store,
      game.storeGameId,
      game.title,
      game.ownership.kind,
      game.ownership.kind === 'familyShared' ? game.ownership.ownerAccountId : null,
      game.ownership.kind === 'familyShared' ? (game.ownership.excludeReason ?? null) : null,
      game.playStatus,
      game.playtimeMinutes ?? null,
      JSON.stringify(game.genres),
      game.releaseYear ?? null,
      game.developer ?? null,
      game.publisher ?? null,
      game.criticScore ?? null,
      game.metacriticUrl ?? null,
      game.storeUrl ?? null,
      game.userRating ?? null,
      game.lastPlayedAt ?? null,
      game.iconUrl ?? null,
      game.coverUrl ?? null,
      game.notes ?? null,
      game.enrichedAt ?? null,
      game.addedManually ? 1 : 0
    ]
  )
}

export async function replaceGames(platform: Platform, games: OwnedGame[]): Promise<void> {
  await platform.db.run('DELETE FROM game')
  for (const game of games) await insertRow(platform, game)
}

/** Adds one row without touching the rest — used by manual entry. */
export async function insertGame(platform: Platform, game: OwnedGame): Promise<void> {
  await insertRow(platform, game)
}


// ---- user data: overrides and hidden flags, kept out of `game` because every import
// truncates that table.

interface UserDataRow {
  store: string
  store_game_id: string
  overrides: string
  hidden: number
}

export async function loadUserData(platform: Platform): Promise<Map<string, UserData>> {
  const rows = await platform.db.query<UserDataRow>('SELECT * FROM user_data')
  return new Map(
    rows.map((row) => [
      `${row.store}:${row.store_game_id}`,
      {
        store: row.store,
        storeGameId: row.store_game_id,
        overrides: JSON.parse(row.overrides || '{}') as Partial<Record<EditableField, unknown>>,
        hidden: row.hidden === 1
      }
    ])
  )
}

export async function saveUserData(platform: Platform, entry: UserData): Promise<void> {
  const empty = Object.keys(entry.overrides).length === 0 && !entry.hidden
  if (empty) {
    // Nothing left to remember; drop the row rather than keep an inert one.
    await platform.db.run('DELETE FROM user_data WHERE store = ? AND store_game_id = ?', [
      entry.store,
      entry.storeGameId
    ])
    return
  }
  await platform.db.run(
    `INSERT INTO user_data (store, store_game_id, overrides, hidden) VALUES (?, ?, ?, ?)
     ON CONFLICT(store, store_game_id) DO UPDATE SET overrides = excluded.overrides, hidden = excluded.hidden`,
    [entry.store, entry.storeGameId, JSON.stringify(entry.overrides), entry.hidden ? 1 : 0]
  )
}

/** Only ever used on manually added rows: an imported one would return on next import. */
export async function deleteGame(platform: Platform, game: OwnedGame): Promise<void> {
  await platform.db.run('DELETE FROM game WHERE store = ? AND store_game_id = ?', [
    game.store,
    game.storeGameId
  ])
  await platform.db.run('DELETE FROM user_data WHERE store = ? AND store_game_id = ?', [
    game.store,
    game.storeGameId
  ])
}
