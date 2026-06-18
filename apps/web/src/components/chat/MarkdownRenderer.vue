<script setup lang="ts">
import { computed } from 'vue'
import type { RootContent } from 'mdast'
import type { RenderableBlock } from '@/modules/chat/types/chat'
import InlineRenderer from './InlineRenderer.vue'
import CodeBlock from './CodeBlock.vue'

const props = defineProps<{
  blocks: RenderableBlock[]
}>()

const normalizedBlocks = computed(() =>
  props.blocks.map((block) => ({
    ...block,
    node: (block.displayNode ?? block.node) as RootContent,
  })),
)
</script>

<template>
  <div class="markdown-body max-w-none text-on-surface-variant text-base leading-relaxed">
    <template v-for="block in normalizedBlocks" :key="block.id">
      <!-- Heading -->
      <component
        v-if="block.node.type === 'heading'"
        :is="`h${(block.node as { depth: number }).depth}`"
        :class="{
          'text-2xl font-bold text-on-surface mt-6 mb-3': (block.node as { depth: number }).depth === 1,
          'text-xl font-semibold text-on-surface mt-5 mb-2': (block.node as { depth: number }).depth === 2,
          'text-lg font-semibold text-on-surface mt-4 mb-2': (block.node as { depth: number }).depth === 3,
          'text-base font-semibold text-on-surface mt-3 mb-1.5': (block.node as { depth: number }).depth === 4,
          'text-sm font-semibold text-on-surface-variant mt-3 mb-1.5': (block.node as { depth: number }).depth === 5,
          'text-xs font-semibold text-on-surface-variant mt-2 mb-1': (block.node as { depth: number }).depth === 6,
        }"
      >
        <InlineRenderer :children="(block.node as { children: RootContent[] }).children" />
      </component>

      <!-- Code block -->
      <CodeBlock
        v-else-if="block.node.type === 'code'"
        :lang="(block.node as { lang?: string }).lang || 'text'"
        :value="(block.node as { value: string }).value"
      />

      <!-- Paragraph -->
      <p v-else-if="block.node.type === 'paragraph'" class="mb-3 last:mb-0">
        <InlineRenderer :children="(block.node as { children: RootContent[] }).children" />
      </p>

      <!-- List -->
      <component
        v-else-if="block.node.type === 'list'"
        :is="(block.node as { ordered?: boolean }).ordered ? 'ol' : 'ul'"
        :class="[(block.node as { ordered?: boolean }).ordered ? 'list-decimal' : 'list-disc', 'pl-6 mb-3 space-y-1 marker:text-on-surface-variant']"
      >
        <li
          v-for="(item, i) in (block.node as { children: { type: string; children: RootContent[] }[] }).children"
          :key="i"
          class="pl-1"
        >
          <template v-for="(child, j) in item.children" :key="j">
            <InlineRenderer
              v-if="child.type === 'paragraph' || child.type === 'heading'"
              :children="(child as { children: RootContent[] }).children"
            />
            <ul v-else-if="child.type === 'list' && !(child as { ordered?: boolean }).ordered" class="list-disc pl-4 mt-1 space-y-1 marker:text-on-surface-variant">
              <li
                v-for="(nested, k) in (child as { children: { type: string; children: RootContent[] }[] }).children"
                :key="k"
                class="pl-1"
              >
                <template v-for="(nc, nk) in nested.children" :key="nk">
                  <InlineRenderer
                    v-if="nc.type === 'paragraph'"
                    :children="(nc as { children: RootContent[] }).children"
                  />
                </template>
              </li>
            </ul>
            <ol v-else-if="child.type === 'list'" class="list-decimal pl-4 mt-1 space-y-1 marker:text-on-surface-variant">
              <li
                v-for="(nested, k) in (child as { children: { type: string; children: RootContent[] }[] }).children"
                :key="k"
                class="pl-1"
              >
                <template v-for="(nc, nk) in nested.children" :key="nk">
                  <InlineRenderer
                    v-if="nc.type === 'paragraph'"
                    :children="(nc as { children: RootContent[] }).children"
                  />
                </template>
              </li>
            </ol>
          </template>
        </li>
      </component>

      <!-- Blockquote -->
      <blockquote v-else-if="block.node.type === 'blockquote'" class="border-l-4 border-primary/40 bg-surface-container-low/50 rounded-r-lg pl-4 pr-3 py-2 my-3">
        <template v-for="(child, cidx) in (block.node as { children: RootContent[] }).children" :key="cidx">
          <p v-if="child.type === 'paragraph'" class="mb-2 last:mb-0">
            <InlineRenderer :children="(child as { children: RootContent[] }).children" />
          </p>
          <template v-else-if="'children' in child">
            <InlineRenderer :children="(child as { children: RootContent[] }).children" />
          </template>
        </template>
      </blockquote>

      <!-- Thematic break -->
      <hr v-else-if="block.node.type === 'thematicBreak'" class="my-6 border-0 h-px bg-outline-variant/30" />

      <!-- Table -->
      <div v-else-if="block.node.type === 'table'" class="my-4 overflow-x-auto rounded-lg border border-outline-variant/20">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-surface-container-low">
              <th
                v-for="(cell, ci) in ((block.node as { children: any[] }).children[0] as { children: any[] }).children"
                :key="ci"
                class="px-4 py-2.5 text-left text-xs font-semibold text-on-surface border-b border-outline-variant/20"
              >
                <InlineRenderer :children="cell.children" />
              </th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(row, ri) in (block.node as { children: any[] }).children.slice(1)"
              :key="ri"
              :class="ri % 2 === 0 ? 'bg-transparent' : 'bg-surface-container-low/30'"
            >
              <td
                v-for="(cell, ci) in (row as { children: any[] }).children"
                :key="ci"
                class="px-4 py-2 border-b border-outline-variant/10 text-on-surface-variant"
              >
                <InlineRenderer :children="cell.children" />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- HTML (Incremark XSS filtered) -->
      <div
        v-else-if="block.node.type === 'html'"
        v-html="(block.node as { value: string }).value"
      />

      <!-- Fallback: unknown block type -->
      <div v-else>
        <template v-if="'children' in block.node">
          <InlineRenderer :children="(block.node as { children: RootContent[] }).children" />
        </template>
        <template v-else>
          {{ (block.node as { value?: string }).value || '' }}
        </template>
      </div>
    </template>
  </div>
</template>

<style scoped>
.markdown-body > :first-child {
  margin-top: 0;
}
.markdown-body > :last-child {
  margin-bottom: 0;
}
</style>
