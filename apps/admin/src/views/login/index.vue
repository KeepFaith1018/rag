<script setup lang="ts">
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "@/stores/auth";
import { ApiError } from "@/api/api";

const router = useRouter();
const authStore = useAuthStore();

const username = ref("");
const password = ref("");
const errorMsg = ref("");
const isSubmitting = ref(false);

async function handleLogin() {
  if (!username.value || !password.value) {
    errorMsg.value = "请输入用户名和密码";
    return;
  }

  isSubmitting.value = true;
  errorMsg.value = "";

  try {
    await authStore.login(username.value, password.value);
    const redirect = new URLSearchParams(window.location.search).get("redirect");
    router.push(redirect || "/dashboard");
  } catch (err) {
    if (err instanceof ApiError) {
      errorMsg.value = err.message || "登录失败，请检查用户名和密码";
    } else {
      errorMsg.value = "登录失败，请稍后重试";
    }
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="min-h-screen flex items-center justify-center" style="background-color: var(--color-surface)">
    <div class="w-full max-w-sm p-8 rounded-2xl shadow-lg" style="background-color: var(--color-surface-container-low)">
      <!-- Logo -->
      <div class="flex flex-col items-center mb-8">
        <div class="w-14 h-14 rounded-2xl flex items-center justify-center mb-4" style="background-color: var(--color-primary)">
          <span class="text-white text-2xl font-bold">L</span>
        </div>
        <h1 class="text-xl font-semibold" style="color: var(--color-on-surface)">管理后台</h1>
        <p class="text-sm mt-1" style="color: var(--color-on-surface-variant)">Linsor AI 系统管理</p>
      </div>

      <!-- 表单 -->
      <form @submit.prevent="handleLogin" class="space-y-4">
        <div>
          <label class="block text-sm font-medium mb-1.5" style="color: var(--color-on-surface)">用户名</label>
          <input
            v-model="username"
            type="text"
            class="input-field"
            placeholder="请输入用户名"
            autocomplete="username"
          />
        </div>

        <div>
          <label class="block text-sm font-medium mb-1.5" style="color: var(--color-on-surface)">密码</label>
          <input
            v-model="password"
            type="password"
            class="input-field"
            placeholder="请输入密码"
            autocomplete="current-password"
          />
        </div>

        <div v-if="errorMsg" class="px-3 py-2 rounded-lg text-sm" style="background-color: var(--color-error-container); color: var(--color-error)">
          {{ errorMsg }}
        </div>

        <button
          type="submit"
          class="btn-primary w-full py-2.5"
          :disabled="isSubmitting"
        >
          {{ isSubmitting ? "登录中..." : "登录" }}
        </button>
      </form>
    </div>
  </div>
</template>
