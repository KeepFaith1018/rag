<script setup lang="ts">
import { ref, watch } from 'vue'
import { getHighlighter } from '@/modules/chat/utils/shiki'
import type { HighlighterCore } from 'shiki/core'

const props = defineProps<{
  lang: string
  value: string
}>()

const highlightedHtml = ref('')
let highlighter: HighlighterCore | null = null

getHighlighter().then((h) => {
  highlighter = h
  highlight()
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
      theme: 'github-dark',
    })
  } catch {
    highlightedHtml.value = `<pre><code>${encodeHTML(code)}</code></pre>`
  }
}

watch(() => [props.lang, props.value], highlight)
</script>

<template>
  <div v-html="highlightedHtml" />
</template>
