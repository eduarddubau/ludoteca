<script setup lang="ts">
import { metacriticLink, needsEnrichment, storeLink, type OwnedGame } from '@ludoteca/core'
import { SORT_COLUMNS, type SortKey } from '../lib/sort'
import ScoreChip from './ScoreChip.vue'

defineProps<{ games: OwnedGame[]; sortKey: SortKey; descending: boolean }>()
const emit = defineEmits<{ sort: [key: SortKey]; enrich: [game: OwnedGame] }>()

const hours = (game: OwnedGame): string =>
  game.playtimeMinutes === undefined ? '—' : Math.round(game.playtimeMinutes / 60).toString()
</script>

<template>
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th
            v-for="column in SORT_COLUMNS"
            :key="column.key"
            class="sortable"
            @click="emit('sort', column.key)"
          >
            {{ column.label
            }}<span class="sort">{{
              sortKey === column.key ? (descending ? ' ▼' : ' ▲') : ''
            }}</span>
          </th>
          <th>Links</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="game in games" :key="`${game.store}:${game.storeGameId}`">
          <td>{{ game.title }}</td>
          <td class="cap">{{ game.store }}</td>
          <td class="cap">{{ game.playStatus }}</td>
          <td>{{ hours(game) }}</td>
          <td>
            <ScoreChip
              :score="game.criticScore"
              :href="metacriticLink(game).url"
              :exact="metacriticLink(game).exact"
            />
          </td>
          <td>{{ game.releaseYear ?? '—' }}</td>
          <td class="links">
            <a
              :href="storeLink(game).url"
              target="_blank"
              rel="noreferrer"
              :class="{ approx: !storeLink(game).exact }"
              :title="storeLink(game).exact ? 'Store page' : 'Search the store (no exact match yet)'"
            >{{ game.store }}</a>
            <button
              v-if="needsEnrichment(game)"
              class="row-enrich"
              title="Fetch score, art and genres for this game"
              @click="emit('enrich', game)"
            >
              ↻
            </button>
          </td>
        </tr>
      </tbody>
    </table>
    <p v-if="!games.length" class="muted empty">Nothing matches those filters.</p>
  </div>
</template>
