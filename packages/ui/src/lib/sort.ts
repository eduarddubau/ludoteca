import type { OwnedGame } from '@ludoteca/core'

export type SortKey = 'title' | 'store' | 'playStatus' | 'hours' | 'criticScore' | 'releaseYear'

export const SORT_COLUMNS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'store', label: 'Store' },
  { key: 'playStatus', label: 'Status' },
  { key: 'hours', label: 'Hours' },
  { key: 'criticScore', label: 'Score' },
  { key: 'releaseYear', label: 'Year' }
]

// Missing values sink to the bottom in both directions — an absent score is not a zero.
function rank(game: OwnedGame, key: SortKey): number | string {
  switch (key) {
    case 'hours':
      return game.playtimeMinutes ?? -1
    case 'criticScore':
      return game.criticScore ?? -1
    case 'releaseYear':
      return game.releaseYear ?? -1
    default:
      return String(game[key])
  }
}

export function sortGames(games: OwnedGame[], key: SortKey, descending: boolean): OwnedGame[] {
  const sorted = [...games].sort((a, b) => {
    const left = rank(a, key)
    const right = rank(b, key)
    return typeof left === 'number' && typeof right === 'number'
      ? left - right
      : String(left).localeCompare(String(right), undefined, { sensitivity: 'base' })
  })
  return descending ? sorted.reverse() : sorted
}
