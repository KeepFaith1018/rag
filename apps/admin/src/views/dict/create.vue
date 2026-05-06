<script setup lang="ts">
import { ref, reactive } from "vue";
import { useRouter } from "vue-router";
import { createDictType } from "@/api/dict";
import { ApiError } from "@/api/api";

const router = useRouter();

const form = reactive({
  code: "",
  name: "",
  remark: "",
});

const loading = ref(false);
const errorMsg = ref("");

async function handleSubmit() {
  if (!form.code || !form.name) {
    errorMsg.value = "请填写必填项";
    return;
  }

  loading.value = true;
  errorMsg.value = "";

  try {
    await createDictType({
      code: form.code,
      name: form.name,
      remark: form.remark || undefined,
    });
    router.push("/dict");
  } catch (err) {
    if (err instanceof ApiError) {
      errorMsg.value = err.message;
    }
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="max-w-md space-y-6">
    <div>
      <h2 class="text-xl font-semibold" style="color: var(--color-on-surface)">
        新建字典类型
      </h2>
      <p class="text-sm mt-1" style="color: var(--color-on-surface-variant)">
        添加新的字典类型
      </p>
    </div>

    <form @submit.prevent="handleSubmit" class="card space-y-4">
      <div>
        <label class="block text-sm font-medium mb-1.5" style="color: var(--color-on-surface)">
          编码 <span style="color: var(--color-error)">*</span>
        </label>
        <input v-model="form.code" type="text" class="input-field" placeholder="如：kb_status" />
        <p class="text-xs mt-1" style="color: var(--color-on-surface-variant)">
          编码唯一，用于程序引用
        </p>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1.5" style="color: var(--color-on-surface)">
          名称 <span style="color: var(--color-error)">*</span>
        </label>
        <input v-model="form.name" type="text" class="input-field" placeholder="如：知识库状态" />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1.5" style="color: var(--color-on-surface)">备注</label>
        <input v-model="form.remark" type="text" class="input-field" placeholder="可选" />
      </div>

      <div v-if="errorMsg" class="px-3 py-2 rounded-lg text-sm" style="background-color: var(--color-error-container); color: var(--color-error)">
        {{ errorMsg }}
      </div>

      <div class="flex justify-end gap-3 pt-2">
        <button type="button" @click="router.back()" class="btn-secondary">取消</button>
        <button type="submit" :disabled="loading" class="btn-primary">
          {{ loading ? "保存中..." : "保存" }}
        </button>
      </div>
    </form>
  </div>
</template>
