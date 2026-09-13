import { STORE_IDS } from '../connectors/types.js'
import type { GamePlatform, PlayStatus, StoreId } from '../connectors/types.js'

export const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export const KNOWN_STORES: StoreId[] = STORE_IDS

const PLATFORM_ALIASES: [GamePlatform, string[]][] = [
  ['playstation', ['playstation', 'psn', 'ps5', 'ps4', 'ps3', 'ps2']],
  ['switch', ['nintendoswitch', 'switch']],
  ['xbox', ['xboxseries', 'xboxone', 'xbox360', 'xbox', 'gamepass']],
  ['pc', ['steamdeck', 'windows', 'linux', 'macos', 'desktop', 'mac', 'pc']]
]

/**
 * Matched by substring so real values land — "PlayStation 5", "Xbox Series X",
 * "Nintendo Switch OLED". Blank means PC; anything unplaceable is 'other' rather than
 * a guess.
 */
export function toPlatform(raw: string | undefined): GamePlatform {
  const value = normalize(raw ?? '')
  if (!value) return 'pc'
  const hit = PLATFORM_ALIASES.find(([, aliases]) => aliases.some((a) => value.includes(a)))
  return hit ? hit[0] : 'other'
}

export function toStore(raw: string | undefined): StoreId {
  const value = normalize(raw ?? '')
  return KNOWN_STORES.find((s) => value.includes(s)) ?? 'other'
}

const NOT_STARTED = ['unplayed', 'notplayed', 'never', 'notstarted', 'unstarted', 'backlog']
// Not finished says nothing about whether it was started.
const NOT_FINISHED = ['incomplete', 'unfinished', 'notfinished', 'notcompleted', 'uncompleted']
const STARTED = ['played', 'playing', 'complete', 'finish', 'beaten']

/** Negations are checked first: "notplayed" and "incomplete" contain the words for played. */
export function toStatus(raw: string | undefined): PlayStatus {
  const value = normalize(raw ?? '')
  const has = (words: string[]): boolean => words.some((w) => value.includes(w))
  if (has(NOT_STARTED)) return 'unplayed'
  if (has(NOT_FINISHED)) return 'unknown'
  if (has(STARTED)) return 'played'
  return 'unknown'
}
