import Papa from 'papaparse'
import type { ExportedGame } from '../export/csv.js'
import { STORE_IDS } from '../connectors/types.js'
import type { GamePlatform, Ownership, OwnedGame, PlayStatus, StoreId } from '../connectors/types.js'

export interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]
}

/** Which CSV column feeds which field. Empty string means "not mapped". */
export interface ColumnMapping {
  title: string
  store: string
  platform: string
  playtime: string
  status: string
  storeGameId: string
}

export const EMPTY_MAPPING: ColumnMapping = {
  title: '', store: '', platform: '', playtime: '', status: '', storeGameId: ''
}

export function parseCsv(text: string): ParsedCsv {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim()
  })
  return { headers: result.meta.fields ?? [], rows: result.data }
}

// Header names vary between exporters, so match normalized aliases and let the user
// correct whatever this gets wrong.
const ALIASES: Record<keyof ColumnMapping, string[]> = {
  title: ['title', 'name', 'game', 'gamename', 'gametitle'],
  store: ['store', 'platform', 'source', 'launcher', 'provider'],
  platform: ['platform', 'console', 'device', 'hardware'],
  playtime: ['playtimeminutes', 'playtime', 'hours', 'hoursplayed', 'timeplayed', 'playtimeforever', 'minutes'],
  status: ['status', 'playstatus', 'state', 'progress'],
  storeGameId: ['appid', 'id', 'gameid', 'storegameid', 'productid']
}

const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

/** Most of a column's values naming known stores is what makes it a store column. */
function holdsStoreNames(rows: Record<string, string>[], header: string): boolean {
  const values = rows.slice(0, 50).map((row) => normalize(row[header] ?? '')).filter(Boolean)
  if (!values.length) return false
  const hits = values.filter((v) => KNOWN_STORES.some((store) => v.includes(store))).length
  return hits * 2 > values.length
}

export function suggestMapping(parsed: ParsedCsv): ColumnMapping {
  const { headers, rows } = parsed
  const mapping = { ...EMPTY_MAPPING }
  // A header feeds one field only, and `platform` is claimed by both: it named the store
  // in older files and the hardware in current ones. The values decide — a column full of
  // store names is a store column whatever its header says.
  const claimed = new Set<string>()
  const contested = headers.find((h) => normalize(h) === 'platform')
  if (contested && !holdsStoreNames(rows, contested)) {
    mapping.platform = contested
    claimed.add(contested)
  }

  for (const field of Object.keys(ALIASES) as (keyof ColumnMapping)[]) {
    if (mapping[field]) continue
    for (const alias of ALIASES[field]) {
      const hit = headers.find((h) => !claimed.has(h) && normalize(h) === alias)
      if (hit) {
        mapping[field] = hit
        claimed.add(hit)
        break
      }
    }
  }
  return mapping
}

const KNOWN_STORES: StoreId[] = STORE_IDS

const PLATFORM_ALIASES: [GamePlatform, string[]][] = [
  ['playstation', ['playstation', 'psn', 'ps5', 'ps4', 'ps3', 'ps2']],
  ['switch', ['nintendoswitch', 'nintendo', 'switch']],
  ['xbox', ['xboxseries', 'xboxone', 'xbox360', 'xbox', 'gamepass']],
  ['pc', ['steamdeck', 'windows', 'linux', 'macos', 'desktop', 'mac', 'pc']]
]

/**
 * Matched by substring so real column values land — "PlayStation 5", "Xbox Series X",
 * "Nintendo Switch OLED". Unmapped or blank means PC; anything unplaceable is 'other'
 * rather than a guess.
 */
function toPlatform(raw: string | undefined): GamePlatform {
  const value = normalize(raw ?? '')
  if (!value) return 'pc'
  const hit = PLATFORM_ALIASES.find(([, aliases]) => aliases.some((a) => value.includes(a)))
  return hit ? hit[0] : 'other'
}

function toStore(raw: string | undefined): StoreId {
  const value = normalize(raw ?? '')
  return KNOWN_STORES.find((s) => value.includes(s)) ?? 'other'
}

