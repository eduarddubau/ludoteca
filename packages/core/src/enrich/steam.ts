import type { Platform } from '../platform.js'
import type { OwnedGame } from '../connectors/types.js'
import { fillMetacriticFromPcgamingwiki } from './pcgamingwiki.js'
import { fetchJson, sleep, steamAppId } from './shared.js'

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
  /** After matching, fill scores Steam did not show from PCGamingWiki, batched and paced. */
  fillFromPcgamingwiki?: boolean
}

interface SearchHit {
  id: number
  name: string
}

/** A Steam result offered to the user when auto-matching cannot decide. */
export interface MatchCandidate {
  appId: number
  name: string
  /** Absent when Steam has no portrait art for the item, as with most DLC. */
  coverUrl?: string
  /** True when the name matches exactly — what auto-matching would have accepted. */
  exact: boolean
}

const normalize = (s: string): string =>
  s.toLowerCase().replace(/[^a-z0-9]/g, '')

// Every request goes through the shared helper, so a failure is never recorded as a miss.
const json = <T>(platform: Platform, url: string): Promise<T | null> =>
  fetchJson<T>(platform, url, { source: 'Steam' })

// Editions Steam ships under a longer name than the game is commonly called. Anchored at
// both ends, so the whole remainder has to be edition words: anchored only at the end, it
// took "Death Stranding 2: On the Beach - Upgrade to Digital Deluxe Edition" for Death
// Stranding and "Hitman Classic Trilogy Remastered" for HITMAN.
const EDITION_SUFFIX =
  /^[-–—:]?\s*(the\s+)?(ultimate|definitive|complete|deluxe|enhanced|goty|game of the year|remastered|anniversary|standard)\s*(edition)?$/

/** The same game sold under an edition name, such as "DARQ: Complete Edition" for DARQ. */
export function isEditionOf(title: string, name: string): boolean {
  const lower = name.toLowerCase()
  const wanted = title.toLowerCase()
  return lower.startsWith(wanted) && EDITION_SUFFIX.test(lower.slice(wanted.length).trim())
}

/**
 * Searches Steam and returns a hit only when the name genuinely corresponds.
 *
 * Deliberately scans the whole result list rather than trusting the top hit: sequels
 * outrank originals, so "Hades" returns Hades II first and "Subnautica" returns
 * Subnautica 2. Checking only index 0 rejected three of four popular titles.
 */
async function search(platform: Platform, term: string): Promise<SearchHit[]> {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(term)}&cc=us&l=en`
  const result = await json<{ items?: SearchHit[] }>(platform, url)
  return result?.items ?? []
}

/**
 * The part before a subtitle separator. Steam's search returns nothing at all for
 * "Alba - A Wildlife Adventure" because its own title uses a colon, yet searching "Alba"
 * finds it — and the two normalize identically, so the match is then exact. Punctuation
 * in a subtitle was a large share of the unmatched games.
 */
export function shortenTitle(title: string): string | null {
  const cut = title.search(/\s*[-–—:]\s+/)
  if (cut <= 0) return null
  const head = title.slice(0, cut).trim()
  return head.length >= 3 ? head : null
}

async function findAppId(platform: Platform, title: string): Promise<SearchHit | null> {
  let items = await search(platform, title)

  // Retry on the leading phrase when the full title finds nothing at all.
  if (!items.length) {
    const shorter = shortenTitle(title)
    if (shorter) items = await search(platform, shorter)
  }

  const wanted = normalize(title)

  const exact = items.find((item) => normalize(item.name) === wanted)
  if (exact) return exact

  // Second tier: the same game under an edition name. Anything else is left unmatched
  // for a human to resolve rather than guessed at.
  return items.find((item) => isEditionOf(title, item.name)) ?? null
}

interface AppDetails {
  success: boolean
  data?: {
    name: string
    metacritic?: { score: number; url: string }
    genres?: { description: string }[]
    developers?: string[]
    publishers?: string[]
    release_date?: { date: string }
  }
}

async function fetchDetails(platform: Platform, appId: number): Promise<AppDetails['data'] | null> {
  const url = `https://store.steampowered.com/api/appdetails?appids=${appId}&l=english`
  const result = await json<Record<string, AppDetails>>(platform, url)
  const entry = result?.[String(appId)]
  return entry?.success ? (entry.data ?? null) : null
}

