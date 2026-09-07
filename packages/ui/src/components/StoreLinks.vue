<script setup lang="ts">
import { FACET_LABEL, sourceLink, type GameSource, type LibraryEntry } from '@ludoteca/core'

// A game owned and also family-shared has two Steam sources; label them apart.
const label = (source: GameSource): string =>
  FACET_LABEL[source.store === 'steam' && source.shared ? 'steam:shared' : source.store]

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
          ? `Open on ${label(source)}`
          : `Search ${label(source)} (no exact match yet)`
      "
    >{{ label(source) }}</a>
  </span>
</template>
