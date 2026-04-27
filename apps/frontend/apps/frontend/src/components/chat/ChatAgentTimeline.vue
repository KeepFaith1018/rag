<script setup lang="ts">
/**
 * ChatAgentTimeline - Agent 工作流阶段时间线
 *
 * 展示当前 Agent 工作流阶段：planning -> retrieving -> reranking -> verifying -> writing -> done
 */
import { computed } from 'vue';
import { useChatStore } from '@/stores/chat';
import type { AgentPhase } from '@/modules/chat/types/stream';

const chatStore = useChatStore();

/** 所有阶段的定义 */
const phases: Array<{ key: AgentPhase; label: string; icon: string }> = [
  { key: 'planning', label: '规划中', icon: 'psychology' },
  { key: 'retrieving', label: '检索中', icon: 'search' },
  { key: 'reranking', label: '精排中', icon: 'sort' },
  { key: 'verifying', label: '校验中', icon: 'fact_check' },
  { key: 'writing', label: '生成中', icon: 'edit_note' },
  { key: 'done', label: '完成', icon: 'check_circle' },
];

/** 当前活跃的阶段索引 */
const activeIndex = computed(() => {
  const current = chatStore.agentPhase;
  if (!current) return -1;
  const index = phases.findIndex((p) => p.key === current);
  return index;
});

/** 是否正在处理中 */
const isProcessing = computed(
  () => chatStore.agentPhase !== null && chatStore.agentPhase !== 'done',
);

/** 当前阶段详情 */
const phaseDetail = computed(() => chatStore.agentPhaseDetail);
</script>

<template>
  <!-- 仅在 Agent 处理中展示 -->
  <div
    v-if="isProcessing"
    class="flex flex-col gap-3 px-4 py-3 bg-surface-container-low rounded-xl border border-outline-variant/10"
  >
    <!-- 阶段标签 -->
    <div class="flex items-center gap-2">
      <span class="material-symbols-outlined text-primary text-[18px] animate-pulse">
        auto_awesome
      </span>
      <span class="text-xs font-label uppercase tracking-widest text-primary">
        {{ chatStore.agentPhaseLabel || '处理中' }}
      </span>
    </div>

    <!-- 时间线 -->
    <div class="flex items-center gap-1">
      <template v-for="(phase, index) in phases" :key="phase.key">
        <!-- 阶段节点 -->
        <div class="flex items-center">
          <!-- 圆形节点 -->
          <div
            class="w-6 h-6 rounded-full flex items-center justify-center transition-all duration-300"
            :class="[
              index < activeIndex
                ? 'bg-primary text-on-primary'
                : index === activeIndex
                  ? 'bg-primary-container text-on-primary-container ring-2 ring-primary/30'
                  : 'bg-surface-container-high text-outline',
            ]"
          >
            <!-- 完成状态 -->
            <span
              v-if="index < activeIndex"
              class="material-symbols-outlined text-[14px]"
            >
              check
            </span>
            <!-- 当前状态 -->
            <span
              v-else-if="index === activeIndex"
              class="material-symbols-outlined text-[14px] animate-spin-slow"
              style="animation-duration: 2s"
            >
              {{ phase.icon }}
            </span>
            <!-- 等待状态 -->
            <span v-else class="material-symbols-outlined text-[14px] opacity-40">
              {{ phase.icon }}
            </span>
          </div>

          <!-- 连接线 -->
          <div
            v-if="index < phases.length - 1"
            class="w-8 h-0.5 transition-colors duration-300"
            :class="index < activeIndex ? 'bg-primary' : 'bg-surface-container-high'"
          ></div>
        </div>
      </template>
    </div>

    <!-- 阶段详情 -->
    <div
      v-if="phaseDetail"
      class="text-xs text-outline mt-1 pl-1"
    >
      {{ phaseDetail }}
    </div>
  </div>
</template>

<style scoped>
@keyframes spin-slow {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.animate-spin-slow {
  animation: spin-slow 2s linear infinite;
}
</style>
