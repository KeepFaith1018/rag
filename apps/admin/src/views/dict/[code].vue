<script setup lang="ts">
import { ref, onMounted, reactive } from "vue";
import { useRouter, useRoute } from "vue-router";
import {
  getDictType,
  updateDictType,
  createDictItem,
  updateDictItem,
  deleteDictItem,
  type DictTypeDetail,
  type DictItem,
} from "@/api/dict";
import { ApiError } from "@/api/api";

const router = useRouter();
const route = useRoute();
const code = route.params.code as string;

const loading = ref(true);
const dict = ref<DictTypeDetail | null>(null);

const typeForm = reactive({ name: "", remark: "" });
const typeLoading = ref(false);

const itemForm = reactive({ value: "", label: "", sort: 0 });
const itemLoading = ref(false);

onMounted(async () => {
  try {
    dict.value = await getDictType(code);
    typeForm.name = dict.value.name;
    typeForm.remark = dict.value.remark || "";
  } catch {
    router.push("/dict");
  } finally {
    loading.value = false;
  }
});

async function handleUpdateType() {
  typeLoading.value = true;
  try {
    await updateDictType(code, { name: typeForm.name, remark: typeForm.remark });
    dict.value && (dict.value.name = typeForm.name);
    dict.value && (dict.value.remark = typeForm.remark);
  } catch (err) {
    if (err instanceof ApiError) alert(err.message);
  } finally {
    typeLoading.value = false;
  }
}

async function handleCreateItem() {
  if (!itemForm.value || !itemForm.label) {
    alert("请填写完整信息");
    return;
  }
  itemLoading.value = true;
  try {
    await createDictItem({
      typeCode: code,
      value: itemForm.value,
      label: itemForm.label,
      sort: itemForm.sort,
    });
    itemForm.value = "";
    itemForm.label = "";
    itemForm.sort = 0;
    dict.value = await getDictType(code);
  } catch (err) {
    if (err instanceof ApiError) alert(err.message);
  } finally {
    itemLoading.value = false;
  }
}

async function handleToggleItem(item: DictItem) {
  try {
    await updateDictItem(item.id, { status: !item.status });
    if (dict.value) {
      const idx = dict.value.items.findIndex((i) => i.id === item.id);
      if (idx >= 0) dict.value.items[idx].status = !item.status;
    }
  } catch (err) {
    if (err instanceof ApiError) alert(err.message);
  }
}

async function handleDeleteItem(id: string) {
  if (!confirm("确定要删除吗？")) return;
  try {
    await deleteDictItem(id);
    dict.value = await getDictType(code);
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
        字典详情
      </h2>
    </div>

    <div v-if="loading" class="card text-center py-8" style="color: var(--color-on-surface-variant)">
      加载中...
    </div>

    <template v-else-if="dict">
      <!-- 基本信息 -->
      <div class="card">
        <h3 class="text-sm font-medium mb-4" style="color: var(--color-on-surface)">
          基本信息
        </h3>
        <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label class="block text-xs mb-1" style="color: var(--color-on-surface-variant)">编码</label>
            <div class="font-mono text-sm" style="color: var(--color-on-surface)">{{ dict.code }}</div>
          </div>
          <div>
            <label class="block text-xs mb-1" style="color: var(--color-on-surface-variant)">名称</label>
            <input v-model="typeForm.name" type="text" class="input-field" />
          </div>
          <div>
            <label class="block text-xs mb-1" style="color: var(--color-on-surface-variant)">备注</label>
            <input v-model="typeForm.remark" type="text" class="input-field" />
          </div>
        </div>
        <div class="flex justify-end mt-4">
          <button @click="handleUpdateType" :disabled="typeLoading" class="btn-primary">
            {{ typeLoading ? "保存中..." : "保存" }}
          </button>
        </div>
      </div>

      <!-- 添加字典项 -->
      <div class="card">
        <h3 class="text-sm font-medium mb-4" style="color: var(--color-on-surface)">
          添加字典项
        </h3>
        <div class="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <input v-model="itemForm.value" type="text" placeholder="值" class="input-field" />
          <input v-model="itemForm.label" type="text" placeholder="标签" class="input-field" />
          <input v-model.number="itemForm.sort" type="number" placeholder="排序" class="input-field" />
          <button @click="handleCreateItem" :disabled="itemLoading" class="btn-primary">
            {{ itemLoading ? "添加中..." : "添加" }}
          </button>
        </div>
      </div>

      <!-- 字典项列表 -->
      <div class="card p-0 overflow-hidden">
        <div class="overflow-x-auto">
          <table class="w-full">
            <thead>
              <tr class="border-b" style="border-color: var(--color-outline-variant)">
                <th class="table-header table-cell">值</th>
                <th class="table-header table-cell">标签</th>
                <th class="table-header table-cell">排序</th>
                <th class="table-header table-cell">状态</th>
                <th class="table-header table-cell">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="item in dict.items"
                :key="item.id"
                class="border-b"
                style="border-color: var(--color-outline-variant)"
              >
                <td class="table-cell font-mono text-sm">{{ item.value }}</td>
                <td class="table-cell">{{ item.label }}</td>
                <td class="table-cell text-center">{{ item.sort }}</td>
                <td class="table-cell">
                  <span
                    class="inline-flex items-center px-2 py-0.5 rounded text-xs"
                    :style="{
                      backgroundColor: item.status ? 'var(--color-primary-container)' : 'var(--color-error-container)',
                      color: item.status ? 'var(--color-primary)' : 'var(--color-error)',
                    }"
                  >
                    {{ item.status ? '启用' : '禁用' }}
                  </span>
                </td>
                <td class="table-cell">
                  <div class="flex items-center gap-2">
                    <button
                      @click="handleToggleItem(item)"
                      class="text-sm underline hover:opacity-80"
                      style="color: var(--color-primary)"
                    >
                      {{ item.status ? '禁用' : '启用' }}
                    </button>
                    <button
                      @click="handleDeleteItem(item.id)"
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
    </template>
  </div>
</template>
