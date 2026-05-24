import { apiRequest } from "@/api/api";

export interface PublicKbDocument {
  id: string;
  title: string;
  originalFilename?: string;
  fileType?: string;
  mimeType?: string;
  status: string;
  currentStage: string;
  tokenCount?: number;
  uploaderId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ListParams {
  page?: number;
  pageSize?: number;
  title?: string;
  status?: string;
}

export async function listPublicKbDocuments(
  kbId: string,
  params: ListParams = {}
): Promise<{
  kbInfo: { id: string; name: string; visibility: string; isPublic: boolean };
  list: PublicKbDocument[];
  total: number;
  page: number;
  pageSize: number;
}> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.title) query.set("title", params.title);
  if (params.status) query.set("status", params.status);

  return apiRequest(`/admin/public-kb/${kbId}/documents?${query}`);
}
