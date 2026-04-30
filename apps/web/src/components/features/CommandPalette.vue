<script setup lang="ts">
import { useAppStore } from "@/stores/app";
import { storeToRefs } from "pinia";
import { ref, onMounted, onUnmounted } from "vue";

const appStore = useAppStore();
const { isCommandPaletteOpen } = storeToRefs(appStore);

const searchQuery = ref("");
const searchInput = ref<HTMLInputElement | null>(null);

// 模拟搜索结果数据
const results = ref([
  {
    type: "文档",
    title: "神经架构设计规范 v2",
    icon: "description",
    score: "98%",
  },
  { type: "知识库", title: "量子态训练核心", icon: "database", score: "95%" },
  {
    type: "历史",
    title: "昨天关于低延迟边缘节点的讨论",
    icon: "history",
    score: "88%",
  },
]);

// 监听键盘事件 (Cmd+K / Ctrl+K 唤出，ESC 关闭)
const handleKeydown = (e: KeyboardEvent) => {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    appStore.toggleCommandPalette();
  }
  if (e.key === "Escape" && isCommandPaletteOpen.value) {
    appStore.toggleCommandPalette();
  }
};

// 弹窗打开时自动聚焦输入框
const onEnter = () => {
  // nextTick 等待 DOM 更新
  setTimeout(() => {
    searchInput.value?.focus();
  }, 50);
};

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <Teleport to="body">
    <!-- Vue 原生 Transition 提供淡入淡出和缩放支持 -->
    <Transition name="palette" @enter="onEnter">
      <!-- 全局遮罩层 -->
      <div
        v-if="isCommandPaletteOpen"
        class="fixed inset-0 bg-surface-container-lowest/60 backdrop-blur-sm z-[100] flex items-start justify-center pt-[15vh]"
        @click.self="appStore.toggleCommandPalette"
      >
        <!--
          面板主体 (Signature Component):
          - blur-[25px]: 极强的底层毛玻璃渗透
          - bg-surface-container-highest/80: 半透明的极高亮容器
        -->
        <div
          class="w-full max-w-2xl bg-surface-container-highest/80 backdrop-blur-[25px] rounded-2xl border border-outline-variant/20 shadow-2xl overflow-hidden mx-4"
        >
          <!-- 搜索输入区域 -->
          <div
            class="p-4 flex items-center gap-4 border-b border-outline-variant/10"
          >
            <span class="material-symbols-outlined text-primary text-2xl"
              >search</span
            >
            <input
              ref="searchInput"
              v-model="searchQuery"
              type="text"
              placeholder="搜索命令、知识库、文档或历史会话..."
              class="bg-transparent border-none focus:ring-0 w-full text-on-surface font-body text-lg placeholder:text-outline/40 outline-none"
            />
            <kbd
              class="hidden md:inline-flex px-2 py-1 bg-surface-container-low rounded border border-outline-variant/10 text-[10px] font-mono text-outline uppercase tracking-widest"
              >ESC</kbd
            >
          </div>

          <!-- 搜索结果列表 -->
          <div class="p-2 max-h-[60vh] overflow-y-auto custom-scrollbar">
            <!-- 空状态 -->
            <div
              v-if="!results.length"
              class="p-8 text-center text-outline/60 font-body text-sm"
            >
              无匹配蓝图或指令。
            </div>

            <!-- 结果列表 -->
            <div class="space-y-1">
              <p
                class="text-[10px] font-bold uppercase tracking-widest text-outline-variant mb-2 px-3 pt-2"
              >
                建议指令
              </p>

              <button
                v-for="(item, idx) in results"
                :key="idx"
                class="w-full flex items-center justify-between p-3 rounded-xl hover:bg-surface-container-high transition-colors group focus:outline-none focus:bg-surface-container-high focus:ring-1 focus:ring-primary/30"
              >
                <div class="flex items-center gap-4">
                  <div
                    class="w-10 h-10 rounded-lg bg-surface-container-low flex items-center justify-center group-hover:bg-primary-container/10 group-hover:text-primary transition-colors text-outline"
                  >
                    <span
                      class="material-symbols-outlined"
                      style="font-variation-settings: FILL 1"
                      >{{ item.icon }}</span
                    >
                  </div>
                  <div class="text-left flex flex-col">
                    <span
                      class="text-sm font-medium text-on-surface group-hover:text-primary transition-colors"
                      >{{ item.title }}</span
                    >
                    <span
                      class="text-[10px] font-label uppercase tracking-wider text-outline"
                      >{{ item.type }}</span
                    >
                  </div>
                </div>
                <span
                  class="text-xs font-mono text-outline/50 group-hover:text-primary/50 transition-colors"
                  >{{ item.score }}</span
                >
              </button>
            </div>
          </div>

          <!-- 底部提示栏 -->
          <div
            class="p-3 bg-surface-container-low/50 border-t border-outline-variant/5 flex items-center justify-between"
          >
            <div
              class="flex items-center gap-4 text-[10px] font-label text-outline/60"
            >
              <span class="flex items-center gap-1"
                ><kbd
                  class="bg-surface-container-high px-1.5 py-0.5 rounded mr-1"
                  >↑</kbd
                ><kbd class="bg-surface-container-high px-1.5 py-0.5 rounded"
                  >↓</kbd
                >
                导航</span
              >
              <span class="flex items-center gap-1"
                ><kbd class="bg-surface-container-high px-1.5 py-0.5 rounded"
                  >Enter</kbd
                >
                执行</span
              >
            </div>
            <span
              class="text-[10px] font-headline text-primary/60 tracking-widest uppercase"
              >Kinetic Engine</span
            >
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
/* 调色板弹窗的过渡动效：淡入淡出 + 缩放 (Scale/Opacity) */
.palette-enter-active,
.palette-leave-active {
  transition: all 0.2s cubic-bezier(0.16, 1, 0.3, 1);
}
.palette-enter-from,
.palette-leave-to {
  opacity: 0;
}
.palette-enter-from .max-w-2xl,
.palette-leave-to .max-w-2xl {
  transform: scale(0.96) translateY(10px);
}

/* 自定义极简滚动条 */
.custom-scrollbar::-webkit-scrollbar {
  width: 4px;
}
.custom-scrollbar::-webkit-scrollbar-track {
  background: transparent;
}
.custom-scrollbar::-webkit-scrollbar-thumb {
  background: var(--color-outline-variant);
  border-radius: 4px;
}
</style>
