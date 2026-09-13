<script setup lang="ts">
import { computed } from 'vue'
import { scoreBand } from '@ludoteca/core'

const props = defineProps<{
  score?: number
  href: string
  exact: boolean
  source?: 'steam' | 'pcgamingwiki'
}>()
const band = computed(() => (props.score === undefined ? 'none' : scoreBand(props.score)))
const title = computed(() => {
  const page = props.exact ? 'Metacritic page' : 'Search Metacritic (no exact match resolved yet)'
  return props.source === 'pcgamingwiki' ? `${page} · score via PCGamingWiki` : page
})
</script>

<template>
  <a
    class="score"
    :class="band"
    :href="href"
    target="_blank"
    rel="noreferrer"
    :title="title"
  >
    {{ score ?? '–' }}
  </a>
</template>
