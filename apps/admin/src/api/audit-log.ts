import { apiRequest } from "@/api/api";
import type { ApiResponse, PageResult } from "@/types/api";

export interface AuditLog {
  id: string;
  action: string;
  module: string;
  ipAddress?: string;
  details?: Record<string, unknown>;
  admin?: {
    id: string;
    username: string;
  };
  createdAt: string;
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  action?: string;
  module?: string;
  adminUsername?: string;
}

export async function listAuditLogs(
  params: ListParams = {}
): Promise<PageResult<AuditLog>> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.action) query.set("action", params.action);
  if (params.module) query.set("module", params.module);
  if (params.adminUsername) query.set("adminUsername", params.adminUsername);

  const res = await apiRequest<ApiResponse<PageResult<AuditLog>>>(
    `/admin/audit-log?${query}`
  );
  return (res as any)?.data || { list: [], total: 0, page: 1, pageSize: 20 };
}

export async function getAuditLog(id: string): Promise<AuditLog> {
  const res = await apiRequest<ApiResponse<AuditLog>>(`/admin/audit-log/${id}`);
  return (res as any)?.data;
}
