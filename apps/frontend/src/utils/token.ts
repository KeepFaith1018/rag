const ACCESS_TOKEN_KEY = "rag_kb_access_token";
const REFRESH_TOKEN_KEY = "rag_kb_refresh_token";

let accessTokenMemory = "";

/**
 * 判断当前是否可访问浏览器存储。
 */
function canUseStorage() {
  return typeof window !== "undefined";
}

/**
 * 获取当前 accessToken。
 */
export function getAccessToken(): string {
  if (!canUseStorage()) {
    return accessTokenMemory;
  }

  return accessTokenMemory || sessionStorage.getItem(ACCESS_TOKEN_KEY) || "";
}

/**
 * 设置 accessToken，同时写入内存与 sessionStorage。
 */
export function setAccessToken(token: string) {
  accessTokenMemory = token;

  if (!canUseStorage()) {
    return;
  }

  sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
}

/**
 * 获取 refreshToken。
 */
export function getRefreshToken(): string {
  if (!canUseStorage()) {
    return "";
  }

  return (
    localStorage.getItem(REFRESH_TOKEN_KEY) ||
    sessionStorage.getItem(REFRESH_TOKEN_KEY) ||
    ""
  );
}

/**
 * 设置 refreshToken。
 */
export function setRefreshToken(token: string, rememberMe = true) {
  if (!canUseStorage()) {
    return;
  }

  // refreshToken 仅保留一份，避免 localStorage / sessionStorage 冲突。
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);

  if (rememberMe) {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
    return;
  }

  sessionStorage.setItem(REFRESH_TOKEN_KEY, token);
}

/**
 * 批量写入双 token。
 */
export function setTokens(
  accessToken: string,
  refreshToken: string,
  rememberMe = true,
) {
  setAccessToken(accessToken);
  setRefreshToken(refreshToken, rememberMe);
}

/**
 * 清空当前登录态 token。
 */
export function clearTokens() {
  accessTokenMemory = "";

  if (!canUseStorage()) {
    return;
  }

  sessionStorage.removeItem(ACCESS_TOKEN_KEY);
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  sessionStorage.removeItem(REFRESH_TOKEN_KEY);
}
