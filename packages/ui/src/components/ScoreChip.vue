<script setup lang="ts">
import { computed } from 'vue'
import { scoreBand } from '@ludoteca/core'

const props = defineProps<{ score?: number; href: string; exact: boolean }>()
const band = computed(() => (props.score === undefined ? 'none' : scoreBand(props.score)))
</script>

<template>
  <a
    class="score"
    :class="band"
    :href="href"
    target="_blank"
    rel="noreferrer"
    :title="exact ? 'Metacritic page' : 'Search Metacritic (no exact match resolved yet)'"
  >
    {{ score ?? '–' }}
  </a>
</template>
