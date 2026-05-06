<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { getUser, disableUser, enableUser } from "@/api/user";
import { ApiError } from "@/api/api";
import type { User } from "@/api/user";

const router = useRouter();
const route = useRoute();
const id = route.params.id as string;

const user = ref<User | null>(null);
const loading = ref(true);
const actionLoading = ref(false);

onMounted(async () => {
  try {
    user.value = await getUser(id);
  } catch {
    router.push("/user");
  } finally {
    loading.value = false;
  }
});

async function handleToggle() {
  if (!user.value) return;
  actionLoading.value = true;
  try {
    if (user.value.isActive) {
      await disableUser(id);
      user.value.isActive = false;
    } else {
      await enableUser(id);
      user.value.isActive = true;
    }
  } catch (err) {
    if (err instanceof ApiError) {
      alert(err.message);
    }
  } finally {
    actionLoading.value = false;
  }
}
</script>

<template>
  <div class="max-w-xl space-y-6">
    <div class="flex items-center gap-4">
      <button @click="router.back()" class="flex items-center gap-1 text-sm" style="color: var(--color-primary)">
        <span class="material-symbols-outlined text-sm">arrow_back</span>
        返回
      </button>
      <h2 class="text-xl font-semibold" style="color: var(--color-on-surface)">用户详情</h2>
    </div>

    <div v-if="loading" class="card text-center py-8" style="color: var(--color-on-surface-variant)">
      加载中...
    </div>

    <div v-else-if="user" class="card space-y-4">
      <div class="flex items-center gap-4 pb-4 border-b" style="border-color: var(--color-outline-variant)">
        <div
          class="w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold"
          style="background-color: var(--color-primary-container); color: var(--color-on-primary-container)"
        >
          {{ user.fullName?.charAt(0)?.toUpperCase() || user.email.charAt(0).toUpperCase() }}
        </div>
        <div>
          <div class="text-lg font-semibold" style="color: var(--color-on-surface)">
            {{ user.fullName || '未设置昵称' }}
          </div>
          <div class="text-sm" style="color: var(--color-on-surface-variant)">{{ user.email }}</div>
        </div>
      </div>

      <div class="space-y-3">
        <div class="flex items-center justify-between">
          <span class="text-sm" style="color: var(--color-on-surface-variant)">账号状态</span>
          <span
            class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
            :style="{
              backgroundColor: user.isActive ? 'var(--color-primary-container)' : 'var(--color-error-container)',
              color: user.isActive ? 'var(--color-primary)' : 'var(--color-error)'
            }"
          >
            {{ user.isActive ? '已启用' : '已禁用' }}
          </span>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-sm" style="color: var(--color-on-surface-variant)">注册时间</span>
          <span class="text-sm" style="color: var(--color-on-surface)">
            {{ new Date(user.createdAt).toLocaleString('zh-CN') }}
          </span>
        </div>
      </div>

      <div class="flex justify-end gap-3 pt-2">
        <button
          @click="handleToggle"
          :disabled="actionLoading"
          class="btn-secondary"
          :style="user.isActive ? { color: 'var(--color-error)', borderColor: 'var(--color-error)' } : {}"
        >
          {{ actionLoading ? '处理中...' : (user.isActive ? '禁用账号' : '启用账号') }}
        </button>
      </div>
    </div>
  </div>
</template>
