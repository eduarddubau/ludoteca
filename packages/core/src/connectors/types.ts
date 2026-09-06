export type StoreId = 'steam' | 'gog' | 'epic'

/** Family-shared titles are playable but not owned, and only one member at a time. */
export type Ownership =
  | { kind: 'owned' }
  | { kind: 'familyShared'; ownerAccountId: string; excludeReason?: number }

/** What the store could tell us about play history. Epic reports nothing, hence 'unknown'. */
export type PlayStatus = 'played' | 'unplayed' | 'unknown'

export interface OwnedGame {
  store: StoreId
  storeGameId: string
  title: string
  ownership: Ownership
  playStatus: PlayStatus
  playtimeMinutes?: number

  // Enrichment — nothing populates these yet. IGDB supplies most, SteamGridDB the art;
  // userRating and notes are the user's own and must survive a re-sync.
  genres: string[]
  releaseYear?: number
  developer?: string
  publisher?: string
  criticScore?: number
  metacriticUrl?: string
  storeUrl?: string
  userRating?: number
  lastPlayedAt?: string
  iconUrl?: string
  coverUrl?: string
  notes?: string
  /** ISO timestamp of the last enrichment attempt, set whether or not it matched. */
  enrichedAt?: string
}

export interface StoreConnector {
  readonly id: StoreId
  isAuthenticated(): Promise<boolean>
  authenticate(): Promise<void>
  fetchLibrary(): Promise<OwnedGame[]>
}
