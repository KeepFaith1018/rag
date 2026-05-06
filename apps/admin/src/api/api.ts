import type { ApiResponse } from "@/types/api";

export const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ||
  "/api";

function getAccessToken(): string | null {
  return sessionStorage.getItem("admin_access_token");
}

function getRefreshToken(): string | null {
  return localStorage.getItem("admin_refresh_token");
}

function setTokens(accessToken: string, refreshToken: string) {
  sessionStorage.setItem("admin_access_token", accessToken);
  localStorage.setItem("admin_refresh_token", refreshToken);
}

function clearTokens() {
  sessionStorage.removeItem("admin_access_token");
  localStorage.removeItem("admin_refresh_token");
}

export { getAccessToken, getRefreshToken, setTokens, clearTokens };

export class ApiError extends Error {
  constructor(
    public code: number,
    message: string,
    public response?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiRequest<T>(
  url: string,
  options: RequestInit & { skipAuth?: boolean } = {}
): Promise<T> {
  const { skipAuth, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers as Record<string, string> || {}),
  };

  if (!skipAuth) {
    const token = getAccessToken();
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_BASE_URL}${url}`, {
    ...fetchOptions,
    headers,
  });

  if (response.status === 401) {
    // 尝试刷新 token
    const refreshToken = getRefreshToken();
    if (refreshToken && !options.skipAuth) {
      try {
        const refreshRes = await fetch(`${API_BASE_URL}/admin/auth/refresh`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ refreshToken }),
        });
        const refreshData = (await refreshRes.json()) as ApiResponse<{ accessToken: string }>;
        if (refreshData.success && refreshData.data) {
          const newToken = refreshData.data.accessToken;
          sessionStorage.setItem("admin_access_token", newToken);
          // 重试原请求
          headers["Authorization"] = `Bearer ${newToken}`;
          const retryRes = await fetch(`${API_BASE_URL}${url}`, {
            ...fetchOptions,
            headers,
          });
          const result = (await retryRes.json()) as ApiResponse<T>;
          if (!result.success) {
            throw new ApiError(result.code, result.message, result);
          }
          return result.data as T;
        }
      } catch {
        // 刷新失败，清除 token
      }
    }
    clearTokens();
    window.location.href = "/admin/login";
    throw new ApiError(401, "未登录或登录已过期");
  }

  const result = (await response.json()) as ApiResponse<T>;

  if (!result.success) {
    throw new ApiError(result.code, result.message, result);
  }

  return result.data as T;
}

export { apiRequest };
