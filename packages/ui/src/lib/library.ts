import { createConnector, STORE_PROFILES, type EditableField, type GamePlatform, type StoreConnection, type OwnedGame, type Platform, type PlayStatus, type StoreId, type UserData } from '@ludoteca/core'

interface GameRow {
  store: string
  store_game_id: string
  title: string
  ownership_kind: string
  owner_account_id: string | null
  exclude_reason: number | null
  platform: string
  play_status: string
  playtime_minutes: number | null
  genres: string
  release_year: number | null
  developer: string | null
  publisher: string | null
  critic_score: number | null
  metacritic_url: string | null
  critic_score_source: string | null
  steam_review_percent: number | null
  steam_review_count: number | null
  steam_review_label: string | null
  store_url: string | null
  steam_app_id: number | null
  steam_app_pinned: number
  pcgamingwiki_checked_at: string | null
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
    platform: (row.platform ?? 'pc') as GamePlatform,
    playStatus: row.play_status as PlayStatus,
    playtimeMinutes: row.playtime_minutes ?? undefined,
    genres: JSON.parse(row.genres || '[]') as string[],
    releaseYear: row.release_year ?? undefined,
    developer: row.developer ?? undefined,
    publisher: row.publisher ?? undefined,
    criticScore: row.critic_score ?? undefined,
    metacriticUrl: row.metacritic_url ?? undefined,
    criticScoreSource:
      row.critic_score_source === 'steam' || row.critic_score_source === 'pcgamingwiki'
        ? row.critic_score_source
        : undefined,
    steamReviewPercent: row.steam_review_percent ?? undefined,
    steamReviewCount: row.steam_review_count ?? undefined,
    steamReviewLabel: row.steam_review_label ?? undefined,
    storeUrl: row.store_url ?? undefined,
    steamAppId: row.steam_app_id ?? undefined,
    steamAppPinned: row.steam_app_pinned === 1,
    pcgamingwikiCheckedAt: row.pcgamingwiki_checked_at ?? undefined,
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
       platform, play_status, playtime_minutes, genres, release_year,
       developer, publisher, critic_score, metacritic_url, critic_score_source,
       steam_review_percent, steam_review_count, steam_review_label, store_url, steam_app_id,
       steam_app_pinned, pcgamingwiki_checked_at,
       user_rating, last_played_at, icon_url, cover_url, notes, enriched_at,
       added_manually
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      game.store,
      game.storeGameId,
      game.title,
      game.ownership.kind,
      game.ownership.kind === 'familyShared' ? game.ownership.ownerAccountId : null,
      game.ownership.kind === 'familyShared' ? (game.ownership.excludeReason ?? null) : null,
      game.platform,
      game.playStatus,
      game.playtimeMinutes ?? null,
      JSON.stringify(game.genres),
      game.releaseYear ?? null,
      game.developer ?? null,
      game.publisher ?? null,
      game.criticScore ?? null,
      game.metacriticUrl ?? null,
      game.criticScoreSource ?? null,
      game.steamReviewPercent ?? null,
      game.steamReviewCount ?? null,
      game.steamReviewLabel ?? null,
      game.storeUrl ?? null,
      game.steamAppId ?? null,
      game.steamAppPinned ? 1 : 0,
      game.pcgamingwikiCheckedAt ?? null,
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

// ---- store connections

interface SyncStateRow {
  store: string
  last_synced_at: string | null
  last_error: string | null
  account_name: string | null
  retry_after: string | null
}

/**
 * Connection status is observed, never assumed: a stored token means "connected" only
 * until something proves otherwise, and an expired one is set by a failed refresh rather
 * than inferred from a clock. Claiming connected while a token is dead is the classic
 * failure in this kind of screen.
 */
export async function loadConnections(platform: Platform): Promise<Map<string, StoreConnection>> {
  const rows = await platform.db.query<SyncStateRow>('SELECT * FROM sync_state')
  const byStore = new Map(rows.map((row) => [row.store, row]))
  const result = new Map<string, StoreConnection>()

  for (const profile of STORE_PROFILES) {
    const row = byStore.get(profile.store)
    const signedIn = await createConnector(platform, profile.store).isAuthenticated()
    result.set(profile.store, {
      store: profile.store,
      status: row?.last_error ? 'error' : signedIn ? 'connected' : 'disconnected',
      accountName: row?.account_name ?? undefined,
      lastSyncedAt: row?.last_synced_at ?? undefined,
      lastError: row?.last_error ?? undefined,
      retryAfter: row?.retry_after ?? undefined
    })
  }
  return result
}

export async function saveConnection(
  platform: Platform,
  connection: StoreConnection
): Promise<void> {
  await platform.db.run(
    `INSERT INTO sync_state (store, last_synced_at, last_error, account_name, retry_after)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(store) DO UPDATE SET
       last_synced_at = excluded.last_synced_at,
       last_error = excluded.last_error,
       -- COALESCE: a sync writes no account name and must not erase the one from sign-in.
       account_name = COALESCE(excluded.account_name, sync_state.account_name),
       retry_after = excluded.retry_after`,
    [
      connection.store,
      connection.lastSyncedAt ?? null,
      connection.lastError ?? null,
      connection.accountName ?? null,
      connection.retryAfter ?? null
    ]
  )
}

/** Forgets the saved sign-in. Only the store itself can truly revoke a session. */
export async function disconnectStore(platform: Platform, store: StoreId): Promise<void> {
  await createConnector(platform, store).signOut()
  await platform.db.run('DELETE FROM sync_state WHERE store = ?', [store])
}

// ---- wipes. A library comes back from an import, sync history from a sync, and a token
// only from signing in to the store again.

/** Together: an override outliving its game would reattach to whatever next imports
 *  under that id. */
export async function clearLibrary(platform: Platform): Promise<void> {
  await platform.db.run('DELETE FROM game')
  await platform.db.run('DELETE FROM user_data')
}

/** What each store last did, not the credential that let it. */
export async function clearSyncState(platform: Platform): Promise<void> {
  await platform.db.run('DELETE FROM sync_state')
}

/** Disconnect, for every store at once. */
export async function clearSignIns(platform: Platform): Promise<void> {
  for (const profile of STORE_PROFILES) await createConnector(platform, profile.store).signOut()
}
