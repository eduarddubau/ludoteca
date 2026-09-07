<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  FACET_LABEL, fromJson, parseCsv, sampleLibrary, SHELF_LABEL, suggestMapping, toCsv,
  toJson,
  type ColumnMapping, type EditableField, type LibraryEntry, type OwnedGame,
  type ParsedCsv, type Shelf, type StoreFacet
} from '@ludoteca/core'
import { useLibrary } from './lib/store'
import { SORT_OPTIONS, sortEntries, type SortKey } from './lib/sort'
import LibraryTable from './components/LibraryTable.vue'
import LibraryGrid from './components/LibraryGrid.vue'
import MappingPanel from './components/MappingPanel.vue'
import FilterMenu from './components/FilterMenu.vue'
import GameEditor from './components/GameEditor.vue'

const library = useLibrary()

const search = ref('')
const stores = ref<Set<StoreFacet>>(new Set())
const shelves = ref<Set<Shelf>>(new Set())
const genres = ref<Set<string>>(new Set())
const developers = ref<Set<string>>(new Set())
const publishers = ref<Set<string>>(new Set())
const exportMenu = ref(false)

const view = ref<'grid' | 'list'>('grid')
const sortKey = ref<SortKey>('criticScore')
const descending = ref(true)

const showHidden = ref(false)
const editing = ref<LibraryEntry | null>(null)
const adding = ref(false)

const fileInput = ref<HTMLInputElement | null>(null)
const pendingCsv = ref<{ parsed: ParsedCsv; suggested: ColumnMapping } | null>(null)
const importError = ref('')

// Only facets actually present, so an empty "Steam (shared)" chip never appears.
const storeOptions = computed(() =>
  [...new Set(library.entries.value.flatMap((entry) => entry.facets))].sort()
)
const shelfOptions: Shelf[] = ['played', 'backlog']

