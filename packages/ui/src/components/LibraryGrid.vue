<script setup lang="ts">
import type { OwnedGame } from '@ludoteca/core'
import GameTile from './GameTile.vue'

defineProps<{ games: OwnedGame[] }>()
</script>

<template>
  <div v-if="games.length" class="grid">
    <GameTile
      v-for="game in games"
      :key="`${game.store}:${game.storeGameId}`"
      :game="game"
    />
  </div>
  <p v-else class="muted panel">Nothing matches those filters.</p>
</template>
