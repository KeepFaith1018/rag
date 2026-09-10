import { defineStore } from "pinia";
import { computed, ref } from "vue";
import {
  getCurrentUser,
  login as loginApi,
  logout as logoutApi,
  changePassword as changePasswordApi,
  register as registerApi,
  resetPassword as resetPasswordApi,
  sendVerificationCode as sendVerificationCodeApi,
  updateUserProfile,
  uploadAvatar,
} from "@/api/auth";
import type {
  LoginPayload,
  RegisterPayload,
  ResetPasswordPayload,
  SendVerificationCodePayload,
  UserProfile,
} from "@/types/auth";
import { clearTokens, getRefreshToken, setTokens } from "@/utils/token";

export const useAuthStore = defineStore("auth", () => {
  const user = ref<UserProfile | null>(null);
  const isBootstrapping = ref(false);
  const isLoginSubmitting = ref(false);
  const isRegisterSubmitting = ref(false);
  const isSendingCode = ref(false);
  const isResetPasswordSubmitting = ref(false);

  /**
   * 当前是否已登录。
   */
  const isAuthenticated = computed(() => Boolean(user.value));

  /**
   * 清空本地认证状态。
   */
  function clearAuthState(options?: { clearTokenStorage?: boolean }) {
    user.value = null;

    if (options?.clearTokenStorage !== false) {
      clearTokens();
    }
  }

  /**
   * 登录并写入本地 token、用户态。
   */
  async function login(payload: LoginPayload, rememberMe = true) {
    isLoginSubmitting.value = true;

    try {
      const result = await loginApi(payload);

      setTokens(result.accessToken, result.refreshToken, rememberMe);
      user.value = result.user;

      return result.user;
    } finally {
      isLoginSubmitting.value = false;
    }
  }

  /**
   * 发送注册验证码。
   */
  async function sendVerificationCode(payload: SendVerificationCodePayload) {
    isSendingCode.value = true;

    try {
      return await sendVerificationCodeApi(payload);
    } finally {
      isSendingCode.value = false;
    }
  }

  /**
   * 注册账号。
   */
  async function register(payload: RegisterPayload) {
    isRegisterSubmitting.value = true;

    try {
      return await registerApi(payload);
    } finally {
      isRegisterSubmitting.value = false;
    }
  }

  /**
   * 通过邮箱验证码重置密码。
   */
  async function resetPassword(payload: ResetPasswordPayload) {
    isResetPasswordSubmitting.value = true;

    try {
      return await resetPasswordApi(payload);
    } finally {
      isResetPasswordSubmitting.value = false;
    }
  }

  /**
   * 获取当前用户信息。
   */
  async function fetchCurrentUser() {
    const profile = await getCurrentUser();
    user.value = profile;
    return profile;
  }

  /**
   * 应用启动时恢复登录态。
   * 当前 accessToken 缺失时，请求层会自动尝试 refresh。
   */
  async function bootstrap() {
    if (isBootstrapping.value) {
      return user.value;
    }

    if (!getRefreshToken()) {
      clearAuthState({ clearTokenStorage: false });
      return null;
    }

    isBootstrapping.value = true;

    try {
      return await fetchCurrentUser();
    } catch {
      clearAuthState();
      return null;
    } finally {
      isBootstrapping.value = false;
    }
  }

  /**
   * 更新当前用户个人资料。
   */
  async function updateProfile(payload: { full_name?: string }) {
    const profile = await updateUserProfile(payload);
    user.value = profile;
    return profile;
  }

  /**
   * 上传新头像并同步用户态。
   */
  async function updateAvatar(file: File) {
    const profile = await uploadAvatar(file);
    user.value = profile;
    return profile;
  }

  /**
   * 主动退出登录。
   */
  async function logout() {
    try {
      await logoutApi();
      return true;
    } catch {
      return false;
    } finally {
      clearAuthState();
    }
  }

  async function changePassword(payload: {
    old_password: string;
    new_password: string;
  }) {
    const result = await changePasswordApi(payload);
    clearAuthState();
    return result;
  }

  return {
    user,
    isAuthenticated,
    isBootstrapping,
    isLoginSubmitting,
    isRegisterSubmitting,
    isSendingCode,
    isResetPasswordSubmitting,
    clearAuthState,
    login,
    sendVerificationCode,
    register,
    resetPassword,
    fetchCurrentUser,
    bootstrap,
    updateProfile,
    updateAvatar,
    logout,
    changePassword,
  };
});
