<script setup lang="ts">
import { ref } from 'vue'
import {
  parseCsv, suggestMapping, toOwnedGames,
  type ColumnMapping, type OwnedGame, type ParsedCsv
} from '@ludoteca/core'

const emit = defineEmits<{ imported: [games: OwnedGame[]] }>()

const parsed = ref<ParsedCsv | null>(null)
const mapping = ref<ColumnMapping | null>(null)
const error = ref('')

const FIELDS: { key: keyof ColumnMapping; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'store', label: 'Store' },
  { key: 'status', label: 'Play status' },
  { key: 'playtime', label: 'Playtime' },
  { key: 'storeGameId', label: 'Store game id' }
]

// The File API works identically in every shell, so import needs no Platform capability.
async function onFile(event: Event): Promise<void> {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (!file) return
  error.value = ''
  try {
    const result = parseCsv(await file.text())
    if (!result.rows.length) throw new Error('No rows found in that file.')
    parsed.value = result
    mapping.value = suggestMapping(result.headers)
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  }
}

function confirmImport(): void {
  if (!parsed.value || !mapping.value) return
  const games = toOwnedGames(parsed.value, mapping.value)
  if (!games.length) {
    error.value = 'No rows produced a title — check the Title mapping.'
    return
  }
  emit('imported', games)
  parsed.value = null
  mapping.value = null
}
</script>

<template>
  <div class="panel">
    <label class="file">
      <input
        type="file"
        accept=".csv,text/csv"
        @change="onFile"
      >
    </label>

    <p
      v-if="error"
      class="error"
    >
      {{ error }}
    </p>

    <div
      v-if="parsed && mapping"
      class="mapping"
    >
      <p class="muted">
        {{ parsed.rows.length }} rows. Confirm which column feeds which field:
      </p>
      <div
        v-for="field in FIELDS"
        :key="field.key"
        class="row"
      >
        <label>{{ field.label }}</label>
        <select v-model="mapping[field.key]">
          <option value="">
            — not mapped —
          </option>
          <option
            v-for="header in parsed.headers"
            :key="header"
            :value="header"
          >
            {{ header }}
          </option>
        </select>
      </div>
      <button
        :disabled="!mapping.title"
        @click="confirmImport"
      >
        Import {{ parsed.rows.length }} rows
      </button>
    </div>
  </div>
</template>
