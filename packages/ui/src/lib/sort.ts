import type { LibraryEntry } from '@ludoteca/core'

export type SortKey = 'criticScore' | 'title' | 'stores' | 'playStatus' | 'hours' | 'releaseYear'

export const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'criticScore', label: 'Score' },
  { key: 'title', label: 'Title' },
  { key: 'stores', label: 'Stores' },
  { key: 'playStatus', label: 'Status' },
  { key: 'hours', label: 'Hours' },
  { key: 'releaseYear', label: 'Year' }
]

// Missing values sink to the bottom in both directions — an absent score is not a zero.
function rank(entry: LibraryEntry, key: SortKey): number | string {
  switch (key) {
    case 'hours':
      return entry.playtimeMinutes ?? -1
    case 'criticScore':
      return entry.criticScore ?? -1
    case 'releaseYear':
      return entry.releaseYear ?? -1
    case 'stores':
      return entry.stores.join('+')
    default:
      return String(entry[key])
  }
}

export function sortEntries(
  entries: LibraryEntry[],
  key: SortKey,
  descending: boolean
): LibraryEntry[] {
  const sorted = [...entries].sort((a, b) => {
    const left = rank(a, key)
    const right = rank(b, key)
    return typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left).localeCompare(String(right), undefined, { sensitivity: 'base' })
  })
  return descending ? sorted.reverse() : sorted
}
