<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  fromJson, parseCsv, sampleLibrary, suggestMapping, toCsv, toJson,
  type ColumnMapping, type ExportedGame, type ParsedCsv
} from '@ludoteca/core'
import { useLibrary, type WipeScope } from './lib/store'
import MappingPanel from './components/MappingPanel.vue'

const library = useLibrary()
const emit = defineEmits<{ navigate: [tab: 'library'] }>()

const fileInput = ref<HTMLInputElement | null>(null)
const pendingCsv = ref<{ parsed: ParsedCsv; suggested: ColumnMapping } | null>(null)
const importError = ref('')
const imported = ref<number | null>(null)
const exportMenu = ref(false)

const pendingWipe = ref<WipeScope | null>(null)
const typed = ref('')
const wiping = ref(false)
const wipeError = ref('')

const gameCount = computed(() => library.games.value.length)
const customised = computed(() => library.customised.value)
const connections = computed(() => [...library.connections.value.values()])
const withHistory = computed(
  () => connections.value.filter((c) => c.lastSyncedAt || c.lastError || c.accountName).length
)
const signedIn = computed(() => connections.value.filter((c) => c.status === 'connected').length)
const busy = computed(() => library.running.value || library.connecting.value !== null)

const WIPES: { scope: WipeScope; label: string; blurb: string; button: string }[] = [
  {
    scope: 'library',
    label: 'Clear the library',
    blurb:
      'Every game, together with the hidden flags and per-field overrides layered over them. Store sign-ins and sync history are left alone.',
    button: 'Clear library…'
  },
  {
    scope: 'syncHistory',
    label: 'Clear the library and sync history',
    blurb:
      'The above, plus what each store last synced and the account name it reported. You stay signed in, so a sync would pull it all back.',
    button: 'Clear library and history…'
  },
  {
    scope: 'everything',
    label: 'Reset to first run',
    blurb:
      'The above, plus every store token in your operating system keychain. Identical to a fresh install: you would sign in to each store again.',
    button: 'Reset everything…'
  }
]

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

function losses(scope: WipeScope): { count: number; text: string }[] {
  const lines: { count: number; text: string }[] = []
  if (gameCount.value) {
    lines.push({ count: gameCount.value, text: plural(gameCount.value, 'game', 'games') })
  }
  if (customised.value) {
    lines.push({
      count: customised.value,
      text: `your edits and hidden flags on ${plural(customised.value, 'game', 'games')}`
    })
  }
  if (scope !== 'library' && withHistory.value) {
    lines.push({
      count: withHistory.value,
      text: `sync history for ${plural(withHistory.value, 'store', 'stores')}`
    })
  }
  if (scope === 'everything' && signedIn.value) {
    lines.push({ count: signedIn.value, text: plural(signedIn.value, 'store sign-in', 'store sign-ins') })
  }
  return lines
}

const pendingLabel = computed(
  () => WIPES.find((w) => w.scope === pendingWipe.value)?.label ?? ''
)
const pendingLosses = computed(() => (pendingWipe.value ? losses(pendingWipe.value) : []))
// The first number on the list: the game count when there are games, and never a 0 to
// type when the only things left to lose are sync history or a sign-in.
const confirmCount = computed(() => pendingLosses.value[0]?.count ?? 0)
const armed = computed(
  () => pendingLosses.value.length > 0 && typed.value.trim() === String(confirmCount.value)
)

function startWipe(scope: WipeScope): void {
  pendingWipe.value = scope
  typed.value = ''
}

function cancelWipe(): void {
  pendingWipe.value = null
  typed.value = ''
  wipeError.value = ''
}

async function confirmWipe(): Promise<void> {
  const scope = pendingWipe.value
  if (!scope || !armed.value || busy.value) return
  wiping.value = true
  wipeError.value = ''
  try {
    await library.wipe(scope)
    imported.value = null
    cancelWipe()
  } catch (err) {
    wipeError.value = err instanceof Error ? err.message : String(err)
  } finally {
    wiping.value = false
  }
}

async function onFileChosen(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return

  importError.value = ''
  imported.value = null
  try {
    const text = await file.text()
    if (file.name.toLowerCase().endsWith('.json') || text.trimStart().startsWith('[')) {
      await confirmImport(fromJson(text))
      return
    }
    const parsed = parseCsv(text)
    if (!parsed.rows.length) throw new Error('No rows found in that file.')
    pendingCsv.value = { parsed, suggested: suggestMapping(parsed) }
  } catch (err) {
    importError.value = err instanceof Error ? err.message : String(err)
  }
}

async function confirmImport(next: ExportedGame[]): Promise<void> {
  await library.importGames(next)
  imported.value = next.length
  pendingCsv.value = null
}

function download(filename: string, contents: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([contents], { type: mime }))
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

/** Whole library, not the filtered view: a filter silently dropping rows from a backup
 *  — hidden games included — is how a restore comes back short. */
function backup(): ExportedGame[] {
  return library.games.value.map((game) => {
    const user = library.userDataFor(game)
    return {
      ...game,
      hidden: user.hidden,
      ...(Object.keys(user.overrides).length ? { overrides: user.overrides } : {})
    }
  })
}

