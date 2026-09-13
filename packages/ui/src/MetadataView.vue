<script setup lang="ts">
import { computed, ref } from 'vue'
import { STORE_LABEL, type OwnedGame } from '@ludoteca/core'
import { useLibrary } from './lib/store'
import MatchPicker from './components/MatchPicker.vue'
import { clock, roughly, timeLeft } from './lib/time'

const library = useLibrary()
const picking = ref<OwnedGame | null>(null)

const percent = computed(() =>
  library.games.value.length
    ? Math.round((library.resolved.value.length / library.games.value.length) * 100)
    : 0
)

// While a run is going the bar is that run's progress; otherwise it is the library's coverage.
const barPercent = computed(() => {
  const status = library.runStatus.value
  if (!status) return percent.value
  return status.total ? Math.round((status.done / status.total) * 100) : 0
})

async function applyPick(appId: number): Promise<void> {
  const target = picking.value
  if (!target) return
  await library.applyMatch(target, appId)
  picking.value = null
}
</script>

<template>
  <div>
    <p class="muted count">
      {{ library.resolved.value.length }} resolved ·
      {{ library.unresolved.value.length }} need a manual match ·
      {{ library.untried.value.length }} not yet looked up
    </p>

    <!-- One line that always says where the run is, whether or not it is running. -->
    <div class="statusbar">
      <div class="bar">
        <div
          class="bar-fill"
          :style="{ width: `${barPercent}%` }"
        />
      </div>
      <span
        v-if="library.runStatus.value"
        class="bar-label"
      >
        <span class="bar-main">
          <strong>{{ library.runStatus.value.phase }}</strong>
          · {{ library.runStatus.value.done }} / {{ library.runStatus.value.total }}
          · {{ timeLeft(library.runStatus.value.secondsLeft) }}
        </span>
        <span class="bar-detail muted">
          <template v-if="library.runStatus.value.counts">
            {{ library.runStatus.value.counts.foundCount }} {{ library.runStatus.value.counts.found }} ·
            {{ library.runStatus.value.counts.missedCount }} {{ library.runStatus.value.counts.missed }} ·
          </template>
          {{ clock(library.runStatus.value.elapsedSeconds) }} elapsed
          <template v-if="library.runStatus.value.title">· {{ library.runStatus.value.title }}</template>
        </span>
      </span>
      <span
        v-else
        class="bar-label muted"
      >
        {{ library.resolved.value.length }} / {{ library.games.value.length }} have metadata
      </span>

      <button
        v-if="library.untried.value.length && !library.running.value"
        @click="library.enrich(library.games.value, false, true)"
      >
        Fetch missing ({{ library.untried.value.length }})
      </button>
      <button
        v-if="!library.running.value"
        @click="library.enrich(library.games.value, true, true)"
      >
        Refetch all ({{ library.games.value.length }})
      </button>
      <button
        v-if="!library.running.value && library.games.value.length"
        title="Refresh every game's Steam review score without searching again"
        @click="library.updateReviews()"
      >
        Update Steam reviews
      </button>
      <button
        v-if="library.running.value"
        @click="library.stop()"
      >
        Stop
      </button>
    </div>

    <p
      v-if="library.enrichError.value"
      class="panel error"
    >
      {{ library.enrichError.value }}
    </p>

    <div
      v-if="library.games.value.length"
      class="meta-cards"
    >
      <div class="coverage">
        <div
          v-for="field in library.coverage.value"
          :key="field.label"
          class="coverage-row"
        >
          <span class="coverage-label">{{ field.label }}</span>
          <div class="bar">
            <div
              class="bar-fill"
              :style="{ width: `${field.total ? (field.count / field.total) * 100 : 0}%` }"
            />
          </div>
          <span class="muted coverage-count">{{ field.count }} / {{ field.total }}</span>
        </div>
        <p class="muted coverage-hint">
          A field added after a run leaves earlier rows without it. Those rows already count
          as looked up, so <strong>Refetch all</strong> is what backfills them —
          <em>Fetch missing</em> will skip them.
        </p>
        <p class="muted coverage-hint">
          Steam reviews are the share of players who recommend a game, and run above Metacritic's
          critic scores, so the two are kept apart rather than one filling in for the other. They
          also change over time: <strong>Update Steam reviews</strong> refreshes them for the whole
          library in a few requests.
        </p>
      </div>

      <section class="panel optional-pass">
        <div class="optional-head">
          <h2 class="section">
            Fill gaps from PCGamingWiki
          </h2>
          <span class="tag">Optional</span>
        </div>
        <p class="muted">
          Not needed for anything else in the library. Steam has no Metacritic score for some games
          Metacritic has rated, and no Epic or GOG store page for games you own there. This looks each
          of those games up on
          <a
            href="https://www.pcgamingwiki.com/"
            target="_blank"
            rel="noreferrer"
          >PCGamingWiki</a>
          and fills in what its editors have recorded: the Metacritic score with the page it came
          from, and the store page for the store you own the game on. It only fills empty fields and
          never replaces anything.
        </p>
        <p
          v-if="library.wikiPass.value.apps"
          class="optional-estimate"
        >
          {{ library.wikiPass.value.apps }} of your games haven't been checked and could gain something.
          The wiki allows about one request a second, so this would take
          <strong>{{ roughly(library.wikiPass.value.seconds) }}</strong>. It can be stopped at any
          point, and keeps what it found.
        </p>
        <p
          v-else
          class="muted"
        >
          Nothing left to look up: every matched game has its score and store page, or has already
          been checked. A single game can be checked again from its details.
        </p>
        <p class="muted optional-credit">
          Wiki content is under
          <a
            href="https://creativecommons.org/licenses/by-nc-sa/3.0/"
            target="_blank"
            rel="noreferrer"
          >CC BY-NC-SA</a>.
          <template v-if="library.scoredViaWiki.value">
            {{ library.scoredViaWiki.value }} of the Metacritic scores here came from it.
          </template>
        </p>
        <button
          v-if="library.wikiPass.value.apps"
          :disabled="library.running.value"
          @click="library.fillFromWiki()"
        >
          Look up {{ library.wikiPass.value.apps }} games on PCGamingWiki
          ({{ roughly(library.wikiPass.value.seconds) }})
        </button>
      </section>
    </div>

    <div
      v-if="picking"
      class="panel"
    >
      <p>
        <strong>{{ picking.title }}</strong>
        <span class="muted"> — pick the right game, or skip it</span>
      </p>
      <MatchPicker
        :game="picking"
        @pick="applyPick"
        @skip="picking = null"
      />
    </div>

    <h2
      v-if="library.unresolved.value.length"
      class="section"
    >
      Needs a manual match ({{ library.unresolved.value.length }})
    </h2>
    <p
      v-if="library.unresolved.value.length"
      class="muted"
    >
      Steam had no confident match for these, so they were left alone rather than guessed at.
    </p>

    <div
      v-if="library.unresolved.value.length"
      class="table-wrap"
    >
      <table>
        <tbody>
          <tr
            v-for="game in library.unresolved.value"
            :key="`${game.store}:${game.storeGameId}`"
          >
            <td>{{ game.title }}</td>
            <td class="col-stores">
              {{ STORE_LABEL[game.store] }}
            </td>
            <td class="col-hours">
              <button @click="picking = game">
                Find match…
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p
      v-else-if="!library.untried.value.length && library.games.value.length"
      class="muted panel"
    >
      Everything has been looked up, and nothing needs resolving by hand.
    </p>
    <p
      v-else-if="!library.games.value.length"
      class="muted panel"
    >
      Import a library from Settings first — there is nothing to fetch metadata for yet.
    </p>
  </div>
</template>
