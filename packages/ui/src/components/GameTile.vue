<script setup lang="ts">
import { computed } from 'vue'
import { entryMetacriticLink, sourceLink, STATUS_LABEL, type LibraryEntry } from '@ludoteca/core'
import ScoreChip from './ScoreChip.vue'
import StoreLinks from './StoreLinks.vue'

const props = defineProps<{ entry: LibraryEntry; needsFetch: boolean }>()
const emit = defineEmits<{ enrich: [entry: LibraryEntry] }>()

const metacritic = computed(() => entryMetacriticLink(props.entry))
const primary = computed(() => sourceLink(props.entry.sources[0], props.entry.title))
const hours = computed(() =>
  props.entry.playtimeMinutes === undefined
    ? null
    : `${Math.round(props.entry.playtimeMinutes / 60)}h`
)
</script>

<template>
  <article class="tile">
    <div class="art">
      <img v-if="entry.coverUrl" :src="entry.coverUrl" :alt="entry.title" loading="lazy" />
      <div v-else class="art-fallback"><span>{{ entry.title }}</span></div>

      <div class="scrim">
        <StoreLinks :entry="entry" />
        <span v-if="hours" class="hours">{{ hours }}</span>
      </div>

      <ScoreChip
        class="tile-score"
        :score="entry.criticScore"
        :href="metacritic.url"
        :exact="metacritic.exact"
      />

      <button
        v-if="needsFetch"
        class="tile-enrich"
        title="Fetch score, art and genres for this game"
        @click="emit('enrich', entry)"
      >
        ↻
      </button>
    </div>

    <div class="meta">
      <a :href="primary.url" target="_blank" rel="noreferrer" class="title" :title="entry.title">
        {{ entry.title }}
      </a>
      <p class="muted sub">
        {{ entry.releaseYear ?? '—' }} · {{ STATUS_LABEL[entry.playStatus] }}
      </p>
    </div>
  </article>
</template>
