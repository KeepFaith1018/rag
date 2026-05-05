<script setup lang="ts">
import { ref, computed } from 'vue';
import { useChatStore } from '@/stores/chat';
import ChatModeToggle from './ChatModeToggle.vue';
import ChatKbSelector from './ChatKbSelector.vue';
import ChatModelSelector from './ChatModelSelector.vue';

const chatStore = useChatStore();
const isExpanded = ref(false);

/** 切换展开状态 */
function toggleExpanded() {
  isExpanded.value = !isExpanded.value;
}

/** 收缩状态显示文本 */
const compactStatus = computed(() => {
  const mode = chatStore.chatMode === 'chat' ? '普通对话' : 'RAG 问答';
  const kbCount = chatStore.selectedKbIds.length;
  const kbText = kbCount > 0 ? `${kbCount}个知识库` : '未选择';
  return { mode, kbText };
});
</script>

<template>
  <div class="relative">
    <!-- 紧凑状态栏 -->
    <button
      class="w-full flex items-center justify-between px-4 py-2 rounded-xl bg-surface-container-low/50 border border-outline-variant/10 hover:bg-surface-container-low transition-colors"
      @click="toggleExpanded"
    >
      <div class="flex items-center gap-4 text-xs">
        <!-- 模式指示 -->
        <div class="flex items-center gap-2">
          <span
            :class="[
              'w-2 h-2 rounded-full',
              chatStore.chatMode === 'chat' ? 'bg-blue-400' : 'bg-purple-400',
            ]"
          ></span>
          <span class="text-on-surface">{{ compactStatus.mode }}</span>
        </div>

        <div class="w-px h-3 bg-outline-variant/30"></div>

        <!-- 知识库指示 -->
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-[14px] text-outline">library_books</span>
          <span class="text-outline">{{ compactStatus.kbText }}</span>
        </div>

        <div class="w-px h-3 bg-outline-variant/30"></div>

        <!-- 模型指示 -->
        <div class="flex items-center gap-2">
          <span class="material-symbols-outlined text-[14px] text-outline">psychology</span>
          <span class="text-outline">{{ chatStore.selectedModel?.modelName || '默认模型' }}</span>
        </div>
      </div>

      <!-- 展开/收起图标 -->
      <span
        :class="[
          'material-symbols-outlined text-[18px] text-outline transition-transform duration-200',
          isExpanded ? 'rotate-180' : '',
        ]"
      >
        expand_more
      </span>
    </button>

    <!-- 展开面板 -->
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <div
        v-if="isExpanded"
        class="absolute top-full left-0 right-0 mt-2 p-4 rounded-xl bg-surface-container-low/95 backdrop-blur-2xl border border-outline-variant/10 shadow-xl z-50 space-y-4"
      >
        <!-- 模式选择 -->
        <div>
          <div class="text-[10px] font-label text-outline uppercase tracking-widest mb-2">对话模式</div>
          <ChatModeToggle />
        </div>

        <!-- 知识库选择（RAG 模式时） -->
        <div v-if="chatStore.chatMode === 'rag'">
          <div class="text-[10px] font-label text-outline uppercase tracking-widest mb-2">知识库</div>
          <ChatKbSelector />
        </div>

        <!-- 模型选择 -->
        <div>
          <div class="text-[10px] font-label text-outline uppercase tracking-widest mb-2">模型</div>
          <ChatModelSelector />
        </div>
      </div>
    </Transition>

    <!-- 点击外部关闭 -->
    <div
      v-if="isExpanded"
      class="fixed inset-0 z-40"
      @click="isExpanded = false"
    ></div>
  </div>
</template>