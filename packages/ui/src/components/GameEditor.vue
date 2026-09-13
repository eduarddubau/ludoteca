<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  PLATFORM_IDS, PLATFORM_LABEL, STORE_IDS, STORE_LABEL,
  type EditableField, type GamePlatform, type LibraryEntry, type OwnedGame, type StoreId
} from '@ludoteca/core'

const props = defineProps<{
  /** Null when adding rather than editing. */
  entry: LibraryEntry | null
  sources: OwnedGame[]
  editedFields: EditableField[]
  /** Set once a draft has been looked up, so an add can be confirmed against real data. */
  preview: OwnedGame | null
  fetching: boolean
  fetchError: string
}>()
const emit = defineEmits<{
  save: [changes: Partial<Record<EditableField, unknown>>]
  add: [game: OwnedGame]
  fetch: [draft: Pick<OwnedGame, 'title' | 'store' | 'platform' | 'playStatus'>]
  invalidate: []
  refetch: [changes: Partial<Record<EditableField, unknown>>]
  remove: []
  close: []
}>()

const adding = computed(() => props.entry === null)
const manual = computed(() => props.sources.every((game) => game.addedManually))

const title = ref(props.entry?.title ?? '')
const store = ref<StoreId>(props.sources[0]?.store ?? 'steam')
const platform = ref<GamePlatform>(props.sources[0]?.platform ?? 'pc')
const played = ref(props.entry?.playStatus === 'played')

const trimmed = computed(() => title.value.trim())
const draft = computed(() => ({
  title: trimmed.value,
  store: store.value,
  platform: platform.value,
  playStatus: (played.value ? 'played' : 'unplayed') as OwnedGame['playStatus']
}))

// Title and store are what the lookup used; platform plays no part in matching, so
// choosing one must not discard a match already fetched.
watch([trimmed, store], () => {
  if (props.preview || props.fetchError) emit('invalidate')
})

const changes = computed<Partial<Record<EditableField, unknown>>>(() => {
  const next: Partial<Record<EditableField, unknown>> = {}
  if (trimmed.value !== (props.entry?.title ?? '')) next.title = trimmed.value
  if (platform.value !== (props.sources[0]?.platform ?? 'pc')) next.platform = platform.value
  return next
})

// Only a match sets a store link; a matched item can still lack cover art.
const matched = computed(() => props.preview?.storeUrl !== undefined)

const facts = computed(() => {
  const game = props.preview ?? props.entry
  return [
    {
      label: 'Metacritic',
      value:
        game?.criticScore === undefined
          ? undefined
          : `${game.criticScore}${game.criticScoreSource === 'pcgamingwiki' ? ' (via PCGamingWiki)' : ''}`
    },
    {
      label: 'Steam reviews',
      value:
        game?.steamReviewPercent === undefined
          ? undefined
          : `${game.steamReviewPercent}% · ${game.steamReviewLabel} (${game.steamReviewCount?.toLocaleString()})`
    },
    { label: 'Released', value: game?.releaseYear?.toString() },
    { label: 'Genres', value: game?.genres.join(', ') || undefined },
    { label: 'Developer', value: game?.developer },
    { label: 'Publisher', value: game?.publisher }
  ]
})

const submitting = ref(false)

function confirmAdd(): void {
  if (!trimmed.value || submitting.value) return
  submitting.value = true
  emit('add', {
    ...(props.preview ?? {}),
    ...draft.value,
    storeGameId: `manual-${crypto.randomUUID()}`,
    ownership: { kind: 'owned' },
    genres: props.preview?.genres ?? []
  } as OwnedGame)
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
        :class="{ edited: editedFields.includes('title') }"
      />
      <p class="field-hint">
        Metadata is matched on this. Correct it, then fetch again if the wrong game was found.
      </p>
    </div>

    <div v-if="adding" class="field">
      <label for="editor-store">Store</label>
      <select id="editor-store" v-model="store">
        <option v-for="id in STORE_IDS" :key="id" :value="id">{{ STORE_LABEL[id] }}</option>
      </select>
    </div>

    <div class="field">
      <label for="editor-platform">Platform</label>
      <select
        id="editor-platform"
        v-model="platform"
        :class="{ edited: editedFields.includes('platform') }"
      >
        <option v-for="id in PLATFORM_IDS" :key="id" :value="id">{{ PLATFORM_LABEL[id] }}</option>
      </select>
      <p class="field-hint">No store reports this, so console titles are set by hand.</p>
    </div>

    <label v-if="adding" class="check">
      <input v-model="played" type="checkbox" /> I have played this
    </label>

    <div class="facts">
      <div v-if="preview && matched" class="preview-head">
        <img v-if="preview.coverUrl" :src="preview.coverUrl" alt="" class="preview-art" />
        <div>
          <strong>{{ preview.title }}</strong>
          <p class="muted field-hint">Matched on the store. Confirm this is the right game.</p>
        </div>
      </div>
      <div v-for="fact in facts" :key="fact.label" class="fact">
        <span class="fact-label">{{ fact.label }}</span>
        <span :class="['fact-value', { missing: !fact.value }]">
          {{ fact.value ?? 'Not fetched' }}
        </span>
      </div>
      <p v-if="fetchError" class="error field-hint">{{ fetchError }}</p>
      <p v-else-if="preview && !matched" class="field-hint">
        No match found for “{{ preview.title }}”. Check the spelling and fetch again, or add
        it without metadata.
      </p>
      <p v-else class="field-hint">
        These come from the store and are not editable — a hand-typed score would not be true.
      </p>
    </div>

    <div class="editor-actions">
      <button
        v-if="adding"
        class="primary"
        :disabled="!trimmed || fetching"
        @click="emit('fetch', draft)"
      >
        {{ fetching ? 'Fetching…' : 'Fetch metadata' }}
      </button>
      <button v-if="adding" :disabled="!trimmed || fetching || submitting" @click="confirmAdd">
        {{ matched ? 'Add this game' : 'Add without metadata' }}
      </button>

      <button v-if="!adding" class="primary" :disabled="!trimmed" @click="emit('save', changes)">
        Save
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
