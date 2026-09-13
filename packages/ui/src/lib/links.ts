import { FACET_LABEL, sourceLink, steamPage, type GameSource, type LibraryEntry } from '@ludoteca/core'

/** A game owned and also family-shared has two Steam sources; the label tells them apart. */
export const sourceLabel = (source: GameSource): string =>
  FACET_LABEL[source.store === 'steam' && source.shared ? 'steam:shared' : source.store]

export interface Destination {
  url: string
  title: string
  /** A search rather than the game's own page. */
  approx: boolean
}

/**
 * Where a store's name opens: that store's page when one is known, otherwise the matched Steam
 * page, which also covers games no longer sold where they were bought, and a search only when
 * there is neither. The title says which, since the name alone does not.
 */
export function storeDestination(entry: LibraryEntry, source: GameSource): Destination {
  const own = sourceLink(source, entry.title)
  const label = sourceLabel(source)
  if (own.exact) return { url: own.url, title: `${label} store page`, approx: false }
  if (entry.steamAppId !== undefined) {
    const where = source.store === 'other' ? '' : ` (no ${label} page known)`
    return { url: steamPage(entry.steamAppId), title: `Steam page${where}`, approx: false }
  }
  return { url: own.url, title: `Search ${label} (no exact match yet)`, approx: true }
}
