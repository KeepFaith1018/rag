<script setup lang="ts">
import { computed, ref } from 'vue'
import { createIncremarkParser } from '@incremark/core'
import type { ParsedBlock } from '@incremark/core'
import type { ChatMessageItem } from '@/modules/chat/types/chat'
import type { Citation } from '@/modules/chat/types/stream'
import { useChatStore } from '@/stores/chat'
import { useMessage } from '@/composables/useMessage'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer.vue'
import ChatAgentPanel from '@/components/chat/ChatAgentPanel.vue'
import DocumentPreviewModal from '@/components/document/DocumentPreviewModal.vue'

const markdownBlockCache = new Map<string, { content: string; blocks: ParsedBlock[] }>()
const MAX_MARKDOWN_CACHE_SIZE = 100

/** 一次性解析完整 Markdown 文本为 blocks */
function parseMarkdown(messageId: string | number, content: string): ParsedBlock[] {
  const cacheKey = String(messageId)
  const cached = markdownBlockCache.get(cacheKey)
  if (cached?.content === content) return cached.blocks

  try {
    const mdParser = createIncremarkParser({ gfm: true })
    mdParser.render(content)
    const blocks = mdParser.getCompletedBlocks()
    markdownBlockCache.set(cacheKey, { content, blocks })
    if (markdownBlockCache.size > MAX_MARKDOWN_CACHE_SIZE) {
      const firstKey = markdownBlockCache.keys().next().value
      if (firstKey) markdownBlockCache.delete(firstKey)
    }
    return blocks
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
const citationsExpanded = ref(false)
const previewOpen = ref(false)
const previewDoc = ref<{
  kbId: string
  documentId: string
  fileName: string
  fileType: string
} | null>(null)

const isStreaming = computed(() =>
  props.message.messageStatus === 'streaming',
)
const isError = computed(() => props.message.messageStatus === 'error')
const isAborted = computed(() => props.message.messageStatus === 'aborted')
const isRagMode = computed(() => props.message.chatMode === 'rag')

const messageCitations = computed(() => {
  if (props.message.citations?.length) return props.message.citations
  return isStreaming.value ? chatStore.citations : []
})

/** 按知识库 → 文档分组 */
const citationGroups = computed(() => {
  const map = new Map<string, {
    kbName: string
    kbId: string
    docId: string
    docTitle: string
    fileType?: string
    fileName?: string
    chunks: Citation[]
  }>()

  for (const c of messageCitations.value) {
    const key = `${c.kbId}:${c.docId}`
    if (!map.has(key)) {
      map.set(key, {
        kbName: c.kbName || `知识库 #${c.kbId.slice(0, 8)}`,
        kbId: c.kbId,
        docId: c.docId,
        docTitle: c.docTitle,
        fileType: c.fileType,
        fileName: c.fileName,
        chunks: [],
      })
    }
    // 同文档内按 chunkId 去重，保留首次出现的 index
    const group = map.get(key)!
    if (!group.chunks.some((existing) => existing.chunkId === c.chunkId)) {
      group.chunks.push(c)
    }
  }
  return [...map.values()]
})

function viewSource(doc: CitationGroup) {
  previewDoc.value = {
    kbId: doc.kbId,
    documentId: doc.docId,
    fileName: doc.fileName || doc.docTitle || '未知文档',
    fileType: doc.fileType || '',
  }
  previewOpen.value = true
}

function scrollToCitation(index: number) {
  chatStore.highlightedCitationIndex = index
  setTimeout(() => {
    if (chatStore.highlightedCitationIndex === index) {
      chatStore.highlightedCitationIndex = null
    }
  }, 3000)
}

type CitationGroup = {
  kbName: string
  kbId: string
  docId: string
  docTitle: string
  fileType?: string
  fileName?: string
  chunks: Citation[]
}

const hasContent = computed(() =>
  props.message.htmlContent || props.message.content || props.message.blocks?.length,
)

/** 解析后的 blocks：流式消息直接用 message.blocks，历史消息用 Incremark 一次性解析 */
const resolvedBlocks = computed(() => {
  if (props.message.blocks?.length) return props.message.blocks
  if (!props.message.content) return []
  return parseMarkdown(props.message.id, props.message.content)
})

/** 递归提取 mdast 节点中的纯文本 */
function extractText(node: unknown): string {
  if (!node || typeof node !== 'object') return ''
  const n = node as Record<string, unknown>
  if (n.type === 'text' && typeof n.value === 'string') return n.value
  if (n.type === 'code' && typeof n.value === 'string') return n.value + '\n'
  if (n.type === 'inlineCode' && typeof n.value === 'string') return n.value
  if (Array.isArray(n.children)) {
    return n.children.map((c) => extractText(c)).join('')
  }
  return ''
}

/** 从 blocks 或 content 中提取纯文本用于复制 */
function getPlainText(): string {
  if (props.message.content) return props.message.content
  if (!props.message.blocks?.length) return ''
  return props.message.blocks
    .map((b) => {
      const block = b as unknown as Record<string, unknown>
      return extractText(block.node ?? block.displayNode)
    })
    .filter(Boolean)
    .join('\n')
}

async function handleCopy() {
  try {
    await navigator.clipboard.writeText(getPlainText())
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

      <!-- 完成后的引用脚注（可折叠） -->
      <div
        v-if="!isStreaming && hasContent && isRagMode && messageCitations.length > 0"
        class="mt-3"
      >
        <button
          class="flex items-center gap-2 text-xs text-outline hover:text-on-surface transition-colors group"
          @click="citationsExpanded = !citationsExpanded"
        >
          <span class="material-symbols-outlined text-[14px] transition-transform" :class="citationsExpanded ? 'rotate-90' : ''">chevron_right</span>
          <span class="material-symbols-outlined text-[14px]">menu_book</span>
          <span>参考 {{ messageCitations.length }} 条知识库内容</span>
        </button>

        <!-- 引用列表 -->
        <div v-if="citationsExpanded" class="mt-3 space-y-2">
          <div
            v-for="doc in citationGroups"
            :key="`${doc.kbId}:${doc.docId}`"
            class="p-3 bg-surface-container-low rounded-lg border border-outline-variant/10"
          >
            <div class="flex items-start gap-2 mb-1.5">
              <span
                v-if="doc.chunks[0]"
                class="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-primary/10 text-primary flex-shrink-0 mt-px"
              >
                {{ doc.chunks[0].index }}
              </span>
              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <span class="text-xs font-medium text-on-surface line-clamp-1">{{ doc.docTitle }}</span>
                  <span
                    v-if="doc.fileType"
                    class="text-[9px] text-outline bg-surface-container-high px-1 py-px rounded uppercase flex-shrink-0"
                  >
                    {{ doc.fileType }}
                  </span>
                </div>
                <span class="text-[10px] text-outline">{{ doc.kbName }}</span>
              </div>
              <button
                class="text-[10px] text-primary hover:underline flex-shrink-0 mt-0.5"
                @click.stop="viewSource(doc)"
              >
                查看来源
              </button>
            </div>

            <div
              v-for="chunk in doc.chunks"
              :key="chunk.citationId"
              class="ml-7 mt-1.5 text-xs text-outline leading-relaxed cursor-pointer hover:text-on-surface-variant transition-colors truncate"
              :class="{ 'text-primary': chatStore.highlightedCitationIndex === chunk.index }"
              @click="scrollToCitation(chunk.index)"
            >
              <span class="text-[10px] font-bold text-primary/70 mr-1">[{{ chunk.index }}]</span>
              {{ chunk.quote }}
            </div>
          </div>
        </div>
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

    <!-- 文档预览弹窗 -->
    <DocumentPreviewModal
      v-if="previewDoc"
      :open="previewOpen"
      :kb-id="previewDoc.kbId"
      :document-id="previewDoc.documentId"
      :file-name="previewDoc.fileName"
      :file-type="previewDoc.fileType"
      @close="previewOpen = false; previewDoc = null"
    />
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

.line-clamp-1 {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
