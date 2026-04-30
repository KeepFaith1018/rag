<script setup lang="ts">
/**
 * ChatStatusBanner - Agent 警告状态横幅
 *
 * 展示警告状态：证据不足、部分回答、建议联网搜索等。
 */
import { computed } from 'vue';
import { useChatStore } from '@/stores/chat';

const chatStore = useChatStore();

/** 警告配置 */
const warningConfig: Record<string, { icon: string; label: string; color: string }> = {
  LOW_CONFIDENCE: {
    icon: 'priority_low',
    label: '置信度较低',
    color: 'text-amber-500',
  },
  PARTIAL_ANSWER: {
    icon: 'help',
    label: '部分回答',
    color: 'text-amber-500',
  },
  WEB_SEARCH_CANDIDATE: {
    icon: 'public',
    label: '建议联网搜索',
    color: 'text-blue-500',
  },
  INSUFFICIENT_CONTEXT: {
    icon: 'info',
    label: '证据不足',
    color: 'text-orange-500',
  },
};

/**
 * 获取警告配置。
 */
function getWarningConfig(code: string) {
  return (
    warningConfig[code] || {
      icon: 'warning',
      label: code,
      color: 'text-outline',
    }
  );
}
</script>

<template>
  <!-- 仅在有警告时展示 -->
  <div
    v-if="chatStore.hasWarnings"
    class="flex items-center gap-3 px-4 py-3 bg-amber-500/10 rounded-xl border border-amber-500/20"
  >
    <!-- 警告图标 -->
    <span class="material-symbols-outlined text-amber-500 text-[20px]">
      warning
    </span>

    <!-- 警告列表 -->
    <div class="flex-1 flex flex-wrap items-center gap-2">
      <template v-for="warning in chatStore.agentWarnings" :key="warning.code">
        <div
          class="flex items-center gap-1.5 px-2 py-1 bg-amber-500/10 rounded-lg"
        >
          <span
            class="material-symbols-outlined text-[14px]"
            :class="getWarningConfig(warning.code).color"
          >
            {{ getWarningConfig(warning.code).icon }}
          </span>
          <span
            class="text-xs font-label"
            :class="getWarningConfig(warning.code).color"
          >
            {{ getWarningConfig(warning.code).label }}
          </span>
        </div>
      </template>
    </div>

    <!-- 提示文字 -->
    <span class="text-xs text-outline italic">
      仅供参考，请核实重要信息
    </span>
  </div>
</template>
