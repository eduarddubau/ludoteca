import type { Platform } from '../platform.js'
import type { OwnedGame } from '../connectors/types.js'
import { fetchJson, sleep, steamAppId } from './shared.js'

/**
 * Metacritic scores Steam does not show, read from PCGamingWiki's Reception rows.
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

interface RevisionsResponse {
  query?: {
    normalized?: { from: string; to: string }[]
    redirects?: { from: string; to: string }[]
    pages?: { title: string; revisions?: { slots?: { main?: { content?: string } } }[] }[]
  }
}

async function readReception(platform: Platform, titles: string[]): Promise<Map<string, MetacriticReception>> {
  const found = new Map<string, MetacriticReception>()
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
    const reception = metacriticFromWikitext(page.revisions?.[0]?.slots?.main?.content ?? '')
    if (!reception) continue
    let title: string | undefined = page.title
    while (title !== undefined) {
      found.set(title, reception)
      title = askedAs.get(title)
    }
  }
  return found
}

export interface FillOptions {
  signal?: { aborted: boolean }
  onProgress?: (progress: { done: number; total: number; title: string; matched: boolean }) => void
  /** Called after every fifty apps with the games as filled so far, so a stopped run keeps them. */
  onCheckpoint?: (games: OwnedGame[]) => Promise<void> | void
}

/**
 * Fills in Metacritic scores for games that have a Steam app but no score. One lookup per
 * app and one read per fifty pages, paced under the wiki's limit: about four minutes for
 * two hundred games. A game the wiki holds no score for is left as it was.
 */
export async function fillMetacriticFromPcgamingwiki(
  platform: Platform,
  games: OwnedGame[],
  { signal, onProgress, onCheckpoint }: FillOptions = {}
): Promise<OwnedGame[]> {
  const wanted = [
    ...new Set(
      games
        .filter((game) => game.criticScore === undefined)
        .map(steamAppId)
        .filter((id): id is number => id !== undefined)
    )
  ]
  const titleOf = new Map(games.map((game) => [steamAppId(game), game.title]))
  const scores = new Map<number, MetacriticReception>()

  const apply = (): OwnedGame[] =>
    games.map((game) => {
      const id = steamAppId(game)
      const reception = id === undefined ? undefined : scores.get(id)
      if (game.criticScore !== undefined || !reception) return game
      return {
        ...game,
        criticScore: reception.score,
        metacriticUrl: reception.url ?? game.metacriticUrl,
        criticScoreSource: 'pcgamingwiki'
      }
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
      const reception = await readReception(platform, [...new Set(pageByApp.values())])
      for (const [id, page] of pageByApp) {
        const found = reception.get(page)
        if (found) scores.set(id, found)
      }
    }
    await onCheckpoint?.(apply())
    if (signal?.aborted) break
  }

  return apply()
}
