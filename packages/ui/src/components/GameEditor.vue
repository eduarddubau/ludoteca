<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  STORE_IDS, STORE_LABEL,
  type EditableField, type LibraryEntry, type OwnedGame, type StoreId
} from '@ludoteca/core'

const props = defineProps<{
  /** Null when adding rather than editing. */
  entry: LibraryEntry | null
  sources: OwnedGame[]
  editedFields: EditableField[]
}>()
const emit = defineEmits<{
  save: [changes: Partial<Record<EditableField, unknown>>]
  add: [game: Pick<OwnedGame, 'title' | 'store' | 'playStatus'>, fetchMetadata: boolean]
  refetch: [changes: Partial<Record<EditableField, unknown>>]
  remove: []
  close: []
}>()

const adding = computed(() => props.entry === null)
const manual = computed(() => props.sources.every((game) => game.addedManually))

const title = ref(props.entry?.title ?? '')
const store = ref<StoreId>(props.sources[0]?.store ?? 'steam')
const played = ref(props.entry?.playStatus === 'played')
const fetchMetadata = ref(true)

const titleEdited = computed(() => props.editedFields.includes('title'))
const trimmed = computed(() => title.value.trim())
const titleChanged = computed(() => trimmed.value !== (props.entry?.title ?? ''))

/** Empty unless the title moved, so a save never pins a field that did not change. */
const changes = computed<Partial<Record<EditableField, unknown>>>(() =>
  titleChanged.value ? { title: trimmed.value } : {}
)

const facts = computed(() => [
  { label: 'Score', value: props.entry?.criticScore?.toString() },
  { label: 'Released', value: props.entry?.releaseYear?.toString() },
  { label: 'Genres', value: props.entry?.genres.join(', ') || undefined },
  { label: 'Developer', value: props.entry?.developer },
  { label: 'Publisher', value: props.entry?.publisher }
])

function submit(): void {
  if (!trimmed.value) return
  if (adding.value) {
    emit(
      'add',
      { title: trimmed.value, store: store.value, playStatus: played.value ? 'played' : 'unplayed' },
      fetchMetadata.value
    )
    return
  }
  emit('save', changes.value)
}
</script>

<template>
  <div class="panel editor">
    <div class="editor-head">
      <h2>{{ adding ? 'Add a game' : 'Edit game' }}</h2>
      <span v-if="!adding && manual" class="tag">Added by hand</span>
    </div>

    <div class="field">
      <label for="editor-title">Title</label>
      <input
        id="editor-title"
        v-model="title"
        type="text"
        autocomplete="off"
        placeholder="Exact title, as the store spells it"
        :class="{ edited: titleEdited }"
      />
      <p class="field-hint">
        Metadata is matched on this. Correct it, then fetch again if the wrong game was found.
      </p>
    </div>

    <template v-if="adding">
      <div class="field">
        <label for="editor-store">Store</label>
        <select id="editor-store" v-model="store">
          <option v-for="id in STORE_IDS" :key="id" :value="id">{{ STORE_LABEL[id] }}</option>
        </select>
      </div>

      <label class="check"><input v-model="played" type="checkbox" /> I have played this</label>
      <label class="check">
        <input v-model="fetchMetadata" type="checkbox" /> Fetch score, artwork and genres now
      </label>
    </template>

    <div v-else class="facts">
      <div v-for="fact in facts" :key="fact.label" class="fact">
        <span class="fact-label">{{ fact.label }}</span>
        <span :class="['fact-value', { missing: !fact.value }]">{{ fact.value ?? 'Not fetched' }}</span>
      </div>
      <p class="field-hint">
        These come from the store and are not editable — a hand-typed score would not be true.
      </p>
    </div>

    <div class="editor-actions">
      <button class="primary" :disabled="!trimmed" @click="submit">
        {{ adding ? 'Add game' : 'Save' }}
      </button>
      <button v-if="!adding" :disabled="!trimmed" @click="emit('refetch', changes)">
        Fetch metadata
      </button>
      <button @click="emit('close')">Cancel</button>
      <span class="grow" />
      <button v-if="!adding && manual" class="danger" @click="emit('remove')">
        Delete permanently
      </button>
    </div>
  </div>
</template>
