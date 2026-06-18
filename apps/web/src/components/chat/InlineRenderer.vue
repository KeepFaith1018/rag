<script setup lang="ts">
import type { RootContent } from 'mdast'
import { parseCitationMarkers } from '@/modules/chat/utils/citation-parser'
import { useChatStore } from '@/stores/chat'

defineProps<{
  children: RootContent[]
}>()

const chatStore = useChatStore()

/** 从 linkReference 节点提取引用编号（兼容 [来源 N]、[KB-N] 等格式），非引用返回 0 */
function extractCitationIndex(node: {
  type: string
  identifier?: string
  label?: string
  children?: { type: string; value: string }[]
}): number {
  if (node.type !== 'linkReference') return 0
  const text = node.children?.[0]?.value || node.identifier || ''
  // [来源 1] / [来源1] → 1
  let match = text.match(/^来源\s*(\d+)$/)
  if (match) return parseInt(match[1], 10)
  // [KB-1] / [kb-1] / [KB- 1] → 1
  match = text.match(/^[Kk][Bb]\s*-\s*(\d+)$/)
  if (match) return parseInt(match[1], 10)
  return 0
}

function handleCitationClick(index: number) {
  chatStore.highlightedCitationIndex = index
  setTimeout(() => {
    if (chatStore.highlightedCitationIndex === index) {
      chatStore.highlightedCitationIndex = null
    }
  }, 3000)
}
</script>

<template>
  <template v-for="(child, idx) in children" :key="idx">
    <template v-if="child.type === 'text'">
      <template v-for="(seg, segIdx) in parseCitationMarkers((child as { value: string }).value)" :key="segIdx">
        <span v-if="seg.type === 'text'">{{ seg.value }}</span>
        <span
          v-else
          class="inline align-middle cursor-pointer select-none text-[0.7em] font-medium px-1 py-px rounded-sm bg-primary/10 text-primary hover:bg-primary/20 hover:underline transition-colors"
          :class="{ 'ring-2 ring-primary/50 bg-primary/20': chatStore.highlightedCitationIndex === seg.citationIndex }"
          role="button"
          tabindex="0"
          @click.stop="handleCitationClick(seg.citationIndex!)"
        >[{{ seg.citationIndex }}]</span>
      </template>
    </template>

    <!-- linkReference 节点：Incremark 会把 [来源N] 解析为 shortcut linkReference -->
    <template v-else-if="child.type === 'linkReference' && extractCitationIndex(child as { type: string; identifier?: string; label?: string; children?: { type: string; value: string }[] }) > 0">
      <span
        class="inline align-middle cursor-pointer select-none text-[0.7em] font-medium px-1 py-px rounded-sm bg-primary/10 text-primary hover:bg-primary/20 hover:underline transition-colors"
        :class="{ 'ring-2 ring-primary/50 bg-primary/20': chatStore.highlightedCitationIndex === extractCitationIndex(child as { type: string; identifier?: string; label?: string; children?: { type: string; value: string }[] }) }"
        role="button"
        tabindex="0"
        @click.stop="handleCitationClick(extractCitationIndex(child as { type: string; identifier?: string; label?: string; children?: { type: string; value: string }[] }))"
      >[{{ extractCitationIndex(child as { type: string; identifier?: string; label?: string; children?: { type: string; value: string }[] }) }}]</span>
    </template>
    <span v-else-if="child.type === 'linkReference'" class="text-on-surface-variant">[{{ (child as { children?: { type: string; value: string }[] }).children?.[0]?.value || '' }}]</span>

    <strong v-else-if="child.type === 'strong'" class="font-semibold text-on-surface">
      <InlineRenderer :children="(child as { children: RootContent[] }).children" />
    </strong>

    <em v-else-if="child.type === 'emphasis'" class="italic">
      <InlineRenderer :children="(child as { children: RootContent[] }).children" />
    </em>

    <del v-else-if="child.type === 'delete'" class="line-through text-on-surface-variant">
      <InlineRenderer :children="(child as { children: RootContent[] }).children" />
    </del>

    <code v-else-if="child.type === 'inlineCode'" class="px-1.5 py-0.5 rounded text-[0.85em] font-mono bg-surface-container-high text-on-surface">
      {{ (child as { value: string }).value }}
    </code>

    <a
      v-else-if="child.type === 'link'"
      :href="(child as { url: string }).url"
      :title="(child as { title?: string }).title"
      target="_blank"
      rel="noopener noreferrer"
      class="text-primary hover:underline"
    >
      <InlineRenderer :children="(child as { children: RootContent[] }).children" />
    </a>

    <img
      v-else-if="child.type === 'image'"
      :src="(child as { url: string }).url"
      :alt="(child as { alt?: string }).alt || ''"
      :title="(child as { title?: string }).title"
      class="rounded max-w-full my-2"
    />

    <br v-else-if="child.type === 'break'" />

    <span
      v-else-if="child.type === 'html'"
      v-html="(child as { value: string }).value"
    />
  </template>
</template>
