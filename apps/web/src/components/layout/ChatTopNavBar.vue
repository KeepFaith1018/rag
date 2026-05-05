<script setup lang="ts">
import { useChatStore } from '@/stores/chat'
import SessionTitle from './SessionTitle.vue'
import SessionManager from './SessionManager.vue'

const chatStore = useChatStore()
</script>

<template>
  <header
    class="flex justify-between items-center w-full px-6 h-20 sticky top-0 z-40 bg-surface/80 backdrop-blur-xl transition-colors duration-300"
  >
    <!-- 左侧：会话标题 -->
    <SessionTitle :title="chatStore.currentSession?.title || '新建会话'" />

    <!-- 右侧：会话管理 -->
    <SessionManager />
  </header>
</template>
