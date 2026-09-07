<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useLibrary } from './lib/store'
import LibraryView from './LibraryView.vue'
import MetadataView from './MetadataView.vue'

const library = useLibrary()
const tab = ref<'library' | 'metadata'>('library')

onMounted(library.reload)

// A run started on one tab keeps going on the other, so its progress has to be visible
// from anywhere — otherwise leaving the tab feels like cancelling it.
const runLabel = computed(() => {
  const progress = library.progress.value
  return progress ? `${progress.done} / ${progress.total}` : null
})
</script>

<template>
  <div class="app">
    <header class="app-head">
      <h1>Ludoteca</h1>

      <nav class="tabs">
        <button :class="{ on: tab === 'library' }" @click="tab = 'library'">Library</button>
        <button :class="{ on: tab === 'metadata' }" @click="tab = 'metadata'">
          Metadata
          <span v-if="library.unresolved.value.length" class="badge">
            {{ library.unresolved.value.length }}
          </span>
        </button>
      </nav>

      <span v-if="runLabel" class="running" title="Metadata fetch in progress">
        Fetching {{ runLabel }}
      </span>
    </header>

    <LibraryView v-if="tab === 'library'" />
    <MetadataView v-else />
  </div>
</template>
