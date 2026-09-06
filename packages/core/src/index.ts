export type {
  Platform, AuthRequest, AuthResult, Cookie,
  HttpRequest, HttpResponse, Database, SecretStore
} from './platform.js'
export type { StoreId, Ownership, OwnedGame, PlayStatus, StoreConnector } from './connectors/types.js'
export { GogConnector } from './connectors/gog.js'
export { SCHEMA, SCHEMA_VERSION, MIGRATIONS } from './db/schema.js'
export {
  parseCsv, suggestMapping, toOwnedGames, EMPTY_MAPPING,
  type ParsedCsv, type ColumnMapping
} from './import/csv.js'
export { sampleLibrary } from './import/sample.js'
export { storeLink, metacriticLink, scoreBand, type GameLink } from './links.js'
export {
  enrichGame, enrichLibrary, needsEnrichment, EnrichTransientError,
  type EnrichProgress, type EnrichOptions
} from './enrich/steam.js'
