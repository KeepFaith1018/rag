<script setup lang="ts">
import { ref, onMounted, reactive } from "vue";
import { RouterLink } from "vue-router";
import { listUsers, disableUser, enableUser, type User } from "@/api/user";
import { ApiError } from "@/api/api";

const loading = ref(false);
const users = ref<User[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

const filters = reactive({
  email: "",
  isActive: "" as "" | "true" | "false",
});

async function fetchData() {
  loading.value = true;
  try {
    const result = await listUsers({
      page: page.value,
      pageSize: pageSize.value,
      email: filters.email || undefined,
      isActive: filters.isActive ? filters.isActive === "true" : undefined,
    });
    users.value = result.list;
    total.value = result.total;
  } finally {
    loading.value = false;
  }
}

function handleFilterChange() {
  page.value = 1;
  fetchData();
}

async function handleToggle(id: string, isActive: boolean) {
  try {
    if (isActive) {
      await disableUser(id);
    } else {
      await enableUser(id);
    }
    await fetchData();
  } catch (err) {
    if (err instanceof ApiError) {
      alert(err.message);
    }
  }
}

onMounted(() => fetchData());
</script>

<template>
  <div class="space-y-4">
    <div>
      <h2 class="text-xl font-semibold" style="color: var(--color-on-surface)">用户管理</h2>
      <p class="text-sm mt-1" style="color: var(--color-on-surface-variant)">查看和管理系统用户</p>
    </div>

    <!-- 筛选 -->
    <div class="card">
      <div class="flex flex-wrap gap-3">
        <input
          v-model="filters.email"
          @change="handleFilterChange"
          type="text"
          placeholder="搜索邮箱"
          class="input-field w-64"
        />
        <select v-model="filters.isActive" @change="handleFilterChange" class="input-field w-40">
          <option value="">全部状态</option>
          <option value="true">已启用</option>
          <option value="false">已禁用</option>
        </select>
      </div>
    </div>

    <!-- 表格 -->
    <div class="card p-0 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b" style="border-color: var(--color-outline-variant)">
              <th class="table-header table-cell">用户</th>
              <th class="table-header table-cell">邮箱</th>
              <th class="table-header table-cell">状态</th>
              <th class="table-header table-cell">注册时间</th>
              <th class="table-header table-cell">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="5" class="table-cell text-center" style="color: var(--color-on-surface-variant)">加载中...</td>
            </tr>
            <tr v-else-if="users.length === 0">
              <td colspan="5" class="table-cell text-center" style="color: var(--color-on-surface-variant)">暂无数据</td>
            </tr>
            <tr
              v-for="item in users"
              :key="item.id"
              class="border-b"
              style="border-color: var(--color-outline-variant)"
            >
              <td class="table-cell">
                <div class="flex items-center gap-3">
                  <div
                    class="w-8 h-8 rounded-full flex items-center justify-center text-xs font-medium shrink-0"
                    style="background-color: var(--color-primary-container); color: var(--color-on-primary-container)"
                  >
                    {{ item.fullName?.charAt(0)?.toUpperCase() || item.email.charAt(0).toUpperCase() }}
                  </div>
                  <span class="font-medium">{{ item.fullName || '-' }}</span>
                </div>
              </td>
              <td class="table-cell">{{ item.email }}</td>
              <td class="table-cell">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  :style="{
                    backgroundColor: item.isActive ? 'var(--color-primary-container)' : 'var(--color-error-container)',
                    color: item.isActive ? 'var(--color-primary)' : 'var(--color-error)'
                  }"
                >
                  {{ item.isActive ? '已启用' : '已禁用' }}
                </span>
              </td>
              <td class="table-cell text-xs" style="color: var(--color-on-surface-variant)">
                {{ new Date(item.createdAt).toLocaleDateString('zh-CN') }}
              </td>
              <td class="table-cell">
                <div class="flex items-center gap-2">
                  <RouterLink
                    :to="`/user/${item.id}`"
                    class="text-sm underline hover:opacity-80"
                    style="color: var(--color-primary)"
                  >
                    详情
                  </RouterLink>
                  <button
                    @click="handleToggle(item.id, item.isActive)"
                    class="text-sm underline hover:opacity-80"
                    style="color: var(--color-secondary)"
                  >
                    {{ item.isActive ? '禁用' : '启用' }}
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 分页 -->
      <div class="flex items-center justify-between px-4 py-3 border-t" style="border-color: var(--color-outline-variant)">
        <div class="text-sm" style="color: var(--color-on-surface-variant)">
          共 {{ total }} 条，第 {{ page }} / {{ Math.ceil(total / pageSize) || 1 }} 页
        </div>
        <div class="flex items-center gap-2">
          <button @click="page = Math.max(1, page - 1); fetchData()" :disabled="page <= 1" class="btn-secondary px-3 py-1.5 text-sm">
            上一页
          </button>
          <button @click="page++; fetchData()" :disabled="page >= Math.ceil(total / pageSize)" class="btn-secondary px-3 py-1.5 text-sm">
            下一页
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
