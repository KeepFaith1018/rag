<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount } from 'vue';
import { useChatStore } from '@/stores/chat';

const chatStore = useChatStore();

const isOpen = ref(false);
const dropdownRef = ref<HTMLElement | null>(null);

/** 供应商图标映射 */
const providerIcon: Record<string, string> = {
  openai: 'smart_toy',
  '百炼': 'cloud',
  dashscope: 'cloud',
  anthropic: 'psychology',
  azure: 'cloud',
  default: 'smart_toy',
};

/**
 * 切换下拉
 */
function toggleDropdown() {
  isOpen.value = !isOpen.value;
}

/**
 * 关闭下拉
 */
function closeDropdown() {
  isOpen.value = false;
}

/**
 * 选择模型
 */
function selectModel(configId: string) {
  const model = chatStore.availableModels.find((m) => m.configId === configId);
  if (model) {
    chatStore.setSelectedModel(model);
  }
  closeDropdown();
}

/**
 * 获取当前模型图标
 */
function getCurrentIcon(): string {
  const provider = chatStore.selectedModel?.provider || '';
  return providerIcon[provider] ?? providerIcon['default'] ?? 'smart_toy';
}

/**
 * 点击外部关闭下拉
 */
function handleClickOutside(e: MouseEvent) {
  if (dropdownRef.value && !dropdownRef.value.contains(e.target as Node)) {
    closeDropdown();
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside);
});
</script>

<template>
  <div ref="dropdownRef" class="relative">
    <!-- 当前选中 -->
    <button
      class="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium bg-surface-container-low hover:bg-surface-container text-on-surface transition-colors border border-outline-variant/10"
      @click="toggleDropdown"
    >
      <span class="material-symbols-outlined text-[16px] text-primary">
        {{ getCurrentIcon() }}
      </span>
      <span class="max-w-[140px] truncate">
        {{ chatStore.selectedModel?.modelName || '选择模型' }}
      </span>
      <span class="material-symbols-outlined text-[14px] text-outline">
        {{ isOpen ? 'expand_more' : 'expand_less' }}
      </span>
    </button>

    <!-- 下拉列表 -->
    <Transition
      enter-active-class="transition-all duration-150 ease-out"
      enter-from-class="opacity-0 scale-95"
      enter-to-class="opacity-100 scale-100"
      leave-active-class="transition-all duration-100 ease-in"
      leave-from-class="opacity-100 scale-100"
      leave-to-class="opacity-0 scale-95"
    >
      <div
        v-if="isOpen"
        class="absolute left-0 bottom-full mb-2 w-64 bg-surface-container-high rounded-xl border border-outline-variant/10 shadow-2xl overflow-hidden z-50"
      >
        <div class="p-2">
          <div class="text-[10px] text-outline uppercase tracking-wider px-2 py-1 font-semibold">
            可用模型
          </div>

          <button
            v-for="model in chatStore.availableModels"
            :key="model.configId"
            :class="[
              'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors',
              chatStore.selectedModel?.configId === model.configId
                ? 'bg-primary-container/50 text-on-primary-container'
                : 'hover:bg-surface-container-low text-on-surface',
            ]"
            @click="selectModel(model.configId)"
          >
            <span class="material-symbols-outlined text-[18px] text-primary">
              {{ providerIcon[model.provider] ?? providerIcon.default }}
            </span>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium truncate">{{ model.modelName }}</div>
              <div class="flex items-center gap-2 mt-0.5">
                <span class="text-[10px] text-outline">{{ model.provider }}</span>
                <span
                  v-if="model.source === 'system'"
                  class="text-[10px] px-1.5 py-0.5 bg-primary/10 text-primary rounded"
                >
                  系统
                </span>
                <span
                  v-else
                  class="text-[10px] px-1.5 py-0.5 bg-surface-container text-outline rounded"
                >
                  自定义
                </span>
              </div>
            </div>
            <!-- 选中指示器 -->
            <span
              v-if="chatStore.selectedModel?.configId === model.configId"
              class="material-symbols-outlined text-primary text-[16px]"
            >
              check
            </span>
          </button>

          <!-- 无模型提示 -->
          <div
            v-if="chatStore.availableModels.length === 0"
            class="px-3 py-6 text-center text-xs text-outline"
          >
            <span class="material-symbols-outlined text-3xl">info</span>
            <p class="mt-2">暂无可用模型</p>
          </div>
        </div>
      </div>
    </Transition>
  </div>
</template>
