<script setup lang="ts">
import { useAppStore } from "@/stores/app";
import { storeToRefs } from "pinia";
import { ref, onMounted, onUnmounted } from "vue";

const appStore = useAppStore();
// 使用 storeToRefs 保持响应式
const { isSidebarOpen, isDark } = storeToRefs(appStore);

const isUserMenuOpen = ref(false);

const toggleUserMenu = () => {
  isUserMenuOpen.value = !isUserMenuOpen.value;
};

// 点击外部关闭弹窗
const closeUserMenu = (e: MouseEvent) => {
  const target = e.target as HTMLElement;
  if (!target.closest(".user-menu-container")) {
    isUserMenuOpen.value = false;
  }
};

onMounted(() => {
  document.addEventListener("click", closeUserMenu);
});

onUnmounted(() => {
  document.removeEventListener("click", closeUserMenu);
});

// 定义导航数据结构
const navGroups = [
  {
    title: "工作区",
    items: [
      { name: "知识库", icon: "database", path: "/kb", active: true },
      { name: "聊天历史", icon: "history", path: "/chat", active: false },
    ],
  },
  {
    title: "最近会话",
    items: [
      { name: "神经优化策略", time: "今天", path: "/chat/1", active: false },
      {
        name: "第四季度技术路线图",
        time: "昨天",
        path: "/chat/2",
        active: false,
      },
    ],
  },
];
</script>

