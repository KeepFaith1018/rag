/**
 * 验证码用途，与后端枚举保持一致。
 */
export const VerificationPurpose = {
  REGISTER: 1,
  RESET_PASSWORD: 2,
  LOGIN: 3,
} as const;

export type VerificationPurpose =
  (typeof VerificationPurpose)[keyof typeof VerificationPurpose];

/**
 * 用户资料结构。
 */
export interface UserProfile {
  id: string;
  email: string;
  username: string;
  avatar: string | null;
  roles: string[];
}

/**
 * 登录请求参数。
 */
export interface LoginPayload {
  email: string;
  password: string;
}

/**
 * 发送验证码请求参数。
 */
export interface SendVerificationCodePayload {
  email: string;
  purpose: VerificationPurpose;
}

/**
 * 注册请求参数。
 */
export interface RegisterPayload {
  email: string;
  password: string;
  code: string;
  username: string;
}

/**
 * 刷新令牌请求参数。
 */
export interface RefreshPayload {
  refreshToken: string;
}

/**
 * 重置密码请求参数。
 */
export interface ResetPasswordPayload {
  email: string;
  code: string;
  new_password: string;
}

/**
 * 通用消息响应。
 */
export interface MessageResponse {
  message: string;
}

/**
 * 登录响应数据。
 */
export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  user: UserProfile;
}

/**
 * 刷新令牌响应数据。
 */
export interface RefreshResponse {
  accessToken: string;
}
