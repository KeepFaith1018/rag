<script setup lang="ts">
import { useChatStore } from '@/stores/chat';

const chatStore = useChatStore();

/** 警告类型配置 */
const warningConfig: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  LOW_CONFIDENCE: {
    label: '低置信度',
    icon: 'warning',
    color: 'text-amber-400',
    bg: 'bg-amber-400/10',
  },
  PARTIAL_ANSWER: {
    label: '部分回答',
    icon: 'help',
    color: 'text-blue-400',
    bg: 'bg-blue-400/10',
  },
  INSUFFICIENT_CONTEXT: {
    label: '上下文不足',
    icon: 'info',
    color: 'text-orange-400',
    bg: 'bg-orange-400/10',
  },
};

/**
 * 关闭指定警告
 */
function dismissWarning(index: number) {
  chatStore.agentWarnings.splice(index, 1);
}
</script>

<template>
  <div
    v-if="chatStore.agentWarnings.length > 0"
    class="px-6 py-2 space-y-2"
  >
    <div
      v-for="(warning, idx) in chatStore.agentWarnings"
      :key="idx"
      :class="[
        'flex items-start gap-3 px-4 py-3 rounded-xl border',
        warningConfig[warning.code]?.bg || 'bg-surface-container',
        warningConfig[warning.code]?.color || 'text-outline',
        'border-outline-variant/10',
      ]"
    >
      <!-- 图标 -->
      <span
        :class="[
          'material-symbols-outlined text-base mt-0.5',
          warningConfig[warning.code]?.color || 'text-outline',
        ]"
      >
        {{ warningConfig[warning.code]?.icon || 'info' }}
      </span>

      <!-- 内容 -->
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2">
          <span
            :class="[
              'text-xs font-semibold uppercase tracking-wider',
              warningConfig[warning.code]?.color || 'text-outline',
            ]"
          >
            {{ warningConfig[warning.code]?.label || warning.code }}
          </span>
        </div>
        <p class="text-sm text-on-surface mt-0.5 leading-relaxed">
          {{ warning.message }}
        </p>
      </div>

      <!-- 关闭按钮 -->
      <button
        class="p-1 text-outline hover:text-on-surface transition-colors"
        @click="dismissWarning(idx)"
      >
        <span class="material-symbols-outlined text-base">close</span>
      </button>
    </div>
  </div>
</template>
