<script setup lang="ts">
import { ref } from 'vue'

const props = defineProps<{
  title: string
}>()

const isHovered = ref(false)
const titleRef = ref<HTMLElement | null>(null)

function onMouseEnter() {
  isHovered.value = true
}

function onMouseLeave() {
  isHovered.value = false
}
</script>

<template>
  <div class="relative">
    <div
      ref="titleRef"
      class="relative max-w-64 cursor-pointer px-3 py-2 rounded-lg transition-colors"
      :class="isHovered ? 'bg-surface-container-high' : 'hover:bg-surface-container-high'"
      @mouseenter="onMouseEnter"
      @mouseleave="onMouseLeave"
    >
      <span
        class="block truncate text-sm font-medium text-on-surface"
        :title="props.title"
      >
        {{ props.title || '新建会话' }}
      </span>

      <!-- Tooltip：固定在标题左下方 -->
      <Teleport to="body">
        <div
          v-if="isHovered && props.title"
          class="fixed z-[100] bg-surface-container-highest border border-outline-variant/20 rounded-lg px-3 py-2 text-xs text-on-surface shadow-xl max-w-48 pointer-events-none"
          :style="{
            left: titleRef ? titleRef.getBoundingClientRect().left + 'px' : '0',
            top: titleRef ? (titleRef.getBoundingClientRect().bottom + 4) + 'px' : '0',
          }"
        >
          {{ props.title }}
        </div>
      </Teleport>
    </div>
  </div>
</template>
