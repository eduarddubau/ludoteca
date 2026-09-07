import type { LibraryEntry } from '@ludoteca/core'

export type ColumnKey =
  | 'criticScore'
  | 'title'
  | 'stores'
  | 'platforms'
  | 'playStatus'
  | 'hours'
  | 'genres'
  | 'developer'
  | 'publisher'
  | 'releaseYear'

/**
 * Categorical fields are filters, not sorts: ordering by a genre or a studio name tells
 * you nothing you could not get by selecting one. Only ordinal fields — and the
 * alphabetical fallback — belong in the sort menu.
 */
export type SortKey = 'criticScore' | 'title' | 'hours' | 'releaseYear'

interface Column {
  key: ColumnKey
  /** Column header: a noun for what the cell holds. */
  label: string
  /** Sort menu entry: how the ordering reads. Falls back to the header label. */
  sortLabel?: string
  sortable: boolean
}

// One definition drives the headers, the cells and the sort menu, so none can drift.
export const COLUMNS: Column[] = [
  { key: 'criticScore', label: 'Score', sortable: true },
  { key: 'title', label: 'Title', sortLabel: 'Alphabetically', sortable: true },
  { key: 'stores', label: 'Stores', sortable: false },
  { key: 'platforms', label: 'Platform', sortable: false },
  { key: 'playStatus', label: 'Shelf', sortable: false },
  { key: 'hours', label: 'Playtime', sortable: true },
  { key: 'genres', label: 'Genres', sortable: false },
  { key: 'developer', label: 'Developer', sortable: false },
  { key: 'publisher', label: 'Publisher', sortable: false },
  { key: 'releaseYear', label: 'Release Date', sortable: true }
]

export const SORT_OPTIONS = COLUMNS.filter((column) => column.sortable).map((column) => ({
  key: column.key as SortKey,
  label: column.sortLabel ?? column.label
}))

// Missing values sink to the bottom in both directions — an absent score is not a zero,
// and an unknown developer should not sort among the As.
function rank(entry: LibraryEntry, key: SortKey): number | string {
  switch (key) {
    case 'hours':
      return entry.playtimeMinutes ?? -1
    case 'criticScore':
      return entry.criticScore ?? -1
    case 'releaseYear':
      return entry.releaseYear ?? -1
    default:
      return entry.title
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
