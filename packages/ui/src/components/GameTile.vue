<script setup lang="ts">
import { computed } from 'vue'
import { entryMetacriticLink, SHELF_LABEL, type LibraryEntry } from '@ludoteca/core'
import { storeDestination } from '../lib/links'
import ReviewChip from './ReviewChip.vue'
import ScoreChip from './ScoreChip.vue'
import StoreLinks from './StoreLinks.vue'

const props = defineProps<{ entry: LibraryEntry; needsFetch: boolean }>()
const emit = defineEmits<{
  enrich: [entry: LibraryEntry]
  edit: [entry: LibraryEntry]
  hide: [entry: LibraryEntry]
}>()

const metacritic = computed(() => entryMetacriticLink(props.entry))
const primary = computed(() => storeDestination(props.entry, props.entry.sources[0]))
const hours = computed(() =>
  props.entry.playtimeMinutes === undefined
    ? null
    : `${Math.round(props.entry.playtimeMinutes / 60)}h`
)
</script>

<template>
  <article class="tile">
    <div class="art">
      <img
        v-if="entry.coverUrl"
        :src="entry.coverUrl"
        :alt="entry.title"
        loading="lazy"
      >
      <div
        v-else
        class="art-fallback"
      >
        <span>{{ entry.title }}</span>
      </div>

      <div class="scrim">
        <StoreLinks :entry="entry" />
        <span
          v-if="hours"
          class="hours"
        >{{ hours }}</span>
      </div>

      <ScoreChip
        class="tile-score"
        :score="entry.criticScore"
        :href="metacritic.url"
        :exact="metacritic.exact"
        :source="entry.criticScoreSource"
      />
      <ReviewChip
        v-if="entry.steamReviewPercent !== undefined"
        class="tile-review"
        :percent="entry.steamReviewPercent"
        :count="entry.steamReviewCount"
        :label="entry.steamReviewLabel"
      />

      <div class="tile-actions">
        <button
          v-if="needsFetch"
          title="Fetch score, art and genres for this game"
          @click="emit('enrich', entry)"
        >
          ↻
        </button>
        <button
          title="Edit this game"
          @click="emit('edit', entry)"
        >
          ✎
        </button>
        <button
          title="Hide or unhide"
          @click="emit('hide', entry)"
        >
          ⊘
        </button>
      </div>
    </div>

    <div class="meta">
      <a
        :href="primary.url"
        target="_blank"
        rel="noreferrer"
        class="title"
        :title="`${entry.title} · ${primary.title}`"
      >
        {{ entry.title }}
      </a>
      <p class="muted sub">
        {{ entry.releaseYear ?? '—' }} · {{ SHELF_LABEL[entry.shelf] }}
      </p>
    </div>
  </article>
</template>
