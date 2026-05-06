<script setup lang="ts">
import { ref, computed } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const route = useRoute();
const router = useRouter();
const authStore = useAuthStore();

const isSuperAdmin = computed(() => authStore.isSuperAdmin);

const menuItems = computed(() => {
  const items = [
    { name: "数据概览", path: "/dashboard", icon: "dashboard" },
    { name: "模型配置", path: "/model-config", icon: "settings" },
    { name: "用户管理", path: "/user", icon: "people" },
    { name: "公开知识库", path: "/public-kb", icon: "cloud" },
    { name: "审计日志", path: "/audit-log", icon: "history" },
    { name: "系统字典", path: "/dict", icon: "book" },
  ];
  if (isSuperAdmin.value) {
    items.push({ name: "管理员管理", path: "/admin", icon: "admin_panel_settings" });
  }
  return items;
});

const isCollapsed = ref(false);

async function handleLogout() {
  await authStore.logout();
  router.push("/login");
}
</script>

<template>
  <div class="flex h-screen overflow-hidden" style="background-color: var(--color-surface)">
    <!-- 侧边栏 -->
    <aside
      class="flex flex-col border-r transition-all duration-200 shrink-0"
      :class="isCollapsed ? 'w-16' : 'w-56'"
      style="background-color: var(--color-surface-container-low); border-color: var(--color-outline-variant)"
    >
      <!-- Logo -->
      <div class="flex items-center h-14 px-4 border-b shrink-0" style="border-color: var(--color-outline-variant)">
        <div class="flex items-center gap-2 overflow-hidden">
          <div class="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style="background-color: var(--color-primary)">
            <span class="text-white text-sm font-bold">L</span>
          </div>
          <span v-if="!isCollapsed" class="font-semibold text-sm truncate" style="color: var(--color-on-surface)">
            管理后台
          </span>
        </div>
      </div>

      <!-- 菜单 -->
      <nav class="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        <RouterLink
          v-for="item in menuItems"
          :key="item.path"
          :to="item.path"
          class="flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors"
          :class="route.path.startsWith(item.path) ? 'font-medium' : ''"
          :style="route.path.startsWith(item.path)
            ? { backgroundColor: 'var(--color-primary-container)', color: 'var(--color-on-primary-container)' }
            : { color: 'var(--color-on-surface-variant)' }"
        >
          <span class="material-symbols-outlined text-lg shrink-0">{{ item.icon }}</span>
          <span v-if="!isCollapsed" class="truncate">{{ item.name }}</span>
        </RouterLink>
      </nav>

      <!-- 底部：折叠按钮 + 登出 -->
      <div class="border-t p-2 space-y-1 shrink-0" style="border-color: var(--color-outline-variant)">
        <button
          @click="isCollapsed = !isCollapsed"
          class="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-sm transition-colors"
          style="color: var(--color-on-surface-variant)"
        >
          <span class="material-symbols-outlined text-lg shrink-0">{{ isCollapsed ? 'chevron_right' : 'chevron_left' }}</span>
          <span v-if="!isCollapsed" class="truncate">收起</span>
        </button>
      </div>
    </aside>

    <!-- 主内容区 -->
    <div class="flex-1 flex flex-col min-w-0">
      <!-- 顶部栏 -->
      <header class="flex items-center justify-between h-14 px-6 border-b shrink-0" style="background-color: var(--color-surface); border-color: var(--color-outline-variant)">
        <h1 class="text-sm font-medium" style="color: var(--color-on-surface-variant)">
          {{ route.meta?.title || '管理后台' }}
        </h1>
        <div class="flex items-center gap-3">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium" style="background-color: var(--color-primary-container); color: var(--color-on-primary-container)">
              {{ authStore.admin?.username?.charAt(0).toUpperCase() || 'A' }}
            </div>
            <div class="hidden sm:block">
              <div class="text-sm font-medium" style="color: var(--color-on-surface)">
                {{ authStore.admin?.username }}
              </div>
              <div class="text-xs" style="color: var(--color-on-surface-variant)">
                {{ authStore.admin?.role === 'super_admin' ? '超级管理员' : '运营人员' }}
              </div>
            </div>
          </div>
          <button
            @click="handleLogout"
            class="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm transition-colors"
            style="color: var(--color-error)"
          >
            <span class="material-symbols-outlined text-sm">logout</span>
            <span>退出</span>
          </button>
        </div>
      </header>

      <!-- 页面内容 -->
      <main class="flex-1 overflow-y-auto p-6">
        <RouterView />
      </main>
    </div>
  </div>
</template>
