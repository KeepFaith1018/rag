<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'

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

const inputText = ref('')
const textareaRef = ref<HTMLTextAreaElement | null>(null)

const LINE_HEIGHT = 24 // 每行高度约 24px
const MAX_LINES = 8
const MAX_HEIGHT = LINE_HEIGHT * MAX_LINES

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
    // Ctrl + Enter：换行
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
    // Enter（无 Ctrl）：发送
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
  <!-- 统一容器：上下结构 -->
  <div class="w-full bg-surface-container-low/80 backdrop-blur-xl rounded-2xl border border-outline-variant/10 shadow-2xl">
    <!-- 上部：输入区 -->
    <div class="px-3 pt-3 pb-2">
      <textarea
        ref="textareaRef"
        v-model="inputText"
        class="w-full bg-transparent focus:outline-none text-on-surface placeholder:text-outline/50 resize-none text-sm leading-6"
        placeholder="向 灵索智能 发送消息..."
        :style="{ height: 'auto', overflowY: 'hidden' }"
        @keydown="handleKeydown"
      />
    </div>

    <!-- 下部：功能区，左右布局 -->
    <div class="flex items-center justify-between px-3 pb-3">
      <!-- 左侧：附件 -->
      <button class="p-2 text-outline hover:text-primary transition-colors focus:outline-none">
        <span class="material-symbols-outlined text-xl">attach_file</span>
      </button>

      <!-- 右侧：语音 + 发送 -->
      <div class="flex items-center gap-1">
        <template v-if="isStreaming">
          <button
            class="bg-error-container hover:bg-error/20 text-on-error-container p-2 rounded-xl transition-all shadow-lg active:scale-95 focus:outline-none"
            @click="handleCancel"
          >
            <span class="material-symbols-outlined text-xl">close</span>
          </button>
        </template>
        <template v-else>
          <button class="p-2 text-outline hover:text-primary transition-colors focus:outline-none">
            <span class="material-symbols-outlined text-xl">mic</span>
          </button>
          <button
            class="bg-primary-container hover:bg-primary text-on-primary-container p-2 rounded-xl transition-all shadow-lg active:scale-95 focus:outline-none"
            @click="handleSend"
          >
            <span class="material-symbols-outlined text-xl">arrow_upward</span>
          </button>
        </template>
      </div>
    </div>
  </div>
</template>
