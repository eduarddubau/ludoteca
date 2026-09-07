<script setup lang="ts">
import { sourceLink, type LibraryEntry } from '@ludoteca/core'

defineProps<{ entry: LibraryEntry }>()
</script>

<template>
  <span class="store-links">
    <a
      v-for="source in entry.sources"
      :key="`${source.store}:${source.storeGameId}`"
      :href="sourceLink(source, entry.title).url"
      target="_blank"
      rel="noreferrer"
      :class="['store-link', { approx: !sourceLink(source, entry.title).exact }]"
      :title="
        sourceLink(source, entry.title).exact
          ? `Open on ${source.store}`
          : `Search ${source.store} (no exact match yet)`
      "
    >{{ source.store }}</a>
  </span>
</template>
