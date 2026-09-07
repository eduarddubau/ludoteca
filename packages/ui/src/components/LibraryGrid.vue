<script setup lang="ts">
import type { LibraryEntry } from '@ludoteca/core'
import GameTile from './GameTile.vue'

defineProps<{ entries: LibraryEntry[]; needsFetch: (entry: LibraryEntry) => boolean }>()
const emit = defineEmits<{
  enrich: [entry: LibraryEntry]
  edit: [entry: LibraryEntry]
  hide: [entry: LibraryEntry]
}>()
</script>

<template>
  <div v-if="entries.length" class="grid">
    <GameTile
      v-for="entry in entries"
      :key="entry.key"
      :entry="entry"
      :needs-fetch="needsFetch(entry)"
      @enrich="emit('enrich', $event)"
      @edit="emit('edit', $event)"
      @hide="emit('hide', $event)"
    />
  </div>
  <p v-else class="muted panel">Nothing matches those filters.</p>
</template>
