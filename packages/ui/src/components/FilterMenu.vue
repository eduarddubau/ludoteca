<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{
  label: string
  options: [string, number][]
  selected: Set<string>
}>()
const emit = defineEmits<{ toggle: [value: string]; clear: [] }>()

const open = ref(false)
const query = ref('')

// A developer list runs to hundreds of one-game studios, so long lists get a search box.
const searchable = computed(() => props.options.length > 20)

const shown = computed(() => {
  const needle = query.value.trim().toLowerCase()
  if (!needle) return props.options
  return props.options.filter(([name]) => name.toLowerCase().includes(needle))
})
</script>

<template>
  <div class="menu-anchor">
    <button :class="{ on: selected.size > 0 }" @click="open = !open">
      {{ label }}<template v-if="selected.size">: {{ selected.size }}</template>
    </button>

    <div v-if="open" class="menu-backdrop" @click="open = false" />
    <div v-if="open" class="menu menu-scroll">
      <input
        v-if="searchable"
        v-model="query"
        type="search"
        class="menu-search"
        :placeholder="`Search ${label.toLowerCase()}…`"
      />
      <button v-if="selected.size" class="menu-clear" @click="emit('clear')">
        Clear selection
      </button>

      <button
        v-for="[name, count] in shown"
        :key="name"
        :class="{ on: selected.has(name) }"
        @click="emit('toggle', name)"
      >
        <span class="menu-name">{{ name }}</span>
        <span class="muted">{{ count }}</span>
      </button>

      <p v-if="!shown.length" class="muted menu-empty">Nothing matches that search.</p>
    </div>
  </div>
</template>