// Ordered by how many games carry each, so the useful ones are not buried under one-offs.
function tally(pick: (entry: LibraryEntry) => string[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const entry of library.entries.value) {
    for (const value of pick(entry)) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

const genreOptions = computed(() => tally((e) => e.genres))
const developerOptions = computed(() => tally((e) => (e.developer ? [e.developer] : [])))
const publisherOptions = computed(() => tally((e) => (e.publisher ? [e.publisher] : [])))

const source = computed(() =>
  showHidden.value ? library.hiddenEntries.value : library.entries.value
)

const visible = computed(() => {
  const needle = search.value.trim().toLowerCase()
  const filtered = source.value.filter(
    (entry) =>
      (stores.value.size === 0 || entry.facets.some((f) => stores.value.has(f))) &&
      (shelves.value.size === 0 || shelves.value.has(entry.shelf)) &&
      (genres.value.size === 0 || entry.genres.some((g) => genres.value.has(g))) &&
      (developers.value.size === 0 ||
        (entry.developer !== undefined && developers.value.has(entry.developer))) &&
      (publishers.value.size === 0 ||
        (entry.publisher !== undefined && publishers.value.has(entry.publisher))) &&
      (!needle || entry.title.toLowerCase().includes(needle))
  )
  return sortEntries(filtered, sortKey.value, descending.value)
})

/** The database rows behind what is on screen — export works on these, not on entries. */
const visibleGames = computed(() => {
  const wanted = new Set(
    visible.value.flatMap((entry) => entry.sources.map((s) => `${s.store}:${s.storeGameId}`))
  )
  return library.games.value.filter((g) => wanted.has(`${g.store}:${g.storeGameId}`))
})

const totalHours = computed(() =>
  Math.round(visible.value.reduce((sum, e) => sum + (e.playtimeMinutes ?? 0), 0) / 60)
)

const entryNeedsFetch = (entry: LibraryEntry): boolean => entry.enrichedAt === undefined

function toggled<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

// Highest score, longest playtime and newest release are the useful ends; only an
// alphabetical list is read forwards.
function onSort(key: SortKey): void {
  if (sortKey.value === key) descending.value = !descending.value
  else {
    sortKey.value = key
    descending.value = key !== 'title'
  }
}

async function onFileChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  importError.value = ''
  try {
    const text = await file.text()
    if (file.name.toLowerCase().endsWith('.json') || text.trimStart().startsWith('[')) {
      await confirmImport(fromJson(text))
      return
    }
    const parsed = parseCsv(text)
    if (!parsed.rows.length) throw new Error('No rows found in that file.')
    pendingCsv.value = { parsed, suggested: suggestMapping(parsed.headers) }
  } catch (err) {
    importError.value = err instanceof Error ? err.message : String(err)
  }
}

async function confirmImport(next: OwnedGame[]): Promise<void> {
  await library.importGames(next)
  pendingCsv.value = null
}

const editingSources = computed(() =>
  editing.value ? library.entrySources(editing.value) : []
)
const editingEdited = computed<EditableField[]>(() => {
  const first = editingSources.value[0]
  if (!first) return []
  return (library.applied.value.find(
    (g) => g.store === first.store && g.storeGameId === first.storeGameId
  )?.editedFields ?? []) as EditableField[]
})

async function saveEdits(changes: Partial<Record<EditableField, unknown>>): Promise<void> {
  const target = editingSources.value[0]
  if (!target) return
  await library.setOverrides(target, changes)
  editing.value = null
}

async function addGame(game: Pick<OwnedGame, 'title' | 'store' | 'playStatus'>): Promise<void> {
  await library.addManual({
    ...game,
    storeGameId: `manual-${crypto.randomUUID()}`,
    ownership: { kind: 'owned' },
    genres: []
  })
  adding.value = false
}

async function removeEditing(): Promise<void> {
  for (const game of editingSources.value) await library.removeGame(game)
  editing.value = null
}

function download(filename: string, contents: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function exportAs(format: 'csv' | 'json'): void {
  exportMenu.value = false
  const stamp = new Date().toISOString().slice(0, 10)
  if (format === 'csv') {
    download(`ludoteca-${stamp}.csv`, toCsv(visibleGames.value), 'text/csv;charset=utf-8')
  } else {
    download(`ludoteca-${stamp}.json`, toJson(visibleGames.value), 'application/json')
  }
}

/** Per-entry fetch: enriches every store row behind it. */
async function enrichOne(entry: LibraryEntry): Promise<void> {
  const keys = new Set(entry.sources.map((s) => `${s.store}:${s.storeGameId}`))
  await library.enrich(
    library.games.value.filter((g) => keys.has(`${g.store}:${g.storeGameId}`)),
    true
  )
}
</script>

<template>
  <div>
    <p class="muted count">
      {{ visible.length }} of {{ library.entries.value.length }} games ·
      {{ library.games.value.length }} store entries · {{ totalHours }}h
    </p>

    <div class="toolbar">
      <input v-model="search" type="search" placeholder="Search titles…" />

      <div class="group">
        <div class="segmented">
          <button :class="{ on: view === 'grid' }" @click="view = 'grid'">Grid</button>
          <button :class="{ on: view === 'list' }" @click="view = 'list'">List</button>
        </div>
      </div>

      <div class="group">
        <button @click="fileInput?.click()">Import…</button>
        <div class="menu-anchor">
          <button :disabled="!visible.length" @click="exportMenu = !exportMenu">
            Export… ({{ visible.length }})
          </button>
          <div v-if="exportMenu" class="menu-backdrop" @click="exportMenu = false" />
          <div v-if="exportMenu" class="menu">
            <button @click="exportAs('csv')">CSV</button>
            <button @click="exportAs('json')">JSON</button>
          </div>
        </div>
        <button @click="adding = true; editing = null">Add game…</button>
        <button v-if="!library.games.value.length" @click="library.replaceAll(sampleLibrary())">
          Sample data
        </button>
      </div>
    </div>

    <input
      ref="fileInput"
      type="file"
      accept=".csv,.json,text/csv,application/json"
      hidden
      @change="onFileChosen"
    />

    <p v-if="importError" class="panel error">{{ importError }}</p>

    <GameEditor
      v-if="adding"
      :entry="null"
      :sources="[]"
      :edited-fields="[]"
      @add="addGame"
      @close="adding = false"
    />
    <GameEditor
      v-else-if="editing"
      :entry="editing"
      :sources="editingSources"
      :edited-fields="editingEdited"
      @save="saveEdits"
      @remove="removeEditing"
      @close="editing = null"
    />

    <MappingPanel
      v-if="pendingCsv"
      :parsed="pendingCsv.parsed"
      :suggested="pendingCsv.suggested"
      @confirm="confirmImport"
      @cancel="pendingCsv = null"
    />

    <div v-if="library.games.value.length" class="filters">
      <span class="muted">Store</span>
      <button
        v-for="store in storeOptions"
        :key="store"
        :class="{ on: stores.has(store) }"
        @click="stores = toggled(stores, store)"
      >
        {{ FACET_LABEL[store] }}
      </button>

      <span class="muted spacer">Shelf</span>
      <button
        v-for="shelf in shelfOptions"
        :key="shelf"
        :class="{ on: shelves.has(shelf) }"
        @click="shelves = toggled(shelves, shelf)"
      >
        {{ SHELF_LABEL[shelf] }}
      </button>

      <span class="muted spacer">Genre</span>
      <FilterMenu
        label="Any"
        :options="genreOptions"
        :selected="genres"
        @toggle="genres = toggled(genres, $event)"
        @clear="genres = new Set()"
      />

      <span class="muted spacer">Developer</span>
      <FilterMenu
        label="Any"
        :options="developerOptions"
        :selected="developers"
        @toggle="developers = toggled(developers, $event)"
        @clear="developers = new Set()"
      />

      <span class="muted spacer">Publisher</span>
      <FilterMenu
        label="Any"
        :options="publisherOptions"
        :selected="publishers"
        @toggle="publishers = toggled(publishers, $event)"
        @clear="publishers = new Set()"
      />

      <span class="muted spacer">Hidden</span>
      <button :class="{ on: showHidden }" @click="showHidden = !showHidden">
        Show hidden ({{ library.hiddenEntries.value.length }})
      </button>
    </div>

    <div v-if="library.games.value.length" class="filters">
      <span class="muted">Sort</span>
      <button
        v-for="option in SORT_OPTIONS"
        :key="option.key"
        :class="{ on: sortKey === option.key }"
        @click="onSort(option.key)"
      >
        {{ option.label
        }}<span v-if="sortKey === option.key">{{ descending ? ' ▼' : ' ▲' }}</span>
      </button>
    </div>

    <p v-if="!library.games.value.length" class="muted panel">
      No games yet. Import a CSV or JSON file, or load the sample data to see the layout.
    </p>
    <LibraryGrid
      v-else-if="view === 'grid'"
      :entries="visible"
      :needs-fetch="entryNeedsFetch"
      @enrich="enrichOne"
      @edit="editing = $event"
      @hide="library.setHidden($event, !showHidden)"
    />
    <LibraryTable
      v-else
      :entries="visible"
      :sort-key="sortKey"
      :descending="descending"
      :needs-fetch="entryNeedsFetch"
      @sort="onSort"
      @enrich="enrichOne"
      @edit="editing = $event"
      @hide="library.setHidden($event, !showHidden)"
    />
  </div>
</template>
