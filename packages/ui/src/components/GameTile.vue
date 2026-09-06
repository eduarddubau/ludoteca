<script setup lang="ts">
import { computed } from 'vue'
import { metacriticLink, needsEnrichment, storeLink, type OwnedGame } from '@ludoteca/core'
import ScoreChip from './ScoreChip.vue'

const props = defineProps<{ game: OwnedGame }>()
const emit = defineEmits<{ enrich: [game: OwnedGame] }>()

const store = computed(() => storeLink(props.game))
const metacritic = computed(() => metacriticLink(props.game))
const hours = computed(() =>
  props.game.playtimeMinutes === undefined
    ? null
    : `${Math.round(props.game.playtimeMinutes / 60)}h`
)
</script>

<template>
  <article class="tile">
    <div class="art">
      <img v-if="game.coverUrl" :src="game.coverUrl" :alt="game.title" loading="lazy" />
      <div v-else class="art-fallback"><span>{{ game.title }}</span></div>

      <div class="scrim">
        <span class="store-tag">{{ game.store }}</span>
        <span v-if="hours" class="hours">{{ hours }}</span>
      </div>

      <ScoreChip
        class="tile-score"
        :score="game.criticScore"
        :href="metacritic.url"
        :exact="metacritic.exact"
      />

      <button
        v-if="needsEnrichment(game)"
        class="tile-enrich"
        title="Fetch score, art and genres for this game"
        @click="emit('enrich', game)"
      >
        ↻
      </button>
    </div>

    <div class="meta">
      <a :href="store.url" target="_blank" rel="noreferrer" class="title" :title="game.title">
        {{ game.title }}
      </a>
      <p class="muted sub">
        {{ game.releaseYear ?? '—' }} · {{ game.playStatus }}
      </p>
    </div>
  </article>
</template>
