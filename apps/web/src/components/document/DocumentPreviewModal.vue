<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { apiRequestBlob } from '@/api/api'
import MarkdownRenderer from '@/components/chat/MarkdownRenderer.vue'
import { marked } from 'marked'

marked.setOptions({ breaks: true, gfm: true })

const props = defineProps<{
  open: boolean
  kbId: string
  documentId: string | number
  fileName: string
  fileType: string
}>()

const emit = defineEmits<{
  close: []
}>()

const textContent = ref<string | null>(null)
const mdBlocks = ref<any[] | null>(null)
const previewBlobUrl = ref<string | null>(null)
const loading = ref(true)
const error = ref('')

// 响应式文件类型解析：fileType > 文件名扩展名
const resolvedType = computed(() => {
  const ft = (props.fileType || '').toLowerCase()
  if (ft === 'pdf' || ft === 'md' || ft === 'txt') return ft
  const ext = (props.fileName || '').split('.').pop()?.toLowerCase() || ''
  if (ext === 'markdown') return 'md'
  if (ext === 'pdf' || ext === 'md' || ext === 'txt') return ext
  return ft
})

const isPdf = computed(() => resolvedType.value === 'pdf')
const isMd = computed(() => resolvedType.value === 'md')
const isTxt = computed(() => resolvedType.value === 'txt')
const isText = computed(() => isMd.value || isTxt.value)

function cleanup() {
  if (previewBlobUrl.value) {
    URL.revokeObjectURL(previewBlobUrl.value)
    previewBlobUrl.value = null
  }
  textContent.value = null
  mdBlocks.value = null
  error.value = ''
  loading.value = true
}

async function loadContent() {
  try {
    const { blob } = await apiRequestBlob({
      url: `/knowledge-bases/${props.kbId}/documents/${props.documentId}/preview`,
      method: 'GET',
    })

    if (isPdf.value) {
      previewBlobUrl.value = URL.createObjectURL(blob)
    } else if (isText.value) {
      const raw = await blob.text()
      if (isMd.value) {
        const html = marked.parse(raw, { async: false }) as string
        mdBlocks.value = [{ id: 'preview-md', node: { type: 'html', value: html } }]
      } else {
        textContent.value = raw
      }
    }
  } catch (e: any) {
    error.value = e?.message || '加载失败'
  } finally {
    loading.value = false
  }
}

watch(() => props.open, async (val) => {
  if (!val) { cleanup(); return }

  loading.value = true
  error.value = ''
  if (previewBlobUrl.value) {
    URL.revokeObjectURL(previewBlobUrl.value)
    previewBlobUrl.value = null
  }
  textContent.value = null
  mdBlocks.value = null
  loadContent()
}, { immediate: true })

// 切换文档时重新加载
watch(() => props.documentId, () => {
  if (props.open) {
    loading.value = true
    error.value = ''
    if (previewBlobUrl.value) {
      URL.revokeObjectURL(previewBlobUrl.value)
      previewBlobUrl.value = null
    }
    textContent.value = null
    mdBlocks.value = null
    loadContent()
  }
})

async function handleDownload() {
  try {
    const { blob, fileName } = await apiRequestBlob({
      url: `/knowledge-bases/${props.kbId}/documents/${props.documentId}/download`,
      method: 'GET',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = fileName || props.fileName
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
  } catch { /* ignore */ }
}

function handleClose() {
  cleanup()
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="preview-modal">
      <div
        v-if="open"
        class="fixed inset-0 z-[130] flex flex-col bg-surface"
        @click.self="handleClose"
      >
        <!-- 顶部工具栏 -->
        <header class="flex items-center justify-between px-6 py-3 bg-surface border-b border-outline-variant/10 shrink-0">
          <div class="flex items-center gap-3 min-w-0">
            <span class="material-symbols-outlined text-primary text-xl">description</span>
            <span class="text-sm font-medium text-on-surface truncate">{{ fileName }}</span>
            <span class="text-[10px] px-1.5 py-0.5 rounded bg-surface-container-high text-outline uppercase">{{ resolvedType || props.fileType }}</span>
          </div>
          <div class="flex items-center gap-2">
            <button
              class="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-primary-container/50 text-on-primary-container hover:bg-primary-container transition-colors"
              @click="handleDownload"
            >
              <span class="material-symbols-outlined text-sm">download</span>
              下载
            </button>
            <button
              class="w-8 h-8 flex items-center justify-center rounded-full hover:bg-surface-container-high transition-colors"
              @click="handleClose"
            >
              <span class="material-symbols-outlined text-outline">close</span>
            </button>
          </div>
        </header>

        <!-- 内容区 -->
        <div class="flex-1 min-h-0">
          <!-- 加载中 -->
          <div v-if="loading" class="flex items-center justify-center h-full gap-3">
            <span class="inline-block w-3 h-3 rounded-full bg-primary animate-pulse" />
            <span class="text-sm text-outline">加载中...</span>
          </div>

          <!-- 错误 -->
          <div v-else-if="error" class="flex flex-col items-center justify-center h-full gap-4">
            <span class="material-symbols-outlined text-4xl text-error/50">error</span>
            <p class="text-sm text-outline">{{ error }}</p>
            <button
              class="px-4 py-2 rounded-lg text-sm font-medium bg-surface-container-high text-on-surface hover:bg-surface-container transition-colors"
              @click="handleClose"
            >关闭</button>
          </div>

          <!-- PDF 预览 -->
          <iframe
            v-else-if="isPdf && previewBlobUrl"
            :src="previewBlobUrl"
            class="w-full h-full border-0 bg-white"
          />

          <!-- Markdown 预览 -->
          <div v-else-if="isMd && mdBlocks" class="h-full overflow-auto">
            <div class="max-w-3xl mx-auto px-8 py-6">
              <MarkdownRenderer :blocks="mdBlocks" />
            </div>
          </div>

          <!-- 纯文本预览 -->
          <div v-else-if="isTxt" class="h-full overflow-auto">
            <pre class="max-w-4xl mx-auto p-8 text-base text-on-surface leading-relaxed whitespace-pre-wrap font-body">{{ textContent }}</pre>
          </div>

          <!-- 不支持预览 -->
          <div v-else class="flex flex-col items-center justify-center h-full gap-4">
            <span class="material-symbols-outlined text-5xl text-outline/30">visibility_off</span>
            <p class="text-sm text-outline">此文件类型不支持在线预览</p>
            <button
              class="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium bg-primary text-on-primary hover:bg-primary/90 transition-colors"
              @click="handleDownload"
            >
              <span class="material-symbols-outlined text-sm">download</span>
              下载文件
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.preview-modal-enter-active,
.preview-modal-leave-active {
  transition: opacity 0.2s ease;
}
.preview-modal-enter-from,
.preview-modal-leave-to {
  opacity: 0;
}
</style>
