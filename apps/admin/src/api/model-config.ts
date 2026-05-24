import { apiRequest } from "@/api/api";
import type { PageResult } from "@/types/api";

export interface ModelConfig {
  id: string;
  provider: string;
  name: string;
  type: "chat" | "embedding";
  baseUrl?: string;
  isDefault: boolean;
  isActive: boolean;
  createdAt: string;
}

export interface CreateModelConfigDto {
  provider: string;
  name: string;
  type: "chat" | "embedding";
  baseUrl?: string;
  apiKey?: string;
  configJson?: Record<string, unknown>;
  isDefault?: boolean;
  isActive?: boolean;
}

export interface UpdateModelConfigDto extends Partial<CreateModelConfigDto> {}

export interface ListParams {
  page?: number;
  pageSize?: number;
  provider?: string;
  type?: string;
  isActive?: boolean;
}

export async function listModelConfigs(
  params: ListParams = {}
): Promise<PageResult<ModelConfig>> {
  const query = new URLSearchParams();
  if (params.page) query.set("page", String(params.page));
  if (params.pageSize) query.set("pageSize", String(params.pageSize));
  if (params.provider) query.set("provider", params.provider);
  if (params.type) query.set("type", params.type);
  if (params.isActive !== undefined)
    query.set("isActive", String(params.isActive));

  return apiRequest<PageResult<ModelConfig>>(`/admin/model-config?${query}`);
}

export async function getModelConfig(id: string): Promise<ModelConfig> {
  return apiRequest<ModelConfig>(`/admin/model-config/${id}`);
}

export async function createModelConfig(
  dto: CreateModelConfigDto
): Promise<ModelConfig> {
  const res = await apiRequest<ModelConfig>("/admin/model-config", {
    method: "POST",
    body: JSON.stringify(dto),
  });
  return res;
}

export async function updateModelConfig(
  id: string,
  dto: UpdateModelConfigDto
): Promise<ModelConfig> {
  const res = await apiRequest<ModelConfig>(`/admin/model-config/${id}`, {
    method: "PUT",
    body: JSON.stringify(dto),
  });
  return res;
}

export async function toggleModelConfig(id: string): Promise<ModelConfig> {
  const res = await apiRequest<ModelConfig>(
    `/admin/model-config/${id}/toggle`,
    { method: "PATCH" }
  );
  return res;
}

export async function deleteModelConfig(id: string): Promise<void> {
  return apiRequest<void>(`/admin/model-config/${id}`, { method: "DELETE" });
}