interface StoreItem {
  appid: number
  assets?: { asset_url_format?: string; library_capsule?: string }
  reviews?: {
    summary_filtered?: {
      review_count: number
      percent_positive: number
      review_score: number
      review_score_label: string
    }
  }
}

const ASSET_HOST = 'https://shared.akamai.steamstatic.com/store_item_assets/'
const STORE_ITEMS_PER_REQUEST = 100

/** Art and review summaries for up to a hundred apps in one request, keyed by app. */
async function fetchStoreItems(platform: Platform, appIds: number[]): Promise<Map<number, StoreItem>> {
  const items = new Map<number, StoreItem>()
  if (!appIds.length) return items

  const input = {
    ids: appIds.map((appid) => ({ appid })),
    context: { language: 'english', country_code: 'US' },
    data_request: { include_assets: true, include_reviews: true }
  }
  const url = `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`
  const result = await json<{ response?: { store_items?: StoreItem[] } }>(platform, url)

  for (const item of result?.response?.store_items ?? []) items.set(item.appid, item)
  return items
}

/**
 * The portrait cover at the path Steam actually serves. Newer apps keep their art under a
 * hashed directory, so a URL built from the app id alone 404s — and a stored dead link
 * counts as a resolved cover, so nothing flagged the ten that had one.
 */
function coverOf(item: StoreItem | undefined): string | undefined {
  const format = item?.assets?.asset_url_format
  const capsule = item?.assets?.library_capsule
  return format && capsule ? ASSET_HOST + format.replace('${FILENAME}', capsule) : undefined
}

type ReviewFields = Pick<OwnedGame, 'steamReviewPercent' | 'steamReviewCount' | 'steamReviewLabel'>

/** All three set together, or all three cleared: a percentage without its count misleads. */
function reviewsOf(item: StoreItem | undefined): ReviewFields {
  const summary = item?.reviews?.summary_filtered
  // A review_score of 0 is Steam declining to rate: no reviews, or too few to call.
  if (!summary?.review_score) {
    return { steamReviewPercent: undefined, steamReviewCount: undefined, steamReviewLabel: undefined }
  }
  return {
    steamReviewPercent: summary.percent_positive,
    steamReviewCount: summary.review_count,
    steamReviewLabel: summary.review_score_label
  }
}

/**
 * Re-reads Steam's review summary for every game with a Steam app, a hundred to a request.
 * Separate from matching because review scores drift where Metacritic's do not, and
 * refreshing one needs only the app a match already stored — no search. An app Steam
 * leaves out of its answer keeps what it had.
 */
