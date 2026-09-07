import { STORE_LABEL } from '../connectors/types.js'
import type { GamePlatform, OwnedGame, PlayStatus, StoreId } from '../connectors/types.js'

/** Where one entry is owned, kept per-store so links and playtime stay attributable. */
export interface GameSource {
  store: StoreId
  storeGameId: string
  storeUrl?: string
  playtimeMinutes?: number
  playStatus: PlayStatus
  shared: boolean
}

/** One game, however many stores sell it. Built for display; the database keeps rows. */
/**
 * What the library is divided into. Deliberately describes the shelf rather than the
 * playtime: 'unplayed' (a store reporting zero) and 'unknown' (Epic reporting nothing at
 * all) are indistinguishable to a reader, and any label about *playing* would overclaim
 * for the 319 games Epic is simply silent about. A shelf makes no such claim.
 */
export type Shelf = 'played' | 'backlog'

export const SHELF_LABEL: Record<Shelf, string> = {
  played: 'Played',
  backlog: 'Backlog'
}

export function shelfOf(status: PlayStatus): Shelf {
  return status === 'played' ? 'played' : 'backlog'
}

/**
 * What the store filter offers. Shared games are Steam games — ownership is the
 * dimension, not the store — but they are worth filtering apart, so the facet is derived
 * from ownership rather than by inventing a store that cannot be connected to.
 */
export type StoreFacet = StoreId | 'steam:shared'

export const FACET_LABEL: Record<StoreFacet, string> = {
  ...STORE_LABEL,
  'steam:shared': 'Steam (shared)'
}

export interface LibraryEntry {
  key: string
  title: string
  stores: StoreId[]
  platforms: GamePlatform[]
  /** Store filter values, splitting owned from family-shared. */
  facets: StoreFacet[]
  sources: GameSource[]
  /** Kept alongside `shelf` so the finer distinction stays recoverable. */
  playStatus: PlayStatus
  shelf: Shelf
  playtimeMinutes?: number
  genres: string[]
  releaseYear?: number
  developer?: string
  publisher?: string
  criticScore?: number
  metacriticUrl?: string
  coverUrl?: string
  enrichedAt?: string
}

const normalize = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]/g, '')

// Played beats unplayed beats no-data: if any store recorded time, the game was played,
// whatever the silent ones say.
const STATUS_RANK: Record<PlayStatus, number> = { played: 2, unplayed: 1, unknown: 0 }

function mergeStatus(sources: GameSource[]): PlayStatus {
  return sources.reduce<PlayStatus>(
    (best, source) => (STATUS_RANK[source.playStatus] > STATUS_RANK[best] ? source.playStatus : best),
    'unknown'
  )
}

/**
 * Collapses the same game owned on several stores into one entry, matching on a
 * normalized title. Merging happens here rather than in the database so it stays
 * reversible: the rows remain per-store, and a wrong merge costs a display quirk
 * rather than lost ownership data.
 */
export function mergeLibrary(games: OwnedGame[]): LibraryEntry[] {
  const grouped = new Map<string, OwnedGame[]>()

  for (const game of games) {
    const key = normalize(game.title)
    const existing = grouped.get(key)
    if (existing) existing.push(game)
    else grouped.set(key, [game])
  }

  return [...grouped.entries()].map(([key, group]) => {
    const sources: GameSource[] = group.map((game) => ({
      store: game.store,
      storeGameId: game.storeGameId,
      storeUrl: game.storeUrl,
      playtimeMinutes: game.playtimeMinutes,
      playStatus: game.playStatus,
      shared: game.ownership.kind === 'familyShared'
    }))

    const played = sources
      .map((source) => source.playtimeMinutes)
      .filter((minutes): minutes is number => minutes !== undefined)

    const first = <T>(pick: (game: OwnedGame) => T | undefined): T | undefined =>
      group.map(pick).find((value) => value !== undefined)

    return {
      key,
      title: group[0].title,
      stores: [...new Set(sources.map((s) => s.store))].sort(),
      platforms: [...new Set(group.map((g) => g.platform))].sort(),
      facets: [
        ...new Set(
          sources.map((s): StoreFacet =>
            s.store === 'steam' && s.shared ? 'steam:shared' : s.store
          )
        )
      ].sort(),
      sources,
      playStatus: mergeStatus(sources),
      shelf: shelfOf(mergeStatus(sources)),
      // Hours on the same game across two stores are still hours on that game.
      playtimeMinutes: played.length ? played.reduce((a, b) => a + b, 0) : undefined,
      genres: group.find((game) => game.genres.length)?.genres ?? [],
      releaseYear: first((game) => game.releaseYear),
      developer: first((game) => game.developer),
      publisher: first((game) => game.publisher),
      criticScore: first((game) => game.criticScore),
      metacriticUrl: first((game) => game.metacriticUrl),
      coverUrl: first((game) => game.coverUrl),
      enrichedAt: first((game) => game.enrichedAt)
    }
  })
}

/** Presentation labels: 'unknown' is an absence of data, not a third play state. */
export const STATUS_LABEL: Record<PlayStatus, string> = {
  played: 'Played',
  unplayed: 'Unplayed',
  unknown: 'No play data'
}