/** A malformed cell must not fail the whole import; the row is still worth having. */
function readOverrides(raw: string | undefined): Record<string, unknown> | undefined {
  if (!raw?.trim()) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined
    return Object.keys(parsed).length ? (parsed as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

const boolean = (raw: string | undefined): boolean =>
  ['true', '1', 'yes'].includes((raw ?? '').trim().toLowerCase())

/** Family sharing survives a restore only if the owner comes back with it. */
function toOwnership(row: Record<string, string>): Ownership {
  if (normalize(row['ownership'] ?? '') !== 'familyshared') return { kind: 'owned' }
  const excludeReason = number(row['exclude_reason'])
  return {
    kind: 'familyShared',
    ownerAccountId: text(row['owner_account_id']) ?? '',
    ...(excludeReason !== undefined ? { excludeReason } : {})
  }
}

function toStatus(raw: string | undefined): PlayStatus {
  const value = normalize(raw ?? '')
  if (value.includes('unplayed') || value.includes('never')) return 'unplayed'
  if (value.includes('played') || value.includes('complete') || value.includes('finish')) return 'played'
  return 'unknown'
}

// Column headers disagree on units. Anything not explicitly minutes is read as hours,
// which is what hand-kept lists and most exports use.
function toMinutes(raw: string | undefined, header: string): number | undefined {
  if (!raw?.trim()) return undefined
  const value = Number.parseFloat(raw.replace(/[^0-9.]/g, ''))
  if (Number.isNaN(value)) return undefined
  return normalize(header).includes('minute') ? Math.round(value) : Math.round(value * 60)
}

const number = (raw: string | undefined): number | undefined => {
  const value = Number.parseInt((raw ?? '').trim(), 10)
  return Number.isNaN(value) ? undefined : value
}

const text = (raw: string | undefined): string | undefined => {
  const value = raw?.trim()
  return value ? value : undefined
}

/**
 * Columns written by this project's own export. They are not user-mappable: they are
 * read by their canonical names when present, so an exported file re-imports intact,
 * and ignored entirely when importing somebody else's CSV.
 */
function readEnrichment(row: Record<string, string>): Partial<OwnedGame> {
  const genres = row['genres']?.split(';').map((g) => g.trim()).filter(Boolean)
  return {
    ...(genres?.length ? { genres } : {}),
    releaseYear: number(row['release_year']),
    criticScore: number(row['critic_score']),
    userRating: number(row['user_rating']),
    metacriticUrl: text(row['metacritic_url']),
    storeUrl: text(row['store_url']),
    coverUrl: text(row['cover_url']),
    iconUrl: text(row['icon_url']),
    lastPlayedAt: text(row['last_played_at']),
    developer: text(row['developer']),
    publisher: text(row['publisher']),
    notes: text(row['notes']),
    enrichedAt: text(row['enriched_at'])
  }
}

export function toOwnedGames(parsed: ParsedCsv, mapping: ColumnMapping): ExportedGame[] {
  const games: ExportedGame[] = []

  parsed.rows.forEach((row, index) => {
    const title = mapping.title ? row[mapping.title]?.trim() : ''
    if (!title) return

    games.push({
      store: toStore(mapping.store ? row[mapping.store] : undefined),
      storeGameId: (mapping.storeGameId ? row[mapping.storeGameId]?.trim() : '') || `csv-${index}`,
      title,
      ownership: toOwnership(row),
      platform: toPlatform(mapping.platform ? row[mapping.platform] : undefined),
      addedManually: boolean(row['added_manually']),
      hidden: boolean(row['hidden']),
      ...(readOverrides(row['overrides']) ? { overrides: readOverrides(row['overrides']) } : {}),
      playStatus: toStatus(mapping.status ? row[mapping.status] : undefined),
      playtimeMinutes: mapping.playtime ? toMinutes(row[mapping.playtime], mapping.playtime) : undefined,
      genres: [],
      ...readEnrichment(row)
    })
  })

  return games
}
