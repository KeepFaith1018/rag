<script setup lang="ts">
/**
 * ChatModelSelector - 模型选择器
 *
 * 显示当前用户可用模型列表，支持每次发送消息前切换模型。
 */
import { ref, computed } from 'vue';
import { useChatStore } from '@/stores/chat';

const chatStore = useChatStore();

const isOpen = ref(false);

const currentModel = computed(() => chatStore.selectedModel);

const availableModels = computed(() => chatStore.availableModels);

const systemModels = computed(() =>
  availableModels.value.filter((m) => m.source === 'system'),
);

const userModels = computed(() =>
  availableModels.value.filter((m) => m.source === 'user'),
);

/**
 * 切换下拉菜单。
 */
function toggleDropdown() {
  isOpen.value = !isOpen.value;
}

/**
 * 选中模型。
 */
function selectModel(model: (typeof availableModels.value)[0]) {
  chatStore.setSelectedModel(model);
  isOpen.value = false;
}

/**
 * 关闭下拉菜单。
 */
function closeDropdown() {
  isOpen.value = false;
}

/**
 * 判断是否为当前选中的模型。
 */
function isSelected(model: (typeof availableModels.value)[0]): boolean {
  return currentModel.value?.configId === model.configId;
}
</script>

<template>
  <div class="relative">
    <!-- 触发按钮 -->
    <button
      class="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-label transition-all"
      :class="[
        isOpen
          ? 'bg-surface-container-high text-on-surface'
          : 'text-outline hover:text-on-surface',
      ]"
      @click="toggleDropdown"
    >
      <span class="material-symbols-outlined text-[14px]">smart_toy</span>
      <span>{{ currentModel?.modelName || '选择模型' }}</span>
      <span
        class="material-symbols-outlined text-[14px] transition-transform"
        :class="{ 'rotate-180': isOpen }"
      >
        expand_more
      </span>
    </button>

    <!-- 下拉菜单 -->
    <Transition
      enter-active-class="transition duration-150 ease-out"
      enter-from-class="opacity-0 scale-95 -translate-y-1"
      enter-to-class="opacity-100 scale-100 translate-y-0"
      leave-active-class="transition duration-100 ease-in"
      leave-from-class="opacity-100 scale-100 translate-y-0"
      leave-to-class="opacity-0 scale-95 -translate-y-1"
    >
      <div
        v-if="isOpen"
        class="absolute bottom-full left-0 mb-2 w-64 bg-surface-container-high rounded-xl border border-outline-variant/10 shadow-xl overflow-hidden z-50"
      >
        <!-- 系统模型 -->
        <div v-if="systemModels.length > 0" class="py-1">
          <div class="px-3 py-1.5 text-[10px] font-label uppercase tracking-widest text-outline">
            系统模型
          </div>
          <button
            v-for="model in systemModels"
            :key="model.configId"
            class="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
            :class="[
              isSelected(model)
                ? 'bg-primary-container text-on-primary-container'
                : 'hover:bg-surface-container-low text-on-surface',
            ]"
            @click="selectModel(model)"
          >
            <span class="material-symbols-outlined text-[16px]">computer</span>
            <div class="flex flex-col">
              <span class="text-xs font-label">{{ model.modelName }}</span>
              <span class="text-[10px] text-outline">{{ model.provider }}</span>
            </div>
            <span
              v-if="isSelected(model)"
              class="material-symbols-outlined text-primary text-[14px] ml-auto"
            >
              check
            </span>
          </button>
        </div>

        <!-- 用户模型 -->
        <div v-if="userModels.length > 0" class="py-1 border-t border-outline-variant/10">
          <div class="px-3 py-1.5 text-[10px] font-label uppercase tracking-widest text-outline">
            我的模型
          </div>
          <button
            v-for="model in userModels"
            :key="model.configId"
            class="w-full flex items-center gap-2 px-3 py-2 text-left transition-colors"
            :class="[
              isSelected(model)
                ? 'bg-primary-container text-on-primary-container'
                : 'hover:bg-surface-container-low text-on-surface',
            ]"
            @click="selectModel(model)"
          >
            <span class="material-symbols-outlined text-[16px]">person</span>
            <div class="flex flex-col">
              <span class="text-xs font-label">{{ model.modelName }}</span>
              <span class="text-[10px] text-outline">{{ model.provider }}</span>
            </div>
            <span
              v-if="isSelected(model)"
              class="material-symbols-outlined text-primary text-[14px] ml-auto"
            >
              check
            </span>
          </button>
        </div>
      </div>
    </Transition>

    <!-- 点击外部关闭 -->
    <div
      v-if="isOpen"
      class="fixed inset-0 z-40"
      @click="closeDropdown"
    ></div>
  </div>
</template>
