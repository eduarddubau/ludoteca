import type { Platform } from '../platform.js'
import type { OwnedGame } from '../connectors/types.js'

export interface EnrichProgress {
  done: number
  total: number
  title: string
  matched: boolean
}

export interface EnrichOptions {
  /** Steam rate-limits; this paces requests rather than getting throttled mid-run. */
  delayMs?: number
  onProgress?: (progress: EnrichProgress) => void
  signal?: { aborted: boolean }
  /** Re-attempt games that have already been tried. */
  force?: boolean
  /**
   * Called every `checkpointEvery` games with the full library so far. A full run takes
   * minutes; without this, a crash loses all of it, since unpersisted work has no
   * `enrichedAt` to resume from.
   */
  onCheckpoint?: (games: OwnedGame[]) => Promise<void> | void
  checkpointEvery?: number
}

interface SearchHit {
  id: number
  name: string
}

const normalize = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]/g, '')

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function json<T>(platform: Platform, url: string): Promise<T | null> {
  const response = await platform.http({ url })
  if (response.status !== 200) return null
  try {
    return JSON.parse(response.body) as T
  } catch {
    return null
  }
}

// Editions Steam ships under a longer name than the game is commonly called.
const EDITION_SUFFIX =
  /(ultimate|definitive|complete|deluxe|enhanced|goty|game of the year|remastered|anniversary|standard)\s*(edition)?$/

/**
 * Searches Steam and returns a hit only when the name genuinely corresponds.
 *
 * Deliberately scans the whole result list rather than trusting the top hit: sequels
 * outrank originals, so "Hades" returns Hades II first and "Subnautica" returns
 * Subnautica 2. Checking only index 0 rejected three of four popular titles.
 */
async function findAppId(platform: Platform, title: string): Promise<SearchHit | null> {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&cc=us&l=en`
  const result = await json<{ items?: SearchHit[] }>(platform, url)
  const items = result?.items ?? []
  const wanted = normalize(title)

  const exact = items.find((item) => normalize(item.name) === wanted)
  if (exact) return exact

  // Second tier: the same game under an edition name. Anything else is left unmatched
  // for a human to resolve rather than guessed at.
  return (
    items.find((item) => {
      const name = item.name.toLowerCase()
      return name.startsWith(title.toLowerCase()) && EDITION_SUFFIX.test(name.slice(title.length).trim())
    }) ?? null
  )
}

interface AppDetails {
  success: boolean
  data?: {
    name: string
    metacritic?: { score: number; url: string }
    genres?: { description: string }[]
    release_date?: { date: string }
  }
}

async function fetchDetails(platform: Platform, appId: number): Promise<AppDetails['data'] | null> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`
  const result = await json<Record<string, AppDetails>>(platform, url)
  const entry = result?.[String(appId)]
  return entry?.success ? (entry.data ?? null) : null
}

function releaseYear(raw: string | undefined): number | undefined {
  const year = raw?.match(/\b(19|20)\d{2}\b/)?.[0]
  return year ? Number(year) : undefined
}

/** True when this game has never been through enrichment. */
export function needsEnrichment(game: OwnedGame): boolean {
  return game.enrichedAt === undefined
}

/**
 * Enriches one game from Steam's public store endpoints — no API key. Call this
 * directly when a single game is added; `enrichLibrary` is the batch built on it.
 *
 * Runs for every store, not only Steam: Steam's database carries most Epic and GOG
 * titles, and a Metacritic score is the same score wherever the game was bought. Only
 * `storeUrl` stays store-specific.
 */
export async function enrichGame(platform: Platform, game: OwnedGame): Promise<OwnedGame> {
  const attemptedAt = new Date().toISOString()
  const hit = await findAppId(platform, game.title)
  if (!hit) return { ...game, enrichedAt: attemptedAt }

  const details = await fetchDetails(platform, hit.id)
  return {
    ...game,
    criticScore: details?.metacritic?.score ?? game.criticScore,
    metacriticUrl: details?.metacritic?.url ?? game.metacriticUrl,
    coverUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${hit.id}/library_600x900.jpg`,
    genres: details?.genres?.map((g) => g.description) ?? game.genres,
    releaseYear: releaseYear(details?.release_date?.date) ?? game.releaseYear,
    storeUrl:
      game.store === 'steam'
        ? `https://store.steampowered.com/app/${hit.id}`
        : game.storeUrl,
    enrichedAt: attemptedAt
  }
}

/** Enriches every game that has not been attempted yet, paced and interruptible. */
export async function enrichLibrary(
  platform: Platform,
  games: OwnedGame[],
  options: EnrichOptions = {}
): Promise<OwnedGame[]> {
  const { delayMs = 350, onProgress, signal, force = false, onCheckpoint, checkpointEvery = 25 } = options
  const pending = games.filter((game) => force || needsEnrichment(game))
  const results = new Map<string, OwnedGame>()

  const merged = (): OwnedGame[] =>
    games.map((game) => results.get(`${game.store}:${game.storeGameId}`) ?? game)

  for (const [index, game] of pending.entries()) {
    if (signal?.aborted) break

    const enriched = await enrichGame(platform, game)
    results.set(`${game.store}:${game.storeGameId}`, enriched)
    onProgress?.({
      done: index + 1,
      total: pending.length,
      title: game.title,
      matched: enriched.criticScore !== undefined || enriched.coverUrl !== undefined
    })

    if (onCheckpoint && (index + 1) % checkpointEvery === 0) await onCheckpoint(merged())
    await sleep(delayMs)
  }

  return merged()
}