export async function refreshSteamReviews(
  platform: Platform,
  games: OwnedGame[],
  options: Pick<EnrichOptions, 'signal' | 'onProgress'> = {}
): Promise<OwnedGame[]> {
  const ids = [...new Set(games.map(steamAppId).filter((id): id is number => id !== undefined))]
  const answered = new Map<number, StoreItem>()

  for (let start = 0; start < ids.length; start += STORE_ITEMS_PER_REQUEST) {
    if (options.signal?.aborted) break
    if (start > 0) await sleep(1000)
    const items = await fetchStoreItems(platform, ids.slice(start, start + STORE_ITEMS_PER_REQUEST))
    for (const [id, item] of items) answered.set(id, item)
    options.onProgress?.({
      done: Math.min(start + STORE_ITEMS_PER_REQUEST, ids.length),
      total: ids.length,
      title: 'Steam reviews',
      matched: true
    })
  }

  return games.map((game) => {
    const id = steamAppId(game)
    return id !== undefined && answered.has(id) ? { ...game, ...reviewsOf(answered.get(id)) } : game
  })
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
 * The top Steam results for a title, for the cases auto-matching refuses. Ranked as
 * Steam ranks them — sequels first for "Hades" — so the exact flag marks which one the
 * automatic path would have taken, and the user decides the rest.
 */
export async function searchCandidates(
  platform: Platform,
  title: string,
  limit = 8
): Promise<MatchCandidate[]> {
  const url = `https://store.steampowered.com/api/storesearch/?term=${encodeURIComponent(title)}&cc=us&l=en`
  const result = await json<{ items?: SearchHit[] }>(platform, url)
  const wanted = normalize(title)
  const items = (result?.items ?? []).slice(0, limit)
  const storeItems = await fetchStoreItems(platform, items.map((item) => item.id))

  return items.map((item) => ({
    appId: item.id,
    name: item.name,
    coverUrl: coverOf(storeItems.get(item.id)),
    exact: normalize(item.name) === wanted
  }))
}

/** Applies a specific Steam app to a game — the manual counterpart to enrichGame. */
export async function enrichWithAppId(
  platform: Platform,
  game: OwnedGame,
  appId: number
): Promise<OwnedGame> {
  const details = await fetchDetails(platform, appId)
  const item = (await fetchStoreItems(platform, [appId])).get(appId)
  return {
    ...game,
    criticScore: details?.metacritic?.score ?? game.criticScore,
    metacriticUrl: details?.metacritic?.url ?? game.metacriticUrl,
    criticScoreSource: details?.metacritic ? 'steam' : game.criticScoreSource,
    // No fallback to the stored cover: that is how a dead link would survive a refetch.
    coverUrl: coverOf(item),
    ...reviewsOf(item),
    genres: details?.genres?.map((g) => g.description) ?? game.genres,
    developer: details?.developers?.[0] ?? game.developer,
    publisher: details?.publishers?.[0] ?? game.publisher,
    releaseYear: releaseYear(details?.release_date?.date) ?? game.releaseYear,
    steamAppId: appId,
    // Steam's page is the store page only for a Steam game; an imported one, with no app of its
    // own, takes the match. Any other store's page, like a synced GOG one, is left alone.
    storeUrl:
      game.store === 'steam' && !/^\d+$/.test(game.storeGameId)
        ? `https://store.steampowered.com/app/${appId}`
        : game.storeUrl,
    enrichedAt: new Date().toISOString()
  }
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
  const hit = await findAppId(platform, game.title)
  // Marked attempted even with no match, so it is not re-tried on every run — and so the
  // manual picker can list exactly the games automation could not resolve.
  if (!hit) return { ...game, enrichedAt: new Date().toISOString() }
  return enrichWithAppId(platform, game, hit.id)
}

/** Enriches every game that has not been attempted yet, paced and interruptible. */
export async function enrichLibrary(
  platform: Platform,
  games: OwnedGame[],
  options: EnrichOptions = {}
): Promise<OwnedGame[]> {
  const {
    delayMs = 350, onProgress, signal, force = false, onCheckpoint, checkpointEvery = 25,
    fillFromPcgamingwiki = false
  } = options
  const pending = games.filter((game) => force || needsEnrichment(game))
  const results = new Map<string, OwnedGame>()

  const merged = (): OwnedGame[] =>
    games.map((game) => results.get(`${game.store}:${game.storeGameId}`) ?? game)

  for (const [index, game] of pending.entries()) {
    if (signal?.aborted) break

    let enriched: OwnedGame
    try {
      enriched = await enrichGame(platform, game)
    } catch (err) {
      // Save what this run achieved before surfacing the failure, or everything since
      // the last checkpoint is lost and has no enrichedAt to resume from.
      await onCheckpoint?.(merged())
      throw err
    }

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

  // Batched after the loop rather than per game: fifty wiki pages cost one read.
  if (fillFromPcgamingwiki && !signal?.aborted && results.size) {
    const keep = (filled: OwnedGame[]): void => {
      for (const game of filled) results.set(`${game.store}:${game.storeGameId}`, game)
    }
    keep(
      await fillMetacriticFromPcgamingwiki(platform, [...results.values()], {
        signal,
        onProgress,
        onCheckpoint: async (filled) => {
          keep(filled)
          await onCheckpoint?.(merged())
        }
      })
    )
  }

  return merged()
}
