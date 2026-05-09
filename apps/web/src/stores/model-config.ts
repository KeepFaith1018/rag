import { defineStore } from "pinia";
import { ref } from "vue";
import {
  getSystemModels,
  getUserModels,
  createUserModel as createUserModelApi,
  updateUserModel as updateUserModelApi,
  deleteUserModel as deleteUserModelApi,
  testConnectivity as testConnectivityApi,
  type SystemModelItem,
  type UserModelItem,
  type CreateUserModelPayload,
  type UpdateUserModelPayload,
  type TestConnectivityPayload,
  type TestConnectivityResult,
} from "@/api/model-config";

export type UserModelConfig = UserModelItem;

export const useModelConfigStore = defineStore("model-config", () => {
  const systemModels = ref<SystemModelItem[]>([]);
  const userModels = ref<UserModelConfig[]>([]);
  const loading = ref(false);

  /**
   * 获取系统预置模型列表。
   */
  async function fetchSystemModels() {
    try {
      const res = await getSystemModels();
      systemModels.value = res.systemModels ?? [];
    } catch {
      systemModels.value = [];
    }
  }

  /**
   * 获取用户自定义模型列表。
   */
  async function fetchUserModels() {
    loading.value = true;
    try {
      const res = await getUserModels();
      userModels.value = res.userModels ?? [];
    } catch {
      userModels.value = [];
    } finally {
      loading.value = false;
    }
  }

  /**
   * 创建用户自定义模型。
   */
  async function createUserModel(data: CreateUserModelPayload) {
    const res = await createUserModelApi(data);
    userModels.value.push(res);
    return res;
  }

  /**
   * 更新用户自定义模型。
   */
  async function updateUserModel(id: number, data: UpdateUserModelPayload) {
    const res = await updateUserModelApi(id, data);
    const index = userModels.value.findIndex((m) => m.id === id);
    if (index !== -1) {
      userModels.value[index] = res;
    }
    return res;
  }

  /**
   * 删除用户自定义模型。
   */
  async function deleteUserModel(id: number) {
    await deleteUserModelApi(id);
    userModels.value = userModels.value.filter((m) => m.id !== id);
  }

  /**
   * 测试模型连通性。
   */
  async function testConnectivity(
    data: TestConnectivityPayload,
  ): Promise<TestConnectivityResult> {
    return testConnectivityApi(data);
  }

  return {
    systemModels,
    userModels,
    loading,
    fetchSystemModels,
    fetchUserModels,
    createUserModel,
    updateUserModel,
    deleteUserModel,
    testConnectivity,
  };
});
