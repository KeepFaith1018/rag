<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import { useVerificationCountdown } from "@/composables/useVerificationCountdown";
import { useAuthStore } from "@/stores/auth";
import { useMessage } from "@/composables/useMessage";
import { ApiError } from "@/types/api";
import { VerificationPurpose } from "@/types/auth";

const router = useRouter();
const authStore = useAuthStore();
const message = useMessage();
const resetCodeCountdown = useVerificationCountdown(30);

const form = ref({
  email: "",
  code: "",
  password: "",
  confirmPassword: "",
});

const sendCodeButtonText = computed(() => {
  if (authStore.isSendingCode) {
    return "发送中...";
  }

  return resetCodeCountdown.buttonText.value;
});

const isResetSendCodeDisabled = computed(() => {
  return authStore.isSendingCode || resetCodeCountdown.isCountingDown.value;
});

const submitButtonText = computed(() => {
  return authStore.isResetPasswordSubmitting ? "重置中..." : "重置密码";
});

const handleSendCode = async () => {
  if (resetCodeCountdown.isCountingDown.value) {
    return;
  }

  const emailValidationError = validateEmail(form.value.email);
  if (emailValidationError) {
    message.warning(emailValidationError);
    return;
  }

  try {
    const result = await authStore.sendVerificationCode({
      email: form.value.email.trim(),
      purpose: VerificationPurpose.RESET_PASSWORD,
    });

    message.success(result.message || "验证码已发送，请查收邮箱");
    resetCodeCountdown.start();
  } catch (error) {
    message.error(resolveErrorMessage(error, "验证码发送失败，请稍后重试"));
  }
};

const handleSubmit = async () => {
  const validationError = validateResetPasswordForm();
  if (validationError) {
    message.warning(validationError);
    return;
  }

  try {
    const result = await authStore.resetPassword({
      email: form.value.email.trim(),
      code: form.value.code.trim(),
      new_password: form.value.password,
    });

    message.success(result.message || "密码已重置，请重新登录");
    await router.replace("/login");
  } catch (error) {
    message.error(resolveErrorMessage(error, "密码重置失败，请稍后重试"));
  }
};

function goBackToLogin() {
  void router.replace("/login");
}

/**
 * 校验重置密码表单。
 */
function validateResetPasswordForm() {
  const emailError = validateEmail(form.value.email);
  if (emailError) {
    return emailError;
  }

  const codeError = validateVerificationCode(form.value.code);
  if (codeError) {
    return codeError;
  }

  const passwordError = validatePassword(form.value.password, "新密码");
  if (passwordError) {
    return passwordError;
  }

  if (form.value.password !== form.value.confirmPassword) {
    return "两次输入的密码不一致";
  }

  return "";
}

/**
 * 校验邮箱格式。
 */
function validateEmail(value: string) {
  const email = value.trim();

  if (!email) {
    return "请输入邮箱地址";
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailPattern.test(email)) {
    return "请输入正确的邮箱格式";
  }

  return "";
}

/**
 * 校验验证码格式。
 */
function validateVerificationCode(value: string) {
  const code = value.trim();

  if (!code) {
    return "请输入验证码";
  }

  if (!/^\d{6}$/.test(code)) {
    return "验证码需为 6 位数字";
  }

  return "";
}

/**
 * 校验密码强度。
 */
function validatePassword(value: string, fieldName: string) {
  if (!value) {
    return `请输入${fieldName}`;
  }

  if (value.length < 8) {
    return `${fieldName}至少需要 8 位字符`;
  }

  if (value.length > 128) {
    return `${fieldName}长度不能超过 128 位字符`;
  }

  return "";
}

/**
 * 统一提取接口错误提示。
 */
function resolveErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message || fallback;
  }

  if (error instanceof Error) {
    return error.message || fallback;
  }

  return fallback;
}
</script>

