<script setup lang="ts">
import type { RootContent } from 'mdast'

defineProps<{
  children: RootContent[]
}>()
</script>

<template>
  <template v-for="(child, idx) in children" :key="idx">
    <template v-if="child.type === 'text'">
      {{ (child as { value: string }).value }}
    </template>

    <strong v-else-if="child.type === 'strong'">
      <InlineRenderer :children="(child as { children: RootContent[] }).children" />
    </strong>

    <em v-else-if="child.type === 'emphasis'">
      <InlineRenderer :children="(child as { children: RootContent[] }).children" />
    </em>

    <del v-else-if="child.type === 'delete'">
      <InlineRenderer :children="(child as { children: RootContent[] }).children" />
    </del>

    <code v-else-if="child.type === 'inlineCode'">
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
      class="rounded max-w-full"
    />

    <br v-else-if="child.type === 'break'" />

    <span
      v-else-if="child.type === 'html'"
      v-html="(child as { value: string }).value"
    />
  </template>
</template>
