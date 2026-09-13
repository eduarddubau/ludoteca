<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useLibrary } from './lib/store'
import { timeLeft } from './lib/time'
import LibraryView from './LibraryView.vue'
import MetadataView from './MetadataView.vue'
import StoresView from './StoresView.vue'
import SettingsView from './SettingsView.vue'

type Tab = 'library' | 'metadata' | 'stores' | 'settings'

const library = useLibrary()
const tab = ref<Tab>('library')

onMounted(library.reload)

// A run started on one tab keeps going on the other, so its progress has to be visible
// from anywhere — otherwise leaving the tab feels like cancelling it.
const runLabel = computed(() => {
  const status = library.runStatus.value
  return status ? `${status.phase} ${status.done} / ${status.total} · ${timeLeft(status.secondsLeft)}` : null
})
</script>

<template>
  <div class="app">
    <header class="app-head">
      <h1>Ludoteca</h1>

      <nav class="tabs">
        <button
          :class="{ on: tab === 'library' }"
          @click="tab = 'library'"
        >
          Library
        </button>
        <button
          :class="{ on: tab === 'metadata' }"
          @click="tab = 'metadata'"
        >
          Metadata
          <span
            v-if="library.unresolved.value.length"
            class="badge"
          >
            {{ library.unresolved.value.length }}
          </span>
        </button>
        <button
          :class="{ on: tab === 'stores' }"
          @click="tab = 'stores'"
        >
          Stores
        </button>
        <button
          :class="{ on: tab === 'settings' }"
          @click="tab = 'settings'"
        >
          Settings
        </button>
      </nav>

      <span
        v-if="runLabel"
        class="running"
        title="Metadata run in progress — details on the Metadata tab"
      >
        {{ runLabel }}
      </span>
    </header>

    <LibraryView
      v-if="tab === 'library'"
      @navigate="tab = $event"
    />
    <MetadataView v-else-if="tab === 'metadata'" />
    <StoresView v-else-if="tab === 'stores'" />
    <SettingsView
      v-else
      @navigate="tab = $event"
    />
  </div>
</template>
