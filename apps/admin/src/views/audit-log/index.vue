<script setup lang="ts">
import { ref, onMounted, reactive } from "vue";
import { listAuditLogs, type AuditLog } from "@/api/audit-log";

const loading = ref(false);
const logs = ref<AuditLog[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

const filters = reactive({
  action: "",
  module: "",
  adminUsername: "",
});

async function fetchData() {
  loading.value = true;
  try {
    const result = await listAuditLogs({
      page: page.value,
      pageSize: pageSize.value,
      action: filters.action || undefined,
      module: filters.module || undefined,
      adminUsername: filters.adminUsername || undefined,
    });
    logs.value = result.list;
    total.value = result.total;
  } finally {
    loading.value = false;
  }
}

function handleFilterChange() {
  page.value = 1;
  fetchData();
}

const moduleOptions = [
  "auth", "model-config", "user", "admin", "public-kb", "dict",
];

onMounted(() => fetchData());
</script>

<template>
  <div class="space-y-4">
    <div>
      <h2 class="text-xl font-semibold" style="color: var(--color-on-surface)">
        审计日志
      </h2>
      <p class="text-sm mt-1" style="color: var(--color-on-surface-variant)">
        查看管理员操作记录
      </p>
    </div>

    <div class="card">
      <div class="flex flex-wrap gap-3">
        <input
          v-model="filters.adminUsername"
          @change="handleFilterChange"
          type="text"
          placeholder="管理员"
          class="input-field w-40"
        />
        <select
          v-model="filters.module"
          @change="handleFilterChange"
          class="input-field w-32"
        >
          <option value="">全部模块</option>
          <option v-for="m in moduleOptions" :key="m" :value="m">{{ m }}</option>
        </select>
        <input
          v-model="filters.action"
          @change="handleFilterChange"
          type="text"
          placeholder="操作名称"
          class="input-field w-40"
        />
      </div>
    </div>

    <div class="card p-0 overflow-hidden">
      <div class="overflow-x-auto">
        <table class="w-full">
          <thead>
            <tr class="border-b" style="border-color: var(--color-outline-variant)">
              <th class="table-header table-cell">时间</th>
              <th class="table-header table-cell">管理员</th>
              <th class="table-header table-cell">模块</th>
              <th class="table-header table-cell">操作</th>
              <th class="table-header table-cell">IP</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="loading">
              <td colspan="5" class="table-cell text-center" style="color: var(--color-on-surface-variant)">
                加载中...
              </td>
            </tr>
            <tr v-else-if="logs.length === 0">
              <td colspan="5" class="table-cell text-center" style="color: var(--color-on-surface-variant)">
                暂无数据
              </td>
            </tr>
            <tr
              v-for="item in logs"
              :key="item.id"
              class="border-b"
              style="border-color: var(--color-outline-variant)"
            >
              <td class="table-cell text-xs" style="color: var(--color-on-surface-variant)">
                {{ new Date(item.createdAt).toLocaleString("zh-CN") }}
              </td>
              <td class="table-cell text-sm">
                {{ item.admin?.username || '-' }}
              </td>
              <td class="table-cell">
                <span
                  class="inline-flex items-center px-2 py-0.5 rounded text-xs"
                  style="background-color: var(--color-secondary-container); color: var(--color-secondary)"
                >
                  {{ item.module }}
                </span>
              </td>
              <td class="table-cell text-sm">{{ item.action }}</td>
              <td class="table-cell text-xs" style="color: var(--color-on-surface-variant)">
                {{ item.ipAddress || '-' }}
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
