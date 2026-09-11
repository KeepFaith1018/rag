<script setup lang="ts">
import { ref } from "vue";
import type { KnowledgeBaseDocumentItem, KnowledgeBaseDocumentStatus } from "@/types/knowledge-base";
import type { UploadQueueTask } from "@/modules/document-upload/composables/useUploadQueue";

const statusLabels: Record<string, string> = {
  processing: "待处理",
  ready: "已就绪",
  failed: "失败",
  deleting: "删除中",
  deleted: "已删除",
};

const props = defineProps<{
  canUpload: boolean;
  documents: KnowledgeBaseDocumentItem[];
  totalCount: number;
  activeStatus: KnowledgeBaseDocumentStatus | "all";
  queueTasks: UploadQueueTask[];
  queueProgress: number;
  queueBusy: boolean;
  canDownload: boolean;
  canDeleteAnyDocument: boolean;
  canDeleteOwnDocument: boolean;
}>();

const emit = defineEmits<{
  openFilePicker: [];
  dropFile: [files: FileList];
  pauseAll: [];
  resumeAll: [];
  clearCompleted: [];
  retryTask: [taskId: string];
  cancelTask: [taskId: string];
  setStatus: [status: KnowledgeBaseDocumentStatus | "all"];
  updateSearchKeyword: [value: string];
  previewDocument: [doc: KnowledgeBaseDocumentItem];
  downloadDocument: [doc: KnowledgeBaseDocumentItem];
  removeDocument: [doc: KnowledgeBaseDocumentItem];
  updateDocument: [doc: KnowledgeBaseDocumentItem, title: string];
}>();

const isDragOver = ref(false);

function onDrop(event: DragEvent) {
  event.preventDefault();
  isDragOver.value = false;
  if (event.dataTransfer?.files.length) emit("dropFile", event.dataTransfer.files);
}

