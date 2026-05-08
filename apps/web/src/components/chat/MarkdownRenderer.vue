<script setup lang="ts">
import type { RootContent } from 'mdast'
import type { ParsedBlock } from '@incremark/core'
import InlineRenderer from './InlineRenderer.vue'
import CodeBlock from './CodeBlock.vue'

defineProps<{
  blocks: ParsedBlock[]
}>()
</script>

<template>
  <div class="prose prose-invert max-w-none text-on-surface-variant text-sm leading-relaxed">
    <template v-for="block in blocks" :key="block.id">
      <!-- Heading -->
      <component
        v-if="block.node.type === 'heading'"
        :is="`h${(block.node as { depth: number }).depth}`"
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
      <p v-else-if="block.node.type === 'paragraph'">
        <InlineRenderer :children="(block.node as { children: RootContent[] }).children" />
      </p>

      <!-- List (ordered or unordered) -->
      <component
        v-else-if="block.node.type === 'list'"
        :is="(block.node as { ordered?: boolean }).ordered ? 'ol' : 'ul'"
      >
        <li
          v-for="(item, i) in (block.node as { children: { type: string; children: RootContent[] }[] }).children"
          :key="i"
        >
          <template v-for="(child, j) in item.children" :key="j">
            <InlineRenderer
              v-if="child.type === 'paragraph' || child.type === 'heading'"
              :children="(child as { children: RootContent[] }).children"
            />
            <ul v-else-if="child.type === 'list' && !(child as { ordered?: boolean }).ordered">
              <li
                v-for="(nested, k) in (child as { children: { type: string; children: RootContent[] }[] }).children"
                :key="k"
              >
                <template v-for="(nc, nk) in nested.children" :key="nk">
                  <InlineRenderer
                    v-if="nc.type === 'paragraph'"
                    :children="(nc as { children: RootContent[] }).children"
                  />
                </template>
              </li>
            </ul>
            <ol v-else-if="child.type === 'list'">
              <li
                v-for="(nested, k) in (child as { children: { type: string; children: RootContent[] }[] }).children"
                :key="k"
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
      <blockquote v-else-if="block.node.type === 'blockquote'">
        <template v-for="(child, cidx) in (block.node as { children: RootContent[] }).children" :key="cidx">
          <p v-if="child.type === 'paragraph'">
            <InlineRenderer :children="(child as { children: RootContent[] }).children" />
          </p>
          <template v-else-if="'children' in child">
            <InlineRenderer :children="(child as { children: RootContent[] }).children" />
          </template>
        </template>
      </blockquote>

      <!-- Thematic break -->
      <hr v-else-if="block.node.type === 'thematicBreak'" />

      <!-- Table -->
      <table v-else-if="block.node.type === 'table'">
        <thead>
          <tr>
            <th
              v-for="(cell, ci) in ((block.node as { children: any[] }).children[0] as { children: any[] }).children"
              :key="ci"
            >
              <InlineRenderer :children="cell.children" />
            </th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="(row, ri) in (block.node as { children: any[] }).children.slice(1)"
            :key="ri"
          >
            <td
              v-for="(cell, ci) in (row as { children: any[] }).children"
              :key="ci"
            >
              <InlineRenderer :children="cell.children" />
            </td>
          </tr>
        </tbody>
      </table>

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
