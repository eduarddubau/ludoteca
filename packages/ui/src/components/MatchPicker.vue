<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { searchCandidates, shortenTitle, type MatchCandidate, type OwnedGame } from '@ludoteca/core'
import { usePlatform } from '../platform'

const props = defineProps<{ game: OwnedGame }>()
const emit = defineEmits<{ pick: [appId: number]; skip: [] }>()

const candidates = ref<MatchCandidate[]>([])
const query = ref(props.game.title)
const loading = ref(true)
const error = ref('')

async function search(): Promise<void> {
  loading.value = true
  error.value = ''
  try {
    const platform = usePlatform()
    let found = await searchCandidates(platform, query.value)

    // Steam returns nothing for some subtitled titles, so fall back to the leading
    // phrase rather than opening the picker on an empty list.
    if (!found.length) {
      const shorter = shortenTitle(query.value)
      if (shorter) {
        found = await searchCandidates(platform, shorter)
        if (found.length) query.value = shorter
      }
    }
    candidates.value = found
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    loading.value = false
  }
}

onMounted(search)
</script>

<template>
  <div class="picker">
    <div class="picker-head">
      <input v-model="query" type="search" @keyup.enter="search" />
      <button @click="search">Search</button>
      <button @click="emit('skip')">Skip</button>
    </div>

    <p v-if="loading" class="muted">Searching Steam…</p>
    <p v-else-if="error" class="error">{{ error }}</p>
    <p v-else-if="!candidates.length" class="muted">
      Steam returned nothing for that title. Try a shorter or different search.
    </p>

    <div v-else class="candidates">
      <button
        v-for="candidate in candidates"
        :key="candidate.appId"
        class="candidate"
        @click="emit('pick', candidate.appId)"
      >
        <img :src="candidate.coverUrl" :alt="candidate.name" loading="lazy" />
        <span class="candidate-name">{{ candidate.name }}</span>
        <span v-if="candidate.exact" class="candidate-exact">exact</span>
      </button>
    </div>
  </div>
</template>
