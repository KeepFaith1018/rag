<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useChatStore } from '@/stores/chat'
import HistoryDropdown from './HistoryDropdown.vue'

const chatStore = useChatStore()
const showDropdown = ref(false)
const containerRef = ref<HTMLElement | null>(null)

function toggleDropdown() {
  showDropdown.value = !showDropdown.value
}

function closeDropdown() {
  showDropdown.value = false
}

function handleClickOutside(e: MouseEvent) {
  if (containerRef.value && !containerRef.value.contains(e.target as Node)) {
    closeDropdown()
  }
}

onMounted(() => document.addEventListener('click', handleClickOutside))
onBeforeUnmount(() => document.removeEventListener('click', handleClickOutside))

async function handleNewChat() {
  await chatStore.createSession()
  closeDropdown()
}

async function handleSelectSession(sessionId: string) {
  await chatStore.selectSession(sessionId)
  closeDropdown()
}

async function handleRename(sessionId: string, title: string) {
  await chatStore.renameSession(sessionId, title)
}

async function handleDelete(sessionId: string) {
  await chatStore.removeSession(sessionId)
}
</script>

<template>
  <div ref="containerRef" class="relative flex items-center gap-1">
    <!-- 历史会话按钮 -->
    <button
      class="p-2.5 rounded-lg transition-colors"
      :class="showDropdown ? 'bg-surface-container-high' : 'hover:bg-surface-container-high'"
      :title="'历史会话'"
      @click="toggleDropdown"
    >
      <span class="material-symbols-outlined text-xl text-on-surface-variant">history</span>
    </button>

    <!-- 下拉面板 -->
    <HistoryDropdown
      v-if="showDropdown"
      :sessions="chatStore.sessions"
      :current-session-id="chatStore.currentSession?.id"
      @select="handleSelectSession"
      @rename="handleRename"
      @delete="handleDelete"
    />

    <!-- 新建会话按钮 -->
    <button
      class="p-2.5 rounded-lg hover:bg-surface-container-high transition-colors"
      :title="'新建会话'"
      @click="handleNewChat"
    >
      <span class="material-symbols-outlined text-xl text-on-surface-variant">add</span>
    </button>
  </div>
</template>
