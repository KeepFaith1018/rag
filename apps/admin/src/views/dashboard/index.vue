<script setup lang="ts">
import { ref, onMounted } from "vue";
import { RouterLink } from "vue-router";
import { apiRequest } from "@/api/api";
import type { ApiResponse } from "@/types/api";

interface Stats {
  modelCount: number;
  userCount: number;
  adminCount: number;
}

const stats = ref<Stats>({ modelCount: 0, userCount: 0, adminCount: 0 });
const loading = ref(true);

onMounted(async () => {
  try {
    const [models, users, admins] = await Promise.all([
      apiRequest<ApiResponse<{ total: number }>>("/admin/model-config?pageSize=1"),
      apiRequest<ApiResponse<{ total: number }>>("/admin/user?pageSize=1"),
      apiRequest<ApiResponse<{ total: number }>>("/admin/admin?pageSize=1"),
    ]);
    stats.value = {
      modelCount: (models as any)?.total || 0,
      userCount: (users as any)?.total || 0,
      adminCount: (admins as any)?.total || 0,
    };
  } catch {
    // 忽略
  } finally {
    loading.value = false;
  }
});
</script>

<template>
  <div class="space-y-6">
    <div>
      <h2 class="text-xl font-semibold" style="color: var(--color-on-surface)">数据概览</h2>
      <p class="text-sm mt-1" style="color: var(--color-on-surface-variant)">系统运行状态一览</p>
    </div>

    <!-- 统计卡片 -->
    <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <div class="card">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background-color: var(--color-primary-container)">
            <span class="material-symbols-outlined text-xl" style="color: var(--color-primary)">smart_toy</span>
          </div>
          <div>
            <div class="text-2xl font-bold" style="color: var(--color-on-surface)">
              {{ loading ? '-' : stats.modelCount }}
            </div>
            <div class="text-sm" style="color: var(--color-on-surface-variant)">AI 模型配置</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background-color: var(--color-secondary-container)">
            <span class="material-symbols-outlined text-xl" style="color: var(--color-secondary)">people</span>
          </div>
          <div>
            <div class="text-2xl font-bold" style="color: var(--color-on-surface)">
              {{ loading ? '-' : stats.userCount }}
            </div>
            <div class="text-sm" style="color: var(--color-on-surface-variant)">注册用户</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="flex items-center gap-3">
          <div class="w-10 h-10 rounded-lg flex items-center justify-center" style="background-color: var(--color-tertiary-container)">
            <span class="material-symbols-outlined text-xl" style="color: var(--color-tertiary)">admin_panel_settings</span>
          </div>
          <div>
            <div class="text-2xl font-bold" style="color: var(--color-on-surface)">
              {{ loading ? '-' : stats.adminCount }}
            </div>
            <div class="text-sm" style="color: var(--color-on-surface-variant)">管理员账号</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 快捷操作 -->
    <div class="card">
      <h3 class="text-sm font-medium mb-4" style="color: var(--color-on-surface)">快捷操作</h3>
      <div class="flex flex-wrap gap-3">
        <RouterLink to="/model-config/create" class="btn-primary flex items-center gap-2">
          <span class="material-symbols-outlined text-sm">add</span>
          新建模型配置
        </RouterLink>
        <RouterLink to="/model-config" class="btn-secondary flex items-center gap-2">
          <span class="material-symbols-outlined text-sm">list</span>
          查看模型列表
        </RouterLink>
        <RouterLink to="/user" class="btn-secondary flex items-center gap-2">
          <span class="material-symbols-outlined text-sm">people</span>
          用户管理
        </RouterLink>
      </div>
    </div>
  </div>
</template>
