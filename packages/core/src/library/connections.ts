import type { StoreId } from '../connectors/types.js'

export type ConnectionStatus = 'disconnected' | 'connected' | 'expired' | 'error'

export interface StoreConnection {
  store: StoreId
  status: ConnectionStatus
  /** Which account is linked — the confirmation that it is the right one. */
  accountName?: string
  lastSyncedAt?: string
  lastError?: string
  /** Set after a failed attempt; connecting again before this is refused. */
  retryAfter?: string
}

export interface StoreProfile {
  store: StoreId
  label: string
  blurb: string
  /** Stated plainly on the card rather than buried: these are not sanctioned APIs. */
  caveat?: string
  connectable: boolean
}

export const STORE_PROFILES: StoreProfile[] = [
  {
    store: 'steam',
    label: 'Steam',
    blurb: 'Owned games, playtime, and the family-shared library.',
    caveat:
      'The family-sharing endpoints are undocumented. Repeated sign-ins have triggered an account restriction before — connect once and leave it.',
    connectable: true
  },
  {
    store: 'gog',
    label: 'GOG',
    blurb: 'DRM-free library, via GOG Galaxy’s own sign-in.',
    caveat: 'Reverse-engineered: GOG publishes no public library API.',
    connectable: true
  },
  {
    store: 'epic',
    label: 'Epic Games',
    blurb: 'Owned games from the Epic Games Store.',
    caveat: 'Reverse-engineered, and the most likely of the three to break.',
    connectable: true
  },
  {
    store: 'other',
    label: 'Other',
    blurb: 'Games added by hand, or imported from a file. Nothing to connect.',
    connectable: false
  }
]

export const tokenKey = (store: StoreId): string => `${store}.refreshToken`

/** Refused while a cooldown is active, so a failing store cannot be hammered. */
export function canConnect(connection: StoreConnection, now = new Date()): boolean {
  if (!connection.retryAfter) return true
  return new Date(connection.retryAfter) <= now
}

export function cooldownSeconds(connection: StoreConnection, now = new Date()): number {
  if (!connection.retryAfter) return 0
  return Math.max(0, Math.ceil((new Date(connection.retryAfter).getTime() - now.getTime()) / 1000))
}
