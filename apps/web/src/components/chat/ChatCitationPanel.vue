<script setup lang="ts">
import { computed, ref, watch, nextTick } from 'vue';
import { storeToRefs } from 'pinia';
import { useChatStore } from '@/stores/chat';
import DocumentPreviewModal from '@/components/document/DocumentPreviewModal.vue';

const chatStore = useChatStore();
const { highlightedCitationIndex } = storeToRefs(chatStore);

const previewOpen = ref(false);
const previewDoc = ref<{
  kbId: string;
  documentId: string;
  fileName: string;
  fileType: string;
} | null>(null);

/** 按知识库 → 文档分组（同文档多 chunk 合并） */
const groupedCitations = computed(() => {
  const groups: Record<
    string,
    {
      kbName: string;
      kbId: string;
      docId: string;
      docTitle: string;
      fileType?: string;
      fileName?: string;
      chunks: typeof chatStore.citations;
    }
  > = {};

  for (const c of chatStore.citations) {
    const key = `${c.kbId}:${c.docId}`;
    if (!groups[key]) {
      groups[key] = {
        kbName: c.kbName || `知识库 #${c.kbId.slice(0, 8)}`,
        kbId: c.kbId,
        docId: c.docId,
        docTitle: c.docTitle,
        fileType: c.fileType,
        fileName: c.fileName,
        chunks: [],
      };
    }
    groups[key].chunks.push(c);
  }
  return Object.values(groups);
});

function handleViewSource(doc: (typeof groupedCitations.value)[0]) {
  previewDoc.value = {
    kbId: doc.kbId,
    documentId: doc.docId,
    fileName: doc.fileName || doc.docTitle || '未知文档',
    fileType: doc.fileType || inferFileType(doc.docTitle || ''),
  };
  previewOpen.value = true;
}

function inferFileType(fileName: string): string {
  const ext = (fileName || '').split('.').pop()?.toLowerCase() ?? '';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'txt') return 'txt';
  return '';
}

function handleCitationClick(indices: number[]) {
  const idx = indices[0];
  if (idx > 0) {
    chatStore.highlightedCitationIndex = idx;
    setTimeout(() => {
      if (chatStore.highlightedCitationIndex === idx) {
        chatStore.highlightedCitationIndex = null;
      }
    }, 3000);
  }
}

function isDocHighlighted(chunks: typeof chatStore.citations): boolean {
  return chunks.some(
    (c) => c.index === highlightedCitationIndex.value,
  );
}

// 监听来自文内角标的高亮 → 滚动面板到对应条目
watch(highlightedCitationIndex, (index) => {
  if (index !== null && index > 0) {
    nextTick(() => {
      const el = document.getElementById(`citation-${index}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }
});
</script>

<template>
  <aside
    v-if="chatStore.citations.length > 0"
    class="w-80 border-l border-outline-variant/10 bg-surface-container-low overflow-y-auto flex-shrink-0"
  >
    <div class="p-4">
      <!-- 检索进度提示 -->
      <div
        class="flex items-center gap-2 mb-4 px-2 py-2 rounded-lg bg-primary/5 border border-primary/10"
      >
        <span class="material-symbols-outlined text-primary text-base">search_check</span>
        <span class="text-sm text-on-surface">
          检索到
          <span class="font-semibold text-primary">{{ chatStore.citations.length }}</span>
          条知识库资料
        </span>
      </div>

      <!-- 按文档分组列表 -->
      <div class="space-y-3">
        <div
          v-for="doc in groupedCitations"
          :key="`${doc.kbId}:${doc.docId}`"
          :id="`citation-${doc.chunks[0]?.index || 0}`"
          class="p-3 bg-surface-container rounded-lg border border-outline-variant/10 hover:border-primary/20 transition-colors group"
          :class="{
            'border-primary/40 ring-1 ring-primary/20 bg-primary/5': isDocHighlighted(doc.chunks),
          }"
          @click="handleCitationClick(doc.chunks.map((c) => c.index))"
        >
          <!-- 标题行 + 序号角标 -->
          <div class="flex items-start gap-2 mb-2">
            <span
              v-if="doc.chunks[0]"
              class="inline-flex items-center justify-center w-5 h-5 rounded text-[10px] font-bold bg-primary/10 text-primary flex-shrink-0 mt-0.5"
            >
              {{ doc.chunks[0].index }}
            </span>
            <div class="min-w-0">
              <span class="text-sm font-medium text-on-surface leading-snug line-clamp-2">
                {{ doc.docTitle }}
              </span>
              <span
                v-if="doc.fileType"
                class="inline-block mt-1 text-[10px] text-outline bg-surface-container-high px-1.5 py-px rounded uppercase"
              >
                {{ doc.fileType }}
              </span>
            </div>
          </div>

          <!-- 多个 chunk 时显示各 chunk 摘要 -->
          <div
            v-for="chunk in doc.chunks"
            :key="chunk.citationId"
            class="mb-1 ml-7"
          >
            <p class="text-xs text-outline leading-relaxed line-clamp-1">
              <span class="text-[10px] font-bold text-primary/70 mr-1">[{{ chunk.index }}]</span>
              "{{ chunk.quote }}"
            </p>
          </div>

          <!-- 底部操作栏 -->
          <div class="flex items-center justify-between ml-7 mt-2">
            <span class="text-[10px] text-outline truncate max-w-[140px]">
              {{ doc.kbName }}
            </span>
            <button
              class="text-[10px] text-primary hover:underline flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
              @click.stop="handleViewSource(doc)"
            >
              <span class="material-symbols-outlined text-[12px]">open_in_new</span>
              查看来源
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- 文档预览弹窗 -->
    <DocumentPreviewModal
      v-if="previewDoc"
      :open="previewOpen"
      :kb-id="previewDoc.kbId"
      :document-id="previewDoc.documentId"
      :file-name="previewDoc.fileName"
      :file-type="previewDoc.fileType"
      @close="previewOpen = false"
    />
  </aside>
</template>

<style scoped>
.line-clamp-1 {
  display: -webkit-box;
  -webkit-line-clamp: 1;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.line-clamp-2 {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
</style>
