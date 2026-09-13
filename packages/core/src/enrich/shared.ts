import type { Platform } from '../platform.js'
import type { OwnedGame } from '../connectors/types.js'

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** A source refused or the request failed — distinct from "this source does not have the game". */
export class EnrichTransientError extends Error {
  constructor(public readonly url: string, message: string) {
    super(message)
    this.name = 'EnrichTransientError'
  }
}

interface FetchJsonOptions {
  /** Named in the error, so a failure says which service pushed back. */
  source: string
  headers?: Record<string, string>
  retryDelaysMs?: number[]
  /** Beyond 429 and 5xx: statuses this source uses for "slow down" rather than "not here". */
  transientStatuses?: number[]
}

/**
 * A throttled or failed request must never be mistaken for a game a source does not carry:
 * that would stamp enrichedAt and permanently record the game as having no metadata.
 * Transient failures are retried with backoff and then raised.
 */
export async function fetchJson<T>(
  platform: Platform,
  url: string,
  { source, headers, retryDelaysMs = [1000, 4000, 12000], transientStatuses = [] }: FetchJsonOptions
): Promise<T | null> {
  let lastProblem = 'unknown'

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
    if (attempt > 0) await sleep(retryDelaysMs[attempt - 1])

    let response
    try {
      response = await platform.http({ url, headers })
    } catch (err) {
      lastProblem = err instanceof Error ? err.message : String(err)
      continue
    }

    if (response.status === 429 || response.status >= 500 || transientStatuses.includes(response.status)) {
      lastProblem = `HTTP ${response.status}`
      continue
    }

    // A definitive answer, even a 404: the game is simply not there.
    if (response.status !== 200) return null

    try {
      return JSON.parse(response.body) as T
    } catch {
      // Steam serves an HTML error page under a 200 when it is unhappy.
      lastProblem = 'non-JSON response'
    }
  }

  throw new EnrichTransientError(
    url,
    `${source} kept failing (${lastProblem}) after ${retryDelaysMs.length + 1} attempts.`
  )
}

/** The Steam app a game is known by: the one a match stored, or its own id on Steam. */
export function steamAppId(game: OwnedGame): number | undefined {
  if (game.steamAppId !== undefined) return game.steamAppId
  // Rows written before steam_app_id existed carry the match only as a Steam storeUrl.
  const matched = game.storeUrl?.match(/store\.steampowered\.com\/app\/(\d+)/)
  if (matched) return Number(matched[1])
  return game.store === 'steam' && /^\d+$/.test(game.storeGameId) ? Number(game.storeGameId) : undefined
}

/**
 * Splits a matched Steam page out of storeUrl, for rows from a backup written before the two
 * were separate. On a game owned elsewhere the Steam URL was never its store page.
 */
export function withSteamAppId<T extends OwnedGame>(game: T): T {
  const id = steamAppId(game)
  if (id === undefined) return game
  const steamUrl = /^https:\/\/store\.steampowered\.com\//.test(game.storeUrl ?? '')
  return {
    ...game,
    steamAppId: id,
    ...(game.store !== 'steam' && steamUrl ? { storeUrl: undefined } : {})
  }
}
