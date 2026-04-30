<script setup lang="ts">
import { computed } from 'vue';
import { useChatStore } from '@/stores/chat';

const chatStore = useChatStore();

/** 按知识库分组 */
const groupedCitations = computed(() => {
  const groups: Record<string, typeof chatStore.citations> = {};
  for (const citation of chatStore.citations) {
    const kbName = citation.kbName || '未知知识库';
    if (!groups[kbName]) {
      groups[kbName] = [];
    }
    groups[kbName].push(citation);
  }
  return groups;
});
</script>

<template>
  <aside
    v-if="chatStore.citations.length > 0"
    class="w-72 border-l border-outline-variant/10 bg-surface-container-low overflow-y-auto"
  >
    <div class="p-4">
      <!-- Header -->
      <div class="flex items-center justify-between mb-4">
        <h3 class="text-sm font-semibold text-on-surface flex items-center gap-2">
          <span class="material-symbols-outlined text-primary text-base">sources</span>
          引用来源
        </h3>
        <span class="text-xs text-outline">{{ chatStore.citations.length }} 条</span>
      </div>

      <!-- 分组列表 -->
      <div class="space-y-4">
        <div
          v-for="(citations, kbName) in groupedCitations"
          :key="kbName"
          class="space-y-2"
        >
          <!-- 知识库分组标题 -->
          <div class="flex items-center gap-2 text-xs text-outline font-medium uppercase tracking-wider">
            <span class="material-symbols-outlined text-[14px]">folder_open</span>
            {{ kbName }}
          </div>

          <!-- 引用项 -->
          <div
            v-for="citation in citations"
            :key="citation.citationId"
            class="p-3 bg-surface-container rounded-lg border border-outline-variant/5 hover:border-primary/30 transition-colors cursor-pointer group"
          >
            <!-- 文档标题 -->
            <div class="flex items-start gap-2 mb-1.5">
              <span class="material-symbols-outlined text-[14px] text-primary mt-0.5">description</span>
              <span class="text-xs font-medium text-on-surface line-clamp-1">
                {{ citation.docTitle }}
              </span>
            </div>

            <!-- 引用内容 -->
            <p class="text-xs text-outline leading-relaxed line-clamp-3 pl-5 font-mono">
              "{{ citation.quote }}"
            </p>

            <!-- 操作 -->
            <div class="flex items-center justify-end mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
              <button
                class="text-[10px] text-primary hover:underline flex items-center gap-1"
              >
                <span class="material-symbols-outlined text-[12px]">open_in_new</span>
                查看来源
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.line-clamp-1 {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.line-clamp-3 {
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
