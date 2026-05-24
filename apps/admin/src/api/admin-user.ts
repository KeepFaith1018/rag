import { apiRequest } from "@/api/api";
import type { PageResult } from "@/types/api";

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

  return apiRequest<PageResult<AdminUser>>(`/admin/admin?${query}`);
}

export async function getAdmin(id: string): Promise<AdminUser> {
  return apiRequest<AdminUser>(`/admin/admin/${id}`);
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
