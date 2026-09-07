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

export interface GameLink {
  url: string
  /** False when this is a search fallback rather than the game's own page. */
  exact: boolean
}

export function storeLink(game: OwnedGame): GameLink {
  if (game.storeUrl) return { url: game.storeUrl, exact: true }

  // Steam is the one store whose page URL is derivable from the id alone.
  if (game.store === 'steam' && /^\d+$/.test(game.storeGameId)) {
    return { url: `https://store.steampowered.com/app/${game.storeGameId}`, exact: true }
  }

  return { url: SEARCH[game.store](game.title), exact: false }
}

/** One link per store an entry is owned on. */
export function sourceLink(source: GameSource, title: string): GameLink {
  if (source.storeUrl) return { url: source.storeUrl, exact: true }
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
