<script setup lang="ts">
import { useAppStore } from "@/stores/app";
import { storeToRefs } from "pinia";

const appStore = useAppStore();
const { isDark } = storeToRefs(appStore);

// 定义组件接收的属性
interface Props {
  title?: string;
  subtitle?: string;
  showSearch?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  title: "AI 对话舱",
  subtitle: "Nexus_Engine_v4",
  showSearch: false,
});
</script>

<template>
  <!-- 
    顶部毛玻璃导航条：
    - sticky top-0 z-40: 确保固定在滚动容器顶部
    - backdrop-blur-xl: 强烈的毛玻璃效果，适配明暗模式
    - border-b border-transparent: 拒绝实线边框
  -->
  <header
    class="flex justify-between items-center w-full px-6 md:px-12 h-20 sticky top-0 z-40 bg-surface/80 backdrop-blur-xl transition-colors duration-300"
  >
    <div class="flex items-center gap-4">
      <!-- 移动端汉堡菜单唤出 Drawer -->
      <button
        class="md:hidden p-2 text-outline hover:text-primary transition-colors focus:outline-none"
        @click="appStore.toggleSidebar"
      >
        <span class="material-symbols-outlined text-2xl">menu</span>
      </button>

      <!-- 标题与模型指示器 -->
      <div class="flex flex-col md:flex-row md:items-center gap-1 md:gap-4">
        <h1
          class="font-headline text-2xl md:text-3xl font-bold tracking-tight text-on-surface"
        >
          {{ title }}
        </h1>

        <div
          class="hidden md:block h-6 w-[1px] bg-outline-variant/30 mx-2"
        ></div>

        <!-- 具有高科技感的微小标签指示器 -->
        <div
          class="flex items-center gap-2 bg-surface-container-low px-3 py-1.5 rounded-lg border border-outline-variant/10 cursor-pointer hover:bg-surface-container-high transition-colors active:scale-[0.98]"
        >
          <span class="material-symbols-outlined text-primary text-[18px]"
            >hub</span
          >
          <span class="text-xs font-medium text-on-surface-variant font-mono">{{
            subtitle
          }}</span>
          <span class="material-symbols-outlined text-outline text-[16px]"
            >expand_more</span
          >
        </div>
      </div>
    </div>

    <!-- 右侧操作区 -->
    <div class="flex items-center gap-4">
      <!-- 全局搜索触发器 (仅在需要时显示，或者触发 Command Palette) -->
      <div v-if="showSearch" class="hidden lg:block relative group">
        <span
          class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline text-lg group-hover:text-primary transition-colors"
          >search</span
        >
        <input
          type="text"
          placeholder="搜索结构... (Cmd+K)"
          class="bg-surface-container-highest border border-outline-variant/15 rounded-xl pl-12 pr-6 py-2.5 w-64 focus:ring-1 focus:ring-primary focus:outline-none text-sm transition-all placeholder:text-outline/50 cursor-text"
          @click="appStore.toggleCommandPalette"
          readonly
        />
      </div>
    </div>
  </header>
</template>
