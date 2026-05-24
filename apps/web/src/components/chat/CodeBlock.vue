<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { getHighlighter } from '@/modules/chat/utils/shiki'
import type { HighlighterCore } from 'shiki/core'

const props = defineProps<{
  lang: string
  value: string
}>()

const highlightedHtml = ref('')
const copied = ref(false)
let highlighter: HighlighterCore | null = null

getHighlighter().then((h) => {
  highlighter = h
  highlight()
})

const languageLabel = computed(() => {
  const lang = props.lang || 'text'
  const map: Record<string, string> = {
    javascript: 'JavaScript',
    typescript: 'TypeScript',
    python: 'Python',
    shellscript: 'Shell',
    json: 'JSON',
    markdown: 'Markdown',
    sql: 'SQL',
    yaml: 'YAML',
    css: 'CSS',
    html: 'HTML',
    xml: 'XML',
    text: 'Plain Text',
  }
  return map[lang] || lang
})

function encodeHTML(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

async function highlight() {
  const code = props.value.trimEnd()
  if (!highlighter) {
    highlightedHtml.value = `<pre><code>${encodeHTML(code)}</code></pre>`
    return
  }
  try {
    highlightedHtml.value = highlighter.codeToHtml(code, {
      lang: props.lang || 'text',
      themes: { light: 'github-light', dark: 'github-dark' },
      defaultColor: 'light',
    })
  } catch {
    highlightedHtml.value = `<pre><code>${encodeHTML(code)}</code></pre>`
  }
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(props.value)
    copied.value = true
    setTimeout(() => { copied.value = false }, 2000)
  } catch { /* ignore */ }
}

watch(() => [props.lang, props.value], highlight)
</script>

<template>
  <div class="my-4 rounded-lg border border-outline-variant/20 overflow-hidden">
    <!-- Header bar -->
    <div class="flex items-center justify-between px-4 py-2 bg-surface-container-low border-b border-outline-variant/10">
      <span class="text-xs text-on-surface-variant font-mono">{{ languageLabel }}</span>
      <button
        class="flex items-center gap-1 px-2 py-1 text-xs text-outline hover:text-on-surface hover:bg-surface-container-high rounded transition-colors"
        @click="copyCode"
      >
        <span class="material-symbols-outlined text-[14px]">{{ copied ? 'check' : 'content_copy' }}</span>
        {{ copied ? '已复制' : '复制' }}
      </button>
    </div>
    <!-- Code content -->
    <div class="overflow-x-auto text-sm" v-html="highlightedHtml" />
  </div>
</template>

<style scoped>
:deep(pre) {
  background-color: var(--color-surface-container-low) !important;
  padding: 1rem !important;
  margin: 0 !important;
  border-radius: 0 !important;
  font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Consolas', monospace;
  font-size: 0.8125rem;
  line-height: 1.6;
}
:deep(code) {
  font-family: inherit;
  font-size: inherit;
}
</style>
