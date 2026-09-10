<script setup lang="ts">
/**
 * 个人设置弹窗 — 头像上传 + 昵称修改。
 */
import { ref, computed } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useMessage } from "@/composables/useMessage";
import { ApiError } from "@/types/api";
import { API_BASE_URL } from "@/api/api";

const emit = defineEmits<{ close: [] }>();
const auth = useAuthStore();
const message = useMessage();

const fullName = ref(auth.user?.username ?? "");
const isSavingName = ref(false);
const isUploadingAvatar = ref(false);
const nameError = ref("");
const oldPassword = ref("");
const newPassword = ref("");
const passwordError = ref("");
const isChangingPassword = ref(false);

const avatarTimestamp = ref(Date.now());

const avatarUrl = computed(() => {
  if (!auth.user?.avatar) return null;
  return `${API_BASE_URL}/users/avatar/${auth.user.id}?t=${avatarTimestamp.value}`;
});

function onAvatarClick() {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = "image/png,image/jpeg,image/gif,image/webp";
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      message.warning("头像文件不能超过 5MB");
      return;
    }
    isUploadingAvatar.value = true;
    try {
      await auth.updateAvatar(file);
      avatarTimestamp.value = Date.now();
      message.success("头像已更新");
    } catch (error) {
      message.error(resolveError(error, "头像上传失败"));
    } finally {
      isUploadingAvatar.value = false;
    }
  };
  input.click();
}

async function submitPassword() {
  passwordError.value = "";
  if (!oldPassword.value) {
    passwordError.value = "请输入原密码";
    return;
  }
  if (newPassword.value.length < 8) {
    passwordError.value = "新密码至少 8 位";
    return;
  }
  isChangingPassword.value = true;
  try {
    await auth.changePassword({
      old_password: oldPassword.value,
      new_password: newPassword.value,
    });
    message.success("密码已修改，请重新登录");
    emit("close");
  } catch (error) {
    passwordError.value = resolveError(error, "密码修改失败");
  } finally {
    isChangingPassword.value = false;
  }
}

async function saveName() {
  nameError.value = "";
  const name = fullName.value.trim();
  if (!name) {
    nameError.value = "昵称不能为空";
    return;
  }
  if (name.length > 100) {
    nameError.value = "昵称不能超过 100 个字符";
    return;
  }
  isSavingName.value = true;
  try {
    await auth.updateProfile({ full_name: name });
    message.success("昵称已更新");
  } catch (error) {
    message.error(resolveError(error, "昵称更新失败"));
  } finally {
    isSavingName.value = false;
  }
}

function resolveError(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}
</script>

<template>
  <div
    class="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex items-center justify-center px-4"
    @click.self="$emit('close')"
  >
    <div
      class="w-full max-w-md rounded-[20px] border border-outline-variant/10 bg-surface-container-low shadow-[0_28px_120px_rgba(0,0,0,0.35)]"
    >
      <!-- 头部 -->
      <div class="px-6 py-5 border-b border-outline-variant/10">
        <div class="flex items-center justify-between gap-4">
          <h3 class="font-headline text-lg font-bold">个人设置</h3>
          <button
            type="button"
            class="w-8 h-8 rounded-xl hover:bg-surface-container-high transition-colors flex items-center justify-center text-on-surface-variant"
            @click="$emit('close')"
          >
            <span class="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>
      </div>

      <!-- 内容区 -->
      <div class="px-6 py-6 space-y-6">
        <!-- 头像区 -->
        <div class="flex flex-col items-center gap-3">
          <button
            class="relative w-24 h-24 rounded-full overflow-hidden bg-surface-container-high border-2 border-outline-variant/20 hover:border-primary/50 transition-colors group"
            :disabled="isUploadingAvatar"
            @click="onAvatarClick"
          >
            <img
              v-if="avatarUrl"
              :src="avatarUrl"
              :alt="auth.user?.username"
              class="w-full h-full object-cover"
            />
            <span v-else class="material-symbols-outlined text-4xl text-outline"
              >person</span
            >
            <div
              class="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            >
              <span class="material-symbols-outlined text-white text-2xl">{{
                isUploadingAvatar ? "sync" : "photo_camera"
              }}</span>
            </div>
          </button>
          <p class="text-xs text-on-surface-variant">
            {{
              isUploadingAvatar
                ? "上传中..."
                : "点击更换头像 (PNG/JPEG/GIF/WebP, ≤2MB)"
            }}
          </p>
        </div>

        <!-- 邮箱（只读） -->
        <div>
          <label
            class="text-[13px] font-medium text-on-surface-variant mb-2 block"
            >邮箱</label
          >
          <div
            class="w-full bg-surface-container-highest border border-outline-variant/10 rounded-xl px-4 py-3 text-sm text-outline"
          >
            {{ auth.user?.email }}
          </div>
        </div>

        <!-- 昵称 -->
        <div>
          <label
            class="text-[13px] font-medium text-on-surface-variant mb-2 block"
            >昵称</label
          >
          <div class="flex gap-2">
            <input
              v-model="fullName"
              type="text"
              maxlength="20"
              placeholder="请输入昵称"
              class="flex-1 bg-surface-container-highest border border-outline-variant/15 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              @keyup.enter="saveName"
            />
            <button
              class="px-4 py-2 rounded-xl text-sm font-medium bg-primary-container text-on-primary-container hover:brightness-110 transition-all disabled:opacity-50"
              :disabled="isSavingName"
              @click="saveName"
            >
              {{ isSavingName ? "保存中" : "保存" }}
            </button>
          </div>
          <p v-if="nameError" class="text-sm text-error mt-2">
            {{ nameError }}
          </p>
        </div>

        <div class="border-t border-outline-variant/10 pt-5 space-y-3">
          <div class="text-sm font-medium">修改密码</div>
          <input
            v-model="oldPassword"
            type="password"
            autocomplete="current-password"
            placeholder="原密码"
            class="w-full bg-surface-container-highest border border-outline-variant/15 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <input
            v-model="newPassword"
            type="password"
            autocomplete="new-password"
            placeholder="新密码（至少 8 位）"
            class="w-full bg-surface-container-highest border border-outline-variant/15 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <p v-if="passwordError" class="text-sm text-error">
            {{ passwordError }}
          </p>
          <button
            class="px-4 py-2 rounded-xl text-sm font-medium border border-outline-variant/20 hover:bg-surface-container-high transition-colors disabled:opacity-50"
            :disabled="isChangingPassword"
            @click="submitPassword"
          >
            {{ isChangingPassword ? "修改中..." : "修改密码" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
