import { apiRequest } from "@/api/api";

export interface SystemModelItem {
  modelName: string;
  provider: string;
  isActive: boolean;
}

export interface UserModelItem {
  id: number;
  model_name: string;
  provider: string;
  base_url: string | null;
  is_active: boolean;
}

export interface CreateUserModelPayload {
  provider: string;
  modelName: string;
  baseUrl?: string;
  apiKey?: string;
}

export interface UpdateUserModelPayload {
  provider?: string;
  modelName?: string;
  baseUrl?: string;
  apiKey?: string;
  isActive?: boolean;
}

export interface TestConnectivityPayload {
  provider: string;
  modelName: string;
  baseUrl?: string;
  apiKey: string;
}

export interface TestConnectivityResult {
  latencyMs: number;
}

export interface SystemModelsResponse {
  systemModels: SystemModelItem[];
}

export interface UserModelsResponse {
  userModels: UserModelItem[];
}

/**
 * 获取系统预置模型列表。
 */
export function getSystemModels() {
  return apiRequest<SystemModelsResponse>({
    url: "/model-config/system",
    method: "GET",
  });
}

/**
 * 获取用户自定义模型列表。
 */
export function getUserModels() {
  return apiRequest<UserModelsResponse>({
    url: "/model-config/user",
    method: "GET",
  });
}

/**
 * 创建用户自定义模型。
 */
export function createUserModel(data: CreateUserModelPayload) {
  return apiRequest<UserModelItem>({
    url: "/model-config/user",
    method: "POST",
    body: data,
  });
}

/**
 * 更新用户自定义模型。
 */
export function updateUserModel(id: number, data: UpdateUserModelPayload) {
  return apiRequest<UserModelItem>({
    url: `/model-config/user/${id}`,
    method: "PATCH",
    body: data,
  });
}

/**
 * 删除用户自定义模型。
 */
export function deleteUserModel(id: number) {
  return apiRequest<void>({
    url: `/model-config/user/${id}`,
    method: "DELETE",
  });
}

/**
 * 测试模型连通性。
 */
export function testConnectivity(data: TestConnectivityPayload) {
  return apiRequest<TestConnectivityResult>({
    url: "/model-config/test",
    method: "POST",
    body: data,
  });
}
