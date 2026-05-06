import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { login as loginApi, logout as logoutApi, getCurrentAdmin } from "@/api/auth";
import { clearTokens } from "@/api/api";
import type { AdminUser } from "@/types/auth";

export const useAuthStore = defineStore("admin-auth", () => {
  const admin = ref<AdminUser | null>(null);
  const isLoading = ref(false);

  const isAuthenticated = computed(() => !!admin.value);
  const isSuperAdmin = computed(() => admin.value?.role === "super_admin");

  async function fetchAdmin() {
    try {
      const data = await getCurrentAdmin();
      admin.value = {
        id: data.id,
        username: data.username,
        role: data.role as "super_admin" | "operator",
        isActive: data.isActive,
      };
    } catch {
      admin.value = null;
    }
  }

  async function login(username: string, password: string) {
    isLoading.value = true;
    try {
      const result = await loginApi({ username, password });
      admin.value = result.admin;
      return result.admin;
    } finally {
      isLoading.value = false;
    }
  }

  async function logout() {
    try {
      await logoutApi();
    } catch {
      // 忽略错误
    } finally {
      admin.value = null;
      clearTokens();
    }
  }

  return {
    admin,
    isLoading,
    isAuthenticated,
    isSuperAdmin,
    fetchAdmin,
    login,
    logout,
  };
});
