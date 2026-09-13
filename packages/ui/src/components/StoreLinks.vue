<script setup lang="ts">
import { computed } from 'vue'
import type { LibraryEntry } from '@ludoteca/core'
import { sourceLabel, storeDestination } from '../lib/links'

const props = defineProps<{ entry: LibraryEntry }>()

const tags = computed(() =>
  props.entry.sources.map((source) => ({
    key: `${source.store}:${source.storeGameId}`,
    label: sourceLabel(source),
    ...storeDestination(props.entry, source)
  }))
)
</script>

<template>
  <span class="store-links">
    <a
      v-for="tag in tags"
      :key="tag.key"
      :href="tag.url"
      target="_blank"
      rel="noreferrer"
      :class="['store-link', { approx: tag.approx }]"
      :title="tag.title"
    >{{ tag.label }}</a>
  </span>
</template>
