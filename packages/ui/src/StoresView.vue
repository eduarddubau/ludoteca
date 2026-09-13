<script setup lang="ts">
import { computed } from 'vue'
import {
  canConnect, cooldownSeconds, STORE_PROFILES,
  type StoreConnection, type StoreId
} from '@ludoteca/core'
import { useLibrary } from './lib/store'

const library = useLibrary()

const STATUS_LABEL: Record<StoreConnection['status'], string> = {
  connected: 'Connected',
  disconnected: 'Not connected',
  expired: 'Sign-in expired',
  error: 'Last attempt failed'
}

function connectionFor(store: StoreId): StoreConnection {
  return (
    library.connections.value.get(store) ?? { store, status: 'disconnected' }
  )
}

/** What each store contributed, so a connection's value is visible rather than abstract. */
const ownedByStore = computed(() => {
  const counts = new Map<string, number>()
  for (const game of library.games.value) {
    counts.set(game.store, (counts.get(game.store) ?? 0) + 1)
  }
  return counts
})

function since(iso: string | undefined): string {
  if (!iso) return 'never'
  const hours = Math.round((Date.now() - new Date(iso).getTime()) / 3_600_000)
  if (hours < 1) return 'just now'
  return hours < 24 ? `${hours}h ago` : `${Math.round(hours / 24)}d ago`
}
</script>

<template>
  <div>
    <!-- The trust claim belongs where the decision is made, not in a readme. -->
    <div class="panel trust">
      <p>
        <strong>Signing in happens on each store's own page.</strong>
        Ludoteca opens the store's real sign-in, keeps only the token it hands back, and
        stores that in your operating system's keychain. Your password is never seen,
        typed into, or stored by this app.
      </p>
      <p class="muted">
        Disconnecting removes the token from this machine. Only the store itself can end
        the session for good — on Steam that means deauthorising devices in your account
        settings.
      </p>
    </div>

    <div class="stores">
      <article
        v-for="profile in STORE_PROFILES"
        :key="profile.store"
        class="store-card"
      >
        <div class="store-head">
          <h2>{{ profile.label }}</h2>
          <span :class="['status', connectionFor(profile.store).status]">
            {{ STATUS_LABEL[connectionFor(profile.store).status] }}
          </span>
        </div>

        <p class="muted store-blurb">
          {{ profile.blurb }}
        </p>

        <p class="store-stats muted">
          <template v-if="ownedByStore.get(profile.store)">
            {{ ownedByStore.get(profile.store) }} games in your library
          </template>
          <template v-else>
            No games from here yet
          </template>
          <template v-if="connectionFor(profile.store).accountName">
            · {{ connectionFor(profile.store).accountName }}
          </template>
          · Last synced {{ since(connectionFor(profile.store).lastSyncedAt) }}
        </p>

        <p
          v-if="profile.caveat"
          class="caveat"
        >
          {{ profile.caveat }}
        </p>

        <p
          v-if="connectionFor(profile.store).lastError"
          class="error store-error"
        >
          {{ connectionFor(profile.store).lastError }}
        </p>

        <div class="actions">
          <button
            v-if="connectionFor(profile.store).status !== 'connected'"
            :disabled="
              library.connecting.value !== null || !canConnect(connectionFor(profile.store))
            "
            @click="library.connect(profile.store)"
          >
            <template v-if="library.connecting.value === profile.store">
              Signing in…
            </template>
            <template v-else-if="!canConnect(connectionFor(profile.store))">
              Retry in {{ cooldownSeconds(connectionFor(profile.store)) }}s
            </template>
            <template v-else>
              Connect…
            </template>
          </button>

          <button
            v-if="connectionFor(profile.store).status === 'connected'"
            :disabled="library.connecting.value !== null"
            @click="library.sync(profile.store)"
          >
            <template v-if="library.connecting.value === profile.store">
              Syncing…
            </template>
            <template v-else>
              Sync now
            </template>
          </button>
          <button
            v-if="connectionFor(profile.store).status === 'connected'"
            :disabled="library.connecting.value !== null"
            @click="library.disconnect(profile.store)"
          >
            Disconnect
          </button>
        </div>
      </article>
    </div>
  </div>
</template>
