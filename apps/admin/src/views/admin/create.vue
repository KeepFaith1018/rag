<script setup lang="ts">
import { ref, reactive } from "vue";
import { useRouter } from "vue-router";
import { createAdmin } from "@/api/admin-user";
import { ApiError } from "@/api/api";

const router = useRouter();

const form = reactive({
  username: "",
  password: "",
  role: "operator" as "super_admin" | "operator",
});

const loading = ref(false);
const errorMsg = ref("");

async function handleSubmit() {
  if (!form.username || !form.password) {
    errorMsg.value = "请填写必填项";
    return;
  }
  if (form.password.length < 6) {
    errorMsg.value = "密码至少 6 位";
    return;
  }

  loading.value = true;
  errorMsg.value = "";

  try {
    await createAdmin({
      username: form.username,
      password: form.password,
      role: form.role,
    });
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
      <h2 class="text-xl font-semibold" style="color: var(--color-on-surface)">新建管理员</h2>
      <p class="text-sm mt-1" style="color: var(--color-on-surface-variant)">创建新的管理员账号</p>
    </div>

    <form @submit.prevent="handleSubmit" class="card space-y-4">
      <div>
        <label class="block text-sm font-medium mb-1.5" style="color: var(--color-on-surface)">
          用户名 <span style="color: var(--color-error)">*</span>
        </label>
        <input v-model="form.username" type="text" class="input-field" placeholder="请输入用户名" />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1.5" style="color: var(--color-on-surface)">
          密码 <span style="color: var(--color-error)">*</span>
        </label>
        <input v-model="form.password" type="password" class="input-field" placeholder="至少 6 位" autocomplete="new-password" />
      </div>

      <div>
        <label class="block text-sm font-medium mb-1.5" style="color: var(--color-on-surface)">
          角色 <span style="color: var(--color-error)">*</span>
        </label>
        <select v-model="form.role" class="input-field">
          <option value="operator">运营人员</option>
          <option value="super_admin">超级管理员</option>
        </select>
        <p class="text-xs mt-1" style="color: var(--color-on-surface-variant)">
          超级管理员可管理系统管理员，运营人员仅能使用基础管理功能
        </p>
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
