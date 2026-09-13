import type { Platform } from '../platform.js'
import type { OwnedGame } from '../connectors/types.js'
import { fetchJson, sleep, steamAppId } from './shared.js'

/**
 * What Steam cannot give, read from PCGamingWiki: Metacritic scores from its Reception rows,
 * and Epic and GOG store pages from its Availability rows.
 *
 * Not from Metacritic itself: Fandom's terms forbid automated access, and its robots.txt
 * closes /search. PCGamingWiki's editors record each score beside the Metacritic page it
 * came from, so the number is still Metacritic's and keeps that label, and pages are found
 * by Steam app id, so nothing is matched by title. The wiki's content is CC BY-NC-SA,
 * which a personal app may use with credit — given where the scores are shown.
 */

const API = 'https://www.pcgamingwiki.com/w/api.php'
// The wiki blocks generic agents and asks for one that says who is calling.
const HEADERS = { 'User-Agent': 'Ludoteca (+https://github.com/eduarddubau/ludoteca)' }
// The published limit is 60 requests a minute, and going over blocks the address for 60
// seconds — so every request is spaced, and a refusal waits the block out before retrying.
const MIN_INTERVAL_MS = 1100
const RETRY_DELAYS_MS = [61_000]
const PAGES_PER_READ = 50

let lastRequestAt = 0

async function request<T>(platform: Platform, params: Record<string, string>): Promise<T | null> {
  const wait = lastRequestAt + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await sleep(wait)
  lastRequestAt = Date.now()
  const url = `${API}?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`
  return fetchJson<T>(platform, url, {
    source: 'PCGamingWiki',
    headers: HEADERS,
    retryDelaysMs: RETRY_DELAYS_MS,
    // 403 is how the wiki refuses an agent it has blocked; it is not "no page".
    transientStatuses: [403]
  })
}

async function pageFor(platform: Platform, appId: number): Promise<string | undefined> {
  const result = await request<{ idlookup?: { title?: { Page?: string } }[] }>(platform, {
    action: 'idlookup',
    field: 'steamappid',
    value: String(appId)
  })
  return result?.idlookup?.[0]?.title?.Page
}

export interface MetacriticReception {
  score: number
  url?: string
}

/** Reads `{{Infobox game/row/reception|Metacritic|<slug>|<score>}}`; an empty score is no score. */
export function metacriticFromWikitext(text: string): MetacriticReception | null {
  const row = text.match(/\{\{\s*Infobox game\/row\/reception\s*\|\s*Metacritic\s*\|([^|}]*)\|([^|}]*)\}\}/i)
  const raw = row?.[2]?.trim() ?? ''
  if (!row || !/^\d{1,3}$/.test(raw) || Number(raw) > 100) return null
  const slug = row[1].trim()
  return { score: Number(raw), ...(slug ? { url: `https://www.metacritic.com/game/${slug}/` } : {}) }
}

/** Store pages the wiki lists, for the stores whose pages it can link exactly. */
export interface WikiStorePages {
  epic?: string
  gog?: string
}

const STORE_ROWS: { store: keyof WikiStorePages; name: RegExp; page: (id: string) => string }[] = [
  {
    store: 'epic',
    name: /^Epic Games Store$/i,
    page: (id) => `https://store.epicgames.com/p/${id.replace(/^p\//, '')}`
  },
  { store: 'gog', name: /^GOG(\.com)?$/i, page: (id) => `https://www.gog.com/en/game/${id}` }
]

/**
 * Reads `{{Availability/row| Epic Games Store | <slug> | … }}` rows. A row ending in
 * `unavailable` is a listing the store has dropped, which would only lead to a dead page.
 */
export function storePagesFromWikitext(text: string): WikiStorePages {
  const pages: WikiStorePages = {}
  for (const line of text.split('\n')) {
    const row = line.trim().match(/^\{\{\s*Availability\/row\s*\|([^|]*)\|([^|}]*)/)
    if (!row || /\|\s*unavailable\s*\}\}\s*$/i.test(line)) continue
    const id = row[2].trim()
    const known = STORE_ROWS.find((entry) => entry.name.test(row[1].trim()))
    if (known && id && !pages[known.store]) pages[known.store] = known.page(id)
  }
  return pages
}

interface WikiPage {
  metacritic: MetacriticReception | null
  stores: WikiStorePages
}

interface RevisionsResponse {
  query?: {
    normalized?: { from: string; to: string }[]
    redirects?: { from: string; to: string }[]
    pages?: { title: string; revisions?: { slots?: { main?: { content?: string } } }[] }[]
  }
}

