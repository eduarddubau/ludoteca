<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{ percent?: number; count?: number; label?: string; verdict?: string }>()

// Steam's own cut-offs: Mostly Positive starts at 70%, Mixed at 40%.
const band = computed(() => {
  if (props.percent === undefined) return 'none'
  return props.percent >= 70 ? 'good' : props.percent >= 40 ? 'mixed' : 'bad'
})
const title = computed(() =>
  props.percent === undefined
    ? 'No Steam review score'
    : `Steam reviews: ${props.verdict}, ${props.percent}% of ${props.count?.toLocaleString()} recommend it`
)
</script>

<template>
  <span
    class="rating"
    :class="band"
    :title="title"
  >
    <span
      v-if="label"
      class="rating-label"
    >{{ label }}</span>
    <span class="rating-value">{{ percent === undefined ? '–' : `${percent}%` }}</span>
  </span>
</template>
