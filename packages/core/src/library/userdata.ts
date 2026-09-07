import type { OwnedGame } from '../connectors/types.js'

/** Fields a user may correct by hand. Deliberately not the store identity. */
export type EditableField =
  | 'title'
  | 'genres'
  | 'releaseYear'
  | 'developer'
  | 'publisher'
  | 'criticScore'
  | 'metacriticUrl'
  | 'storeUrl'
  | 'coverUrl'
  | 'notes'

export const EDITABLE_FIELDS: EditableField[] = [
  'title', 'genres', 'releaseYear', 'developer', 'publisher',
  'criticScore', 'metacriticUrl', 'storeUrl', 'coverUrl', 'notes'
]

export interface UserData {
  store: string
  storeGameId: string
  /** Only the fields the user actually set; everything else still comes from sync. */
  overrides: Partial<Record<EditableField, unknown>>
  hidden: boolean
}

export const gameKey = (game: { store: string; storeGameId: string }): string =>
  `${game.store}:${game.storeGameId}`

/**
 * Layers user intent over synced rows. Overrides win per field, so correcting a title
 * does not freeze the score — a later refetch still updates everything untouched.
 */
export function applyUserData(
  games: OwnedGame[],
  userData: Map<string, UserData>
): (OwnedGame & { hidden: boolean; editedFields: EditableField[] })[] {
  return games.map((game) => {
    const entry = userData.get(gameKey(game))
    if (!entry) return { ...game, hidden: false, editedFields: [] }

    const edited = Object.keys(entry.overrides) as EditableField[]
    return {
      ...game,
      ...entry.overrides,
      hidden: entry.hidden,
      editedFields: edited
    } as OwnedGame & { hidden: boolean; editedFields: EditableField[] }
  })
}

const normalize = (title: string): string => title.toLowerCase().replace(/[^a-z0-9]/g, '')

/**
 * What survives an import. Manually added games are kept, because the user typed them
 * and an import of one store should not silently discard them — except where the import
 * now carries the same game on the same store, in which case the real row supersedes the
 * placeholder and keeping both would just be a duplicate.
 */
export function reconcileImport(existing: OwnedGame[], imported: OwnedGame[]): OwnedGame[] {
  const importedKeys = new Set(
    imported.map((game) => `${game.store}:${normalize(game.title)}`)
  )
  const survivingManual = existing.filter(
    (game) => game.addedManually && !importedKeys.has(`${game.store}:${normalize(game.title)}`)
  )
  return [...imported, ...survivingManual]
}
