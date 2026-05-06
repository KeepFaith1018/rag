<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ChatMessageItem } from '@/modules/chat/types/chat'
import { useChatStore } from '@/stores/chat'
import { useMessage } from '@/composables/useMessage'

const props = defineProps<{
  message: ChatMessageItem
}>()

const emit = defineEmits<{
  retry: []
}>()

const chatStore = useChatStore()
const messageToast = useMessage()
const copied = ref(false)

const isStreaming = computed(() => props.message.messageStatus === 'streaming')
const isError = computed(() => props.message.messageStatus === 'error')
const isAborted = computed(() => props.message.messageStatus === 'aborted')
const isRagMode = computed(() => props.message.chatMode === 'rag')

const hasContent = computed(() =>
  props.message.htmlContent || props.message.content,
)

/** 检索结果总数（优先取 fusedCount，取不到用 0） */
const kbResultCount = computed(() => {
  const last = chatStore.retrievalProgresses.at(-1)
  return last?.fusedCount ?? 0
})

const citationCount = computed(() => chatStore.citations.length)

/** 当前阶段对应的中文状态文案 */
const statusText = computed(() => {
  if (!isRagMode.value) return ''
  const phase = chatStore.agentPhase
  if (phase === 'planning') return '正在分析问题...'
  if (phase === 'retrieving') {
    const n = kbResultCount.value
    return n > 0 ? `检索到 ${n} 条相关内容` : '正在检索知识库...'
  }
  if (phase === 'writing') return ''
  return ''
})

async function handleCopy() {
  try {
    await navigator.clipboard.writeText(props.message.content || '')
    copied.value = true
    messageToast.success('已复制')
    setTimeout(() => { copied.value = false }, 2000)
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
      <!-- 流式等待：还没有文字，显示阶段状态 -->
      <div
        v-if="!hasContent && isStreaming && isRagMode"
        class="flex items-center gap-2 py-2"
      >
        <span class="inline-block w-2 h-4 bg-primary rounded-sm animate-pulse" />
        <span class="text-xs text-outline">{{ statusText }}</span>
      </div>

      <!-- 普通模式等待 -->
      <div
        v-else-if="!hasContent && isStreaming"
        class="flex items-center gap-2 py-2"
      >
        <span class="inline-block w-2 h-4 bg-primary rounded-sm animate-pulse" />
        <span class="text-xs text-outline">思考中...</span>
      </div>

      <!-- Markdown 内容 -->
      <div
        v-if="hasContent"
        class="prose prose-invert max-w-none text-on-surface-variant text-sm leading-relaxed"
        v-html="message.htmlContent || message.content"
      />

      <!-- 已取消 -->
      <div v-if="isAborted" class="text-xs text-error mt-2">请求已取消</div>

      <!-- 错误 -->
      <div v-if="isError" class="text-xs text-error mt-2">生成失败，请重试</div>

      <!-- 完成后的脚注 -->
      <div
        v-if="!isStreaming && hasContent && isRagMode && citationCount > 0"
        class="flex items-center gap-2 mt-2 text-xs text-outline/50"
      >
        <span class="material-symbols-outlined text-[14px]">menu_book</span>
        <span>参考 {{ citationCount }} 条知识库内容</span>
      </div>

      <!-- 底部操作栏 -->
      <div
        v-if="!isStreaming && hasContent"
        class="flex items-center justify-end gap-1 mt-2 pt-2 border-t border-outline-variant/10"
      >
        <button
          class="flex items-center gap-1 px-2 py-1 text-xs text-outline hover:text-on-surface hover:bg-surface-container-low rounded transition-colors"
          @click="handleCopy"
        >
          <span class="material-symbols-outlined text-xs">{{ copied ? 'check' : 'content_copy' }}</span>
          {{ copied ? '已复制' : '复制' }}
        </button>

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
