<script setup lang="ts">
/**
 * ChatCitationPanel - 引用列表面板
 *
 * 展示回答使用的引用列表，支持按知识库和文档分组。
 */
import { computed } from 'vue';
import { useChatStore } from '@/stores/chat';
import type { Citation } from '@/modules/chat/types/stream';

const chatStore = useChatStore();

/** 按知识库分组的引用 */
const citationsByKb = computed(() => {
  const groups: Record<string, { kbName: string; citations: Citation[] }> = {};

  for (const citation of chatStore.citations) {
    if (!groups[citation.kbId]) {
      groups[citation.kbId] = {
        kbName: citation.kbName,
        citations: [],
      };
    }
    groups[citation.kbId].citations.push(citation);
  }

  return Object.values(groups);
});

/**
 * 截断过长的引用文本。
 */
function truncateQuote(quote: string, maxLength = 80): string {
  if (quote.length <= maxLength) return quote;
  return quote.slice(0, maxLength) + '...';
}

/**
 * 格式化文档标题。
 */
function formatDocTitle(docTitle: string): string {
  if (!docTitle) return '未知文档';
  // 移除文件扩展名
  return docTitle.replace(/\.[^.]+$/, '');
}
</script>

<template>
  <!-- 仅在有引用时展示 -->
  <div
    v-if="chatStore.hasCitations"
    class="flex flex-col gap-4 px-4 py-3 bg-surface-container-low rounded-xl border border-outline-variant/10"
  >
    <!-- 标题 -->
    <div class="flex items-center gap-2">
      <span class="material-symbols-outlined text-primary text-[18px]">format_quote</span>
      <span class="text-xs font-label uppercase tracking-widest text-primary">
        引用来源
      </span>
      <span class="text-xs text-outline">({{ chatStore.citations.length }})</span>
    </div>

    <!-- 引用列表 -->
    <div class="flex flex-col gap-3">
      <div
        v-for="group in citationsByKb"
        :key="group.kbName"
        class="flex flex-col gap-2"
      >
        <!-- 知识库分组标题 -->
        <div class="flex items-center gap-1.5 text-xs text-primary font-label">
          <span class="material-symbols-outlined text-[14px]">library_books</span>
          {{ group.kbName }}
        </div>

        <!-- 该知识库下的引用列表 -->
        <div class="flex flex-col gap-1.5 pl-4">
          <div
            v-for="citation in group.citations"
            :key="citation.citationId"
            class="flex items-start gap-2 p-2 bg-surface-container-high rounded-lg"
          >
            <!-- 引用序号 -->
            <span
              class="flex-shrink-0 w-5 h-5 flex items-center justify-center bg-primary text-on-primary text-[10px] font-bold rounded"
            >
              {{ group.citations.indexOf(citation) + 1 }}
            </span>

            <!-- 引用内容 -->
            <div class="flex flex-col gap-0.5 min-w-0">
              <!-- 文档标题 -->
              <span class="text-xs font-medium text-on-surface truncate">
                {{ formatDocTitle(citation.docTitle) }}
              </span>
              <!-- 引用文本 -->
              <span class="text-xs text-outline leading-relaxed">
                "{{ truncateQuote(citation.quote) }}"
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
