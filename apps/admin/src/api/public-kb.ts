import { apiRequest } from "@/api/api";
import type { PageResult } from "@/types/api";

export interface PublicKb {
  id: string;
  name: string;
  description?: string;
  visibility: string;
  status: string;
  isPublic: boolean;
  allowPublicDownload: boolean;
  owner: {
    id: string;
    email: string;
    fullName?: string;
    avatarUrl?: string;
  };
  documentCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  name?: string;
  status?: string;
  isPublic?: boolean;
}

export async function listPublicKbs(
  params: ListParams = {}
): Promise<PageResult<PublicKb>> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.name) query.set("name", params.name);
  if (params.status) query.set("status", params.status);
  if (params.isPublic !== undefined)
    query.set("isPublic", String(params.isPublic));

  return apiRequest<PageResult<PublicKb>>(`/admin/public-kb?${query}`);
}

export async function getPublicKb(id: string): Promise<PublicKb> {
  return apiRequest<PublicKb>(`/admin/public-kb/${id}`);
}

export async function updatePublicKbStatus(
  id: string,
  status: "normal" | "blocked"
): Promise<void> {
  return apiRequest<void>(`/admin/public-kb/${id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}
