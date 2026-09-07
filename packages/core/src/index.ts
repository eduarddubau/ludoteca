export type {
  Platform, AuthRequest, AuthResult, Cookie,
  HttpRequest, HttpResponse, Database, SecretStore
} from './platform.js'
export type {
  StoreId, Ownership, OwnedGame, PlayStatus, StoreConnector, AuthResultSummary
} from './connectors/types.js'
export { STORE_IDS, STORE_LABEL } from './connectors/types.js'
export {
  applyUserData, reconcileImport, preserveEnrichment, gameKey, EDITABLE_FIELDS,
  type UserData, type EditableField
} from './library/userdata.js'
export { GogConnector } from './connectors/gog.js'
export { EpicConnector } from './connectors/epic.js'
export { SteamConnector } from './connectors/steam.js'
export { SCHEMA, SCHEMA_VERSION, MIGRATIONS, TABLES } from './db/schema.js'
export {
  parseCsv, suggestMapping, toOwnedGames, EMPTY_MAPPING,
  type ParsedCsv, type ColumnMapping
} from './import/csv.js'
export { sampleLibrary } from './import/sample.js'
export {
  storeLink, metacriticLink, sourceLink, entryMetacriticLink, scoreBand,
  type GameLink
} from './links.js'
export {
  enrichGame, enrichLibrary, enrichWithAppId, searchCandidates, shortenTitle, needsEnrichment,
  EnrichTransientError,
  type EnrichProgress, type EnrichOptions, type MatchCandidate
} from './enrich/steam.js'
export { toCsv, toJson } from './export/csv.js'
export { fromJson } from './import/json.js'
export {
  mergeLibrary, STATUS_LABEL, SHELF_LABEL, FACET_LABEL, shelfOf,
  type LibraryEntry, type GameSource, type Shelf, type StoreFacet
} from './library/merge.js'
export {
  STORE_PROFILES, tokenKey, canConnect, cooldownSeconds,
  type StoreConnection, type ConnectionStatus, type StoreProfile
} from './library/connections.js'
export { storeJson, storeRequest, SessionExpiredError } from './connectors/http.js'
