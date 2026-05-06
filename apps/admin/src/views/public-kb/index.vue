<script setup lang="ts">
import { ref, onMounted, reactive } from "vue";
import { RouterLink } from "vue-router";
import { listPublicKbs, updatePublicKbStatus, type PublicKb } from "@/api/public-kb";
import { ApiError } from "@/api/api";

const loading = ref(false);
const kbs = ref<PublicKb[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

const filters = reactive({
  name: "",
  status: "",
});

async function fetchData() {
  loading.value = true;
  try {
    const result = await listPublicKbs({
      page: page.value,
      pageSize: pageSize.value,
      name: filters.name || undefined,
      status: filters.status || undefined,
    });
    kbs.value = result.list;
    total.value = result.total;
  } finally {
    loading.value = false;
  }
}

function handleFilterChange() {
  page.value = 1;
  fetchData();
}

async function handleUpdateStatus(id: string, status: string) {
  try {
    await updatePublicKbStatus(id, status as "normal" | "blocked");
    await fetchData();
  } catch (err) {
    if (err instanceof ApiError) alert(err.message);
  }
}

onMounted(() => fetchData());
</script>

<template>
  <div class="space-y-4">
    <div>
      <h2 class="text-xl font-semibold" style="color: var(--color-on-surface)">
        公开知识库管理
      </h2>
      <p class="text-sm mt-1" style="color: var(--color-on-surface-variant)">
        管理和审核公开的知识库
      </p>
    </div>

    <div class="card">
      <div class="flex flex-wrap gap-3">
        <input
          v-model="filters.name"
          @change="handleFilterChange"
          type="text"
          placeholder="搜索名称"
          class="input-field w-48"
        />
        <select
          v-model="filters.status"
          @change="handleFilterChange"
          class="input-field w-40"
        >
          <option value="">全部状态</option>
          <option value="normal">正常</option>
          <option value="pending">待审核</option>
          <option value="blocked">已封禁</option>
        </select>
      </div>
    </div>

    <div class="card p-0 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b" style="border-color: var(--color-outline-variant)">
              <th class="table-header table-cell">名称</th>
              <th class="table-header table-cell">创建者</th>
              <th class="table-header table-cell">文档数</th>
              <th class="table-header table-cell">状态</th>
              <th class="table-header table-cell">创建时间</th>
              <th class="table-header table-cell">操作</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="6" class="table-cell text-center" style="color: var(--color-on-surface-variant)">
                加载中...
              </td>
            </tr>
            <tr v-else-if="kbs.length === 0">
              <td colspan="6" class="table-cell text-center" style="color: var(--color-on-surface-variant)">
                暂无数据
              </td>
            </tr>
            <tr
              v-for="item in kbs"
              :key="item.id"
              class="border-b"
              style="border-color: var(--color-outline-variant)"
            >
              <td class="table-cell">
                <div>
                  <div class="font-medium">{{ item.name }}</div>
                  <div v-if="item.description" class="text-xs truncate max-w-xs" style="color: var(--color-on-surface-variant)">
                    {{ item.description }}
                  </div>
                </div>
              </td>
              <td class="table-cell">
                <div class="text-sm">{{ item.owner.email }}</div>
                <div v-if="item.owner.fullName" class="text-xs" style="color: var(--color-on-surface-variant)">
                  {{ item.owner.fullName }}
                </div>
              </td>
              <td class="table-cell text-center">{{ item.documentCount }}</td>
              <td class="table-cell">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium"
                  :style="{
                    backgroundColor: item.status === 'normal' ? 'var(--color-primary-container)' : 'var(--color-error-container)',
                    color: item.status === 'normal' ? 'var(--color-primary)' : 'var(--color-error)',
                  }"
                >
                  {{ item.status === 'normal' ? '正常' : item.status === 'blocked' ? '已封禁' : '待审核' }}
                </span>
              </td>
              <td class="table-cell text-xs" style="color: var(--color-on-surface-variant)">
                {{ new Date(item.createdAt).toLocaleDateString("zh-CN") }}
              </td>
              <td class="table-cell">
                <div class="flex items-center gap-2">
                  <RouterLink
                    :to="`/public-kb/${item.id}`"
                    class="text-sm underline hover:opacity-80"
                    style="color: var(--color-primary)"
                  >
                    详情
                  </RouterLink>
                  <button
                    v-if="item.status !== 'blocked'"
                    @click="handleUpdateStatus(item.id, 'blocked')"
                    class="text-sm underline hover:opacity-80"
                    style="color: var(--color-error)"
                  >
                    封禁
                  </button>
                  <button
                    v-else
                    @click="handleUpdateStatus(item.id, 'normal')"
                    class="text-sm underline hover:opacity-80"
                    style="color: var(--color-primary)"
                  >
                    解封
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
          <button
            @click="page = Math.max(1, page - 1); fetchData()"
            :disabled="page <= 1"
            class="btn-secondary px-3 py-1.5 text-sm"
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
  </div>
</template>
