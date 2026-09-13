import { sanitizeOverrides } from '../library/userdata.js'
import { withSteamAppId } from '../enrich/shared.js'
import type { ExportedGame } from '../export/csv.js'
import { toPlatform, toStatus, toStore } from './values.js'

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
export function fromJson(text: string): ExportedGame[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('That file is not valid JSON.')
  }

  if (!Array.isArray(parsed)) {
    throw new Error('Expected a JSON array of games.')
  }

  const games: ExportedGame[] = []

  for (const [index, raw] of parsed.entries()) {
    if (typeof raw !== 'object' || raw === null) continue
    const entry = raw as Record<string, unknown>

    const title = str(entry['title'])
    if (!title) continue

    const ownership = entry['ownership'] as
      | { kind?: unknown; ownerAccountId?: unknown; excludeReason?: unknown }
      | undefined
    const genres = Array.isArray(entry['genres'])
      ? (entry['genres'] as unknown[]).map(str).filter((g): g is string => g !== undefined)
      : []

    games.push(withSteamAppId({
      store: toStore(str(entry['store'])),
      storeGameId: str(entry['storeGameId']) ?? `json-${index}`,
      title,
      ownership:
        ownership?.kind === 'familyShared'
          ? {
              kind: 'familyShared',
              ownerAccountId: str(ownership['ownerAccountId']) ?? '',
              ...(num(ownership['excludeReason']) !== undefined
                ? { excludeReason: num(ownership['excludeReason']) as number }
                : {})
            }
          : { kind: 'owned' },
      platform: toPlatform(str(entry['platform'])),
      playStatus: toStatus(str(entry['playStatus'])),
      playtimeMinutes: num(entry['playtimeMinutes']),
      genres,
      releaseYear: num(entry['releaseYear']),
      developer: str(entry['developer']),
      publisher: str(entry['publisher']),
      criticScore: num(entry['criticScore']),
      metacriticUrl: str(entry['metacriticUrl']),
      criticScoreSource:
        entry['criticScoreSource'] === 'steam' || entry['criticScoreSource'] === 'pcgamingwiki'
          ? entry['criticScoreSource']
          : undefined,
      steamReviewPercent: num(entry['steamReviewPercent']),
      steamReviewCount: num(entry['steamReviewCount']),
      steamReviewLabel: str(entry['steamReviewLabel']),
      storeUrl: str(entry['storeUrl']),
      steamAppId: num(entry['steamAppId']),
      steamAppPinned: entry['steamAppPinned'] === true,
      pcgamingwikiCheckedAt: str(entry['pcgamingwikiCheckedAt']),
      userRating: num(entry['userRating']),
      lastPlayedAt: str(entry['lastPlayedAt']),
      coverUrl: str(entry['coverUrl']),
      iconUrl: str(entry['iconUrl']),
      notes: str(entry['notes']),
      enrichedAt: str(entry['enrichedAt']),
      addedManually: entry['addedManually'] === true,
      ...('hidden' in entry ? { hidden: entry['hidden'] === true } : {}),
      ...('overrides' in entry ? { overrides: sanitizeOverrides(entry['overrides']) } : {})
    }))
  }

  if (!games.length) throw new Error('No entries with a title were found in that file.')
  return games
}
