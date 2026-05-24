import { apiRequest } from "@/api/api";
import type { PageResult } from "@/types/api";

export interface User {
  id: string;
  email: string;
  fullName?: string;
  avatarUrl?: string;
  isActive: boolean;
  createdAt: string;
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  email?: string;
  isActive?: boolean;
}

export async function listUsers(
  params: ListParams = {}
): Promise<PageResult<User>> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.email) query.set("email", params.email);
  if (params.isActive !== undefined)
    query.set("isActive", String(params.isActive));

  return apiRequest<PageResult<User>>(`/admin/user?${query}`);
}

export async function getUser(id: string): Promise<User> {
  return apiRequest<User>(`/admin/user/${id}`);
}

export async function disableUser(id: string): Promise<void> {
  return apiRequest<void>(`/admin/user/${id}/disable`, { method: "PATCH" });
}

export async function enableUser(id: string): Promise<void> {
  return apiRequest<void>(`/admin/user/${id}/enable`, { method: "PATCH" });
}
