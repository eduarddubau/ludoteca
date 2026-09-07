<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  STORE_IDS, type EditableField, type LibraryEntry, type OwnedGame, type StoreId
} from '@ludoteca/core'

const props = defineProps<{
  /** Null when adding rather than editing. */
  entry: LibraryEntry | null
  sources: OwnedGame[]
  editedFields: EditableField[]
}>()
const emit = defineEmits<{
  save: [changes: Partial<Record<EditableField, unknown>>]
  add: [game: Pick<OwnedGame, 'title' | 'store' | 'playStatus'>]
  remove: []
  close: []
}>()

const adding = computed(() => props.entry === null)
const manual = computed(() => props.sources.every((game) => game.addedManually))

const title = ref(props.entry?.title ?? '')
const store = ref<StoreId>(props.sources[0]?.store ?? 'steam')
const played = ref(props.entry?.playStatus === 'played')
const releaseYear = ref(props.entry?.releaseYear?.toString() ?? '')
const developer = ref(props.entry?.developer ?? '')
const publisher = ref(props.entry?.publisher ?? '')
const criticScore = ref(props.entry?.criticScore?.toString() ?? '')
const genres = ref(props.entry?.genres.join(', ') ?? '')
const coverUrl = ref(props.entry?.coverUrl ?? '')

const isEdited = (field: EditableField): boolean => props.editedFields.includes(field)

function submit(): void {
  if (!title.value.trim()) return

  if (adding.value) {
    emit('add', {
      title: title.value.trim(),
      store: store.value,
      playStatus: played.value ? 'played' : 'unplayed'
    })
    return
  }

  // Only fields whose value actually moved become overrides. Sending them all would pin
  // every field on the first save and freeze it against later refetches — the exact thing
  // per-field overrides exist to avoid.
  const changes: Partial<Record<EditableField, unknown>> = {}
  const changed = (field: EditableField, next: unknown, before: unknown): void => {
    if (next !== before) changes[field] = next
  }

  changed('title', title.value.trim(), props.entry?.title ?? '')
  changed('genres', genres.value.split(',').map((g) => g.trim()).filter(Boolean).join(', '),
    props.entry?.genres.join(', ') ?? '')
  changed('developer', developer.value.trim(), props.entry?.developer ?? '')
  changed('publisher', publisher.value.trim(), props.entry?.publisher ?? '')
  changed('releaseYear', releaseYear.value, props.entry?.releaseYear?.toString() ?? '')
  changed('criticScore', criticScore.value, props.entry?.criticScore?.toString() ?? '')
  changed('coverUrl', coverUrl.value.trim(), props.entry?.coverUrl ?? '')

  // Re-typed at the edge, so the comparison above can stay a plain string compare.
  if ('genres' in changes) {
    changes.genres = genres.value.split(',').map((g) => g.trim()).filter(Boolean)
  }
  if ('releaseYear' in changes) {
    changes.releaseYear = releaseYear.value ? Number(releaseYear.value) : undefined
  }
  if ('criticScore' in changes) {
    changes.criticScore = criticScore.value ? Number(criticScore.value) : undefined
  }

  emit('save', changes)
}
</script>

<template>
  <div class="panel editor">
    <p class="editor-head">
      <strong>{{ adding ? 'Add a game' : entry?.title }}</strong>
      <span v-if="!adding && manual" class="muted"> — added by hand</span>
    </p>

    <div class="mapping">
      <div class="row">
        <label>Title</label>
        <input v-model="title" type="text" :class="{ edited: isEdited('title') }" />
      </div>

      <template v-if="adding">
        <div class="row">
          <label>Store</label>
          <select v-model="store">
            <option v-for="id in STORE_IDS" :key="id" :value="id">{{ id }}</option>
          </select>
        </div>
        <div class="row">
          <label>Played</label>
          <input v-model="played" type="checkbox" />
        </div>
      </template>

      <template v-else>
        <div class="row">
          <label>Genres</label>
          <input v-model="genres" type="text" placeholder="comma separated"
                 :class="{ edited: isEdited('genres') }" />
        </div>
        <div class="row">
          <label>Developer</label>
          <input v-model="developer" type="text" :class="{ edited: isEdited('developer') }" />
        </div>
        <div class="row">
          <label>Publisher</label>
          <input v-model="publisher" type="text" :class="{ edited: isEdited('publisher') }" />
        </div>
        <div class="row">
          <label>Release year</label>
          <input v-model="releaseYear" type="number" :class="{ edited: isEdited('releaseYear') }" />
        </div>
        <div class="row">
          <label>Score</label>
          <input v-model="criticScore" type="number" min="0" max="100"
                 :class="{ edited: isEdited('criticScore') }" />
        </div>
        <div class="row">
          <label>Cover URL</label>
          <input v-model="coverUrl" type="text" :class="{ edited: isEdited('coverUrl') }" />
        </div>
      </template>
    </div>

    <p v-if="!adding" class="muted hint">
      Edited fields are outlined. Clearing one returns it to whatever a fetch last found —
      untouched fields keep updating on a refetch.
    </p>

    <div class="actions">
      <button :disabled="!title.trim()" @click="submit">
        {{ adding ? 'Add game' : 'Save changes' }}
      </button>
      <button @click="emit('close')">Cancel</button>
      <button v-if="!adding && manual" class="danger" @click="emit('remove')">
        Delete permanently
      </button>
    </div>
  </div>
</template>
