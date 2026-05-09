<script setup lang="ts">
import type { ChatMessageItem } from '@/modules/chat/types/chat'

defineProps<{
  message: ChatMessageItem
}>()
</script>

<template>
  <div class="flex justify-end py-2">
    <div class="max-w-[70%] rounded-2xl bg-surface-container-high border border-outline-variant/10 px-4 py-3 text-base text-on-surface">
      {{ message.content }}
    </div>
  </div>
</template>
