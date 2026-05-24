<script setup lang="ts">
import { computed, ref } from 'vue'
import { createIncremarkParser } from '@incremark/core'
import type { ParsedBlock } from '@incremark/core'
import type { ChatMessageItem } from '@/modules/chat/types/chat'
import { useChatStore } from '@/stores/chat'
import { useMessage } from '@/composables/useMessage'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer.vue'
import ChatAgentPanel from '@/components/chat/ChatAgentPanel.vue'

/** 模块级 Incremark 解析器单例，用于历史消息一次性 Markdown 解析 */
const mdParser = createIncremarkParser({ gfm: true })

/** 一次性解析完整 Markdown 文本为 blocks */
function parseMarkdown(content: string): ParsedBlock[] {
  try {
    mdParser.render(content)
    return mdParser.getCompletedBlocks()
  } catch {
    return []
  }
}

const props = defineProps<{
  message: ChatMessageItem
}>()

const emit = defineEmits<{
  retry: []
}>()

const chatStore = useChatStore()
const messageToast = useMessage()
const copied = ref(false)

const isStreaming = computed(() =>
  props.message.messageStatus === 'streaming',
)
const isError = computed(() => props.message.messageStatus === 'error')
const isAborted = computed(() => props.message.messageStatus === 'aborted')
const isRagMode = computed(() => props.message.chatMode === 'rag')

const hasContent = computed(() =>
  props.message.htmlContent || props.message.content || props.message.blocks?.length,
)

/** 解析后的 blocks：流式消息直接用 message.blocks，历史消息用 Incremark 一次性解析 */
const resolvedBlocks = computed(() => {
  if (props.message.blocks?.length) return props.message.blocks
  if (!props.message.content) return []
  return parseMarkdown(props.message.content)
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
  <div class="px-0 py-2">
    <div>
      <!-- 流式等待：还没有文字，显示阶段状态 -->
      <Transition name="msg-fade">
        <div
          v-if="!hasContent && isStreaming && isRagMode"
          class="flex items-center gap-2 py-2"
        >
          <span class="inline-block w-2 h-4 bg-primary rounded-sm animate-pulse" />
          <span class="text-xs text-outline">
            {{ chatStore.agentPhaseLabel || '正在思考...' }}
            <span v-if="chatStore.agentPhaseDetail" class="ml-2 text-outline/60">— {{ chatStore.agentPhaseDetail }}</span>
          </span>
        </div>

        <!-- 普通模式等待 -->
        <div
          v-else-if="!hasContent && isStreaming"
          class="flex items-center gap-2 py-2"
        >
          <span class="inline-block w-2 h-4 bg-primary rounded-sm animate-pulse" />
          <span class="text-xs text-outline">思考中...</span>
        </div>
      </Transition>

      <!-- Agent 步骤面板 -->
      <ChatAgentPanel
        :message-steps="message.aguiSteps"
        :message-tool-calls="message.aguiToolCalls"
        :is-streaming="isStreaming"
      />

      <!-- Markdown 内容 (Incremark AST blocks) -->
      <div v-if="hasContent">
          <MarkdownRenderer
            v-if="resolvedBlocks.length"
            :blocks="resolvedBlocks"
          />
          <!-- 远古消息兼容：仅有 htmlContent 无 content/blocks -->
          <div
            v-else-if="message.htmlContent"
            class="markdown-fallback max-w-none text-on-surface-variant text-sm leading-relaxed"
            v-html="message.htmlContent"
          />
          <!-- 纯文本兜底 -->
          <div
            v-else
            class="text-on-surface-variant text-sm leading-relaxed whitespace-pre-wrap"
          >{{ message.content }}</div>
          <!-- 流式打字机光标 -->
          <span
            v-if="isStreaming"
            class="inline-block w-2 h-4 bg-primary ml-0.5 animate-pulse align-middle rounded-sm"
          />
        </div>

      <!-- 已取消 -->
      <div v-if="isAborted" class="text-xs text-error mt-2">请求已取消</div>

      <!-- 错误 -->
      <div v-if="isError" class="text-xs text-error mt-2">生成失败，请重试</div>

      <!-- 完成后的脚注 -->
      <div
        v-if="!isStreaming && hasContent && isRagMode && chatStore.citations.length > 0"
        class="flex items-center gap-2 mt-2 text-xs text-outline/50"
      >
        <span class="material-symbols-outlined text-[14px]">menu_book</span>
        <span>参考 {{ chatStore.citations.length }} 条知识库内容</span>
      </div>

      <!-- 底部操作栏 -->
      <div
        v-if="!isStreaming"
        class="flex items-center justify-start gap-1 mt-2 pt-2 border-t border-outline-variant/10"
      >
        <button
          v-if="hasContent"
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

<style scoped>
.msg-fade-enter-active {
  transition: all 0.35s cubic-bezier(0.16, 1, 0.3, 1);
}
.msg-fade-enter-from {
  opacity: 0;
  transform: translateY(10px);
}

.step-item {
  animation: stepIn 0.3s ease both;
}
.step-item:nth-child(1) { animation-delay: 0s; }
.step-item:nth-child(2) { animation-delay: 0.04s; }
.step-item:nth-child(3) { animation-delay: 0.08s; }
.step-item:nth-child(4) { animation-delay: 0.12s; }
.step-item:nth-child(5) { animation-delay: 0.16s; }
.step-item:nth-child(6) { animation-delay: 0.20s; }
.step-item:nth-child(7) { animation-delay: 0.24s; }
.step-item:nth-child(8) { animation-delay: 0.28s; }
.step-item:nth-child(9) { animation-delay: 0.32s; }
.step-item:nth-child(10) { animation-delay: 0.36s; }

@keyframes stepIn {
  from {
    opacity: 0;
    transform: translateX(-8px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
</style>
