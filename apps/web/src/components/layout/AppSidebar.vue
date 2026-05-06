<script setup lang="ts">
import { useAppStore } from "@/stores/app";
import { useAuthStore } from "@/stores/auth";
import { useMessage } from "@/composables/useMessage";
import { storeToRefs } from "pinia";
import { computed, ref, onMounted, onUnmounted } from "vue";
import { RouterLink, useRoute, useRouter } from "vue-router";

const appStore = useAppStore();
const authStore = useAuthStore();
const message = useMessage();
const route = useRoute();
const router = useRouter();

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

interface PrimaryNavItem {
  name: string;
  icon: string;
  path: string;
  query?: Record<string, string>;
  children?: {
    name: string;
    path: string;
    query?: Record<string, string>;
    icon?: string;
  }[];
}

const primaryNavItems: PrimaryNavItem[] = [
  {
    name: "知识库",
    icon: "database",
    path: "/kb",
    query: { visibility: "private" },
    children: [
      {
        name: "私有知识库",
        path: "/kb",
        query: { visibility: "private" },
        icon: "lock",
      },
      {
        name: "共享知识库",
        path: "/kb",
        query: { visibility: "shared" },
        icon: "folder_shared",
      },
    ],
  },
  { name: "知识库广场", icon: "public", path: "/public-kb" },
  { name: "聊天历史", icon: "history", path: "/chat" },
];

const displayName = computed(() => authStore.user?.username || "未登录用户");
const displayEmail = computed(() => authStore.user?.email || "请先登录");
const displayRole = computed(() => authStore.user?.roles?.[0] || "guest");
const displayAvatar = computed(() => authStore.user?.avatar || "");

/**
 * 判断主导航项是否处于激活状态。
 */
function isNavActive(path: string) {
  return route.path === path || route.path.startsWith(`${path}/`);
}

/**
 * 判断子导航项是否处于激活状态。
 */
function isChildActive(child: {
  path: string;
  query?: Record<string, string>;
}) {
  if (route.path !== child.path) {
    return false;
  }

  if (!child.query) {
    return Object.keys(route.query).length === 0;
  }

  for (const [key, value] of Object.entries(child.query)) {
    if (route.query[key] !== value) {
      return false;
    }
  }

  // Also ensure no extra queries are present that shouldn't be
  return Object.keys(route.query).length === Object.keys(child.query).length;
}

/**
 * 退出登录并返回登录页。
 */
async function handleLogout() {
  authStore.logout();
  isUserMenuOpen.value = false;
  message.success("已退出登录");
  await router.replace("/login");
}
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

      <nav class="space-y-1">
        <p
          class="text-[10px] font-bold uppercase tracking-widest text-outline-variant mb-3 px-4"
        >
          工作区
        </p>

        <template v-for="item in primaryNavItems" :key="item.name">
          <RouterLink
            :to="
              item.query ? { path: item.path, query: item.query } : item.path
            "
            :class="[
              'flex items-center px-4 py-2.5 gap-3 rounded-md transition-all active:scale-[0.98]',
              isNavActive(item.path)
                ? 'bg-primary-container text-on-primary-container mx-0'
                : 'text-outline hover:text-on-surface hover:bg-surface-container-high',
            ]"
          >
            <span
              class="material-symbols-outlined text-lg"
              :style="
                isNavActive(item.path)
                  ? 'font-variation-settings: \'FILL\' 1'
                  : ''
              "
              >{{ item.icon }}</span
            >
            <span class="font-body text-sm antialiased">{{ item.name }}</span>
          </RouterLink>

          <!-- 子导航 -->
          <div
            v-if="item.children && isNavActive(item.path)"
            class="flex flex-col gap-1 pl-11 pr-4 py-2 relative"
          >
            <!-- 树形连接线 -->
            <div
              class="absolute left-6 top-0 bottom-4 w-px bg-outline-variant/30"
            ></div>

            <RouterLink
              v-for="child in item.children"
              :key="child.name"
              :to="{ path: child.path, query: child.query }"
              class="flex items-center px-3 py-2 rounded-md transition-all text-xs active:scale-[0.98] relative"
              :class="[
                isChildActive(child)
                  ? 'text-primary bg-primary/10 font-medium'
                  : 'text-outline hover:text-on-surface hover:bg-surface-container-highest',
              ]"
            >
              <!-- 水平连接线 -->
              <div
                class="absolute -left-5 top-1/2 w-4 h-px bg-outline-variant/30"
              ></div>
              <span
                v-if="child.icon"
                class="material-symbols-outlined text-[14px] mr-2"
              >
                {{ child.icon }}
              </span>
              {{ child.name }}
            </RouterLink>
          </div>
        </template>
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
            <span class="text-xs font-semibold text-on-surface">{{
              displayEmail
            }}</span>
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
              @click="handleLogout"
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
              :src="
                displayAvatar ||
                'https://placehold.co/80x80/1f2937/e5e7eb?text=U'
              "
              alt="User profile"
              class="w-full h-full object-cover"
            />
          </div>
          <div class="flex flex-col overflow-hidden text-left">
            <span
              class="text-sm font-semibold text-on-surface truncate group-hover:text-primary transition-colors"
              >{{ displayName }}</span
            >
            <span class="text-[10px] text-outline truncate">{{
              displayRole
            }}</span>
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
