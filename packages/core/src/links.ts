import type { OwnedGame, StoreId } from './connectors/types.js'
import type { GameSource, LibraryEntry } from './library/merge.js'

// Exact links need an id that enrichment has not resolved yet, so everything falls back
// to that store's search. A search link that works today beats a dead link.
const SEARCH: Record<StoreId, (title: string) => string> = {
  steam: (t) => `https://store.steampowered.com/search/?term=${encodeURIComponent(t)}`,
  gog: (t) => `https://www.gog.com/en/games?query=${encodeURIComponent(t)}`,
  epic: (t) => `https://store.epicgames.com/en-US/browse?q=${encodeURIComponent(t)}`,
  // No store to search, so fall back to the open web. Enrichment usually replaces this
  // with a real Steam page anyway, since Steam carries most of what 'other' covers.
  other: (t) => `https://duckduckgo.com/?q=${encodeURIComponent(`${t} game`)}`
}

// A stored URL counts as a store's own page only on that store's site, so no label can
// point somewhere else — as an Epic tag opening Steam once did.
const OWN_SITE: Partial<Record<StoreId, RegExp>> = {
  steam: /(^|\.)steampowered\.com$/,
  gog: /(^|\.)gog\.com$/,
  epic: /(^|\.)epicgames\.com$/
}

function ownPage(store: StoreId, url: string | undefined): string | undefined {
  if (!url) return undefined
  const site = OWN_SITE[store]
  if (!site) return url
  try {
    return site.test(new URL(url).hostname) ? url : undefined
  } catch {
    return undefined
  }
}

export const steamPage = (appId: number): string => `https://store.steampowered.com/app/${appId}`

/** PCGamingWiki's own redirect from a Steam app id to the game's page. */
export const pcgamingwikiPage = (appId: number): string =>
  `https://www.pcgamingwiki.com/api/appid.php?appid=${appId}`

export interface GameLink {
  url: string
  /** False when this is a search fallback rather than the game's own page. */
  exact: boolean
}

export function storeLink(game: OwnedGame): GameLink {
  const own = ownPage(game.store, game.storeUrl)
  if (own) return { url: own, exact: true }

  // Steam is the one store whose page URL is derivable from the id alone.
  if (game.store === 'steam' && /^\d+$/.test(game.storeGameId)) {
    return { url: `https://store.steampowered.com/app/${game.storeGameId}`, exact: true }
  }

  return { url: SEARCH[game.store](game.title), exact: false }
}

/** One link per store an entry is owned on. */
export function sourceLink(source: GameSource, title: string): GameLink {
  const own = ownPage(source.store, source.storeUrl)
  if (own) return { url: own, exact: true }
  if (source.store === 'steam' && /^\d+$/.test(source.storeGameId)) {
    return { url: `https://store.steampowered.com/app/${source.storeGameId}`, exact: true }
  }
  return { url: SEARCH[source.store](title), exact: false }
}

export function entryMetacriticLink(entry: LibraryEntry): GameLink {
  if (entry.metacriticUrl) return { url: entry.metacriticUrl, exact: true }
  return {
    url: `https://www.metacritic.com/search/${encodeURIComponent(entry.title)}/`,
    exact: false
  }
}

export function metacriticLink(game: OwnedGame): GameLink {
  if (game.metacriticUrl) return { url: game.metacriticUrl, exact: true }
  return {
    url: `https://www.metacritic.com/search/${encodeURIComponent(game.title)}/`,
    exact: false
  }
}

/** Metacritic's own bands: 75+ favourable, 50–74 mixed, below 50 unfavourable. */
export function scoreBand(score: number): 'good' | 'mixed' | 'bad' {
  if (score >= 75) return 'good'
  if (score >= 50) return 'mixed'
  return 'bad'
}
