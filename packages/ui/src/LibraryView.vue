<script setup lang="ts">
import { computed, ref, watch, type Ref } from 'vue'
import {
  FACET_LABEL, PLATFORM_LABEL, SHELF_LABEL,
  type EditableField, type GamePlatform, type LibraryEntry, type OwnedGame,
  type Shelf, type StoreFacet
} from '@ludoteca/core'
import { useLibrary } from './lib/store'
import { SORT_OPTIONS, sortEntries, type SortKey } from './lib/sort'
import LibraryTable from './components/LibraryTable.vue'
import LibraryGrid from './components/LibraryGrid.vue'
import FilterMenu from './components/FilterMenu.vue'
import GameEditor from './components/GameEditor.vue'

const library = useLibrary()
const emit = defineEmits<{ navigate: [tab: 'settings'] }>()

const search = ref('')
const stores = ref<Set<StoreFacet>>(new Set())
const platforms = ref<Set<GamePlatform>>(new Set())
const shelves = ref<Set<Shelf>>(new Set())
const genres = ref<Set<string>>(new Set())
const developers = ref<Set<string>>(new Set())
const publishers = ref<Set<string>>(new Set())

const view = ref<'grid' | 'list'>('grid')
const sortKey = ref<SortKey>('criticScore')
const descending = ref(true)

const showHidden = ref(false)
const editing = ref<LibraryEntry | null>(null)
const adding = ref(false)
const preview = ref<OwnedGame | null>(null)
const fetching = ref(false)
const fetchError = ref('')

const source = computed(() =>
  showHidden.value ? library.hiddenEntries.value : library.entries.value
)

// Every filter offers what is on screen, which is the hidden set while Show hidden is on
// — options read from the visible set would omit values the listed rows actually carry.
const shelfOptions: Shelf[] = ['played', 'backlog']
const storeOptions = computed(() =>
  [...new Set(source.value.flatMap((entry) => entry.facets))].sort()
)
const platformOptions = computed(() =>
  [...new Set(source.value.flatMap((entry) => entry.platforms))].sort()
)

// Ordered by how many games carry each, so the useful ones are not buried under one-offs.
function tally(pick: (entry: LibraryEntry) => string[]): [string, number][] {
  const counts = new Map<string, number>()
  for (const entry of source.value) {
    for (const value of pick(entry)) counts.set(value, (counts.get(value) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

const genreOptions = computed(() => tally((e) => e.genres))
const developerOptions = computed(() => tally((e) => (e.developer ? [e.developer] : [])))
const publisherOptions = computed(() => tally((e) => (e.publisher ? [e.publisher] : [])))

// Toggling Show hidden changes what the chips offer. A selection whose chip is gone would
// filter the view to nothing with no visible control left to clear it.
function prune<T>(selected: Ref<Set<T>>, allowed: T[]): void {
  const keep = new Set(allowed)
  if ([...selected.value].every((value) => keep.has(value))) return
  selected.value = new Set([...selected.value].filter((value) => keep.has(value)))
}

watch(source, () => {
  prune(stores, storeOptions.value)
  prune(platforms, platformOptions.value)
  prune(genres, genreOptions.value.map(([value]) => value))
  prune(developers, developerOptions.value.map(([value]) => value))
  prune(publishers, publisherOptions.value.map(([value]) => value))
})

const visible = computed(() => {
  const needle = search.value.trim().toLowerCase()
  const filtered = source.value.filter(
    (entry) =>
      (stores.value.size === 0 || entry.facets.some((f) => stores.value.has(f))) &&
      (platforms.value.size === 0 ||
        entry.platforms.some((p) => platforms.value.has(p))) &&
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

// Every source row, like setHidden: an edit belongs to the entry, and pinning a title on
// one of two rows would split the merged entry in half at the next render.
async function saveEdits(changes: Partial<Record<EditableField, unknown>>): Promise<void> {
  if (!editingSources.value.length) return
  await library.setOverrides(editingSources.value, changes)
  closeEditor()
}

// Bumped by every edit and every close, so a lookup that outlives the form it was
// started from is discarded instead of landing in it under a title it never matched.
let previewGeneration = 0

async function fetchPreview(
  draft: Pick<OwnedGame, 'title' | 'store' | 'platform' | 'playStatus'>
): Promise<void> {
  const generation = ++previewGeneration
  fetching.value = true
  fetchError.value = ''
  preview.value = null
  try {
    const found = await library.previewMetadata({
      ...draft,
      storeGameId: `draft-${crypto.randomUUID()}`,
      ownership: { kind: 'owned' },
      genres: []
    })
    if (generation !== previewGeneration) return
    preview.value = found
  } catch (err) {
    if (generation !== previewGeneration) return
    fetchError.value = err instanceof Error ? err.message : String(err)
  } finally {
    if (generation === previewGeneration) fetching.value = false
  }
}

function invalidatePreview(): void {
  previewGeneration++
  preview.value = null
  fetchError.value = ''
  fetching.value = false
}

async function addGame(game: OwnedGame): Promise<void> {
  await library.addManual(game)
  closeEditor()
}

function closeEditor(): void {
  adding.value = false
  editing.value = null
  invalidatePreview()
}

async function refetchEditing(changes: Partial<Record<EditableField, unknown>>): Promise<void> {
  const entry = editing.value
  if (!entry || !editingSources.value.length) return
  const searchTitle = (changes.title as string | undefined) ?? entry.title
  if (Object.keys(changes).length) {
    await library.setOverrides(editingSources.value, changes)
  }
  closeEditor()
  await enrichOne(entry, searchTitle)
}

async function removeEditing(): Promise<void> {
  for (const game of editingSources.value) await library.removeGame(game)
  closeEditor()
}

/** Per-entry fetch: enriches every store row behind it. */
// searchTitle is passed explicitly after a rename: `entry` is captured before the
// override lands, so reading entry.title here would look the old name up again.
async function enrichOne(entry: LibraryEntry, searchTitle = entry.title): Promise<void> {
  const keys = new Set(entry.sources.map((s) => `${s.store}:${s.storeGameId}`))
  const targets = library.games.value
    .filter((g) => keys.has(`${g.store}:${g.storeGameId}`))
    .map((game) => ({ ...game, title: searchTitle }))
  await library.enrich(targets, true)
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
        <button @click="closeEditor(); adding = true">Add game…</button>
      </div>
    </div>

    <GameEditor
      v-if="adding"
      :entry="null"
      :sources="[]"
      :edited-fields="[]"
      :preview="preview"
      :fetching="fetching"
      :fetch-error="fetchError"
      @add="addGame"
      @fetch="fetchPreview"
      @invalidate="invalidatePreview"
      @close="closeEditor"
    />
    <GameEditor
      v-else-if="editing"
      :key="editing.key"
      :entry="editing"
      :sources="editingSources"
      :edited-fields="editingEdited"
      :preview="null"
      :fetching="false"
      fetch-error=""
      @save="saveEdits"
      @refetch="refetchEditing"
      @remove="removeEditing"
      @close="closeEditor"
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

      <span class="muted spacer">Platform</span>
      <button
        v-for="id in platformOptions"
        :key="id"
        :class="{ on: platforms.has(id) }"
        @click="platforms = toggled(platforms, id)"
      >
        {{ PLATFORM_LABEL[id] }}
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

    <p v-if="!library.games.value.length" class="muted panel empty-library">
      <span>No games yet. Importing a file and loading the sample data both live in Settings.</span>
      <button @click="emit('navigate', 'settings')">Open Settings</button>
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
