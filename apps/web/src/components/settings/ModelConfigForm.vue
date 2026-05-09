<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useModelConfigStore, type UserModelConfig } from '@/stores/model-config'
import { useMessage } from '@/composables/useMessage'

const props = defineProps<{ model: UserModelConfig | null }>()
const emit = defineEmits<{ close: []; saved: [] }>()

const store = useModelConfigStore()
const toast = useMessage()

const form = reactive({
  provider: props.model?.provider || 'bailian',
  modelName: props.model?.model_name || '',
  baseUrl: props.model?.base_url || '',
  apiKey: '',
})
const showKey = ref(false)
const testing = ref(false)
const saving = ref(false)

const isEdit = !!props.model

async function handleTest() {
  if (!form.modelName || !form.apiKey) {
    toast.warning('请填写模型名和 API Key')
    return
  }
  testing.value = true
  try {
    const result = await store.testConnectivity({
      provider: form.provider,
      modelName: form.modelName,
      baseUrl: form.baseUrl || undefined,
      apiKey: form.apiKey,
    })
    toast.success(`连接成功！延迟 ${result.latencyMs}ms`)
  } catch (err: any) {
    toast.error(err?.message || '连接失败')
  } finally {
    testing.value = false
  }
}

async function handleSave() {
  if (!form.modelName) {
    toast.warning('请填写模型名')
    return
  }
  saving.value = true
  try {
    // Save API key to sessionStorage (not DB!)
    if (form.apiKey) {
      sessionStorage.setItem('user_api_key', form.apiKey)
      sessionStorage.setItem('user_model', form.modelName)
      sessionStorage.setItem('user_base_url', form.baseUrl)
    }
    if (isEdit) {
      await store.updateUserModel(props.model!.id, {
        provider: form.provider,
        modelName: form.modelName,
        baseUrl: form.baseUrl || undefined,
      })
    } else {
      await store.createUserModel({
        provider: form.provider,
        modelName: form.modelName,
        baseUrl: form.baseUrl || undefined,
      })
    }
    toast.success(isEdit ? '模型已更新' : '模型已添加')
    emit('saved')
  } catch (err: any) {
    toast.error(err?.message || '保存失败')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <div class="absolute inset-0 z-10 flex items-center justify-center bg-black/30" @click.self="emit('close')">
    <div class="bg-surface-container-high rounded-xl shadow-lg w-full max-w-md p-6 border border-outline-variant/10" @click.stop>
      <h3 class="text-base font-semibold text-on-surface mb-4">{{ isEdit ? '编辑模型' : '添加模型' }}</h3>
      <div class="space-y-3">
        <div>
          <label class="text-xs text-outline block mb-1">提供商</label>
          <select v-model="form.provider" class="w-full bg-surface-container-low border border-outline-variant/10 rounded-lg px-3 py-2 text-sm text-on-surface focus:outline-none focus:border-primary">
            <option value="bailian">阿里百炼</option>
            <option value="openai">OpenAI</option>
            <option value="deepseek">DeepSeek</option>
            <option value="zhipu">智谱</option>
            <option value="custom">自定义</option>
          </select>
        </div>
        <div>
          <label class="text-xs text-outline block mb-1">模型名</label>
          <input v-model="form.modelName" class="w-full bg-surface-container-low border border-outline-variant/10 rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-outline/50 focus:outline-none focus:border-primary" placeholder="如: deepseek-v4-pro" />
        </div>
        <div>
          <label class="text-xs text-outline block mb-1">Base URL</label>
          <input v-model="form.baseUrl" class="w-full bg-surface-container-low border border-outline-variant/10 rounded-lg px-3 py-2 text-sm text-on-surface placeholder:text-outline/50 focus:outline-none focus:border-primary" placeholder="如: https://api.deepseek.com/v1" />
        </div>
        <div>
          <label class="text-xs text-outline block mb-1">API Key</label>
          <div class="relative">
            <input :type="showKey ? 'text' : 'password'" v-model="form.apiKey" class="w-full bg-surface-container-low border border-outline-variant/10 rounded-lg px-3 py-2 pr-10 text-sm text-on-surface placeholder:text-outline/50 focus:outline-none focus:border-primary" :placeholder="isEdit ? '留空则不更改' : 'sk-...'" />
            <button class="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-outline hover:text-on-surface transition-colors" @click="showKey = !showKey">
              <span class="material-symbols-outlined text-sm">{{ showKey ? 'visibility_off' : 'visibility' }}</span>
            </button>
          </div>
        </div>
      </div>
      <div class="flex items-center justify-between mt-5 pt-4 border-t border-outline-variant/10">
        <button
          class="flex items-center gap-1 px-3 py-2 text-sm text-outline hover:text-on-surface hover:bg-surface-container-low rounded-lg transition-colors"
          :disabled="testing"
          @click="handleTest"
        >
          <span v-if="testing" class="inline-block w-3 h-3 border-2 border-outline border-t-transparent rounded-full animate-spin" />
          <span v-else class="material-symbols-outlined text-sm">network_check</span>
          {{ testing ? '测试中...' : '测试连通性' }}
        </button>
        <div class="flex items-center gap-2">
          <button class="px-4 py-2 text-sm text-outline hover:text-on-surface transition-colors" @click="emit('close')">取消</button>
          <button
            class="px-4 py-2 text-sm bg-primary text-on-primary rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
            :disabled="saving"
            @click="handleSave"
          >
            {{ saving ? '保存中...' : '确定' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
