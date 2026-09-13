import type { OwnedGame } from '../connectors/types.js'

/** Fields a user may correct by hand. Deliberately not the store identity. */
export type EditableField =
  | 'title'
  | 'platform'
  | 'genres'
  | 'releaseYear'
  | 'developer'
  | 'publisher'
  | 'criticScore'
  | 'metacriticUrl'
  | 'storeUrl'
  | 'coverUrl'
  | 'notes'

export const EDITABLE_FIELDS: EditableField[] = [
  'title', 'platform', 'genres', 'releaseYear', 'developer', 'publisher',
  'criticScore', 'metacriticUrl', 'storeUrl', 'coverUrl', 'notes'
]

/**
 * Keeps an imported file from writing arbitrary keys into user_data. `applyUserData`
 * spreads overrides straight onto the game, so an unfiltered `store` or `storeGameId`
 * would move the row's identity away from the database row it came from, and a `genres`
 * string would break every consumer expecting an array.
 */
export function sanitizeOverrides(raw: unknown): Partial<Record<EditableField, unknown>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const source = raw as Record<string, unknown>
  const clean: Partial<Record<EditableField, unknown>> = {}
  for (const field of EDITABLE_FIELDS) {
    if (!(field in source)) continue
    const value = source[field]
    if (field === 'genres' && !Array.isArray(value)) continue
    clean[field] = value
  }
  return clean
}

export interface UserData {
  store: string
  storeGameId: string
  /** Only the fields the user actually set; everything else still comes from sync. */
  overrides: Partial<Record<EditableField, unknown>>
  hidden: boolean
}

export const gameKey = (game: { store: string; storeGameId: string }): string =>
  `${game.store}:${game.storeGameId}`

/**
 * Layers user intent over synced rows. Overrides win per field, so correcting a title
 * does not freeze the score — a later refetch still updates everything untouched.
 */
export function applyUserData(
  games: OwnedGame[],
  userData: Map<string, UserData>
): (OwnedGame & { hidden: boolean; editedFields: EditableField[] })[] {
  return games.map((game) => {
    const entry = userData.get(gameKey(game))
    if (!entry) return { ...game, hidden: false, editedFields: [] }

    const edited = Object.keys(entry.overrides) as EditableField[]
    return {
      ...game,
      ...entry.overrides,
      hidden: entry.hidden,
      editedFields: edited
    } as OwnedGame & { hidden: boolean; editedFields: EditableField[] }
  })
}

const normalize = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * What survives an import. Manually added games are kept, because the user typed them
 * and an import of one store should not silently discard them — except where the import
 * now carries the same game on the same store, in which case the real row supersedes the
 * placeholder and keeping both would just be a duplicate.
 */
export function reconcileImport(existing: OwnedGame[], imported: OwnedGame[]): OwnedGame[] {
  const importedKeys = new Set(
    imported.map((game) => `${game.store}:${normalize(game.title)}`)
  )
  const survivingManual = existing.filter(
    (game) => game.addedManually && !importedKeys.has(`${game.store}:${normalize(game.title)}`)
  )
  return [...imported, ...survivingManual]
}

/**
 * Carries enrichment across a re-sync. A store hands back ownership facts only — title,
 * id, store page — so replacing rows wholesale would discard every score, cover and
 * genre the metadata pass found, and mark the game unenriched so it all had to be
 * fetched again. Matching is on the store's own id, which is stable.
 */
export function preserveEnrichment(fetched: OwnedGame[], existing: OwnedGame[]): OwnedGame[] {
  const before = new Map(existing.map((game) => [gameKey(game), game]))

  return fetched.map((game) => {
    const previous = before.get(gameKey(game))
    if (!previous) return game

    return {
      ...game,
      genres: game.genres.length ? game.genres : previous.genres,
      releaseYear: game.releaseYear ?? previous.releaseYear,
      // Connectors all report 'pc'; a console platform only ever came from the user.
      platform: previous.platform,
      developer: previous.developer,
      publisher: previous.publisher,
      criticScore: previous.criticScore,
      metacriticUrl: previous.metacriticUrl,
      criticScoreSource: previous.criticScoreSource,
      steamAppId: previous.steamAppId,
      steamReviewPercent: previous.steamReviewPercent,
      steamReviewCount: previous.steamReviewCount,
      steamReviewLabel: previous.steamReviewLabel,
      coverUrl: previous.coverUrl ?? game.coverUrl,
      enrichedAt: previous.enrichedAt,
      // Playtime a store does report should win; GOG reports none, so keep what we had.
      playtimeMinutes: game.playtimeMinutes ?? previous.playtimeMinutes,
      playStatus: game.playStatus === 'unknown' ? previous.playStatus : game.playStatus
    }
  })
}
