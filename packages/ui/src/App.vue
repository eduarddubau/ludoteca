<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  enrichGame, enrichLibrary, needsEnrichment, sampleLibrary,
  type EnrichProgress, type OwnedGame, type PlayStatus, type StoreId
} from '@ludoteca/core'
import { usePlatform } from './platform'
import { loadGames, replaceGames } from './lib/library'
import { sortGames, type SortKey } from './lib/sort'
import LibraryTable from './components/LibraryTable.vue'
import LibraryGrid from './components/LibraryGrid.vue'
import ImportPanel from './components/ImportPanel.vue'

const shell = ref('—')
const games = ref<OwnedGame[]>([])
const search = ref('')
const stores = ref<Set<StoreId>>(new Set())
const statuses = ref<Set<PlayStatus>>(new Set())
const showImport = ref(false)

// Grid is the pleasant default; at 500+ games the list is the one that gets used.
const view = ref<'grid' | 'list'>('grid')
const sortKey = ref<SortKey>('title')
const descending = ref(false)

const progress = ref<EnrichProgress | null>(null)
const abort = ref({ aborted: false })

const unenriched = computed(() => games.value.filter(needsEnrichment).length)

onMounted(async () => {
  const platform = usePlatform()
  shell.value = platform.name
  games.value = await loadGames(platform)
})

const storeOptions = computed(() => [...new Set(games.value.map((g) => g.store))].sort())
const statusOptions = computed(() => [...new Set(games.value.map((g) => g.playStatus))].sort())

const visible = computed(() => {
  const needle = search.value.trim().toLowerCase()
  const filtered = games.value.filter(
    (game) =>
      (stores.value.size === 0 || stores.value.has(game.store)) &&
      (statuses.value.size === 0 || statuses.value.has(game.playStatus)) &&
      (!needle || game.title.toLowerCase().includes(needle))
  )
  return sortGames(filtered, sortKey.value, descending.value)
})

const totalHours = computed(() =>
  Math.round(visible.value.reduce((sum, g) => sum + (g.playtimeMinutes ?? 0), 0) / 60)
)

function toggled<T>(set: Set<T>, value: T): Set<T> {
  const next = new Set(set)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

function onSort(key: SortKey): void {
  if (sortKey.value === key) descending.value = !descending.value
  else {
    sortKey.value = key
    descending.value = false
  }
}

// Two Steam requests per unenriched game, paced to stay under the rate limit, so a
// full library takes minutes. Progress is shown and it can be stopped and resumed —
// already-enriched rows are skipped on the next run.
async function enrich(): Promise<void> {
  const platform = usePlatform()
  abort.value = { aborted: false }
  progress.value = { done: 0, total: games.value.length, title: '', matched: false }
  try {
    const next = await enrichLibrary(platform, games.value, {
      signal: abort.value,
      onProgress: (p) => (progress.value = p),
      // A full run takes minutes; write periodically so a crash costs a batch, not all of it.
      onCheckpoint: (partial) => replaceGames(platform, partial)
    })
    await persist(next)
  } finally {
    progress.value = null
  }
}

// Single-game path, for a title added after the last bulk run.
async function enrichOne(game: OwnedGame): Promise<void> {
  const platform = usePlatform()
  const updated = await enrichGame(platform, game)
  await persist(
    games.value.map((g) =>
      g.store === game.store && g.storeGameId === game.storeGameId ? updated : g
    )
  )
}

async function persist(next: OwnedGame[]): Promise<void> {
  const platform = usePlatform()
  await replaceGames(platform, next)
  games.value = await loadGames(platform)
  showImport.value = false
}
</script>

<template>
  <div class="app">
    <header>
      <h1>Ludoteca</h1>
      <p class="muted">
        {{ visible.length }} of {{ games.length }} games · {{ totalHours }}h · {{ shell }} shell
      </p>
    </header>

    <div class="toolbar">
      <input v-model="search" type="search" placeholder="Search titles…" />

      <div class="segmented">
        <button :class="{ on: view === 'grid' }" @click="view = 'grid'">Grid</button>
        <button :class="{ on: view === 'list' }" @click="view = 'list'">List</button>
      </div>

      <button @click="showImport = !showImport">
        {{ showImport ? 'Close import' : 'Import CSV' }}
      </button>
      <button v-if="!games.length" @click="persist(sampleLibrary())">Load sample data</button>
      <button v-if="unenriched && !progress" @click="enrich">
        Fetch metadata ({{ unenriched }})
      </button>
      <button v-if="progress" @click="abort.aborted = true">Stop</button>
    </div>

    <p v-if="progress" class="muted panel">
      Enriching {{ progress.done }} / {{ progress.total }} — {{ progress.title }}
    </p>

    <ImportPanel v-if="showImport" @imported="persist" />

    <div v-if="games.length" class="filters">
      <span class="muted">Store</span>
      <button
        v-for="store in storeOptions"
        :key="store"
        :class="{ on: stores.has(store) }"
        @click="stores = toggled(stores, store)"
      >
        {{ store }}
      </button>

      <span class="muted spacer">Status</span>
      <button
        v-for="status in statusOptions"
        :key="status"
        :class="{ on: statuses.has(status) }"
        @click="statuses = toggled(statuses, status)"
      >
        {{ status }}
      </button>

      <!-- The grid has no column headers, so it needs its own sort control. -->
      <template v-if="view === 'grid'">
        <span class="muted spacer">Sort</span>
        <select v-model="sortKey">
          <option value="title">Title</option>
          <option value="criticScore">Score</option>
          <option value="hours">Hours</option>
          <option value="releaseYear">Year</option>
          <option value="store">Store</option>
        </select>
        <button @click="descending = !descending">{{ descending ? '▼' : '▲' }}</button>
      </template>
    </div>

    <p v-if="!games.length" class="muted panel">
      No games yet. Import a CSV, or load the sample data to see the layout.
    </p>
    <LibraryGrid v-else-if="view === 'grid'" :games="visible" @enrich="enrichOne" />
    <LibraryTable
      v-else
      :games="visible"
      :sort-key="sortKey"
      :descending="descending"
      @sort="onSort"
      @enrich="enrichOne"
    />
  </div>
</template>
