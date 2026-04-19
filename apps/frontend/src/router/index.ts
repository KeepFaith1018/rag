import { createRouter, createWebHistory } from "vue-router";

// 定义基础路由，配合 Phase 3/4/5 的页面规划
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("@/views/auth/LoginView.vue"),
    },
    {
      path: "/",
      component: () => import("@/layout/MainLayout.vue"),
      redirect: "/chat",
      children: [
        {
          path: "chat",
          name: "chat",
          component: () => import("@/views/chat/ChatView.vue"),
        },
        {
          path: "kb",
          name: "kb-list",
          component: () => import("@/views/kb/KbListView.vue"),
        },
        {
          path: "kb/:id",
          name: "kb-detail",
          component: () => import("@/views/kb/KbDetailView.vue"),
        },
      ],
    },
  ],
});

export default router;
