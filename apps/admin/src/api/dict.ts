import { apiRequest } from "@/api/api";
import type { ApiResponse } from "@/types/api";

export interface DictType {
  id: string;
  code: string;
  name: string;
  remark?: string;
  itemCount: number;
  createdAt: string;
}

export interface DictTypeDetail extends DictType {
  items: DictItem[];
}

export interface DictItem {
  id: string;
  value: string;
  label: string;
  sort: number;
  status: boolean;
  createdAt: string;
}

export async function listDictTypes(): Promise<DictType[]> {
  const res = await apiRequest<ApiResponse<DictType[]>>(`/admin/dict/type`);
  return (res as any)?.data || [];
}

export async function getDictType(
  code: string
): Promise<DictTypeDetail> {
  const res = await apiRequest<ApiResponse<DictTypeDetail>>(
    `/admin/dict/type/${code}`
  );
  return (res as any)?.data;
}

export async function createDictType(data: {
  code: string;
  name: string;
  remark?: string;
}): Promise<DictType> {
  const res = await apiRequest<ApiResponse<DictType>>(`/admin/dict/type`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return (res as any)?.data;
}

export async function updateDictType(
  code: string,
  data: { name?: string; remark?: string }
): Promise<DictType> {
  const res = await apiRequest<ApiResponse<DictType>>(
    `/admin/dict/type/${code}`,
    {
      method: "PUT",
      body: JSON.stringify(data),
    }
  );
  return (res as any)?.data;
}

export async function deleteDictType(code: string): Promise<void> {
  return apiRequest<void>(`/admin/dict/type/${code}`, { method: "DELETE" });
}

export async function createDictItem(data: {
  typeCode: string;
  value: string;
  label: string;
  sort?: number;
  status?: boolean;
}): Promise<DictItem> {
  const res = await apiRequest<ApiResponse<DictItem>>(`/admin/dict/item`, {
    method: "POST",
    body: JSON.stringify(data),
  });
  return (res as any)?.data;
}

export async function updateDictItem(
  id: string,
  data: { label?: string; sort?: number; status?: boolean }
): Promise<DictItem> {
  const res = await apiRequest<ApiResponse<DictItem>>(`/admin/dict/item/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
  return (res as any)?.data;
}

export async function deleteDictItem(id: string): Promise<void> {
  return apiRequest<void>(`/admin/dict/item/${id}`, { method: "DELETE" });
}
