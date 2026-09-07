<script setup lang="ts">
import {
  entryMetacriticLink, PLATFORM_LABEL, SHELF_LABEL, type LibraryEntry
} from '@ludoteca/core'
import { COLUMNS, type ColumnKey, type SortKey } from '../lib/sort'
import ScoreChip from './ScoreChip.vue'
import StoreLinks from './StoreLinks.vue'

defineProps<{
  entries: LibraryEntry[]
  sortKey: SortKey
  descending: boolean
  needsFetch: (entry: LibraryEntry) => boolean
}>()
const emit = defineEmits<{
  sort: [key: SortKey]
  enrich: [entry: LibraryEntry]
  edit: [entry: LibraryEntry]
  hide: [entry: LibraryEntry]
}>()

// Header and body both iterate SORT_COLUMNS, so reordering a column cannot desync them.
function cell(entry: LibraryEntry, key: ColumnKey): string {
  switch (key) {
    case 'hours':
      return entry.playtimeMinutes === undefined
        ? '—'
        : String(Math.round(entry.playtimeMinutes / 60))
    case 'releaseYear':
      return entry.releaseYear?.toString() ?? '—'
    case 'platforms':
      return entry.platforms.map((id) => PLATFORM_LABEL[id]).join(', ')
    case 'playStatus':
      return SHELF_LABEL[entry.shelf]
    case 'genres':
      return entry.genres.join(', ') || '—'
    case 'developer':
      return entry.developer ?? '—'
    case 'publisher':
      return entry.publisher ?? '—'
    default:
      return entry.title
  }
}
</script>

<template>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th
            v-for="column in COLUMNS"
            :key="column.key"
            :class="[{ sortable: column.sortable }, `col-${column.key}`]"
            @click="column.sortable && emit('sort', column.key as SortKey)"
          >
            {{ column.label
            }}<span class="sort">{{
              sortKey === column.key ? (descending ? ' ▼' : ' ▲') : ''
            }}</span>
          </th>
          <th />
        </tr>
      </thead>
      <tbody>
        <tr v-for="entry in entries" :key="entry.key">
          <td v-for="column in COLUMNS" :key="column.key" :class="`col-${column.key}`">
            <ScoreChip
              v-if="column.key === 'criticScore'"
              :score="entry.criticScore"
              :href="entryMetacriticLink(entry).url"
              :exact="entryMetacriticLink(entry).exact"
            />
            <StoreLinks v-else-if="column.key === 'stores'" :entry="entry" />
            <template v-else>{{ cell(entry, column.key) }}</template>
          </td>
          <td class="col-actions">
            <button
              v-if="needsFetch(entry)"
              class="row-enrich"
              title="Fetch score, art and genres for this game"
              @click="emit('enrich', entry)"
            >
              ↻
            </button>
            <button class="row-enrich" title="Edit this game" @click="emit('edit', entry)">✎</button>
            <button class="row-enrich" title="Hide or unhide" @click="emit('hide', entry)">⊘</button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!entries.length" class="muted empty">Nothing matches those filters.</p>
  </div>
</template>
