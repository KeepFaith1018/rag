<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue'
import { useChatStore } from '@/stores/chat'
import ChatModeToggle from './ChatModeToggle.vue'
import ChatKbSelector from './ChatKbSelector.vue'
import ChatModelSelector from './ChatModelSelector.vue'

const props = withDefaults(
  defineProps<{
    isStreaming?: boolean
  }>(),
  {
    isStreaming: false,
  },
)

const emit = defineEmits<{
  send: [message: string]
  cancel: []
}>()

const chatStore = useChatStore()

const inputText = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const LINE_HEIGHT = 24
const MAX_LINES = 8
const MAX_HEIGHT = LINE_HEIGHT * MAX_LINES

/** RAG 模式的 placeholder */
const placeholderText = computed(() =>
  chatStore.chatMode === 'rag' ? '基于知识库提问...' : '向 灵索智能 发送消息...',
)

/** 自适应高度 */
function autoResize() {
  nextTick(() => {
    if (!textareaRef.value) return
    textareaRef.value.style.height = 'auto'
    const scrollHeight = textareaRef.value.scrollHeight
    textareaRef.value.style.height = Math.min(scrollHeight, MAX_HEIGHT) + 'px'
    textareaRef.value.style.overflowY = scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden'
  })
}

watch(inputText, autoResize)

/** 发送消息 */
function handleSend() {
  const message = inputText.value.trim()
  if (!message) return
  emit('send', message)
  inputText.value = ''
  nextTick(() => {
    if (textareaRef.value) {
      textareaRef.value.style.height = 'auto'
      textareaRef.value.style.overflowY = 'hidden'
    }
  })
}

/** 处理键盘事件 */
function handleKeydown(e: KeyboardEvent) {
  if (e.key === 'Enter' && e.ctrlKey) {
    e.preventDefault()
    const textarea = textareaRef.value
    if (!textarea) return
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    inputText.value = inputText.value.substring(0, start) + '\n' + inputText.value.substring(end)
    nextTick(() => {
      textarea.selectionStart = textarea.selectionEnd = start + 1
    })
    return
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    handleSend()
  }
}

/** 取消请求 */
function handleCancel() {
  emit('cancel')
}
</script>

<template>
  <div class="bg-surface-container/60 backdrop-blur-xl rounded-3xl border border-outline-variant/10 shadow-lg">
    <!-- textarea 区 -->
    <div class="px-4 py-3">
      <textarea
        ref="textareaRef"
        v-model="inputText"
        class="w-full bg-transparent focus:outline-none text-on-surface placeholder:text-outline/50 resize-none text-sm leading-6"
        :placeholder="placeholderText"
        :style="{ height: 'auto', overflowY: 'hidden' }"
        @keydown="handleKeydown"
      />
    </div>

    <!-- 底部控制栏：单行，左右结构 -->
    <div class="flex items-center justify-between px-4 pb-2 pt-0 gap-3">
      <!-- 左侧：模式切换 + KB 选择器 + 警告 -->
      <div class="flex items-center gap-2 flex-1 min-w-0">
        <ChatModeToggle />
        <ChatKbSelector v-if="chatStore.chatMode === 'rag' && chatStore.availableKbs.length > 0" compact />
        <span
          v-if="chatStore.chatMode === 'rag' && chatStore.selectedKbIds.length === 0 && chatStore.availableKbs.length > 0"
          class="text-[10px] text-amber-400 flex items-center gap-1 whitespace-nowrap"
        >
          <span class="material-symbols-outlined text-[12px]">info</span>
          请选择
        </span>
      </div>

      <!-- 右侧：模型 + 发送（贴近排列） -->
      <div class="flex items-center gap-1 flex-shrink-0">
        <ChatModelSelector />
        <!-- 发送 / 取消 -->
        <template v-if="isStreaming">
          <button
            class="w-9 h-9 flex items-center justify-center rounded-full bg-error-container hover:bg-error/20 text-on-error-container transition-all shadow-lg active:scale-95 focus:outline-none"
            @click="handleCancel"
          >
            <span class="material-symbols-outlined text-xl leading-none">close</span>
          </button>
        </template>
        <template v-else>
          <button
            class="w-9 h-9 flex items-center justify-center rounded-full bg-primary-container hover:bg-primary text-on-primary-container transition-all shadow-lg active:scale-95 focus:outline-none"
            :class="{ 'opacity-30 pointer-events-none': !inputText.trim() }"
            :disabled="!inputText.trim()"
            @click="handleSend"
          >
            <span class="material-symbols-outlined text-xl leading-none">arrow_upward</span>
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
