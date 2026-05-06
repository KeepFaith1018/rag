import { apiRequest, setTokens } from "./api";
import type { LoginPayload, LoginResponse, RefreshResponse } from "@/types/auth";
import type { ApiResponse } from "@/types/api";

export async function login(payload: LoginPayload): Promise<LoginResponse> {
  const data = await apiRequest<LoginResponse>("/admin/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
    skipAuth: true,
  });
  setTokens(data.accessToken, data.refreshToken);
  return data;
}

export async function refreshToken(
  refreshToken: string
): Promise<RefreshResponse> {
  return apiRequest<RefreshResponse>("/admin/auth/refresh", {
    method: "POST",
    body: JSON.stringify({ refreshToken }),
    skipAuth: true,
  });
}

export async function logout(): Promise<void> {
  await apiRequest("/admin/auth/logout", { method: "POST" });
}

export async function getCurrentAdmin(): Promise<{
  id: string;
  username: string;
  role: string;
  isActive: boolean;
}> {
  const res = await apiRequest<
    ApiResponse<{ id: string; username: string; role: string; isActive: boolean }>
  >("/admin/auth/me");
  return res!;
}
