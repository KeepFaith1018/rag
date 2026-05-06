<script setup lang="ts">
import { ref, onMounted } from "vue";
import { listDictTypes, deleteDictType, type DictType } from "@/api/dict";
import { ApiError } from "@/api/api";

const loading = ref(false);
const types = ref<DictType[]>([]);
const deleteId = ref<string | null>(null);
const deleteLoading = ref(false);

async function fetchData() {
  loading.value = true;
  try {
    types.value = await listDictTypes();
  } finally {
    loading.value = false;
  }
}

function confirmDelete(code: string) {
  deleteId.value = code;
}

async function handleDelete() {
  if (!deleteId.value) return;
  deleteLoading.value = true;
  try {
    await deleteDictType(deleteId.value);
    deleteId.value = null;
    await fetchData();
  } catch (err) {
    if (err instanceof ApiError) alert(err.message);
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
        <h2 class="text-xl font-semibold" style="color: var(--color-on-surface)">
          系统字典
        </h2>
        <p class="text-sm mt-1" style="color: var(--color-on-surface-variant)">
          管理字典类型和字典项
        </p>
      </div>
      <RouterLink to="/dict/create" class="btn-primary flex items-center gap-2">
        <span class="material-symbols-outlined text-sm">add</span>
        新建字典类型
      </RouterLink>
    </div>

    <div class="card p-0 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b" style="border-color: var(--color-outline-variant)">
              <th class="table-header table-cell">编码</th>
              <th class="table-header table-cell">名称</th>
              <th class="table-header table-cell">备注</th>
              <th class="table-header table-cell">字典项数</th>
              <th class="table-header table-cell">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="5" class="table-cell text-center" style="color: var(--color-on-surface-variant)">
                加载中...
              </td>
            </tr>
            <tr v-else-if="types.length === 0">
              <td colspan="5" class="table-cell text-center" style="color: var(--color-on-surface-variant)">
                暂无数据
              </td>
            </tr>
            <tr
              v-for="item in types"
              :key="item.id"
              class="border-b"
              style="border-color: var(--color-outline-variant)"
            >
              <td class="table-cell font-mono text-sm">{{ item.code }}</td>
              <td class="table-cell">{{ item.name }}</td>
              <td class="table-cell text-sm" style="color: var(--color-on-surface-variant)">
                {{ item.remark || '-' }}
              </td>
              <td class="table-cell text-center">{{ item.itemCount }}</td>
              <td class="table-cell">
                <div class="flex items-center gap-2">
                  <RouterLink
                    :to="`/dict/${item.code}`"
                    class="text-sm underline hover:opacity-80"
                    style="color: var(--color-primary)"
                  >
                    编辑
                  </RouterLink>
                  <button
                    @click="confirmDelete(item.code)"
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
    </div>

    <!-- 删除确认 -->
    <div
      v-if="deleteId"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="deleteId = null"
    >
      <div class="w-full max-w-sm rounded-xl p-6" style="background-color: var(--color-surface-container-high)">
        <h3 class="text-lg font-semibold mb-2" style="color: var(--color-on-surface)">确认删除</h3>
        <p class="text-sm mb-6" style="color: var(--color-on-surface-variant)">
          删除后无法恢复，确定要删除吗？
        </p>
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
