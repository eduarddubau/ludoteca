import Papa from 'papaparse'
import type { OwnedGame } from '../connectors/types.js'
import type { EditableField } from '../library/userdata.js'

/**
 * A game row plus the user state stored beside it. Rows are raw, not override-applied:
 * a restore has to reproduce the database, and flattening corrections into base values
 * would unpin them, so the next store sync would quietly overwrite them.
 */
export type ExportedGame = OwnedGame & {
  hidden?: boolean
  overrides?: Partial<Record<EditableField, unknown>>
}

/**
 * Every field the database holds, because this file is the backup. `parseCsv` reads all
 * of them back by these names, so export/import is a genuine round trip.
 *
 * Playtime is minutes, not hours: the old `hours_played` column rounded, so a re-import
 * turned 90 minutes into 120. Human-readable, but not a backup.
 */
const COLUMNS = [
  'title',
  'store',
  'platform',
  'playtime_minutes',
  'status',
  'genres',
  'release_year',
  'critic_score',
  'metacritic_url',
  'store_url',
  'cover_url',
  'icon_url',
  'last_played_at',
  'store_game_id',
  'ownership',
  'owner_account_id',
  'exclude_reason',
  'developer',
  'publisher',
  'user_rating',
  'notes',
  'enriched_at',
  'added_manually',
  'hidden',
  'overrides'
] as const

const flag = (value: boolean | undefined): string => (value ? 'true' : 'false')

export function toCsv(games: ExportedGame[]): string {
  const rows = games.map((game) => ({
    title: game.title,
    store: game.store,
    platform: game.platform,
    playtime_minutes: game.playtimeMinutes ?? '',
    status: game.playStatus,
    genres: game.genres.join('; '),
    release_year: game.releaseYear ?? '',
    critic_score: game.criticScore ?? '',
    metacritic_url: game.metacriticUrl ?? '',
    store_url: game.storeUrl ?? '',
    cover_url: game.coverUrl ?? '',
    icon_url: game.iconUrl ?? '',
    last_played_at: game.lastPlayedAt ?? '',
    store_game_id: game.storeGameId,
    ownership: game.ownership.kind,
    owner_account_id: game.ownership.kind === 'familyShared' ? game.ownership.ownerAccountId : '',
    exclude_reason:
      game.ownership.kind === 'familyShared' ? (game.ownership.excludeReason ?? '') : '',
    developer: game.developer ?? '',
    publisher: game.publisher ?? '',
    user_rating: game.userRating ?? '',
    notes: game.notes ?? '',
    enriched_at: game.enrichedAt ?? '',
    added_manually: flag(game.addedManually),
    hidden: flag(game.hidden),
    overrides: Object.keys(game.overrides ?? {}).length ? JSON.stringify(game.overrides) : ''
  }))

  return Papa.unparse(rows, { columns: [...COLUMNS] })
}

/** Keeps genres as an array and omits empty fields entirely. */
export function toJson(games: ExportedGame[]): string {
  return JSON.stringify(games, null, 2)
}