async function readPages(platform: Platform, titles: string[]): Promise<Map<string, WikiPage>> {
  const found = new Map<string, WikiPage>()
  const result = await request<RevisionsResponse>(platform, {
    action: 'query',
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    redirects: '1',
    titles: titles.join('|')
  })
  // The answer is keyed by the page's final title; walk renames back to the one asked for.
  const askedAs = new Map(
    [...(result?.query?.normalized ?? []), ...(result?.query?.redirects ?? [])].map((n) => [n.to, n.from])
  )
  for (const page of result?.query?.pages ?? []) {
    const text = page.revisions?.[0]?.slots?.main?.content ?? ''
    const parsed = { metacritic: metacriticFromWikitext(text), stores: storePagesFromWikitext(text) }
    let title: string | undefined = page.title
    while (title !== undefined) {
      found.set(title, parsed)
      title = askedAs.get(title)
    }
  }
  return found
}

const needsStorePage = (game: OwnedGame): boolean =>
  (game.store === 'epic' || game.store === 'gog') && !game.storeUrl

/**
 * Steam apps worth a lookup: a game not yet checked that has no Metacritic score, or is owned on
 * Epic or GOG without a page. A checked game is skipped, found or not — asking again gets the same
 * answer — unless `recheck` is set, as the details page does for one game.
 */
export function pcgamingwikiGaps(games: OwnedGame[], recheck = false): number[] {
  return [
    ...new Set(
      games
        .filter((game) => recheck || game.pcgamingwikiCheckedAt === undefined)
        .filter((game) => game.criticScore === undefined || needsStorePage(game))
        .map(steamAppId)
        .filter((id): id is number => id !== undefined)
    )
  ]
}

/** Seconds a fill of this many apps takes at the wiki's pace: one lookup each, one read per fifty. */
export function pcgamingwikiSeconds(apps: number): number {
  return Math.ceil(((apps + Math.ceil(apps / PAGES_PER_READ)) * MIN_INTERVAL_MS) / 1000)
}

export interface FillOptions {
  /** Look up games already checked too. */
  recheck?: boolean
  signal?: { aborted: boolean }
  onProgress?: (progress: { done: number; total: number; title: string; matched: boolean }) => void
  /** Called after every fifty apps with the games as filled so far, so a stopped run keeps them. */
  onCheckpoint?: (games: OwnedGame[]) => Promise<void> | void
}

/**
 * Fills what Steam cannot give from PCGamingWiki: Metacritic scores Steam shows none for, and
 * the store page of a game owned on Epic or GOG. One lookup per app and one read per fifty
 * pages, paced under the wiki's limit. Only empty fields are filled; nothing is overwritten.
 */
export async function fillFromPcgamingwiki(
  platform: Platform,
  games: OwnedGame[],
  { recheck = false, signal, onProgress, onCheckpoint }: FillOptions = {}
): Promise<OwnedGame[]> {
  const wanted = pcgamingwikiGaps(games, recheck)
  const titleOf = new Map(games.map((game) => [steamAppId(game), game.title]))
  const pages = new Map<number, WikiPage>()
  const checked = new Map<number, string>()

  const apply = (): OwnedGame[] =>
    games.map((game) => {
      const id = steamAppId(game)
      const checkedAt = id === undefined ? undefined : checked.get(id)
      if (!checkedAt) return game
      const page = id === undefined ? undefined : pages.get(id)
      let next: OwnedGame = { ...game, pcgamingwikiCheckedAt: checkedAt }
      if (!page) return next
      if (game.criticScore === undefined && page.metacritic) {
        next = {
          ...next,
          criticScore: page.metacritic.score,
          metacriticUrl: page.metacritic.url ?? game.metacriticUrl,
          criticScoreSource: 'pcgamingwiki'
        }
      }
      const storePage = needsStorePage(game) ? page.stores[game.store as keyof WikiStorePages] : undefined
      return storePage ? { ...next, storeUrl: storePage } : next
    })

  let done = 0
  for (let start = 0; start < wanted.length; start += PAGES_PER_READ) {
    const pageByApp = new Map<number, string>()
    for (const id of wanted.slice(start, start + PAGES_PER_READ)) {
      if (signal?.aborted) break
      const page = await pageFor(platform, id)
      if (page) pageByApp.set(id, page)
      done++
      onProgress?.({ done, total: wanted.length, title: titleOf.get(id) ?? '', matched: page !== undefined })
    }

    // Read even after a stop, so lookups already paid for are not thrown away.
    if (pageByApp.size) {
      const read = await readPages(platform, [...new Set(pageByApp.values())])
      for (const [id, title] of pageByApp) {
        const found = read.get(title)
        if (found) pages.set(id, found)
      }
    }
    // Only once the read has succeeded does an app count as checked.
    const checkedAt = new Date().toISOString()
    for (const id of wanted.slice(start, done)) checked.set(id, checkedAt)
    await onCheckpoint?.(apply())
    if (signal?.aborted) break
  }

  return apply()
}
