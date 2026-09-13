import { computed, ref } from 'vue'
import {
  applyUserData, createConnector, enrichLibrary, enrichWithAppId, fillFromPcgamingwiki,
  gameKey, pcgamingwikiGaps, pcgamingwikiSeconds, refreshSteamReviews,
  steamAppId,
  type ExportedGame,
  mergeLibrary,
  needsEnrichment, preserveEnrichment, reconcileImport,
  type EditableField, type EnrichProgress, type LibraryEntry, type OwnedGame,
  type StoreConnection, type StoreId, type UserData
} from '@ludoteca/core'
import { usePlatform } from '../platform'
import {
  clearLibrary, clearSignIns, clearSyncState,
  deleteGame, disconnectStore, insertGame, loadConnections, loadGames, loadUserData,
  replaceGames, saveConnection, saveUserData
} from './library'

/** Cumulative: each scope destroys what the one before it does, and more. */
export type WipeScope = 'library' | 'syncHistory' | 'everything'

// Module scope, deliberately: a component holding this would abandon the run the moment
// the user switched tabs, which is exactly what an activity view must not do.
const games = ref<OwnedGame[]>([])
const progress = ref<EnrichProgress | null>(null)

interface RunClock {
  phase: string
  startedAt: number
  /** Progress over roughly the last minute, plus one older point to measure from. */
  samples: { at: number; done: number }[]
  found: number
  missed: number
  counts: { found: string; missed: string } | null
}
const runClock = ref<RunClock | null>(null)
// Ticks while a run is active, so the estimate keeps moving when Steam holds a request back.
const now = ref(Date.now())
let ticker: ReturnType<typeof setInterval> | undefined

/** Starts timing a phase, and returns the progress callback that feeds it. */
function beginPhase(
  phase: string,
  total: number,
  counts: RunClock['counts'] = null
): (p: EnrichProgress) => void {
  const startedAt = Date.now()
  runClock.value = { phase, startedAt, samples: [{ at: startedAt, done: 0 }], found: 0, missed: 0, counts }
  progress.value = { done: 0, total, title: '', matched: false }
  ticker ??= setInterval(() => (now.value = Date.now()), 1000)
  return (p) => {
    const clock = runClock.value
    if (!clock) return
    const at = Date.now()
    const advanced = p.done > (progress.value?.done ?? 0)
    const recent = clock.samples.filter((sample) => sample.at >= at - 60_000)
    const anchor = clock.samples.filter((sample) => sample.at < at - 60_000).pop()
    runClock.value = {
      ...clock,
      samples: [...(anchor ? [anchor] : []), ...recent, { at, done: p.done }],
      found: clock.found + (advanced && p.matched ? 1 : 0),
      missed: clock.missed + (advanced && !p.matched ? 1 : 0)
    }
    progress.value = p
  }
}

function endRun(): void {
  progress.value = null
  runClock.value = null
  clearInterval(ticker)
  ticker = undefined
}
const enrichError = ref('')
const abort = ref({ aborted: false })
const userData = ref<Map<string, UserData>>(new Map())
const connections = ref<Map<string, StoreConnection>>(new Map())
const connecting = ref<StoreId | null>(null)

const keyOf = (game: OwnedGame): string => `${game.store}:${game.storeGameId}`