function formatBytes(value: string | number) {
  const bytes = Number(value);
  if (!Number.isFinite(bytes)) return "未知";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function statusLabel(status: string) {
  return statusLabels[status] ?? status;
}

function taskStatusLabel(task: UploadQueueTask) {
  if (task.status === "hashing") return "计算文件指纹";
  if (task.status === "initializing") return "初始化上传";
  if (task.status === "uploading") return "上传分片";
  if (task.status === "completing") return "校验并登记";
  if (task.status === "instantCompleted") return "秒传完成";
  if (task.status === "completed") return "已完成";
  if (task.status === "paused") return "已暂停";
  if (task.status === "failed") return "失败";
  if (task.status === "cancelled") return "已取消";
  return "等待中";
}

function canDelete() {
  return props.canDeleteAnyDocument || props.canDeleteOwnDocument;
}
</script>

<template>
  <div class="flex flex-col gap-6">
    <div
      class="bg-surface-container-low p-8 rounded-xl border border-dashed border-outline-variant/20 flex flex-col items-center justify-center group transition-all shadow-md"
      :class="{
        'hover:border-primary/40 cursor-pointer': canUpload,
        'opacity-80 cursor-not-allowed': !canUpload,
        '!border-primary !bg-primary/5': isDragOver && canUpload,
      }"
      @click="canUpload && emit('openFilePicker')"
      @dragover.prevent="isDragOver = canUpload"
      @dragleave="isDragOver = false"
      @drop="canUpload && onDrop($event)"
    >
      <div class="w-16 h-16 bg-surface-container-high rounded-full flex items-center justify-center mb-4">
        <span class="material-symbols-outlined text-3xl text-primary">cloud_upload</span>
      </div>
      <h3 class="font-headline text-lg font-bold mb-1">{{ canUpload ? "上传知识资产" : "当前角色无上传权限" }}</h3>
      <p class="text-on-surface-variant text-sm mb-5 text-center">支持 PDF、DOC、DOCX、TXT、MD，单文件最大 20MB</p>
      <div v-if="queueTasks.length" class="w-full max-w-xl mb-5">
        <div class="flex items-center justify-between text-xs text-on-surface-variant mb-2">
          <span>批次进度</span><span>{{ queueProgress }}%</span>
        </div>
        <div class="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden">
          <div class="bg-primary h-full rounded-full transition-all duration-300" :style="{ width: `${queueProgress}%` }" />
        </div>
      </div>
      <div class="flex items-center gap-3">
        <button :disabled="!canUpload" class="btn-primary" @click.stop="emit('openFilePicker')">
          <span class="material-symbols-outlined text-[18px]">upload_file</span>选择文件
        </button>
        <button v-if="queueBusy" class="btn-outline" @click.stop="emit('pauseAll')">暂停</button>
        <button v-else-if="queueTasks.some((task) => task.status === 'paused')" class="btn-outline" @click.stop="emit('resumeAll')">继续</button>
        <button v-if="queueTasks.some((task) => task.status === 'cancelled')" class="btn-outline" @click.stop="emit('clearCompleted')">清理已取消</button>
      </div>
    </div>

    <div v-if="queueTasks.length" class="bg-surface-container-low rounded-xl border border-outline-variant/5 overflow-hidden">
      <div class="px-6 py-4 border-b border-outline-variant/5 flex items-center justify-between">
        <h4 class="text-sm font-bold">上传队列（{{ queueTasks.length }}）</h4>
        <span class="text-xs text-on-surface-variant">最多同时上传 2 个文件</span>
      </div>
      <div class="divide-y divide-outline-variant/5">
        <div v-for="task in queueTasks" :key="task.id" class="px-6 py-4 flex items-center gap-4">
          <span class="material-symbols-outlined text-primary">description</span>
          <div class="min-w-0 flex-1">
            <div class="flex items-center justify-between gap-3">
              <span class="text-sm truncate">{{ task.fileName }}</span>
              <span class="text-xs text-on-surface-variant">{{ task.progress }}%</span>
            </div>
            <div class="h-1.5 bg-surface-container-highest rounded-full overflow-hidden mt-2">
              <div class="h-full bg-primary transition-all" :style="{ width: `${task.progress}%` }" />
            </div>
            <div class="text-xs text-on-surface-variant mt-2">{{ taskStatusLabel(task) }} · {{ formatBytes(task.uploadedBytes) }} / {{ formatBytes(task.fileSize) }}<span v-if="task.errorMessage"> · {{ task.errorMessage }}</span></div>
          </div>
          <button v-if="task.status === 'failed'" class="btn-outline-sm" @click="emit('retryTask', task.id)">重试</button>
          <button v-if="['queued', 'hashing', 'initializing', 'uploading', 'completing', 'paused'].includes(task.status)" class="btn-outline-sm !text-error" @click="emit('cancelTask', task.id)">取消</button>
        </div>
      </div>
    </div>

    <div class="bg-surface-container-low rounded-xl overflow-hidden shadow-lg border border-outline-variant/5">
      <div class="px-6 py-4 flex flex-col gap-4 border-b border-outline-variant/5 bg-surface-container-high/30">
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <h4 class="text-sm font-bold uppercase tracking-widest text-on-surface-variant font-label">当前文件（{{ totalCount }}）</h4>
          <div class="relative w-full md:w-80">
            <span class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline text-lg">search</span>
            <input type="text" placeholder="搜索文档标题或原文件名" class="w-full bg-surface-container-highest border border-outline-variant/15 rounded-xl pl-12 pr-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary" @input="emit('updateSearchKeyword', ($event.target as HTMLInputElement).value)" />
          </div>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <button v-for="option in (['all', 'processing', 'ready', 'failed', 'deleting', 'deleted'] as const)" :key="option" type="button" class="filter-chip" :class="{ 'filter-chip-active': activeStatus === option }" @click="emit('setStatus', option)">{{ option === 'all' ? '全部' : statusLabel(option) }}</button>
        </div>
      </div>
      <div v-if="documents.length" class="divide-y divide-outline-variant/5">
        <div v-for="doc in documents" :key="doc.id" class="px-6 py-5 flex flex-col gap-4 hover:bg-surface-container-high/40 transition-colors">
          <div class="flex flex-col sm:flex-row sm:items-start gap-4">
            <div class="w-11 h-11 bg-surface-container-high rounded-xl flex items-center justify-center flex-shrink-0"><span class="material-symbols-outlined text-primary">description</span></div>
            <div class="flex-1 min-w-0">
              <div class="flex flex-wrap items-center gap-2 mb-2">
                <span class="font-semibold text-sm truncate">{{ doc.title }}</span>
                <span class="status-badge" :class="doc.status === 'ready' ? 'status-badge-ready' : doc.status === 'failed' ? 'status-badge-error' : ''">{{ statusLabel(doc.status) }}</span>
              </div>
              <p class="text-xs text-on-surface-variant truncate">原文件：{{ doc.originalFilename || doc.title }}</p>
              <div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-on-surface-variant"><span>大小：{{ formatBytes(doc.fileSize) }}</span><span>上传者：{{ doc.uploader?.fullName || doc.uploader?.email || "未知" }}</span><span v-if="doc.processingDeferred">暂不可检索</span></div>
            </div>
            <div class="flex items-center gap-2">
              <button v-if="props.canDeleteAnyDocument || props.canDeleteOwnDocument" class="btn-outline-sm" @click="emit('updateDocument', doc, doc.title)">改名</button>
              <button v-if="doc.fileExtension && ['.pdf', '.txt', '.md'].includes(doc.fileExtension)" class="btn-outline-sm" @click="emit('previewDocument', doc)">预览</button>
              <button v-if="canDownload" class="btn-outline-sm" @click="emit('downloadDocument', doc)">下载</button>
              <button v-if="canDelete()" class="btn-outline-sm !text-error" @click="emit('removeDocument', doc)">删除</button>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="px-6 py-12 flex flex-col items-center justify-center text-center"><span class="material-symbols-outlined text-4xl text-outline mb-3">folder_open</span><div class="text-lg font-headline font-semibold">暂无文档</div><div class="text-sm text-outline mt-1">该知识库当前没有符合条件的文档。</div></div>
    </div>
  </div>
</template>

<style scoped>
.btn-primary,.btn-outline,.btn-outline-sm{display:inline-flex;align-items:center;justify-content:center;gap:.5rem;border-radius:.5rem;font-size:.875rem;font-family:var(--font-headline);font-weight:500;transition:all .2s ease;cursor:pointer}
.btn-primary{padding:.5rem 1rem;background:var(--color-primary-container);color:var(--color-on-primary-container)}
.btn-outline{padding:.5rem 1rem;background:transparent;border:1px solid color-mix(in srgb,var(--color-outline-variant) 30%,transparent);color:var(--color-on-surface)}
.btn-outline-sm{padding:.3rem .7rem;font-size:.75rem;background:transparent;border:1px solid color-mix(in srgb,var(--color-outline-variant) 30%,transparent);color:var(--color-on-surface)}
.btn-primary:disabled{opacity:.5;cursor:not-allowed}
</style>
