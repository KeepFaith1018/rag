<script setup lang="ts">
import { ref, reactive, onMounted } from "vue";
import { useRouter, useRoute } from "vue-router";
import { getAdmin, updateAdmin } from "@/api/admin-user";
import { ApiError } from "@/api/api";
import type { AdminUser } from "@/api/admin-user";

const router = useRouter();
const route = useRoute();
const id = route.params.id as string;

const fetching = ref(true);
const loading = ref(false);
const errorMsg = ref("");

const form = reactive({
  password: "",
  role: "operator" as "super_admin" | "operator",
  isActive: true,
});

onMounted(async () => {
  try {
    const data = await getAdmin(id);
    form.role = data.role;
    form.isActive = data.isActive;
  } catch {
    router.push("/admin");
  } finally {
    fetching.value = false;
  }
});

async function handleSubmit() {
  loading.value = true;
  errorMsg.value = "";

  try {
    const dto: Record<string, unknown> = {
      role: form.role,
      isActive: form.isActive,
    };
    if (form.password) {
      if (form.password.length < 6) {
        errorMsg.value = "密码至少 6 位";
        loading.value = false;
        return;
      }
      dto.password = form.password;
    }
    await updateAdmin(id, dto as any);
    router.push("/admin");
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
      <h2 class="text-xl font-semibold" style="color: var(--color-on-surface)">编辑管理员</h2>
      <p class="text-sm mt-1" style="color: var(--color-on-surface-variant)">修改管理员信息</p>
    </div>

    <div v-if="fetching" class="card text-center py-8" style="color: var(--color-on-surface-variant)">
      加载中...
    </div>

    <form v-else @submit.prevent="handleSubmit" class="card space-y-4">
      <div>
        <label class="block text-sm font-medium mb-1.5" style="color: var(--color-on-surface)">新密码</label>
        <input v-model="form.password" type="password" class="input-field" placeholder="留空则不修改" autocomplete="new-password" />
        <p class="text-xs mt-1" style="color: var(--color-on-surface-variant)">留空则保持原有密码不变</p>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1.5" style="color: var(--color-on-surface)">角色</label>
        <select v-model="form.role" class="input-field">
          <option value="operator">运营人员</option>
          <option value="super_admin">超级管理员</option>
        </select>
      </div>

      <div>
        <label class="block text-sm font-medium mb-1.5" style="color: var(--color-on-surface)">状态</label>
        <label class="flex items-center gap-2 cursor-pointer">
          <input v-model="form.isActive" type="checkbox" class="w-4 h-4" />
          <span class="text-sm" style="color: var(--color-on-surface)">启用账号</span>
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
