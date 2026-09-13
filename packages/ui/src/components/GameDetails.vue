<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  entryMetacriticLink, metacriticLink, pcgamingwikiPage, PLATFORM_IDS, PLATFORM_LABEL,
  SHELF_LABEL, sourceLink, steamAppId, steamPage, STORE_IDS, STORE_LABEL,
  type EditableField, type GamePlatform, type LibraryEntry, type OwnedGame, type StoreId
} from '@ludoteca/core'
import { sourceLabel } from '../lib/links'
import ReviewChip from './ReviewChip.vue'
import ScoreChip from './ScoreChip.vue'

const props = defineProps<{
  /** Null when adding rather than viewing an existing game. */
  entry: LibraryEntry | null
  sources: OwnedGame[]
  editedFields: EditableField[]
  /** Set once a draft has been looked up, so an add can be confirmed against real data. */
  preview: OwnedGame | null
  fetching: boolean
  fetchError: string
  /** Whether the entry is currently hidden, which decides between Hide and Unhide. */
  hidden?: boolean
}>()
const emit = defineEmits<{
  save: [changes: Partial<Record<EditableField, unknown>>]
  add: [game: OwnedGame]
  fetch: [draft: Pick<OwnedGame, 'title' | 'store' | 'platform' | 'playStatus'>]
  invalidate: []
  refetch: [changes: Partial<Record<EditableField, unknown>>]
  remove: []
  hide: []
  close: []
}>()

const adding = computed(() => props.entry === null)
const manual = computed(() => props.sources.every((game) => game.addedManually))

// An existing game opens read-only; Edit turns its title and platform into fields in place.
const editing = ref(adding.value)

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

// Only a match sets a Steam app; a matched item can still lack cover art.
const matched = computed(() => props.preview?.steamAppId !== undefined)

/** What the page describes: the fetched draft while adding, the library entry otherwise. */
const shown = computed(() => props.preview ?? props.entry)

const heading = computed(() =>
  adding.value ? (props.preview?.title ?? (trimmed.value || 'New game')) : (props.entry?.title ?? '')
)
const byline = computed(() =>
  [shown.value?.releaseYear, shown.value?.developer].filter((part) => part !== undefined).join(' · ')
)

const metacritic = computed(() => {
  if (props.entry) return entryMetacriticLink(props.entry)
  return props.preview ? metacriticLink(props.preview) : null
})

const appId = computed(() =>
  (props.preview ? [props.preview] : props.sources)
    .map(steamAppId)
    .find((value) => value !== undefined)
)
const steamReviewsUrl = computed(() =>
  appId.value === undefined ? null : `${steamPage(appId.value)}/#app_reviews_hash`
)

/** Reference pages, each named for the site it opens rather than the store the game is owned on. */
const links = computed(() =>
  appId.value === undefined
    ? []
    : [
        { label: 'Steam page', url: steamPage(appId.value) },
        { label: 'PCGamingWiki', url: pcgamingwikiPage(appId.value) }
      ]
)

const about = computed(() => [
  { label: 'Developer', value: shown.value?.developer },
  { label: 'Publisher', value: shown.value?.publisher },
  { label: 'Released', value: shown.value?.releaseYear?.toString() },
  { label: 'Genres', value: shown.value?.genres.join(', ') || undefined }
])

const hours = (minutes: number | undefined): string | null =>
  minutes === undefined ? null : `${Math.round(minutes / 60)}h`

const titleInput = ref<HTMLInputElement | null>(null)

async function startEditing(): Promise<void> {
  editing.value = true
  await nextTick()
  titleInput.value?.focus()
}

function cancelEditing(): void {
  title.value = props.entry?.title ?? ''
  platform.value = props.sources[0]?.platform ?? 'pc'
  editing.value = false
}

const confirmingDelete = ref(false)
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

// Return does what the highlighted button does: fetch and then add while adding, save while editing.
function submit(): void {
  if (!trimmed.value) return
  if (adding.value) {
    if (matched.value) confirmAdd()
    else if (!props.fetching) emit('fetch', draft.value)
  } else if (editing.value) {
    emit('save', changes.value)
  }
}
</script>

