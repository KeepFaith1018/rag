import { apiRequest } from "@/api/api";
import type {
  LoginPayload,
  LoginResponse,
  MessageResponse,
  RefreshPayload,
  RefreshResponse,
  RegisterPayload,
  ResetPasswordPayload,
  SendVerificationCodePayload,
  UserProfile,
} from "@/types/auth";

/**
 * 发送邮箱验证码。
 */
export function sendVerificationCode(data: SendVerificationCodePayload) {
  return apiRequest<MessageResponse>({
    url: "/auth/send-code",
    method: "POST",
    body: data,
    skipAuth: true,
    skipRefreshRetry: true,
  });
}

/**
 * 注册账号。
 */
export function register(data: RegisterPayload) {
  return apiRequest<MessageResponse>({
    url: "/auth/register",
    method: "POST",
    body: data,
    skipAuth: true,
    skipRefreshRetry: true,
  });
}

/**
 * 登录并返回双 token 与用户信息。
 */
export function login(data: LoginPayload) {
  return apiRequest<LoginResponse>({
    url: "/auth/login",
    method: "POST",
    body: data,
    skipAuth: true,
    skipRefreshRetry: true,
  });
}

/**
 * 主动刷新 accessToken。
 */
export function refreshToken(data: RefreshPayload) {
  return apiRequest<RefreshResponse>({
    url: "/auth/refresh",
    method: "POST",
    body: data,
    skipAuth: true,
    skipRefreshRetry: true,
  });
}

export function logout() {
  return apiRequest<MessageResponse>({
    url: "/auth/logout",
    method: "POST",
    skipRefreshRetry: true,
  });
}

export function changePassword(data: {
  old_password: string;
  new_password: string;
}) {
  return apiRequest<MessageResponse>({
    url: "/users/me/password",
    method: "POST",
    body: data,
  });
}

/**
 * 通过邮箱验证码重置密码。
 */
export function resetPassword(data: ResetPasswordPayload) {
  return apiRequest<MessageResponse>({
    url: "/users/reset-password",
    method: "POST",
    body: data,
    skipAuth: true,
    skipRefreshRetry: true,
  });
}

/**
 * 获取当前登录用户信息。
 */
export function getCurrentUser() {
  return apiRequest<UserProfile>({
    url: "/auth/me",
    method: "GET",
  });
}

/**
 * 更新当前用户个人资料。
 */
export function updateUserProfile(data: { full_name?: string }) {
  return apiRequest<UserProfile>({
    url: "/users/me",
    method: "PATCH",
    body: data,
  });
}

/**
 * 上传用户头像（multipart/form-data）。
 */
export function uploadAvatar(file: File) {
  const formData = new FormData();
  formData.append("file", file);
  return apiRequest<UserProfile>({
    url: "/users/me/avatar",
    method: "POST",
    body: formData,
  });
}
