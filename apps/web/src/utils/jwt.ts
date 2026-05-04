/**
 * JWT 解码工具函数（不验证签名，仅解析 payload）。
 * 用于前端判断 token 是否即将过期，以便提前刷新。
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const payload = parts[1];
    // Base64url 解码
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4);
    const decoded = atob(padded.replace(/-/g, '+').replace(/_/g, '/'));
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * 从 JWT payload 中提取过期时间（exp，Unix 秒）。
 * 如果无法解析或无 exp 字段，返回 null。
 */
export function getJwtExpiresAt(token: string): number | null {
  const payload = decodeJwtPayload(token);
  if (!payload || typeof payload.exp !== 'number') {
    return null;
  }
  return payload.exp;
}

/**
 * 判断 token 是否已过期或距离过期不足 expireSoonThreshold 秒。
 * expireSoonThreshold 默认 60 秒。
 */
export function isTokenExpiredOrSoon(
  token: string,
  expireSoonThreshold = 60,
): boolean {
  const exp = getJwtExpiresAt(token);
  if (exp === null) {
    return false; // 无法判断，保守不触发
  }
  const now = Math.floor(Date.now() / 1000);
  return exp - now < expireSoonThreshold;
}