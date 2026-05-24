<script setup lang="ts">
/**
 * 文档面板 — 纯展示组件，所有逻辑由父组件 KbDetailView 提供。
 */
import type { KnowledgeBaseDocumentItem, KnowledgeBaseDocumentStatus } from "@/types/knowledge-base";

defineProps<{
  /** 是否允许上传 */
  canUpload: boolean;
  /** 文档列表 */
  documents: KnowledgeBaseDocumentItem[];
  /** 文档总数 */
  totalCount: number;
  /** 当前筛选状态 */
  activeStatus: KnowledgeBaseDocumentStatus | "all";
  /** 是否正在上传 */
  isUploading: boolean;
  /** 上传进度百分比 */
  uploadProgress: number;
  /** 上传文件名 */
  uploadFileName: string;
  /** 上传状态文本 */
  uploadStatusText: string;
  /** 上传会话 ID */
  uploadId: string | null;
  /** 知识库权限信息 */
  kbPermissions: Record<string, boolean>;
}>();
</script>

<template>
  <div class="flex flex-col gap-6">
    <!-- 上传区域 -->
    <div
      class="bg-surface-container-low p-8 rounded-xl border border-dashed border-outline-variant/20 flex flex-col items-center justify-center group transition-all shadow-md"
      :class="canUpload ? 'hover:border-primary/40 cursor-pointer' : 'opacity-80 cursor-not-allowed'"
      @click="$emit('openFilePicker')"
    >
      <div class="w-16 h-16 bg-surface-container-high rounded-full flex items-center justify-center mb-4 transition-transform shadow-inner" :class="canUpload ? 'group-hover:scale-110' : ''">
        <span class="material-symbols-outlined text-3xl text-primary drop-shadow-[0_0_8px_rgba(195,192,255,0.5)]">cloud_upload</span>
      </div>
      <h3 class="font-headline text-lg font-bold mb-1">{{ canUpload ? "上传知识资产" : "当前角色无上传权限" }}</h3>
      <p class="text-on-surface-variant text-sm mb-6 text-center">{{ canUpload ? uploadStatusText : "你可以浏览文档列表，但上传入口仅对有权限的角色开放。" }}</p>
      <div v-if="isUploading || uploadProgress > 0" class="w-full max-w-xl mb-6">
        <div class="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden shadow-inner">
          <div class="bg-primary h-full rounded-full transition-all duration-300" :style="{ width: `${uploadProgress}%` }" />
        </div>
        <div class="mt-3 flex items-center justify-between text-xs text-on-surface-variant">
          <span class="truncate">{{ uploadFileName || "等待选择文件" }}</span>
          <span>{{ uploadProgress }}%</span>
        </div>
      </div>
      <div class="flex items-center gap-3">
        <button :disabled="!canUpload" class="btn-primary" @click.stop="$emit('openFilePicker')">上传文件</button>
        <button v-if="isUploading && uploadId" class="btn-outline" @click.stop="$emit('cancelUpload')">取消上传</button>
      </div>
    </div>

    <!-- 文档列表 -->
    <div class="bg-surface-container-low rounded-xl overflow-hidden shadow-lg border border-outline-variant/5">
      <div class="px-6 py-4 flex flex-col gap-4 border-b border-outline-variant/5 bg-surface-container-high/30">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <h4 class="text-sm font-bold uppercase tracking-widest text-on-surface-variant font-label">当前文件 ({{ totalCount }})</h4>
          <div class="relative w-full md:w-80">
            <span class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline text-lg">search</span>
            <input type="text" placeholder="搜索文档标题或原文件名" class="w-full bg-surface-container-highest border border-outline-variant/15 rounded-xl pl-12 pr-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary" @input="$emit('update:searchKeyword', ($event.target as HTMLInputElement).value)" />
          </div>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button v-for="option in (['all','queued','parsing','chunking','embedding','ready','failed'] as const)" :key="option" type="button" class="filter-chip" :class="{ 'filter-chip-active': activeStatus === option }" @click="$emit('setStatus', option)">{{ option === 'all' ? '全部' : option === 'queued' ? '处理中' : option === 'parsing' ? '解析中' : option === 'chunking' ? '切块中' : option === 'embedding' ? '向量化' : option === 'ready' ? '已就绪' : '失败' }}</button>
        </div>
      </div>

      <div v-if="documents.length" class="divide-y divide-outline-variant/5">
        <div v-for="doc in documents" :key="doc.id" class="px-6 py-5 flex flex-col gap-4 hover:bg-surface-container-high/40 transition-colors">
          <div class="flex flex-col sm:flex-row sm:items-start gap-4">
            <div class="w-11 h-11 bg-surface-container-high rounded-xl flex items-center justify-center flex-shrink-0">
              <span class="material-symbols-outlined text-primary">description</span>
            </div>
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-2 mb-2">
                <span class="font-semibold text-sm truncate">{{ doc.title }}</span>
                <span class="status-badge" :class="doc.status === 'ready' ? 'status-badge-ready' : doc.status === 'failed' ? 'status-badge-error' : ''">{{ doc.status }}</span>
              </div>
              <p class="text-xs text-on-surface-variant truncate">原文件：{{ doc.originalFilename }}</p>
              <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-on-surface-variant">
                <span>大小：{{ doc.fileSize }}</span>
                <span>切片：{{ doc.chunkCount }}</span>
                <span>上传者：{{ doc.uploader?.fullName || "未知" }}</span>
              </div>
            </div>
            <div class="flex items-center gap-2">
              <button class="btn-outline-sm" @click="$emit('previewDocument', doc)">预览</button>
              <button v-if="kbPermissions['canDownload']" class="btn-outline-sm" @click="$emit('downloadDocument', doc)">下载</button>
              <button v-if="kbPermissions['canReparse']" class="btn-outline-sm" @click="$emit('reparseDocument', doc)">重解析</button>
              <button v-if="kbPermissions['canDeleteAnyDocument'] || kbPermissions['canDeleteOwnDocument']" class="btn-outline-sm !text-error" @click="$emit('removeDocument', doc)">删除</button>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="px-6 py-12 flex flex-col items-center justify-center text-center">
        <span class="material-symbols-outlined text-4xl text-outline mb-3">folder_open</span>
        <div class="text-lg font-headline font-semibold">暂无文档</div>
        <div class="text-sm text-outline mt-1">该知识库当前没有符合筛选条件的文档。</div>
      </div>
    </div>
  </div>
</template>
