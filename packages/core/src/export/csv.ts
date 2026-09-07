import Papa from 'papaparse'
import type { OwnedGame } from '../connectors/types.js'

/**
 * The first four columns deliberately match the shape and names of the library CSV this
 * project started from, so an export stays readable by whatever produced that file. The
 * metadata columns follow, and `parseCsv` reads them back, which makes export/import a
 * genuine round trip rather than a one-way door.
 */
const COLUMNS = [
  'title',
  'platform',
  'hours_played',
  'status',
  'genres',
  'release_year',
  'critic_score',
  'metacritic_url',
  'store_url',
  'cover_url',
  'store_game_id',
  'ownership',
  'developer',
  'publisher',
  'user_rating',
  'notes',
  'enriched_at'
] as const

const hours = (minutes: number | undefined): string =>
  minutes === undefined ? '' : String(Math.round(minutes / 60))

export function toCsv(games: OwnedGame[]): string {
  const rows = games.map((game) => ({
    title: game.title,
    platform: game.store,
    hours_played: hours(game.playtimeMinutes),
    status: game.playStatus,
    genres: game.genres.join('; '),
    release_year: game.releaseYear ?? '',
    critic_score: game.criticScore ?? '',
    metacritic_url: game.metacriticUrl ?? '',
    store_url: game.storeUrl ?? '',
    cover_url: game.coverUrl ?? '',
    store_game_id: game.storeGameId,
    ownership: game.ownership.kind,
    developer: game.developer ?? '',
    publisher: game.publisher ?? '',
    user_rating: game.userRating ?? '',
    notes: game.notes ?? '',
    enriched_at: game.enrichedAt ?? ''
  }))

  return Papa.unparse(rows, { columns: [...COLUMNS] })
}

/** Lossless, unlike the CSV: keeps genres as an array and omits empty fields entirely. */
export function toJson(games: OwnedGame[]): string {
  return JSON.stringify(games, null, 2)
}
