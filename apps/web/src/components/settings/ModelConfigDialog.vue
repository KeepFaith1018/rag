<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useModelConfigStore, type UserModelConfig } from '@/stores/model-config'
import ModelConfigForm from './ModelConfigForm.vue'

const emit = defineEmits<{ close: [] }>()
const store = useModelConfigStore()
const showForm = ref(false)
const editingModel = ref<UserModelConfig | null>(null)

onMounted(async () => {
  await Promise.all([store.fetchSystemModels(), store.fetchUserModels()])
})

function handleAdd() {
  editingModel.value = null
  showForm.value = true
}

function handleEdit(model: UserModelConfig) {
  editingModel.value = model
  showForm.value = true
}

async function handleToggle(model: UserModelConfig) {
  await store.updateUserModel(model.id, { isActive: !model.is_active })
}

async function handleDelete(model: UserModelConfig) {
  if (!confirm(`删除模型 "${model.model_name}"？`)) return
  await store.deleteUserModel(model.id)
}

function handleFormClose() {
  showForm.value = false
  editingModel.value = null
}

function handleFormSaved() {
  showForm.value = false
  editingModel.value = null
  store.fetchUserModels()
}
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50" @click.self="emit('close')">
    <div class="bg-surface-container-high rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col border border-outline-variant/10">
      <div class="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
        <h2 class="text-lg font-semibold text-on-surface">模型配置</h2>
        <button class="p-1 text-outline hover:text-on-surface transition-colors" @click="emit('close')">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="flex-1 overflow-auto px-6 py-4 space-y-6">
        <!-- 系统模型 -->
        <section>
          <h3 class="text-xs font-medium text-outline uppercase tracking-wide mb-2">系统模型</h3>
          <div class="rounded-xl border border-outline-variant/5 overflow-hidden">
            <table class="w-full text-sm">
              <thead class="bg-surface-container-low">
                <tr>
                  <th class="text-left px-4 py-2 text-xs text-outline font-medium">模型名</th>
                  <th class="text-left px-4 py-2 text-xs text-outline font-medium">服务商</th>
                  <th class="text-left px-4 py-2 text-xs text-outline font-medium">状态</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-outline-variant/5">
                <tr v-for="(m, i) in store.systemModels" :key="i" class="hover:bg-surface-container-low transition-colors">
                  <td class="px-4 py-2.5 text-on-surface">{{ m.modelName }}</td>
                  <td class="px-4 py-2.5 text-outline">{{ m.provider }}</td>
                  <td class="px-4 py-2.5">
                    <span :class="['inline-block w-2 h-2 rounded-full', m.isActive ? 'bg-green-400' : 'bg-outline/30']" />
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <!-- 用户模型 -->
        <section>
          <div class="flex items-center justify-between mb-2">
            <h3 class="text-xs font-medium text-outline uppercase tracking-wide">我的模型</h3>
            <button class="flex items-center gap-1 px-2 py-1 text-xs text-primary hover:bg-primary/10 rounded-lg transition-colors" @click="handleAdd">
              <span class="material-symbols-outlined text-sm">add</span>
              添加模型
            </button>
          </div>
          <div v-if="store.userModels.length === 0" class="text-center py-8 text-xs text-outline/50">
            暂无自定义模型，点击"添加模型"开始配置
          </div>
          <div v-else class="rounded-xl border border-outline-variant/5 overflow-hidden">
            <table class="w-full text-sm">
              <thead class="bg-surface-container-low">
                <tr>
                  <th class="text-left px-4 py-2 text-xs text-outline font-medium">模型名</th>
                  <th class="text-left px-4 py-2 text-xs text-outline font-medium">服务商</th>
                  <th class="text-left px-4 py-2 text-xs text-outline font-medium">状态</th>
                  <th class="text-left px-4 py-2 text-xs text-outline font-medium">操作</th>
                </tr>
              </thead>
              <tbody class="divide-y divide-outline-variant/5">
                <tr v-for="m in store.userModels" :key="m.id" class="hover:bg-surface-container-low transition-colors">
                  <td class="px-4 py-2.5 text-on-surface">{{ m.model_name }}</td>
                  <td class="px-4 py-2.5 text-outline">{{ m.provider }}</td>
                  <td class="px-4 py-2.5">
                    <button @click="handleToggle(m)">
                      <span :class="['inline-block w-2 h-2 rounded-full cursor-pointer', m.is_active ? 'bg-green-400' : 'bg-outline/30']" />
                    </button>
                  </td>
                  <td class="px-4 py-2.5">
                    <div class="flex items-center gap-1">
                      <button class="p-1 text-outline hover:text-on-surface transition-colors" @click="handleEdit(m)">
                        <span class="material-symbols-outlined text-sm">edit</span>
                      </button>
                      <button class="p-1 text-outline hover:text-error transition-colors" @click="handleDelete(m)">
                        <span class="material-symbols-outlined text-sm">delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </div>
      <div class="px-6 py-3 border-t border-outline-variant/10 flex justify-end">
        <button class="px-4 py-2 text-sm text-outline hover:text-on-surface transition-colors" @click="emit('close')">关闭</button>
      </div>
    </div>

    <!-- 添加/编辑模型表单弹窗 -->
    <ModelConfigForm
      v-if="showForm"
      :model="editingModel"
      @close="handleFormClose"
      @saved="handleFormSaved"
    />
  </div>
</template>
