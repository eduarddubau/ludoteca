<script setup lang="ts">
import { ref } from 'vue'
import {
  toOwnedGames, type ColumnMapping, type ExportedGame, type ParsedCsv
} from '@ludoteca/core'

const props = defineProps<{ parsed: ParsedCsv; suggested: ColumnMapping }>()
const emit = defineEmits<{ confirm: [games: ExportedGame[]]; cancel: [] }>()

const mapping = ref<ColumnMapping>({ ...props.suggested })
const error = ref('')

const FIELDS: { key: keyof ColumnMapping; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'store', label: 'Store' },
  { key: 'platform', label: 'Platform' },
  { key: 'status', label: 'Play status' },
  { key: 'playtime', label: 'Playtime' },
  { key: 'storeGameId', label: 'Store game id' }
]

function confirm(): void {
  const games = toOwnedGames(props.parsed, mapping.value)
  if (!games.length) {
    error.value = 'No rows produced a title — check the Title mapping.'
    return
  }
  emit('confirm', games)
}
</script>

<template>
  <div class="panel">
    <p class="muted">
      {{ parsed.rows.length }} rows found. Confirm which column feeds which field.
    </p>

    <div class="mapping">
      <div v-for="field in FIELDS" :key="field.key" class="row">
        <label>{{ field.label }}</label>
        <select v-model="mapping[field.key]">
          <option value="">— not mapped —</option>
          <option v-for="header in parsed.headers" :key="header" :value="header">
            {{ header }}
          </option>
        </select>
      </div>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="actions">
      <button :disabled="!mapping.title" @click="confirm">
        Import {{ parsed.rows.length }} rows
      </button>
      <button @click="emit('cancel')">Cancel</button>
    </div>
  </div>
</template>