<template>
  <form
    class="details"
    @submit.prevent="submit"
  >
    <header class="details-head">
      <img
        v-if="shown?.coverUrl"
        :src="shown.coverUrl"
        alt=""
        class="details-art"
      >
      <div
        v-else
        class="details-art"
        aria-hidden="true"
      />
      <div class="details-heading">
        <p class="details-kicker">
          {{ adding ? 'Add a game' : editing ? 'Editing' : 'Game details' }}
        </p>
        <h2 class="details-title">
          {{ heading }}
        </h2>
        <p
          v-if="byline"
          class="details-byline"
        >
          {{ byline }}
        </p>
        <p
          v-if="!adding && (manual || editedFields.length || hidden)"
          class="details-tags"
        >
          <span
            v-if="manual"
            class="tag"
          >Added by hand</span>
          <span
            v-if="editedFields.length"
            class="tag"
          >Edited by you</span>
          <span
            v-if="hidden"
            class="tag"
          >Hidden</span>
        </p>
        <p
          v-if="adding && matched"
          class="field-hint"
        >
          Matched on the store. Confirm this is the right game.
        </p>
      </div>
      <button
        type="button"
        class="details-close"
        aria-label="Close"
        title="Close"
        @click="emit('close')"
      >
        ✕
      </button>
    </header>

    <section
      v-if="editing"
      class="details-section"
    >
      <h3>{{ adding ? 'Game' : 'Correct this game' }}</h3>
      <div class="field">
        <label for="details-title">Title</label>
        <input
          id="details-title"
          ref="titleInput"
          v-model="title"
          type="text"
          class="input-title"
          autocomplete="off"
          placeholder="Exact title, as the store spells it"
          :class="{ edited: editedFields.includes('title') }"
        >
        <p class="field-hint">
          Metadata is matched on this. Correct it, then fetch again if the wrong game was found.
        </p>
      </div>
      <div
        v-if="adding"
        class="field"
      >
        <label for="details-store">Store</label>
        <select
          id="details-store"
          v-model="store"
          class="input-short"
        >
          <option
            v-for="id in STORE_IDS"
            :key="id"
            :value="id"
          >
            {{ STORE_LABEL[id] }}
          </option>
        </select>
      </div>
      <div class="field">
        <label for="details-platform">Platform</label>
        <select
          id="details-platform"
          v-model="platform"
          class="input-short"
          :class="{ edited: editedFields.includes('platform') }"
        >
          <option
            v-for="id in PLATFORM_IDS"
            :key="id"
            :value="id"
          >
            {{ PLATFORM_LABEL[id] }}
          </option>
        </select>
        <p class="field-hint">
          No store reports this, so console titles are set by hand.
        </p>
      </div>
      <label
        v-if="adding"
        class="check"
      >
        <input
          v-model="played"
          type="checkbox"
        > I have played this
      </label>
      <p
        v-if="fetchError"
        class="error field-hint"
      >
        {{ fetchError }}
      </p>
      <p
        v-else-if="adding && preview && !matched"
        class="field-hint"
      >
        No match found for “{{ preview.title }}”. Check the spelling and fetch again, or add it
        without metadata.
      </p>
    </section>

    <section
      v-if="shown && (!adding || matched)"
      class="details-section"
    >
      <h3>Scores</h3>
      <div class="details-score">
        <ScoreChip
          v-if="metacritic"
          label="Metacritic"
          :score="shown.criticScore"
          :href="metacritic.url"
          :exact="metacritic.exact"
          :source="shown.criticScoreSource"
        />
        <span class="muted">
          <template v-if="shown.criticScore === undefined">No score found</template>
          <template v-else-if="shown.criticScoreSource === 'pcgamingwiki'">via PCGamingWiki</template>
          <template v-else>via Steam</template>
        </span>
        <a
          v-if="metacritic"
          class="ext-link"
          :href="metacritic.url"
          target="_blank"
          rel="noreferrer"
        >
          {{ metacritic.exact ? 'Metacritic page' : 'Search Metacritic' }} ↗
        </a>
      </div>

      <div class="details-score">
        <ReviewChip
          label="Steam"
          :percent="shown.steamReviewPercent"
          :count="shown.steamReviewCount"
          :verdict="shown.steamReviewLabel"
        />
        <span class="muted">
          <template v-if="shown.steamReviewPercent === undefined">No Steam review score</template>
          <template v-else>
            {{ shown.steamReviewLabel }} · {{ shown.steamReviewCount?.toLocaleString() }} reviews
          </template>
        </span>
        <a
          v-if="steamReviewsUrl"
          class="ext-link"
          :href="steamReviewsUrl"
          target="_blank"
          rel="noreferrer"
        >
          Reviews on Steam ↗
        </a>
      </div>
    </section>

    <section
      v-if="shown && (!adding || matched)"
      class="details-section"
    >
      <h3>About <span class="details-note">from the store, not editable</span></h3>
      <dl class="details-list">
        <template
          v-for="row in about"
          :key="row.label"
        >
          <dt>{{ row.label }}</dt>
          <dd :class="{ missing: !row.value }">
            {{ row.value ?? 'Not fetched' }}
          </dd>
        </template>
        <template v-if="adding && links.length">
          <dt>Links</dt>
          <dd class="details-stores">
            <a
              v-for="link in links"
              :key="link.label"
              class="ext-link"
              :href="link.url"
              target="_blank"
              rel="noreferrer"
            >
              {{ link.label }} ↗
            </a>
          </dd>
        </template>
      </dl>
    </section>

    <section
      v-if="entry"
      class="details-section"
    >
      <h3>In your library</h3>
      <dl class="details-list">
        <template v-if="!editing">
          <dt>Platform</dt>
          <dd>
            {{ PLATFORM_LABEL[platform] }}
            <span
              v-if="editedFields.includes('platform')"
              class="details-note"
            >set by you</span>
          </dd>
        </template>
        <dt>Shelf</dt>
        <dd>
          {{ SHELF_LABEL[entry.shelf] }}
          <template v-if="hours(entry.playtimeMinutes)">
            · {{ hours(entry.playtimeMinutes) }} played
          </template>
        </dd>
        <dt>Owned on</dt>
        <dd class="details-stores">
          <span
            v-for="source in entry.sources"
            :key="`${source.store}:${source.storeGameId}`"
          >
            <a
              v-if="sourceLink(source, entry.title).exact"
              class="ext-link"
              :href="sourceLink(source, entry.title).url"
              target="_blank"
              rel="noreferrer"
              :title="`${sourceLabel(source)} store page`"
            >
              {{ sourceLabel(source) }} ↗
            </a>
            <template v-else>{{ sourceLabel(source) }}</template>
            <span
              v-if="entry.sources.length > 1 && hours(source.playtimeMinutes)"
              class="muted"
            >
              {{ hours(source.playtimeMinutes) }}
            </span>
          </span>
        </dd>
        <template v-if="links.length">
          <dt>Links</dt>
          <dd class="details-stores">
            <a
              v-for="link in links"
              :key="link.label"
              class="ext-link"
              :href="link.url"
              target="_blank"
              rel="noreferrer"
            >
              {{ link.label }} ↗
            </a>
          </dd>
        </template>
      </dl>
    </section>

    <footer class="details-actions">
      <template v-if="!adding && !editing">
        <template v-if="!confirmingDelete">
          <button
            type="button"
            @click="emit('hide')"
          >
            {{ hidden ? 'Unhide' : 'Hide' }}
          </button>
          <button
            v-if="manual"
            type="button"
            class="danger"
            @click="confirmingDelete = true"
          >
            Delete…
          </button>
        </template>
        <template v-else>
          <span class="details-confirm">Delete this game permanently?</span>
          <button
            type="button"
            @click="confirmingDelete = false"
          >
            Keep
          </button>
          <button
            type="button"
            class="danger"
            @click="emit('remove')"
          >
            Delete
          </button>
        </template>
      </template>
      <span class="grow" />

      <template v-if="adding">
        <button
          type="button"
          @click="emit('close')"
        >
          Cancel
        </button>
        <button
          type="button"
          :class="{ primary: !matched }"
          :disabled="!trimmed || fetching"
          @click="emit('fetch', draft)"
        >
          {{ fetching ? 'Fetching…' : 'Fetch metadata' }}
        </button>
        <button
          type="button"
          :class="{ primary: matched }"
          :disabled="!trimmed || fetching || submitting"
          @click="confirmAdd"
        >
          {{ matched ? 'Add this game' : 'Add without metadata' }}
        </button>
      </template>
      <template v-else-if="editing">
        <button
          type="button"
          @click="cancelEditing"
        >
          Cancel
        </button>
        <button
          type="button"
          :disabled="!trimmed"
          @click="emit('refetch', changes)"
        >
          {{ Object.keys(changes).length ? 'Save and fetch metadata' : 'Fetch metadata' }}
        </button>
        <button
          type="submit"
          class="primary"
          :disabled="!trimmed"
        >
          Save
        </button>
      </template>
      <template v-else-if="!confirmingDelete">
        <button
          type="button"
          @click="emit('refetch', {})"
        >
          Fetch metadata
        </button>
        <button
          type="button"
          class="primary"
          @click="startEditing"
        >
          Edit
        </button>
      </template>
    </footer>
  </form>
</template>
