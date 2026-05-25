/**
 * 聊天配置 Store
 *
 * 管理对话模式、模型选择、知识库选择、联网搜索等 UI 配置状态。
 */
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { ChatMode } from '@/modules/chat/types/chat';

export interface AvailableKb {
  kbId: string;
  kbName: string;
  permission: 'owner' | 'manager' | 'collaborator' | 'member' | 'publicVisitor';
  visibility?: string;
  isPublic?: boolean;
}

export interface AvailableModel {
  configId: string;
  modelName: string;
  provider: string;
  source: 'system' | 'user';
}

export const useChatConfigStore = defineStore('chat-config', () => {
  // ── 模式 ──
  const chatMode = ref<ChatMode>('rag');
  const enableWebSearch = ref(false);

  // ── 知识库 ──
  const availableKbs = ref<AvailableKb[]>([]);
  const selectedKbIds = ref<string[]>([]);

  // ── 模型 ──
  const availableModels = ref<AvailableModel[]>([]);
  const selectedModel = ref<AvailableModel | null>(null);

  // ── 计算 ──
  const selectedKbCount = computed(() => selectedKbIds.value.length);
  const isKbSelected = computed(() => selectedKbIds.value.length > 0);

  const lastUserMessage = ref('');

  // ── 动作 ──

  function setChatMode(mode: ChatMode) {
    chatMode.value = mode;
  }

  function toggleWebSearch() {
    enableWebSearch.value = !enableWebSearch.value;
  }

  function setAvailableKbs(kbs: AvailableKb[]) {
    availableKbs.value = kbs;
  }

  function toggleKb(kbId: string) {
    const idx = selectedKbIds.value.indexOf(kbId);
    if (idx >= 0) {
      selectedKbIds.value.splice(idx, 1);
    } else {
      selectedKbIds.value.push(kbId);
    }
  }

  function setSelectedKbIds(ids: string[]) {
    selectedKbIds.value = ids;
  }

  function setAvailableModels(models: AvailableModel[]) {
    availableModels.value = models;
    if (models.length > 0 && !selectedModel.value) {
      // 优先选择系统模型，回退到列表第一个
      selectedModel.value = models.find((m) => m.source === 'system') ?? models[0]!;
    }
  }

  function setSelectedModel(model: AvailableModel | null) {
    selectedModel.value = model;
  }

  function setLastUserMessage(message: string) {
    lastUserMessage.value = message;
  }

  return {
    // state
    chatMode,
    enableWebSearch,
    availableKbs,
    selectedKbIds,
    availableModels,
    selectedModel,
    lastUserMessage,
    // computed
    selectedKbCount,
    isKbSelected,
    // actions
    setChatMode,
    toggleWebSearch,
    setAvailableKbs,
    toggleKb,
    setSelectedKbIds,
    setAvailableModels,
    setSelectedModel,
    setLastUserMessage,
  };
});
