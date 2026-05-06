<script setup lang="ts">
import { ref, onMounted } from "vue";
import { RouterLink } from "vue-router";
import { listAdmins, deleteAdmin, type AdminUser } from "@/api/admin-user";
import { ApiError } from "@/api/api";
import { useAuthStore } from "@/stores/auth";

const authStore = useAuthStore();
const loading = ref(false);
const admins = ref<AdminUser[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

const deleteId = ref<string | null>(null);
const deleteLoading = ref(false);

async function fetchData() {
  loading.value = true;
  try {
    const result = await listAdmins({ page: page.value, pageSize: pageSize.value });
    admins.value = result.list;
    total.value = result.total;
  } finally {
    loading.value = false;
  }
}

function confirmDelete(id: string) {
  deleteId.value = id;
}

async function handleDelete() {
  if (!deleteId.value) return;
  deleteLoading.value = true;
  try {
    await deleteAdmin(deleteId.value);
    deleteId.value = null;
    await fetchData();
  } catch (err) {
    if (err instanceof ApiError) {
      alert(err.message);
    }
  } finally {
    deleteLoading.value = false;
  }
}

onMounted(() => fetchData());
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-xl font-semibold" style="color: var(--color-on-surface)">管理员管理</h2>
        <p class="text-sm mt-1" style="color: var(--color-on-surface-variant)">管理系统管理员账号</p>
      </div>
      <RouterLink to="/admin/create" class="btn-primary flex items-center gap-2">
        <span class="material-symbols-outlined text-sm">add</span>
        新建管理员
      </RouterLink>
    </div>

    <div class="card p-0 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b" style="border-color: var(--color-outline-variant)">
              <th class="table-header table-cell">用户名</th>
              <th class="table-header table-cell">角色</th>
              <th class="table-header table-cell">状态</th>
              <th class="table-header table-cell">创建时间</th>
              <th class="table-header table-cell">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="5" class="table-cell text-center" style="color: var(--color-on-surface-variant)">加载中...</td>
            </tr>
            <tr v-else-if="admins.length === 0">
              <td colspan="5" class="table-cell text-center" style="color: var(--color-on-surface-variant)">暂无数据</td>
            </tr>
            <tr
              v-for="item in admins"
              :key="item.id"
              class="border-b"
              style="border-color: var(--color-outline-variant)"
            >
              <td class="table-cell font-medium">{{ item.username }}</td>
              <td class="table-cell">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  :style="{
                    backgroundColor: item.role === 'super_admin' ? 'var(--color-primary-container)' : 'var(--color-secondary-container)',
                    color: item.role === 'super_admin' ? 'var(--color-on-primary-container)' : 'var(--color-on-secondary-container)'
                  }"
                >
                  {{ item.role === 'super_admin' ? '超级管理员' : '运营人员' }}
                </span>
              </td>
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
                    :to="`/admin/${item.id}/edit`"
                    class="text-sm underline hover:opacity-80"
                    style="color: var(--color-primary)"
                  >
                    编辑
                  </RouterLink>
                  <button
                    v-if="item.id !== authStore.admin?.id"
                    @click="confirmDelete(item.id)"
                    class="text-sm underline hover:opacity-80"
                    style="color: var(--color-error)"
                  >
                    删除
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div class="flex items-center justify-between px-4 py-3 border-t" style="border-color: var(--color-outline-variant)">
        <div class="text-sm" style="color: var(--color-on-surface-variant)">
          共 {{ total }} 条
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

    <!-- 删除确认 -->
    <div
      v-if="deleteId"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="deleteId = null"
    >
      <div class="w-full max-w-sm rounded-xl p-6" style="background-color: var(--color-surface-container-high)">
        <h3 class="text-lg font-semibold mb-2" style="color: var(--color-on-surface)">确认删除</h3>
        <p class="text-sm mb-6" style="color: var(--color-on-surface-variant)">删除后无法恢复，确定要删除吗？</p>
        <div class="flex justify-end gap-3">
          <button @click="deleteId = null" class="btn-secondary">取消</button>
          <button @click="handleDelete" :disabled="deleteLoading" class="btn-danger">
            {{ deleteLoading ? '删除中...' : '确认删除' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
