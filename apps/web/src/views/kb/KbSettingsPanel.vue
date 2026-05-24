<script setup lang="ts">
/**
 * 设置面板 — 知识库名称/描述/可见性/公开选项
 */
defineProps<{
  /** 知识库名称 */
  name: string;
  /** 知识库描述 */
  description: string;
  /** 可见性 */
  visibility: "private" | "shared";
  /** 是否公开 */
  isPublic: boolean;
  /** 是否允许公开下载 */
  allowPublicDownload: boolean;
  /** 错误信息 */
  error: string;
  /** 是否正在保存 */
  isSaving: boolean;
  /** 是否可删除 */
  canDelete: boolean;
}>();
</script>

<template>
  <div class="flex flex-col gap-6">
    <div class="bg-surface-container-low rounded-xl overflow-hidden shadow-lg border border-outline-variant/5">
      <div class="px-6 py-4 border-b border-outline-variant/5 bg-surface-container-high/30">
        <h4 class="text-lg font-headline font-bold">知识库设置</h4>
      </div>
      <div class="px-6 py-6 space-y-5">
        <!-- 名称 -->
        <div>
          <label class="text-sm font-medium text-on-surface mb-2 block">名称</label>
          <input :value="name" type="text" class="w-full bg-surface-container-highest border border-outline-variant/15 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary" maxlength="20" @input="$emit('update:name', ($event.target as HTMLInputElement).value)" />
        </div>
        <!-- 描述 -->
        <div>
          <label class="text-sm font-medium text-on-surface mb-2 block">描述</label>
          <textarea :value="description" rows="3" class="w-full bg-surface-container-highest border border-outline-variant/15 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary resize-none" maxlength="200" @input="$emit('update:description', ($event.target as HTMLTextAreaElement).value)" />
        </div>
        <!-- 可见性 -->
        <div>
          <label class="text-sm font-medium text-on-surface mb-2 block">可见性</label>
          <div class="flex gap-3">
            <button class="flex-1 py-3 rounded-xl text-sm font-medium border transition-colors" :class="visibility === 'private' ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant/15 text-outline'" @click="$emit('update:visibility', 'private')">私有</button>
            <button class="flex-1 py-3 rounded-xl text-sm font-medium border transition-colors" :class="visibility === 'shared' ? 'border-primary bg-primary/10 text-primary' : 'border-outline-variant/15 text-outline'" @click="$emit('update:visibility', 'shared')">共享</button>
          </div>
        </div>
        <!-- 公开选项 (仅共享) -->
        <template v-if="visibility === 'shared'">
          <div class="flex items-center justify-between">
            <span class="text-sm">公开访问</span>
            <input type="checkbox" :checked="isPublic" :disabled="visibility !== 'shared'" @change="$emit('update:isPublic', ($event.target as HTMLInputElement).checked)" />
          </div>
          <div class="flex items-center justify-between">
            <span class="text-sm">允许公开下载</span>
            <input type="checkbox" :checked="allowPublicDownload" :disabled="visibility !== 'shared'" @change="$emit('update:allowPublicDownload', ($event.target as HTMLInputElement).checked)" />
          </div>
        </template>
      </div>
      <p v-if="error" class="text-sm text-error px-6 pb-4">{{ error }}</p>
      <div class="px-6 py-4 border-t border-outline-variant/5 flex items-center justify-between">
        <button class="btn-primary" :disabled="isSaving" @click="$emit('save')">{{ isSaving ? "保存中..." : "保存设置" }}</button>
        <button v-if="canDelete" class="btn-outline text-error" @click="$emit('delete')">删除知识库</button>
      </div>
    </div>
  </div>
</template>
