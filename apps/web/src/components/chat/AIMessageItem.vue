<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChatMessageItem } from '@/modules/chat/types/chat'
import { useMessage } from '@/composables/useMessage'

const props = defineProps<{
  message: ChatMessageItem
}>()

const emit = defineEmits<{
  retry: []
}>()

const messageToast = useMessage()
const copied = ref(false)

const isStreaming = computed(() => props.message.messageStatus === 'streaming')
const isError = computed(() => props.message.messageStatus === 'error')
const isAborted = computed(() => props.message.messageStatus === 'aborted')

const hasContent = computed(() =>
  props.message.htmlContent || props.message.content,
)

async function handleCopy() {
  try {
    await navigator.clipboard.writeText(props.message.content || '')
    copied.value = true
    messageToast.success('已复制')
    setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    messageToast.error('复制失败')
  }
}

function handleRetry() {
  emit('retry')
}
</script>

<template>
  <div class="px-6 py-2">
    <div class="max-w-3xl">
      <!-- Markdown 内容 -->
      <div
        v-if="hasContent"
        class="prose prose-invert max-w-none text-on-surface-variant text-sm leading-relaxed"
        v-html="message.htmlContent || message.content"
      />

      <!-- 流式加载中：闪烁光标 -->
      <div
        v-else-if="isStreaming"
        class="flex items-center gap-2 py-2"
      >
        <span class="inline-block w-2 h-4 bg-primary rounded-sm animate-pulse" />
        <span class="text-xs text-outline">生成中...</span>
      </div>

      <!-- 已取消 -->
      <div
        v-if="isAborted"
        class="text-xs text-error mt-2"
      >
        请求已取消
      </div>

      <!-- 错误 -->
      <div
        v-if="isError"
        class="text-xs text-error mt-2"
      >
        生成失败，请重试
      </div>

      <!-- 底部操作栏（非流式时显示） -->
      <div
        v-if="!isStreaming && hasContent"
        class="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-outline-variant/10"
      >
        <!-- 复制按钮 -->
        <button
          class="flex items-center gap-1 px-2 py-1 text-xs text-outline hover:text-on-surface hover:bg-surface-container-low rounded transition-colors"
          @click="handleCopy"
        >
          <span class="material-symbols-outlined text-xs">{{ copied ? 'check' : 'content_copy' }}</span>
          {{ copied ? '已复制' : '复制' }}
        </button>

        <!-- 重试按钮 -->
        <button
          class="flex items-center gap-1 px-2 py-1 text-xs text-outline hover:text-on-surface hover:bg-surface-container-low rounded transition-colors"
          @click="handleRetry"
        >
          <span class="material-symbols-outlined text-xs">refresh</span>
          重试
        </button>
      </div>
    </div>
  </div>
</template>
