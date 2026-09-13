/** 'other' covers stores with no integration — itch, Amazon, a physical key, anything. */
export type StoreId = 'steam' | 'gog' | 'epic' | 'other'

export const STORE_IDS: StoreId[] = ['steam', 'gog', 'epic', 'other']

export const STORE_LABEL: Record<StoreId, string> = {
  steam: 'Steam',
  gog: 'GOG',
  epic: 'Epic',
  other: 'Other'
}

/**
 * Where a game is played, as opposed to where it was bought. No store API reports it —
 * Steam, GOG and Epic are all PC — so anything else is declared by hand.
 */
export type GamePlatform = 'pc' | 'xbox' | 'playstation' | 'switch' | 'other'

export const PLATFORM_IDS: GamePlatform[] = ['pc', 'xbox', 'playstation', 'switch', 'other']

export const PLATFORM_LABEL: Record<GamePlatform, string> = {
  pc: 'PC',
  xbox: 'Xbox',
  playstation: 'PlayStation',
  switch: 'Switch',
  other: 'Other'
}

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
  platform: GamePlatform
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
  /** Where the Metacritic score was read. Absent on rows scored before this was recorded,
   *  when Steam was the only source. */
  criticScoreSource?: 'steam' | 'pcgamingwiki'
  /** Share of Steam reviews recommending the game. Player sentiment on its own scale — a
   *  median 7 points above Metacritic across a 279-game library — so it sits beside
   *  criticScore and never fills it. */
  steamReviewPercent?: number
  steamReviewCount?: number
  /** Steam's own wording, such as "Very Positive". */
  steamReviewLabel?: string
  /** The game's page on the store it is owned on. */
  storeUrl?: string
  /** The Steam app enrichment matched, whichever store the game is owned on — what review
   *  scores, PCGamingWiki and the Steam page link key on. */
  steamAppId?: number
  /** Set when a person chose that app, so a refetch reuses it rather than searching again. */
  steamAppPinned?: boolean
  /** When PCGamingWiki was last asked about this game's app, found or not. */
  pcgamingwikiCheckedAt?: string
  userRating?: number
  lastPlayedAt?: string
  iconUrl?: string
  coverUrl?: string
  notes?: string
  /** ISO timestamp of the last enrichment attempt, set whether or not it matched. */
  enrichedAt?: string
  /** Entered by hand rather than imported, so an import must not delete it. */
  addedManually?: boolean
}

export interface AuthResultSummary {
  /** Shown on the store card so the user can confirm the right account was linked. */
  accountName?: string
}

export interface StoreConnector {
  readonly id: StoreId
  isAuthenticated(): Promise<boolean>
  /** Forgets the credentials saved on this machine, whatever this store keeps them under.
   *  The store still holds the session until it is revoked there. */
  signOut(): Promise<void>
  authenticate(): Promise<AuthResultSummary>
  fetchLibrary(): Promise<OwnedGame[]>
}
