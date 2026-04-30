<script setup lang="ts">
import type { KnowledgeBaseVisibility } from "@/types/knowledge-base";

type VisibilityFilter = KnowledgeBaseVisibility | "all";

const props = withDefaults(
  defineProps<{
    modelValue: VisibilityFilter;
    sortLabel?: string;
  }>(),
  {
    sortLabel: "修改日期",
  },
);

const emit = defineEmits<{
  (event: "update:modelValue", value: VisibilityFilter): void;
}>();

/**
 * 切换当前可见性过滤。
 */
function setFilter(filter: VisibilityFilter) {
  emit("update:modelValue", filter);
}
</script>

<template>
  <div class="flex items-center justify-between w-full gap-4">
    <div
      class="flex gap-2 bg-surface-container-low p-1.5 rounded-xl border border-outline-variant/10"
    >
      <button
        @click="setFilter('all')"
        :class="[
          'px-5 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 focus:outline-none',
          props.modelValue === 'all'
            ? 'bg-surface-container-high text-on-surface shadow-md'
            : 'text-outline hover:text-on-surface',
        ]"
      >
        全部
      </button>
      <button
        @click="setFilter('private')"
        :class="[
          'px-5 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 focus:outline-none',
          props.modelValue === 'private'
            ? 'bg-surface-container-high text-on-surface shadow-md'
            : 'text-outline hover:text-on-surface',
        ]"
      >
        私有
      </button>
      <button
        @click="setFilter('shared')"
        :class="[
          'px-5 py-1.5 rounded-lg text-sm font-medium transition-all duration-200 focus:outline-none',
          props.modelValue === 'shared'
            ? 'bg-surface-container-high text-on-surface shadow-md'
            : 'text-outline hover:text-on-surface',
        ]"
      >
        共享
      </button>
    </div>

    <div class="flex items-center gap-3">
      <span
        class="text-xs font-label uppercase tracking-widest text-outline hidden sm:inline-block"
      >
        排序方式：{{ props.sortLabel }}
      </span>
      <span class="material-symbols-outlined text-outline text-lg">
        tune
      </span>
    </div>
  </div>
</template>
