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

/** Steam's own search ranking does the fuzzy matching, which beats a local title index. */
async function findAppId(platform: Platform, title: string): Promise<SearchHit | null> {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&cc=us&l=en`
  const result = await json<{ items?: SearchHit[] }>(platform, url)
  return result?.items?.[0] ?? null
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

/**
 * Fills Metacritic score, cover art, genres and release year from Steam's public store
 * endpoints — no API key. Runs for every game, not only Steam ones: Steam's database
 * carries most Epic and GOG titles too, and a Metacritic score is the same score
 * wherever the game was bought. Only `storeUrl` stays store-specific.
 */
export async function enrichFromSteam(
  platform: Platform,
  games: OwnedGame[],
  options: EnrichOptions = {}
): Promise<OwnedGame[]> {
  const { delayMs = 350, onProgress, signal } = options
  const enriched: OwnedGame[] = []

  for (const [index, game] of games.entries()) {
    if (signal?.aborted) {
      enriched.push(...games.slice(index))
      break
    }

    // Already enriched, or previously searched and not found.
    if (game.criticScore !== undefined || game.coverUrl !== undefined) {
      enriched.push(game)
      continue
    }

    const hit = await findAppId(platform, game.title)
    // Only trust a hit whose name actually matches; Steam always returns *something*.
    const matched = hit !== null && normalize(hit.name) === normalize(game.title)

    if (!hit || !matched) {
      enriched.push(game)
      onProgress?.({ done: index + 1, total: games.length, title: game.title, matched: false })
      await sleep(delayMs)
      continue
    }

    const details = await fetchDetails(platform, hit.id)
    enriched.push({
      ...game,
      criticScore: details?.metacritic?.score ?? game.criticScore,
      metacriticUrl: details?.metacritic?.url ?? game.metacriticUrl,
      coverUrl: `https://cdn.cloudflare.steamstatic.com/steam/apps/${hit.id}/library_600x900.jpg`,
      genres: details?.genres?.map((g) => g.description) ?? game.genres,
      releaseYear: releaseYear(details?.release_date?.date) ?? game.releaseYear,
      // Steam is the source of the metadata, but not necessarily where it was bought.
      storeUrl:
        game.store === 'steam'
          ? `https://store.steampowered.com/app/${hit.id}`
          : game.storeUrl
    })

    onProgress?.({ done: index + 1, total: games.length, title: game.title, matched: true })
    await sleep(delayMs)
  }

  return enriched
}