export function useLibrary() {
  // Overrides and hidden flags layered over synced rows, per field.
  const applied = computed(() => applyUserData(games.value, userData.value))

  const entries = computed(() => mergeLibrary(applied.value.filter((g) => !g.hidden)))
  const hiddenEntries = computed(() => mergeLibrary(applied.value.filter((g) => g.hidden)))
  // Counted from user_data rather than the games on screen: an import that drops a game
  // keeps its overrides, and a wipe deletes those too.
  const customised = computed(() => userData.value.size)
  const editedKeys = computed(
    () => new Set(applied.value.filter((g) => g.editedFields.length).map(gameKey))
  )
  const untried = computed(() => games.value.filter(needsEnrichment))
  // Looked up and still no cover: what automation could not resolve.
  const unresolved = computed(() =>
    games.value.filter((g) => g.enrichedAt !== undefined && g.coverUrl === undefined)
  )
  const resolved = computed(() => games.value.filter((g) => g.coverUrl !== undefined))
  const scoredViaWiki = computed(
    () => games.value.filter((g) => g.criticScoreSource === 'pcgamingwiki').length
  )
  /** What the optional PCGamingWiki pass would look up, and roughly how long it would take. */
  const wikiPass = computed(() => {
    const apps = pcgamingwikiGaps(games.value).length
    return { apps, seconds: pcgamingwikiSeconds(apps) }
  })

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
      { label: 'Steam reviews', count: has((g) => g.steamReviewPercent), total },
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

  /** Live numbers for the progress bar: position, counts, and time left at the recent pace. */
  const runStatus = computed(() => {
    const p = progress.value
    const clock = runClock.value
    if (!p || !clock) return null
    const first = clock.samples[0]
    const seconds = (now.value - first.at) / 1000
    // Measured against the current time rather than the last update, so a stall lengthens it.
    const rate = seconds >= 5 && p.done > first.done ? (p.done - first.done) / seconds : null
    return {
      phase: clock.phase,
      done: p.done,
      total: p.total,
      title: p.title,
      counts: clock.counts && { ...clock.counts, foundCount: clock.found, missedCount: clock.missed },
      elapsedSeconds: (now.value - clock.startedAt) / 1000,
      secondsLeft: rate ? Math.ceil((p.total - p.done) / rate) : null
    }
  })

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
      const summary = await createConnector(platform, store).authenticate()
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
      const fetched = await createConnector(platform, store).fetchLibrary()

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

  /** Refused mid-run: a metadata checkpoint or a sync writes rows it read before the wipe,
   *  and would put them back. */
  async function wipe(scope: WipeScope): Promise<void> {
    if (running.value || connecting.value !== null) {
      throw new Error('Wait for the metadata run or store sync to finish first.')
    }
    const platform = usePlatform()
    await clearLibrary(platform)
    if (scope !== 'library') await clearSyncState(platform)
    if (scope === 'everything') await clearSignIns(platform)
    await reload()
  }

  async function replaceAll(next: OwnedGame[]): Promise<void> {
    const platform = usePlatform()
    await replaceGames(platform, next)
    games.value = await loadGames(platform)
  }

  /**
   * Lays enriched rows over the library. The stored title always wins: a refetch after a title
   * correction searches under the corrected title, and writing that back would replace the store's
   * own title, leaving nothing to restore if the correction is later cleared.
   */
  function merge(subset: OwnedGame[]): OwnedGame[] {
    const updated = new Map(subset.map((game) => [keyOf(game), game]))
    return games.value.map((game) => {
      const next = updated.get(keyOf(game))
      return next ? { ...next, title: game.title } : game
    })
  }

  /** `withReviews` also refreshes every game's Steam review score, for runs over the whole
   *  library: those drift, and the refresh is a few batched requests rather than a search each. */
  async function enrich(target: OwnedGame[], force: boolean, withReviews = false): Promise<void> {
    if (running.value) return
    const platform = usePlatform()
    abort.value = { aborted: false }
    enrichError.value = ''
    const reportMatching = beginPhase(
      'Matching on Steam',
      force ? target.length : target.filter(needsEnrichment).length,
      { found: 'matched', missed: 'no match' }
    )
    try {
      let next = await enrichLibrary(platform, target, {
        force,
        signal: abort.value,
        onProgress: reportMatching,
        onCheckpoint: async (partial) => {
          const merged = merge(partial)
          await replaceGames(platform, merged)
          games.value = merged
        }
      })
      if (withReviews && !abort.value.aborted) {
        const library = merge(next)
        const apps = new Set(library.map(steamAppId).filter((id) => id !== undefined)).size
        next = await refreshSteamReviews(platform, library, {
          signal: abort.value,
          onProgress: beginPhase('Updating Steam reviews', apps)
        })
      }
      await replaceAll(merge(next))
    } catch (err) {
      enrichError.value = err instanceof Error ? err.message : String(err)
      await reload()
    } finally {
      endRun()
    }
  }

  /** Steam review scores for every matched game, in a few batched requests and without searching. */
  async function updateReviews(): Promise<void> {
    if (running.value) return
    const platform = usePlatform()
    abort.value = { aborted: false }
    enrichError.value = ''
    const apps = new Set(games.value.map(steamAppId).filter((id) => id !== undefined))
    const report = beginPhase('Updating Steam reviews', apps.size)
    try {
      const next = await refreshSteamReviews(platform, games.value, {
        signal: abort.value,
        onProgress: report
      })
      await replaceAll(merge(next))
    } catch (err) {
      enrichError.value = err instanceof Error ? err.message : String(err)
      await reload()
    } finally {
      endRun()
    }
  }

  /**
   * The optional PCGamingWiki pass: Metacritic scores Steam shows none for, and Epic and GOG
   * store pages. Kept out of every automatic run, since the wiki's limit of a request a second
   * makes it the slow part.
   */
  async function fillFromWiki(targets: OwnedGame[] = games.value, recheck = false): Promise<void> {
    if (running.value) return
    const platform = usePlatform()
    abort.value = { aborted: false }
    enrichError.value = ''
    const report = beginPhase('Looking up on PCGamingWiki', pcgamingwikiGaps(targets, recheck).length, {
      found: 'on the wiki',
      missed: 'not on the wiki'
    })
    try {
      const next = await fillFromPcgamingwiki(platform, targets, {
        recheck,
        signal: abort.value,
        onProgress: report,
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
      endRun()
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
    // Pinned: a person chose this app, so a later refetch reuses it instead of searching.
    const updated = await enrichWithAppId(usePlatform(), game, appId)
    await replaceAll(merge([{ ...updated, steamAppPinned: true }]))
  }

  return {
    games, applied, entries, hiddenEntries, editedKeys, customised,
    untried, unresolved, resolved, coverage, scoredViaWiki, wikiPass,
    importGames, entrySources, userDataFor: userEntryFor, setHidden, setOverrides,
    addManual, removeGame,
    connections, connecting, connect, sync, disconnect,
    progress, runStatus, enrichError, running,
    stop: () => (abort.value.aborted = true),
    reload, replaceAll, enrich, updateReviews, fillFromWiki, applyMatch, previewMetadata, wipe
  }
}
