import { apiRequest } from "@/api/api";
import type { ApiResponse, PageResult } from "@/types/api";

export interface AdminUser {
  id: string;
  username: string;
  role: "super_admin" | "operator";
  isActive: boolean;
  createdAt: string;
}

export interface CreateAdminDto {
  username: string;
  password: string;
  role: "super_admin" | "operator";
}

export interface UpdateAdminDto {
  password?: string;
  role?: "super_admin" | "operator";
  isActive?: boolean;
}

export async function listAdmins(
  params: { page?: number; pageSize?: number } = {}
): Promise<PageResult<AdminUser>> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));

  const res = await apiRequest<ApiResponse<PageResult<AdminUser>>>(
    `/admin/admin?${query}`
  );
  return (res as any)?.data || { list: [], total: 0, page: 1, pageSize: 20 };
}

export async function getAdmin(id: string): Promise<AdminUser> {
  const res = await apiRequest<ApiResponse<AdminUser>>(`/admin/admin/${id}`);
  return (res as any)?.data;
}

export async function createAdmin(dto: CreateAdminDto): Promise<AdminUser> {
  const res = await apiRequest<AdminUser>("/admin/admin", {
    method: "POST",
    body: JSON.stringify(dto),
  });
  return res;
}

export async function updateAdmin(
  id: string,
  dto: UpdateAdminDto
): Promise<AdminUser> {
  const res = await apiRequest<AdminUser>(`/admin/admin/${id}`, {
    method: "PUT",
    body: JSON.stringify(dto),
  });
  return res;
}

export async function deleteAdmin(id: string): Promise<void> {
  return apiRequest<void>(`/admin/admin/${id}`, {
    method: "DELETE",
  });
}