<template>
  <!-- 
    侧边栏实现：
    - md:flex : 桌面端常驻显示 (w-64)
    - fixed : 移动端通过汉堡菜单唤起时的遮罩抽屉
    - z-50 : 确保在顶层
  -->

  <!-- 移动端背景遮罩 (点击可关闭抽屉) -->
  <Transition name="fade">
    <div
      v-if="isSidebarOpen"
      class="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 md:hidden"
      @click="appStore.toggleSidebar"
    ></div>
  </Transition>

  <!-- 侧边栏主体 (抽屉滑动效果) -->
  <aside
    :class="[
      'fixed left-0 top-0 h-screen w-64 bg-surface-container-low border-r border-transparent z-50 flex flex-col transition-transform duration-300',
      isSidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0',
    ]"
  >
    <!-- Header 品牌区 -->
    <div class="p-6">
      <div class="flex items-center gap-3 mb-10">
        <div
          class="w-8 h-8 rounded bg-primary-container flex items-center justify-center shadow-lg shadow-primary/20"
        >
          <span
            class="material-symbols-outlined text-on-primary-container text-sm"
            style="font-variation-settings: FILL 1"
            >dataset</span
          >
        </div>
        <div>
          <h2
            class="font-headline font-bold uppercase tracking-[0.1em] text-[12px] text-outline"
          >
            Linsor AI
          </h2>
          <p class="text-[10px] text-outline/70 font-label tracking-wide">
            灵动搜索个人知识
          </p>
        </div>
      </div>

      <!-- 动态渲染导航分组 -->
      <nav
        v-for="(group, idx) in navGroups"
        :key="idx"
        :class="idx === 0 ? 'space-y-1' : 'mt-10'"
      >
        <p
          v-if="group.title"
          class="text-[10px] font-bold uppercase tracking-widest text-outline-variant mb-3 px-4"
        >
          {{ group.title }}
        </p>

        <div v-if="idx === 0" class="space-y-1">
          <!-- 主导航项 -->
          <a
            v-for="item in group.items"
            :key="item.name"
            :href="item.path"
            :class="[
              'flex items-center px-4 py-2.5 gap-3 rounded-md transition-all active:scale-[0.98]',
              item.active
                ? 'bg-primary-container text-on-primary-container mx-0'
                : 'text-outline hover:text-on-surface hover:bg-surface-container-high',
            ]"
          >
            <span
              class="material-symbols-outlined text-lg"
              :style="item.active ? `font-variation-settings: 'FILL' 1;` : ''"
              >{{ item.icon }}</span
            >
            <span class="font-body text-sm antialiased">{{ item.name }}</span>
          </a>
        </div>

        <div v-else class="px-4 space-y-3 opacity-80">
          <!-- 会话历史项 -->
          <a
            v-for="item in group.items"
            :key="item.name"
            :href="item.path"
            class="flex flex-col border-l-2 border-outline-variant/30 pl-4 py-1 hover:border-primary/50 transition-colors group cursor-pointer"
          >
            <span class="text-[10px] text-outline uppercase tracking-wider">{{
              item.time
            }}</span>
            <span
              class="text-xs text-on-surface-variant truncate group-hover:text-on-surface transition-colors"
              >{{ item.name }}</span
            >
          </a>
        </div>
      </nav>
    </div>

    <!-- 底部固定的工具栏 -->
    <div
      class="mt-auto p-4 border-t border-outline-variant/10 relative user-menu-container"
    >
      <!-- 弹出菜单 Popover -->
      <Transition name="fade-slide">
        <div
          v-if="isUserMenuOpen"
          class="absolute bottom-[100%] left-4 right-4 mb-2 bg-surface-container-high border border-outline-variant/15 rounded-xl shadow-lg overflow-hidden flex flex-col z-50"
        >
          <div
            class="p-3 border-b border-outline-variant/10 flex items-center justify-between"
          >
            <span class="text-xs font-semibold text-on-surface"
              >alex.rivera@linsor.ai</span
            >
          </div>
          <div class="p-2 space-y-1">
            <button
              class="w-full flex items-center gap-3 px-3 py-2 text-sm text-outline hover:text-on-surface hover:bg-surface-container-highest rounded-lg transition-colors"
            >
              <span class="material-symbols-outlined text-[18px]"
                >settings</span
              >
              <span>个人设置</span>
            </button>
            <button
              @click="appStore.toggleDark()"
              class="w-full flex items-center justify-between px-3 py-2 text-sm text-outline hover:text-on-surface hover:bg-surface-container-highest rounded-lg transition-colors"
            >
              <div class="flex items-center gap-3">
                <span class="material-symbols-outlined text-[18px]">{{
                  isDark ? "light_mode" : "dark_mode"
                }}</span>
                <span>外观设置</span>
              </div>
              <span
                class="text-[10px] text-outline-variant bg-surface-container-lowest px-1.5 rounded"
                >{{ isDark ? "暗色" : "亮色" }}</span
              >
            </button>
            <button
              class="w-full flex items-center gap-3 px-3 py-2 text-sm text-outline hover:text-on-surface hover:bg-surface-container-highest rounded-lg transition-colors"
            >
              <span class="material-symbols-outlined text-[18px]">help</span>
              <span>帮助中心</span>
            </button>
          </div>
          <div class="p-2 border-t border-outline-variant/10">
            <button
              class="w-full flex items-center gap-3 px-3 py-2 text-sm text-error hover:bg-error-container/10 rounded-lg transition-colors"
            >
              <span class="material-symbols-outlined text-[18px]">logout</span>
              <span>退出登录</span>
            </button>
          </div>
        </div>
      </Transition>

      <!-- 底部用户操作与状态区 (仿 ChatGPT 风格) -->
      <button
        @click="toggleUserMenu"
        class="w-full flex items-center justify-between p-2 hover:bg-surface-container-high rounded-xl transition-colors group focus:outline-none"
      >
        <div class="flex items-center gap-3">
          <div
            class="w-9 h-9 rounded-full overflow-hidden border border-outline-variant/20 flex-shrink-0"
          >
            <img
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuBK3UvrWbRJFbEnmoGfmCG231sGFDP1AZV3UqvGHP-5bMgS3MEeHPO8q5OT9FK7qrHD0Wijc4oKbn1bHzPj4U29MJpu7YXUM1dY-Ld-dOnq8_6IX8T0391nm_ke5sGwVXFelS0QdGLf57MB9lL_-1a6XuKkscu_USgi4rprpSHf1w4qmzFg6xmftyJdzZs2IYTjv30BBh4vyJ1XMQ8Z3K9uTrazHOWKyMvEzNjaplIWxDSqOcEyYISdT7uwi0zBsioomwk0DuvxrmrK"
              alt="User profile"
              class="w-full h-full object-cover"
            />
          </div>
          <div class="flex flex-col overflow-hidden text-left">
            <span
              class="text-sm font-semibold text-on-surface truncate group-hover:text-primary transition-colors"
              >Alex Rivera</span
            >
            <span class="text-[10px] text-outline truncate">Admin Access</span>
          </div>
        </div>

        <span
          class="material-symbols-outlined text-outline group-hover:text-primary transition-colors text-[20px]"
        >
          more_horiz
        </span>
      </button>
    </div>
  </aside>
</template>

<style scoped>
/* 移动端遮罩层淡入淡出动画 */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

/* 弹出菜单动画 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(10px) scale(0.98);
}
</style>
