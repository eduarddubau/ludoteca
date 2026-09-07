<script setup lang="ts">
import { entryMetacriticLink, STATUS_LABEL, type LibraryEntry } from '@ludoteca/core'
import { SORT_COLUMNS, type SortKey } from '../lib/sort'
import ScoreChip from './ScoreChip.vue'
import StoreLinks from './StoreLinks.vue'

defineProps<{
  entries: LibraryEntry[]
  sortKey: SortKey
  descending: boolean
  needsFetch: (entry: LibraryEntry) => boolean
}>()
const emit = defineEmits<{ sort: [key: SortKey]; enrich: [entry: LibraryEntry] }>()

// Header and body both iterate SORT_COLUMNS, so reordering a column cannot desync them.
function cell(entry: LibraryEntry, key: SortKey): string {
  switch (key) {
    case 'hours':
      return entry.playtimeMinutes === undefined
        ? '—'
        : String(Math.round(entry.playtimeMinutes / 60))
    case 'releaseYear':
      return entry.releaseYear?.toString() ?? '—'
    case 'playStatus':
      return STATUS_LABEL[entry.playStatus]
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
            v-for="column in SORT_COLUMNS"
            :key="column.key"
            :class="['sortable', `col-${column.key}`]"
            @click="emit('sort', column.key)"
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
          <td v-for="column in SORT_COLUMNS" :key="column.key" :class="`col-${column.key}`">
            <ScoreChip
              v-if="column.key === 'criticScore'"
              :score="entry.criticScore"
              :href="entryMetacriticLink(entry).url"
              :exact="entryMetacriticLink(entry).exact"
            />
            <StoreLinks v-else-if="column.key === 'stores'" :entry="entry" />
            <template v-else>{{ cell(entry, column.key) }}</template>
          </td>
          <td>
            <button
              v-if="needsFetch(entry)"
              class="row-enrich"
              title="Fetch score, art and genres for this game"
              @click="emit('enrich', entry)"
            >
              ↻
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!entries.length" class="muted empty">Nothing matches those filters.</p>
  </div>
</template>
