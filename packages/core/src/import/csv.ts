import Papa from 'papaparse'
import type { OwnedGame, PlayStatus, StoreId } from '../connectors/types.js'

export interface ParsedCsv {
  headers: string[]
  rows: Record<string, string>[]
}

/** Which CSV column feeds which field. Empty string means "not mapped". */
export interface ColumnMapping {
  title: string
  store: string
  playtime: string
  status: string
  storeGameId: string
}

export const EMPTY_MAPPING: ColumnMapping = {
  title: '', store: '', playtime: '', status: '', storeGameId: ''
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
  playtime: ['playtime', 'hours', 'hoursplayed', 'timeplayed', 'playtimeforever', 'minutes'],
  status: ['status', 'playstatus', 'state', 'progress'],
  storeGameId: ['appid', 'id', 'gameid', 'storegameid', 'productid']
}

const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '')

export function suggestMapping(headers: string[]): ColumnMapping {
  const mapping = { ...EMPTY_MAPPING }
  for (const field of Object.keys(ALIASES) as (keyof ColumnMapping)[]) {
    const hit = headers.find((h) => ALIASES[field].includes(normalize(h)))
    if (hit) mapping[field] = hit
  }
  return mapping
}

const KNOWN_STORES: StoreId[] = ['steam', 'gog', 'epic']

function toStore(raw: string | undefined): StoreId {
  const value = normalize(raw ?? '')
  return KNOWN_STORES.find((s) => value.includes(s)) ?? 'steam'
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
    developer: text(row['developer']),
    publisher: text(row['publisher']),
    notes: text(row['notes']),
    enrichedAt: text(row['enriched_at'])
  }
}

export function toOwnedGames(parsed: ParsedCsv, mapping: ColumnMapping): OwnedGame[] {
  const games: OwnedGame[] = []

  parsed.rows.forEach((row, index) => {
    const title = mapping.title ? row[mapping.title]?.trim() : ''
    if (!title) return

    games.push({
      store: toStore(mapping.store ? row[mapping.store] : undefined),
      storeGameId: (mapping.storeGameId ? row[mapping.storeGameId]?.trim() : '') || `csv-${index}`,
      title,
      ownership: { kind: 'owned' },
      playStatus: toStatus(mapping.status ? row[mapping.status] : undefined),
      playtimeMinutes: mapping.playtime ? toMinutes(row[mapping.playtime], mapping.playtime) : undefined,
      genres: [],
      ...readEnrichment(row)
    })
  })

  return games
}
