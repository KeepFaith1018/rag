/** 认证守卫解析出的当前请求身份；sessionId 用于精确撤销当前登录会话。 */
export interface Principal {
  userId: string;
  sessionId: string;
  /** 当前 access token 的绝对到期时间（Unix 毫秒）。 */
  expiresAt: number;
}
