<script setup lang="ts">
import { computed } from 'vue'
import { entryMetacriticLink, SHELF_LABEL, type LibraryEntry } from '@ludoteca/core'
import { storeDestination } from '../lib/links'
import ReviewChip from './ReviewChip.vue'
import ScoreChip from './ScoreChip.vue'
import StoreLinks from './StoreLinks.vue'

const props = defineProps<{ entry: LibraryEntry }>()
const emit = defineEmits<{ open: [entry: LibraryEntry] }>()

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

      <button
        class="art-hit"
        :aria-label="`Details for ${entry.title}`"
        :title="`Details for ${entry.title}`"
        @click="emit('open', entry)"
      >
        <span class="art-hint">Details</span>
      </button>

      <div class="scrim">
        <StoreLinks :entry="entry" />
        <span
          v-if="hours"
          class="hours"
        >{{ hours }}</span>
      </div>

      <div class="tile-scores">
        <ScoreChip
          label="Metacritic"
          :score="entry.criticScore"
          :href="metacritic.url"
          :exact="metacritic.exact"
          :source="entry.criticScoreSource"
        />
        <ReviewChip
          v-if="entry.steamReviewPercent !== undefined"
          label="Steam"
          :percent="entry.steamReviewPercent"
          :count="entry.steamReviewCount"
          :verdict="entry.steamReviewLabel"
        />
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
