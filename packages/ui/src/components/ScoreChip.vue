<script setup lang="ts">
import { computed } from 'vue'
import { scoreBand } from '@ludoteca/core'

const props = defineProps<{
  score?: number
  href: string
  exact: boolean
  source?: 'steam' | 'pcgamingwiki'
  /** Shown before the score where nothing else names it, as on a tile. */
  label?: string
}>()
const band = computed(() => (props.score === undefined ? 'none' : scoreBand(props.score)))
const title = computed(() => {
  const page = props.exact ? 'Metacritic page' : 'Search Metacritic (no exact match resolved yet)'
  return props.source === 'pcgamingwiki' ? `${page} · score via PCGamingWiki` : page
})
</script>

<template>
  <a
    class="rating"
    :class="band"
    :href="href"
    target="_blank"
    rel="noreferrer"
    :title="title"
  >
    <span
      v-if="label"
      class="rating-label"
    >{{ label }}</span>
    <span class="rating-value">{{ score ?? '–' }}</span>
  </a>
</template>
