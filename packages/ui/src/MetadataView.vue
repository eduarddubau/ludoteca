<script setup lang="ts">
import { computed, ref } from 'vue'
import type { OwnedGame } from '@ludoteca/core'
import { useLibrary } from './lib/store'
import MatchPicker from './components/MatchPicker.vue'

const library = useLibrary()
const picking = ref<OwnedGame | null>(null)

const percent = computed(() =>
  library.games.value.length
    ? Math.round((library.resolved.value.length / library.games.value.length) * 100)
    : 0
)

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
          :style="{ width: `${percent}%` }"
        />
      </div>
      <span class="bar-label muted">
        <template v-if="library.progress.value">
          {{ library.progress.value.done }} / {{ library.progress.value.total }} —
          {{ library.progress.value.title }}
        </template>
        <template v-else>{{ percent }}% of {{ library.games.value.length }} have metadata</template>
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
        title="Refresh Steam reviews, and look up Metacritic scores Steam lacks, without matching again"
        @click="library.updateScores()"
      >
        Update scores
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
      class="coverage"
    >
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
        also change over time: <strong>Update scores</strong> refreshes them for the whole library
        in a few requests.
      </p>
      <p class="muted coverage-hint">
        Where Steam shows no Metacritic score, one is looked up on
        <a
          href="https://www.pcgamingwiki.com/"
          target="_blank"
          rel="noreferrer"
        >PCGamingWiki</a>,
        whose editors record it with its Metacritic page (content under
        <a
          href="https://creativecommons.org/licenses/by-nc-sa/3.0/"
          target="_blank"
          rel="noreferrer"
        >CC BY-NC-SA</a>).
        <template v-if="library.scoredViaWiki.value">
          {{ library.scoredViaWiki.value }} of the scores here came from there.
        </template>
        The wiki allows a request a second, so filling a large library takes a few minutes.
      </p>
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
            <td class="cap col-stores">
              {{ game.store }}
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
