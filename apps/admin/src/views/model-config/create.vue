<script setup lang="ts">
import { ref, reactive } from "vue";
import { useRouter } from "vue-router";
import { createModelConfig } from "@/api/model-config";
import { ApiError } from "@/api/api";

const router = useRouter();

const form = reactive({
  provider: "",
  name: "",
  type: "chat" as "chat" | "embedding",
  baseUrl: "",
  apiKey: "",
  isDefault: false,
  isActive: true,
});

const loading = ref(false);
const errorMsg = ref("");

async function handleSubmit() {
  if (!form.provider || !form.name || !form.type) {
    errorMsg.value = "请填写必填项";
    return;
  }

  loading.value = true;
  errorMsg.value = "";

  try {
    await createModelConfig({
      provider: form.provider,
      name: form.name,
      type: form.type,
      baseUrl: form.baseUrl || undefined,
      apiKey: form.apiKey || undefined,
      isDefault: form.isDefault,
      isActive: form.isActive,
    });
    router.push("/model-config");
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
  <div class="max-w-2xl space-y-6">
    <div>
      <h2 class="text-xl font-semibold" style="color: var(--color-on-surface)">新建模型配置</h2>
      <p class="text-sm mt-1" style="color: var(--color-on-surface-variant)">添加新的 AI 模型配置</p>
    </div>

    <form @submit.prevent="handleSubmit" class="card space-y-4">
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1.5" style="color: var(--color-on-surface)">
            服务商 <span style="color: var(--color-error)">*</span>
          </label>
          <input
            v-model="form.provider"
            type="text"
            class="input-field"
            placeholder="如：OpenAI、阿里百炼"
          />
        </div>
        <div>
          <label class="block text-sm font-medium mb-1.5" style="color: var(--color-on-surface)">
            模型名称 <span style="color: var(--color-error)">*</span>
          </label>
          <input
            v-model="form.name"
            type="text"
            class="input-field"
            placeholder="如：gpt-4o、qwen-turbo"
          />
        </div>
      </div>

      <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium mb-1.5" style="color: var(--color-on-surface)">
            模型类型 <span style="color: var(--color-error)">*</span>
          </label>
          <select v-model="form.type" class="input-field">
            <option value="chat">对话模型</option>
            <option value="embedding">Embedding</option>
          </select>
        </div>
        <div>
          <label class="block text-sm font-medium mb-1.5" style="color: var(--color-on-surface)">API 地址</label>
          <input
            v-model="form.baseUrl"
            type="text"
            class="input-field"
            placeholder="如：https://api.openai.com/v1"
          />
        </div>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1.5" style="color: var(--color-on-surface)">API 密钥</label>
        <input
          v-model="form.apiKey"
          type="password"
          class="input-field"
          placeholder="请输入 API 密钥"
          autocomplete="new-password"
        />
      </div>

      <div class="flex items-center gap-6">
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="form.isDefault" type="checkbox" class="w-4 h-4" />
          <span class="text-sm" style="color: var(--color-on-surface)">设为默认模型</span>
        </label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="form.isActive" type="checkbox" class="w-4 h-4" />
          <span class="text-sm" style="color: var(--color-on-surface)">启用</span>
        </label>
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
