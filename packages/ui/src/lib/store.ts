import { computed, ref } from 'vue'
import {
  applyUserData, enrichLibrary, enrichWithAppId, EpicConnector, gameKey, GogConnector,
  type ExportedGame,
  mergeLibrary, SteamConnector,
  needsEnrichment, preserveEnrichment, reconcileImport,
  type EditableField, type EnrichProgress, type LibraryEntry, type OwnedGame, type Platform,
  type StoreConnection, type StoreConnector, type StoreId, type UserData
} from '@ludoteca/core'
import { usePlatform } from '../platform'
import {
  deleteGame, disconnectStore, insertGame, loadConnections, loadGames, loadUserData,
  replaceGames, saveConnection, saveUserData
} from './library'

// Module scope, deliberately: a component holding this would abandon the run the moment
// the user switched tabs, which is exactly what an activity view must not do.
const games = ref<OwnedGame[]>([])
const progress = ref<EnrichProgress | null>(null)
const enrichError = ref('')
const abort = ref({ aborted: false })
const userData = ref<Map<string, UserData>>(new Map())
const connections = ref<Map<string, StoreConnection>>(new Map())
const connecting = ref<StoreId | null>(null)

const keyOf = (game: OwnedGame): string => `${game.store}:${game.storeGameId}`

function connectorFor(platform: Platform, store: StoreId): StoreConnector {
  switch (store) {
    case 'gog':
      return new GogConnector(platform)
    case 'epic':
      return new EpicConnector(platform)
    case 'steam':
      return new SteamConnector(platform)
    default:
      throw new Error(`${store} has no connector yet.`)
  }
}

