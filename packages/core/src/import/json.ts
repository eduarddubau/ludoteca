import type { OwnedGame, PlayStatus, StoreId } from '../connectors/types.js'

const STORES: StoreId[] = ['steam', 'gog', 'epic']
const STATUSES: PlayStatus[] = ['played', 'unplayed', 'unknown']

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

const num = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

/**
 * Reads a library exported as JSON. Unlike the CSV path there is no column mapping —
 * the file is already this project's own shape — but it is still validated field by
 * field, because a hand-edited or foreign file will otherwise poison the database with
 * values the UI assumes are well-formed.
 */
export function fromJson(text: string): OwnedGame[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Expected a JSON array of games.')
  }

  const games: OwnedGame[] = []

  for (const [index, raw] of parsed.entries()) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Record<string, unknown>

    const title = str(entry['title'])
    if (!title) continue

    const store = str(entry['store'])?.toLowerCase()
    const status = str(entry['playStatus'])?.toLowerCase()
    const ownership = entry['ownership'] as { kind?: unknown; ownerAccountId?: unknown } | undefined
    const genres = Array.isArray(entry['genres'])
      ? (entry['genres'] as unknown[]).map(str).filter((g): g is string => g !== undefined)
      : []

    games.push({
      store: STORES.includes(store as StoreId) ? (store as StoreId) : 'steam',
      storeGameId: str(entry['storeGameId']) ?? `json-${index}`,
      title,
      ownership:
        ownership?.kind === 'familyShared'
          ? { kind: 'familyShared', ownerAccountId: str(ownership['ownerAccountId']) ?? '' }
          : { kind: 'owned' },
      playStatus: STATUSES.includes(status as PlayStatus) ? (status as PlayStatus) : 'unknown',
      playtimeMinutes: num(entry['playtimeMinutes']),
      genres,
      releaseYear: num(entry['releaseYear']),
      developer: str(entry['developer']),
      publisher: str(entry['publisher']),
      criticScore: num(entry['criticScore']),
      metacriticUrl: str(entry['metacriticUrl']),
      storeUrl: str(entry['storeUrl']),
      userRating: num(entry['userRating']),
      lastPlayedAt: str(entry['lastPlayedAt']),
      coverUrl: str(entry['coverUrl']),
      notes: str(entry['notes']),
      enrichedAt: str(entry['enrichedAt'])
    })
  }

  if (!games.length) throw new Error('No entries with a title were found in that file.')
  return games
}
