<script setup lang="ts">
import { computed } from 'vue';
import { useChatStore } from '@/stores/chat';

const chatStore = useChatStore();

/** Agent 阶段配置 */
const phaseConfig: Record<string, { label: string; icon: string; color: string }> = {
  planning: { label: '规划中', icon: 'psychology', color: 'text-purple-400' },
  retrieving: { label: '检索中', icon: 'search', color: 'text-blue-400' },
  reranking: { label: '重排中', icon: 'sort', color: 'text-cyan-400' },
  verifying: { label: '校验中', icon: 'verified', color: 'text-amber-400' },
  writing: { label: '生成中', icon: 'edit_note', color: 'text-green-400' },
  done: { label: '完成', icon: 'check_circle', color: 'text-primary' },
};

const phases = ['planning', 'retrieving', 'reranking', 'verifying', 'writing', 'done'];

const currentPhaseIndex = computed(() => {
  if (!chatStore.agentPhase) return -1;
  return phases.indexOf(chatStore.agentPhase);
});
</script>

<template>
  <div
    v-if="chatStore.agentPhase"
    class="flex items-center gap-4 px-6 py-3 bg-surface-container-low border-b border-outline-variant/10"
  >
    <!-- 阶段指示器 -->
    <div class="flex items-center gap-1.5">
      <template v-for="(phase, idx) in phases" :key="phase">
        <div
          :class="[
            'w-2 h-2 rounded-full transition-all duration-300',
            idx < currentPhaseIndex
              ? 'bg-primary scale-110'
              : idx === currentPhaseIndex
                ? 'bg-primary animate-pulse scale-125'
                : 'bg-surface-variant',
          ]"
        />
        <div
          v-if="idx < phases.length - 1"
          :class="[
            'w-6 h-px transition-colors',
            idx < currentPhaseIndex ? 'bg-primary' : 'bg-surface-variant',
          ]"
        />
      </template>
    </div>

    <!-- 当前阶段标签 -->
    <div class="flex items-center gap-2">
      <span
        :class="['material-symbols-outlined text-base', phaseConfig[chatStore.agentPhase]?.color]"
      >
        {{ phaseConfig[chatStore.agentPhase]?.icon || 'circle' }}
      </span>
      <span class="text-sm font-medium text-on-surface">
        {{ chatStore.agentPhaseLabel || phaseConfig[chatStore.agentPhase]?.label }}
      </span>
      <span
        v-if="chatStore.agentPhaseDetail"
        class="text-xs text-outline"
      >
        — {{ chatStore.agentPhaseDetail }}
      </span>
    </div>
  </div>
</template>