export function useLibrary() {
  // Overrides and hidden flags layered over synced rows, per field.
  const applied = computed(() => applyUserData(games.value, userData.value))

  const entries = computed(() => mergeLibrary(applied.value.filter((g) => !g.hidden)))
  const hiddenEntries = computed(() => mergeLibrary(applied.value.filter((g) => g.hidden)))
  const editedKeys = computed(
    () => new Set(applied.value.filter((g) => g.editedFields.length).map(gameKey))
  )
  const untried = computed(() => games.value.filter(needsEnrichment))
  // Looked up and still no cover: what automation could not resolve.
  const unresolved = computed(() =>
    games.value.filter((g) => g.enrichedAt !== undefined && g.coverUrl === undefined)
  )
  const resolved = computed(() => games.value.filter((g) => g.coverUrl !== undefined))

  // Per-field, because a field added to enrichment after a run leaves every existing row
  // without it — and since those rows are already marked attempted, "fetch missing"
  // skips them. Showing the gap is what tells you a refetch is needed.
  const coverage = computed(() => {
    const total = games.value.length
    const has = (pick: (g: OwnedGame) => unknown): number =>
      games.value.filter((g) => {
        const value = pick(g)
        return Array.isArray(value) ? value.length > 0 : value !== undefined
      }).length
    return [
      { label: 'Cover art', count: has((g) => g.coverUrl), total },
      { label: 'Metacritic score', count: has((g) => g.criticScore), total },
      { label: 'Genres', count: has((g) => g.genres), total },
      { label: 'Release year', count: has((g) => g.releaseYear), total },
      { label: 'Developer', count: has((g) => g.developer), total },
      { label: 'Publisher', count: has((g) => g.publisher), total }
    ]
  })
  // Blocks a bulk run while a preview is out, without putting the preview on the progress
  // bar or under the Stop button — a cancelled preview would read as "no match found".
  const previewing = ref(false)
  const running = computed(() => progress.value !== null || previewing.value)

  async function reload(): Promise<void> {
    const platform = usePlatform()
    userData.value = await loadUserData(platform)
    connections.value = await loadConnections(platform)
    games.value = await loadGames(platform)
  }

  /**
   * Runs a store's sign-in. Failures are recorded with a cooldown rather than left for
   * the user to retry immediately — repeated sign-ins are what got a Steam account
   * restricted, so the UI refuses to hammer a store that just said no.
   */
  async function connect(store: StoreId): Promise<void> {
    const platform = usePlatform()
    connecting.value = store
    try {
      const summary = await connectorFor(platform, store).authenticate()
      await saveConnection(platform, {
        store,
        status: 'connected',
        accountName: summary.accountName
      })
      connections.value = await loadConnections(platform)
      await sync(store)
      return
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await saveConnection(platform, {
        store,
        status: 'error',
        lastError: message,
        retryAfter: new Date(Date.now() + 60_000).toISOString()
      })
    } finally {
      connecting.value = null
      connections.value = await loadConnections(platform)
    }
  }

  /**
   * Pulls a store's library in. Only that store's rows are touched: other stores, manual
   * additions and every user override survive, and enrichment is carried across so a sync
   * does not undo the metadata pass.
   */
  async function sync(store: StoreId): Promise<void> {
    const platform = usePlatform()
    connecting.value = store
    try {
      const fetched = await connectorFor(platform, store).fetchLibrary()

      const untouched = games.value.filter((game) => game.store !== store)
      const forStore = games.value.filter((game) => game.store === store)
      const carried = preserveEnrichment(fetched, forStore)

      await replaceAll([...untouched, ...reconcileImport(forStore, carried)])
      await saveConnection(platform, {
        store,
        status: 'connected',
        lastSyncedAt: new Date().toISOString()
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await saveConnection(platform, {
        store,
        status: 'error',
        lastError: message,
        retryAfter: new Date(Date.now() + 60_000).toISOString()
      })
    } finally {
      connecting.value = null
      connections.value = await loadConnections(platform)
    }
  }

  async function disconnect(store: StoreId): Promise<void> {
    const platform = usePlatform()
    await disconnectStore(platform, store)
    connections.value = await loadConnections(platform)
  }

  /** Import path: manually added rows survive unless the import now carries them. */
  async function importGames(next: ExportedGame[]): Promise<void> {
    await replaceAll(reconcileImport(games.value, next))

    // A backup restores what was hidden *and* what was not: writing only the hidden rows
    // would leave a game hidden that the backup records as visible.
    const platform = usePlatform()
    for (const game of next) {
      if (game.hidden === undefined && game.overrides === undefined) continue
      const current = userData.value.get(gameKey(game))
      const hidden = game.hidden ?? current?.hidden ?? false
      const overrides = (game.overrides ?? current?.overrides ?? {}) as UserData['overrides']
      if (!current && !hidden && !Object.keys(overrides).length) continue
      if (
        current?.hidden === hidden &&
        JSON.stringify(current?.overrides ?? {}) === JSON.stringify(overrides)
      ) {
        continue
      }
      await saveUserData(platform, { store: game.store, storeGameId: game.storeGameId, overrides, hidden })
    }
    userData.value = await loadUserData(platform)
  }

  /** Applied, not raw: an editor opened on these shows the values the library shows. */
  function entrySources(entry: LibraryEntry): OwnedGame[] {
    const keys = new Set(entry.sources.map((s) => `${s.store}:${s.storeGameId}`))
    return applied.value.filter((game) => keys.has(gameKey(game)))
  }

  function userEntryFor(game: OwnedGame): UserData {
    return (
      userData.value.get(gameKey(game)) ?? {
        store: game.store,
        storeGameId: game.storeGameId,
        overrides: {},
        hidden: false
      }
    )
  }

  async function writeUserData(entries: UserData[]): Promise<void> {
    const platform = usePlatform()
    for (const entry of entries) await saveUserData(platform, entry)
    userData.value = await loadUserData(platform)
  }

  /** Hiding acts on the whole entry: hiding a game the user owns twice hides both rows. */
  async function setHidden(entry: LibraryEntry, hidden: boolean): Promise<void> {
    await writeUserData(entrySources(entry).map((game) => ({ ...userEntryFor(game), hidden })))
  }

  /** Applies a whole edit in one write; per-field saving cost a full reload each time. */
  async function setOverrides(
    targets: OwnedGame[],
    changes: Partial<Record<EditableField, unknown>>
  ): Promise<void> {
    await writeUserData(
      targets.map((game) => {
        const current = userEntryFor(game)
        const overrides = { ...current.overrides }

        for (const [field, value] of Object.entries(changes) as [EditableField, unknown][]) {
          // An empty value clears the override rather than pinning a blank over synced data.
          const empty =
            value === undefined || value === '' || (Array.isArray(value) && !value.length)
          if (empty) delete overrides[field]
          else overrides[field] = value
        }

        return { ...current, overrides }
      })
    )
  }

  async function addManual(game: OwnedGame): Promise<void> {
    const platform = usePlatform()
    await insertGame(platform, { ...game, addedManually: true })
    await reload()
  }

  /** Only manual rows can truly go: an imported one would return on the next import. */
  async function removeGame(game: OwnedGame): Promise<void> {
    await deleteGame(usePlatform(), game)
    await reload()
  }

  async function replaceAll(next: OwnedGame[]): Promise<void> {
    const platform = usePlatform()
    await replaceGames(platform, next)
    games.value = await loadGames(platform)
  }

  function merge(subset: OwnedGame[]): OwnedGame[] {
    const updated = new Map(subset.map((game) => [keyOf(game), game]))
    return games.value.map((game) => updated.get(keyOf(game)) ?? game)
  }

  async function enrich(target: OwnedGame[], force: boolean): Promise<void> {
    if (running.value) return
    const platform = usePlatform()
    abort.value = { aborted: false }
    enrichError.value = ''
    progress.value = {
      done: 0,
      total: force ? target.length : target.filter(needsEnrichment).length,
      title: '',
      matched: false
    }
    try {
      const next = await enrichLibrary(platform, target, {
        force,
        signal: abort.value,
        onProgress: (p) => (progress.value = p),
        onCheckpoint: async (partial) => {
          const merged = merge(partial)
          await replaceGames(platform, merged)
          games.value = merged
        }
      })
      await replaceAll(merge(next))
    } catch (err) {
      enrichError.value = err instanceof Error ? err.message : String(err)
      await reload()
    } finally {
      progress.value = null
    }
  }

  /**
   * Enriches a draft without storing it, so an add can be confirmed against real data.
   * Shares the single-flight guard and abort signal with the bulk run: a second unpaced
   * Steam lookup alongside one is exactly the traffic that got an account restricted.
   */
  async function previewMetadata(draft: OwnedGame): Promise<OwnedGame> {
    if (running.value) throw new Error('A metadata run is in progress. Stop it first.')
    previewing.value = true
    try {
      const [enriched] = await enrichLibrary(usePlatform(), [draft], { force: true })
      return enriched ?? draft
    } finally {
      previewing.value = false
    }
  }

  async function applyMatch(game: OwnedGame, appId: number): Promise<void> {
    const updated = await enrichWithAppId(usePlatform(), game, appId)
    await replaceAll(merge([updated]))
  }

  return {
    games, applied, entries, hiddenEntries, editedKeys,
    untried, unresolved, resolved, coverage,
    importGames, entrySources, userDataFor: userEntryFor, setHidden, setOverrides,
    addManual, removeGame,
    connections, connecting, connect, sync, disconnect,
    progress, enrichError, running,
    stop: () => (abort.value.aborted = true),
    reload, replaceAll, enrich, applyMatch, previewMetadata
  }
}