<template>
  <main class="flex min-h-screen w-full bg-surface">
    <div
      class="hidden lg:flex lg:w-1/2 relative overflow-hidden border-r border-outline-variant/10 bg-surface-container-lowest"
    >
      <div class="absolute inset-0 blueprint-grid"></div>
      <div
        class="absolute top-20 left-[-60px] h-80 w-80 rounded-full bg-primary-container opacity-20 blur-[120px]"
      ></div>
      <div
        class="absolute bottom-10 right-[-40px] h-72 w-72 rounded-full bg-primary opacity-15 blur-[110px]"
      ></div>

      <div
        class="relative z-10 flex h-full max-w-xl flex-col justify-center px-16"
      >
        <div class="mb-10 flex items-center gap-3">
          <div
            class="flex h-10 w-10 items-center justify-center rounded-lg bg-primary-container shadow-[0_0_20px_var(--color-primary-container)]"
          >
            <span class="material-symbols-outlined text-on-primary-container"
              >lock_reset</span
            >
          </div>
          <span
            class="font-headline text-2xl font-bold tracking-tighter text-primary"
          >
            LINSOR_AI
          </span>
        </div>

        <h1
          class="mb-6 font-headline text-5xl font-bold leading-tight tracking-tight text-on-surface"
        >
          安全重建<br />
          <span class="text-primary">访问凭据</span>
        </h1>

        <p
          class="max-w-md text-lg font-light leading-relaxed text-on-surface-variant"
        >
          通过邮箱验证码快速重置密码，恢复你的私有知识库访问权限。
        </p>
      </div>
    </div>

    <div
      class="flex w-full items-center justify-center px-8 py-12 sm:px-16 lg:w-1/2"
    >
      <div
        class="w-full max-w-md rounded-3xl border border-outline-variant/10 bg-surface-container-low/60 p-8 backdrop-blur-xl"
      >
        <div class="mb-8">
          <button
            type="button"
            class="mb-5 inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-outline transition-colors hover:text-primary"
            @click="goBackToLogin"
          >
            <span class="material-symbols-outlined text-base">arrow_back</span>
            返回登录
          </button>

          <h2
            class="mb-2 font-headline text-3xl font-bold tracking-tight text-on-surface"
          >
            找回密码
          </h2>
          <p class="text-sm font-light text-on-surface-variant">
            输入邮箱、验证码与新密码，完成账号访问恢复。
          </p>
        </div>

        <form class="space-y-5" @submit.prevent="handleSubmit">
          <div class="space-y-2">
            <label
              class="block text-[11px] font-label font-medium uppercase tracking-[0.1em] text-on-surface-variant"
            >
              电子邮箱
            </label>
            <BaseInput
              v-model="form.email"
              type="email"
              placeholder="name@linsor.ai"
              required
            />
          </div>

          <div class="space-y-2">
            <label
              class="block text-[11px] font-label font-medium uppercase tracking-[0.1em] text-on-surface-variant"
            >
              验证码
            </label>
            <div class="flex gap-3">
              <BaseInput
                v-model="form.code"
                type="text"
                placeholder="6位验证码"
                required
                class="flex-1 text-center font-mono tracking-widest"
              />
              <BaseButton
                type="button"
                variant="outline"
                class="whitespace-nowrap px-5"
                :disabled="isResetSendCodeDisabled"
                @click="handleSendCode"
              >
                {{ sendCodeButtonText }}
              </BaseButton>
            </div>
          </div>

          <div class="space-y-2">
            <label
              class="block text-[11px] font-label font-medium uppercase tracking-[0.1em] text-on-surface-variant"
            >
              新密码
            </label>
            <BaseInput
              v-model="form.password"
              type="password"
              placeholder="设置新的登录密码"
              required
            />
          </div>

          <div class="space-y-2">
            <label
              class="block text-[11px] font-label font-medium uppercase tracking-[0.1em] text-on-surface-variant"
            >
              确认密码
            </label>
            <BaseInput
              v-model="form.confirmPassword"
              type="password"
              placeholder="再次输入新密码"
              required
            />
          </div>

          <div class="pt-3">
            <BaseButton
              type="submit"
              variant="primary"
              class="w-full py-3"
              :disabled="authStore.isResetPasswordSubmitting"
            >
              {{ submitButtonText }}
              <span class="material-symbols-outlined text-sm">lock</span>
            </BaseButton>
          </div>
        </form>
      </div>
    </div>
  </main>
</template>
