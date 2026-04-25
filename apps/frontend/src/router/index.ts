import { createRouter, createWebHistory } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { pinia } from "@/stores/pinia";

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: "/login",
      name: "login",
      component: () => import("@/views/auth/LoginView.vue"),
      meta: {
        guestOnly: true,
      },
    },
    {
      path: "/forgot-password",
      name: "forgot-password",
      component: () => import("@/views/auth/ForgotPasswordView.vue"),
      meta: {
        guestOnly: true,
      },
    },
    {
      path: "/",
      component: () => import("@/layout/MainLayout.vue"),
      redirect: "/chat",
      meta: {
        requiresAuth: true,
      },
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
          path: "public-kb",
          name: "kb-square",
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

router.beforeEach(async (to) => {
  const authStore = useAuthStore(pinia);

  if (to.meta.guestOnly && authStore.isAuthenticated) {
    return "/chat";
  }

  if (to.meta.requiresAuth && !authStore.isAuthenticated) {
    return {
      path: "/login",
      query: {
        redirect: to.fullPath,
      },
    };
  }

  return true;
});

export default router;