function exportAs(format: 'csv' | 'json'): void {
  exportMenu.value = false
  const stamp = new Date().toISOString().slice(0, 10)
  if (format === 'csv') {
    download(`ludoteca-${stamp}.csv`, toCsv(backup()), 'text/csv;charset=utf-8')
  } else {
    download(`ludoteca-${stamp}.json`, toJson(backup()), 'application/json')
  }
}
</script>

<template>
  <div>
    <p class="muted count">
      {{ gameCount }} games · {{ customised }} with your edits ·
      {{ signedIn }} of {{ connections.length }} stores signed in
    </p>

    <div class="settings-columns">
      <section>
        <h2 class="section">
          Data
        </h2>

        <div class="setting">
          <div class="setting-text">
            <strong>Import</strong>
            <p class="muted">
              A CSV or JSON file. Columns are matched by name and by what they contain, and
              you confirm the mapping before anything is written. Importing replaces synced
              rows but keeps your edits and anything added by hand.
            </p>
          </div>
          <div class="setting-actions">
            <button
              :disabled="busy"
              @click="fileInput?.click()"
            >
              Import…
            </button>
          </div>
        </div>

        <div class="setting">
          <div class="setting-text">
            <strong>Export</strong>
            <p class="muted">
              A full backup, not a summary: every field, plus hidden flags and per-field
              overrides, so importing it back restores the library as it stands. Hidden games
              are included.
            </p>
          </div>
          <div class="setting-actions">
            <div class="menu-anchor">
              <button
                :disabled="!gameCount"
                @click="exportMenu = !exportMenu"
              >
                Export… ({{ gameCount }})
              </button>
              <div
                v-if="exportMenu"
                class="menu-backdrop"
                @click="exportMenu = false"
              />
              <div
                v-if="exportMenu"
                class="menu"
              >
                <button @click="exportAs('csv')">
                  CSV
                </button>
                <button @click="exportAs('json')">
                  JSON
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="setting">
          <div class="setting-text">
            <strong>Sample data</strong>
            <p class="muted">
              A handful of games to see the layout with. It replaces the whole library, so it
              is only offered while there is nothing to lose.
            </p>
          </div>
          <div class="setting-actions">
            <button
              :disabled="gameCount > 0 || busy"
              @click="library.replaceAll(sampleLibrary())"
            >
              Load sample data
            </button>
          </div>
        </div>

        <input
          ref="fileInput"
          type="file"
          accept=".csv,.json,text/csv,application/json"
          hidden
          @change="onFileChosen"
        >

        <p
          v-if="importError"
          class="panel error"
        >
          {{ importError }}
        </p>

        <div
          v-if="imported !== null"
          class="panel imported"
        >
          <span>Imported {{ imported }} rows.</span>
          <button @click="emit('navigate', 'library')">
            View library
          </button>
        </div>

        <MappingPanel
          v-if="pendingCsv"
          :parsed="pendingCsv.parsed"
          :suggested="pendingCsv.suggested"
          @confirm="confirmImport"
          @cancel="pendingCsv = null"
        />
      </section>
      <section>
        <h2 class="section">
          Delete
        </h2>
        <p class="muted">
          None of these can be undone, and none of them touch your stores — a cleared library
          is gone from this machine only. Export a backup first if you might want it back.
        </p>
        <p
          v-if="busy"
          class="panel muted"
        >
          A metadata run or store sync is in progress. Importing and deleting wait until it
          finishes, since it would write back rows from before.
        </p>

        <div
          v-for="wipe in WIPES"
          :key="wipe.scope"
          class="setting"
        >
          <div class="setting-text">
            <strong>{{ wipe.label }}</strong>
            <p class="muted">
              {{ wipe.blurb }}
            </p>
          </div>
          <div class="setting-actions">
            <button
              class="danger"
              :disabled="!losses(wipe.scope).length || pendingWipe !== null || busy"
              @click="startWipe(wipe.scope)"
            >
              <template v-if="!losses(wipe.scope).length">
                Nothing to clear
              </template>
              <template v-else>
                {{ wipe.button }}
              </template>
            </button>
          </div>
        </div>

        <div
          v-if="pendingWipe"
          class="panel wipe-confirm"
        >
          <p class="wipe-title">
            <strong>{{ pendingLabel }}</strong> — this cannot be undone.
          </p>
          <p class="muted">
            This deletes:
          </p>
          <ul class="wipe-losses">
            <li
              v-for="line in pendingLosses"
              :key="line.text"
            >
              {{ line.text }}
            </li>
          </ul>

          <div class="wipe-gate">
            <button
              :disabled="!gameCount"
              @click="exportAs('json')"
            >
              Export a backup first
            </button>
            <label for="wipe-gate">Type {{ confirmCount }} to confirm</label>
            <input
              id="wipe-gate"
              v-model="typed"
              type="text"
              inputmode="numeric"
              autocomplete="off"
            >
            <button
              :disabled="wiping"
              @click="cancelWipe"
            >
              Cancel
            </button>
            <button
              class="danger"
              :disabled="!armed || wiping || busy"
              @click="confirmWipe"
            >
              <template v-if="wiping">
                Deleting…
              </template>
              <template v-else>
                Delete permanently
              </template>
            </button>
          </div>
          <p
            v-if="wipeError"
            class="error"
          >
            {{ wipeError }}
          </p>
        </div>
      </section>
    </div>
  </div>
</template>
