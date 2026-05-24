<script setup lang="ts">
import { ref, onMounted, reactive } from "vue";
import { RouterLink } from "vue-router";
import {
  listModelConfigs,
  toggleModelConfig,
  deleteModelConfig,
  type ModelConfig,
} from "@/api/model-config";
import { ApiError } from "@/api/api";

const loading = ref(false);
const configs = ref<ModelConfig[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

const filters = reactive({
  provider: "",
  type: "",
  isActive: "" as "" | "true" | "false",
});

const deleteId = ref<string | null>(null);
const deleteLoading = ref(false);

async function fetchData() {
  loading.value = true;
  try {
    const result = await listModelConfigs({
      page: page.value,
      pageSize: pageSize.value,
      provider: filters.provider || undefined,
      type: filters.type || undefined,
      isActive: filters.isActive ? filters.isActive === "true" : undefined,
    });
    configs.value = result.list;
    total.value = result.total;
  } finally {
    loading.value = false;
  }
}

function buildQuery() {
  return { page: page.value, pageSize: pageSize.value };
}

async function handleToggle(id: string) {
  try {
    await toggleModelConfig(id);
    await fetchData();
  } catch (err) {
    if (err instanceof ApiError) {
      alert(err.message);
    }
  }
}

function confirmDelete(id: string) {
  deleteId.value = id;
}

async function handleDelete() {
  if (!deleteId.value) return;
  deleteLoading.value = true;
  try {
    await deleteModelConfig(deleteId.value);
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

function handleFilterChange() {
  page.value = 1;
  fetchData();
}

onMounted(() => fetchData());
</script>

<template>
  <div class="space-y-4">
    <div class="flex items-center justify-between">
      <div>
        <h2 class="text-xl font-semibold" style="color: var(--color-on-surface)">模型配置</h2>
        <p class="text-sm mt-1" style="color: var(--color-on-surface-variant)">管理 AI 模型配置</p>
      </div>
      <RouterLink to="/model-config/create" class="btn-primary flex items-center gap-2">
        <span class="material-symbols-outlined text-sm">add</span>
        新建配置
      </RouterLink>
    </div>

    <!-- 筛选 -->
    <div class="card">
      <div class="flex flex-wrap gap-3">
        <input
          v-model="filters.provider"
          @change="handleFilterChange"
          type="text"
          placeholder="服务商"
          class="input-field w-40"
        />
        <select
          v-model="filters.type"
          @change="handleFilterChange"
          class="input-field w-32"
        >
          <option value="">全部类型</option>
          <option value="chat">对话模型</option>
          <option value="embedding">Embedding</option>
        </select>
        <select
          v-model="filters.isActive"
          @change="handleFilterChange"
          class="input-field w-32"
        >
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
              <th class="table-header table-cell">服务商</th>
              <th class="table-header table-cell">模型名称</th>
              <th class="table-header table-cell">类型</th>
              <th class="table-header table-cell">默认</th>
              <th class="table-header table-cell">状态</th>
              <th class="table-header table-cell">创建时间</th>
              <th class="table-header table-cell">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="7" class="table-cell text-center" style="color: var(--color-on-surface-variant)">
                加载中...
              </td>
            </tr>
            <tr v-else-if="configs.length === 0">
              <td colspan="7" class="table-cell text-center" style="color: var(--color-on-surface-variant)">
                暂无数据
              </td>
            </tr>
            <tr
              v-for="item in configs"
              :key="item.id"
              class="border-b transition-colors"
              style="border-color: var(--color-outline-variant)"
            >
              <td class="table-cell font-medium">{{ item.provider }}</td>
              <td class="table-cell">{{ item.name }}</td>
              <td class="table-cell">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  :style="{
                    backgroundColor: item.type === 'chat' ? 'var(--color-primary-container)' : 'var(--color-secondary-container)',
                    color: item.type === 'chat' ? 'var(--color-on-primary-container)' : 'var(--color-on-secondary-container)'
                  }"
                >
                  {{ item.type === 'chat' ? '对话模型' : 'Embedding' }}
                </span>
              </td>
              <td class="table-cell">
                <span v-if="item.isDefault" class="material-symbols-outlined text-sm" style="color: var(--color-primary)">star</span>
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
                    :to="`/model-config/${item.id}/edit`"
                    class="text-sm underline hover:opacity-80"
                    style="color: var(--color-primary)"
                  >
                    编辑
                  </RouterLink>
                  <button
                    @click="handleToggle(item.id)"
                    class="text-sm underline hover:opacity-80"
                    style="color: var(--color-secondary)"
                  >
                    {{ item.isActive ? '禁用' : '启用' }}
                  </button>
                  <button
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

      <!-- 分页 -->
      <div class="flex items-center justify-between px-4 py-3 border-t" style="border-color: var(--color-outline-variant)">
        <div class="text-sm" style="color: var(--color-on-surface-variant)">
          共 {{ total }} 条，第 {{ page }} / {{ Math.ceil(total / pageSize) || 1 }} 页
        </div>
        <div class="flex items-center gap-2">
          <button
            @click="page = Math.max(1, page - 1); fetchData()"
            :disabled="page <= 1"
            class="btn-secondary px-3 py-1.5 text-sm"
            :disabled="page <= 1"
          >
            上一页
          </button>
          <button
            @click="page++; fetchData()"
            :disabled="page >= Math.ceil(total / pageSize)"
            class="btn-secondary px-3 py-1.5 text-sm"
          >
            下一页
          </button>
        </div>
      </div>
    </div>

    <!-- 删除确认弹窗 -->
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
