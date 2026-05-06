<script setup lang="ts">
import { ref, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { getPublicKb, updatePublicKbStatus, type PublicKb } from "@/api/public-kb";
import { listPublicKbDocuments, type PublicKbDocument } from "@/api/public-kb-document";
import { ApiError } from "@/api/api";

const router = useRouter();
const route = useRoute();
const id = route.params.id as string;

const kb = ref<PublicKb | null>(null);
const documents = ref<PublicKbDocument[]>([]);
const loading = ref(true);
const docLoading = ref(false);
const total = ref(0);
const page = ref(1);
const pageSize = ref(20);

onMounted(async () => {
  try {
    kb.value = await getPublicKb(id);
    await fetchDocuments();
  } catch {
    router.push("/public-kb");
  } finally {
    loading.value = false;
  }
});

async function fetchDocuments() {
  docLoading.value = true;
  try {
    const result = await listPublicKbDocuments(id, {
      page: page.value,
      pageSize: pageSize.value,
    });
    documents.value = result.list;
    total.value = result.total;
  } finally {
    docLoading.value = false;
  }
}

async function handleUpdateStatus(status: string) {
  try {
    await updatePublicKbStatus(id, status as "normal" | "blocked");
    kb.value && (kb.value.status = status);
  } catch (err) {
    if (err instanceof ApiError) alert(err.message);
  }
}
</script>

<template>
  <div class="space-y-6">
    <div class="flex items-center gap-4">
      <button
        @click="router.back()"
        class="flex items-center gap-1 text-sm"
        style="color: var(--color-primary)"
      >
        <span class="material-symbols-outlined text-sm">arrow_back</span>
        返回
      </button>
      <h2 class="text-xl font-semibold" style="color: var(--color-on-surface)">
        知识库详情
      </h2>
    </div>

    <div v-if="loading" class="card text-center py-8" style="color: var(--color-on-surface-variant)">
      加载中...
    </div>

    <template v-else-if="kb">
      <div class="card">
        <div class="flex items-start justify-between pb-4 border-b" style="border-color: var(--color-outline-variant)">
          <div>
            <h3 class="text-lg font-semibold" style="color: var(--color-on-surface)">
              {{ kb.name }}
            </h3>
            <p v-if="kb.description" class="text-sm mt-1" style="color: var(--color-on-surface-variant)">
              {{ kb.description }}
            </p>
          </div>
          <span
            class="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium"
            :style="{
              backgroundColor: kb.status === 'normal' ? 'var(--color-primary-container)' : 'var(--color-error-container)',
              color: kb.status === 'normal' ? 'var(--color-primary)' : 'var(--color-error)',
            }"
          >
            {{ kb.status === 'normal' ? '正常' : kb.status === 'blocked' ? '已封禁' : '待审核' }}
          </span>
        </div>

        <div class="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-4">
          <div>
            <div class="text-xs" style="color: var(--color-on-surface-variant)">创建者</div>
            <div class="text-sm mt-1" style="color: var(--color-on-surface)">{{ kb.owner.email }}</div>
          </div>
          <div>
            <div class="text-xs" style="color: var(--color-on-surface-variant)">文档数</div>
            <div class="text-sm mt-1" style="color: var(--color-on-surface)">{{ kb.documentCount }}</div>
          </div>
          <div>
            <div class="text-xs" style="color: var(--color-on-surface-variant)">可见性</div>
            <div class="text-sm mt-1" style="color: var(--color-on-surface)">{{ kb.visibility }}</div>
          </div>
          <div>
            <div class="text-xs" style="color: var(--color-on-surface-variant)">创建时间</div>
            <div class="text-sm mt-1" style="color: var(--color-on-surface)">
              {{ new Date(kb.createdAt).toLocaleDateString("zh-CN") }}
            </div>
          </div>
        </div>

        <div class="flex justify-end gap-3 mt-6">
          <button
            v-if="kb.status !== 'blocked'"
            @click="handleUpdateStatus('blocked')"
            class="btn-danger"
          >
            封禁
          </button>
          <button
            v-else
            @click="handleUpdateStatus('normal')"
            class="btn-primary"
          >
            解封
          </button>
        </div>
      </div>

      <!-- 文档列表 -->
      <div class="card">
        <h3 class="text-sm font-medium mb-4" style="color: var(--color-on-surface)">
          文档列表
        </h3>
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b" style="border-color: var(--color-outline-variant)">
                <th class="table-header table-cell">标题</th>
                <th class="table-header table-cell">类型</th>
                <th class="table-header table-cell">状态</th>
                <th class="table-header table-cell">更新时间</th>
              </tr>
            </thead>
            <tbody>
              <tr v-if="docLoading">
                <td colspan="4" class="table-cell text-center" style="color: var(--color-on-surface-variant)">
                  加载中...
                </td>
              </tr>
              <tr v-else-if="documents.length === 0">
                <td colspan="4" class="table-cell text-center" style="color: var(--color-on-surface-variant)">
                  暂无文档
                </td>
              </tr>
              <tr
                v-for="doc in documents"
                :key="doc.id"
                class="border-b"
                style="border-color: var(--color-outline-variant)"
              >
                <td class="table-cell font-medium">{{ doc.title }}</td>
                <td class="table-cell text-sm" style="color: var(--color-on-surface-variant)">
                  {{ doc.fileType || '-' }}
                </td>
                <td class="table-cell">
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded text-xs"
                    :style="{
                      backgroundColor: doc.status === 'ready' ? 'var(--color-primary-container)' : 'var(--color-secondary-container)',
                      color: doc.status === 'ready' ? 'var(--color-primary)' : 'var(--color-secondary)',
                    }"
                  >
                    {{ doc.currentStage }}
                  </span>
                </td>
                <td class="table-cell text-xs" style="color: var(--color-on-surface-variant)">
                  {{ new Date(doc.updatedAt).toLocaleDateString("zh-CN") }}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-if="total > pageSize" class="flex justify-center gap-2 mt-4">
          <button
            @click="page = Math.max(1, page - 1); fetchDocuments()"
            :disabled="page <= 1"
            class="btn-secondary px-3 py-1.5 text-sm"
          >
            上一页
          </button>
          <button
            @click="page++; fetchDocuments()"
            :disabled="page >= Math.ceil(total / pageSize)"
            class="btn-secondary px-3 py-1.5 text-sm"
          >
            下一页
          </button>
        </div>
      </div>
    </template>
  </div>
</template>
