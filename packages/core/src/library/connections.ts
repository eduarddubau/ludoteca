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
}

/** Stores with an integration. The manual/imported bucket has none, so it has no card. */
export const STORE_PROFILES: StoreProfile[] = [
  {
    store: 'steam',
    label: 'Steam',
    blurb: 'Owned games, playtime, and the family-shared library.',
    caveat:
      'Signs in through Steam\u2019s ordinary web login \u2014 the approach Lutris uses. This replaces an earlier one that impersonated the Steam mobile app and got an account restricted. Still untested since: use a throwaway account first.'
  },
  {
    store: 'gog',
    label: 'GOG',
    blurb: 'DRM-free library, via GOG Galaxy’s own sign-in.',
    caveat: 'Reverse-engineered: GOG publishes no public library API.'
  },
  {
    store: 'epic',
    label: 'Epic Games',
    blurb: 'Owned games from the Epic Games Store.',
    caveat:
      'Reverse-engineered. Epic warns that its authorization code grants full account access, so it is exchanged immediately and only the refresh token is kept.'
  }
]

/** Refused while a cooldown is active, so a failing store cannot be hammered. */
export function canConnect(connection: StoreConnection, now = new Date()): boolean {
  if (!connection.retryAfter) return true
  return new Date(connection.retryAfter) <= now
}

export function cooldownSeconds(connection: StoreConnection, now = new Date()): number {
  if (!connection.retryAfter) return 0
  return Math.max(0, Math.ceil((new Date(connection.retryAfter).getTime() - now.getTime()) / 1000))
}
