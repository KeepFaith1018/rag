import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("@/views/login/index.vue"),
      meta: { guestOnly: true },
    },
    {
      path: "/",
      component: () => import("@/components/layout/AdminLayout.vue"),
      redirect: "/dashboard",
      meta: { requiresAuth: true },
      children: [
        {
          path: "dashboard",
          name: "dashboard",
          component: () => import("@/views/dashboard/index.vue"),
        },
        {
          path: "model-config",
          name: "model-config",
          component: () => import("@/views/model-config/index.vue"),
        },
        {
          path: "model-config/create",
          name: "model-config-create",
          component: () => import("@/views/model-config/create.vue"),
        },
        {
          path: "model-config/:id/edit",
          name: "model-config-edit",
          component: () => import("@/views/model-config/[id]/edit.vue"),
        },
        {
          path: "user",
          name: "user",
          component: () => import("@/views/user/index.vue"),
        },
        {
          path: "user/:id",
          name: "user-detail",
          component: () => import("@/views/user/[id].vue"),
        },
        {
          path: "admin",
          name: "admin",
          component: () => import("@/views/admin/index.vue"),
          meta: { requiresSuperAdmin: true },
        },
        {
          path: "admin/create",
          name: "admin-create",
          component: () => import("@/views/admin/create.vue"),
          meta: { requiresSuperAdmin: true },
        },
        {
          path: "admin/:id/edit",
          name: "admin-edit",
          component: () => import("@/views/admin/[id]/edit.vue"),
          meta: { requiresSuperAdmin: true },
        },
        {
          path: "public-kb",
          name: "public-kb",
          component: () => import("@/views/public-kb/index.vue"),
        },
        {
          path: "public-kb/:id",
          name: "public-kb-detail",
          component: () => import("@/views/public-kb/[id].vue"),
        },
        {
          path: "audit-log",
          name: "audit-log",
          component: () => import("@/views/audit-log/index.vue"),
        },
        {
          path: "dict",
          name: "dict",
          component: () => import("@/views/dict/index.vue"),
        },
        {
          path: "dict/create",
          name: "dict-create",
          component: () => import("@/views/dict/create.vue"),
        },
        {
          path: "dict/:code",
          name: "dict-detail",
          component: () => import("@/views/dict/[code].vue"),
        },
      ],
    },
  ],
});

router.beforeEach(async (to) => {
  const authStore = useAuthStore();

  // guestOnly 页面：已登录则重定向
  if (to.meta.guestOnly && authStore.isAuthenticated) {
    return "/dashboard";
  }

  // 需要登录
  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    // 尝试获取当前管理员
    await authStore.fetchAdmin();
    if (!authStore.isAuthenticated) {
      return { path: "/login", query: { redirect: to.fullPath } };
    }
  }

  // 需要 super_admin
  if (to.meta.requiresSuperAdmin && !authStore.isSuperAdmin) {
    return "/dashboard";
  }

  return true;
});

export default router;
