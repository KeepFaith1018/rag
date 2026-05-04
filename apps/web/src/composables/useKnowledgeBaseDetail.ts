import { computed, reactive, ref, onUnmounted } from "vue";
import {
  deleteKnowledgeBase,
  getKnowledgeBaseDetail,
  updateKnowledgeBase,
} from "@/api/knowledge-base";
import {
  downloadKnowledgeBaseDocument,
  deleteKnowledgeBaseDocument,
  listKnowledgeBaseDocuments,
  reparseKnowledgeBaseDocument,
} from "@/api/document";
import type {
  KnowledgeBaseDetail,
  KnowledgeBaseDocumentItem,
  KnowledgeBaseDocumentStatus,
  UpdateKnowledgeBasePayload,
} from "@/types/knowledge-base";
import { useAuthStore } from "@/stores/auth";
import { getAccessToken } from "@/utils/token";

interface SseMessagePayload {
  type: string;
  kbId?: string;
  documentId?: string;
  status?: string;
  currentStage?: string;
  processingVersion?: number;
}

/**
 * 知识库详情页业务封装。
 */
export function useKnowledgeBaseDetail() {
  const isLoading = ref(false);
  const isMutating = ref(false);
  const kb = ref<KnowledgeBaseDetail | null>(null);
  const documents = ref<KnowledgeBaseDocumentItem[]>([]);
  const documentPagination = reactive({
    page: 1,
    pageSize: 20,
    total: 0,
  });
  const documentQuery = reactive<{
    keyword: string;
    status: KnowledgeBaseDocumentStatus | "all";
  }>({
    keyword: "",
    status: "all",
  });

  /**
   * 页面是否已有知识库详情。
   */
  const hasKnowledgeBase = computed(() => Boolean(kb.value));

  /**
   * 拉取知识库详情。
   */
  async function fetchKnowledgeBase(kbId: string) {
    isLoading.value = true;

    try {
      const detail = await getKnowledgeBaseDetail(kbId);
      kb.value = detail;
      return detail;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 拉取文档列表。
   */
  async function fetchDocuments(kbId: string) {
    const result = await listKnowledgeBaseDocuments(kbId, {
      keyword: documentQuery.keyword || undefined,
      status: documentQuery.status === "all" ? undefined : documentQuery.status,
      page: documentPagination.page,
      pageSize: documentPagination.pageSize,
    });

    documents.value = result.list;
    documentPagination.page = result.pagination.page;
    documentPagination.pageSize = result.pagination.pageSize;
    documentPagination.total = result.pagination.total;

    return result;
  }

  /**
   * 同时刷新详情与文档区。
   */
  async function reload(kbId: string) {
    await Promise.all([fetchKnowledgeBase(kbId), fetchDocuments(kbId)]);
  }

  /**
   * 更新知识库设置。
   */
  async function updateSettings(
    kbId: string,
    payload: UpdateKnowledgeBasePayload,
  ) {
    isMutating.value = true;

    try {
      const updated = await updateKnowledgeBase(kbId, payload);
      kb.value = updated;
      return updated;
    } finally {
      isMutating.value = false;
    }
  }

  /**
   * 删除当前知识库。
   */
  async function removeKnowledgeBaseItem(kbId: string) {
    isMutating.value = true;

    try {
      return await deleteKnowledgeBase(kbId);
    } finally {
      isMutating.value = false;
    }
  }

  /**
   * 删除文档后刷新列表。
   */
  async function removeDocument(kbId: string, documentId: string) {
    isMutating.value = true;

    try {
      const result = await deleteKnowledgeBaseDocument(kbId, documentId);
      await fetchDocuments(kbId);
      return result;
    } finally {
      isMutating.value = false;
    }
  }

  /**
   * 触发文档重解析后刷新列表。
   */
  async function reparseDocument(kbId: string, documentId: string) {
    isMutating.value = true;

    try {
      const result = await reparseKnowledgeBaseDocument(kbId, documentId);
      await fetchDocuments(kbId);
      return result;
    } finally {
      isMutating.value = false;
    }
  }

  /**
   * 下载知识库文档原文件。
   */
  async function downloadDocument(kbId: string, documentId: string) {
    isMutating.value = true;

    try {
      return await downloadKnowledgeBaseDocument(kbId, documentId);
    } finally {
      isMutating.value = false;
    }
  }

  // SSE 连接管理
  let sseConnection: EventSource | null = null;
  let sseKbId: string | null = null;

  /**
   * 连接 SSE 以接收实时文档状态变更。
   */
  function connectDocumentStream(kbId: string) {
    if (sseConnection && sseKbId === kbId) {
      return;
    }

    disconnectDocumentStream();

    const authStore = useAuthStore();
    if (!authStore.isAuthenticated) {
      return;
    }

    const token = getAccessToken();
    if (!token) {
      return;
    }

    const baseUrl: string =
      (import.meta.env.VITE_API_BASE_URL as string) || "http://localhost:3000";
    const url = `${baseUrl}/api/knowledge-bases/${kbId}/documents/stream?token=${encodeURIComponent(token)}`;

    sseConnection = new EventSource(url);
    sseKbId = kbId;

    sseConnection.onmessage = (event) => {
      try {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const raw: Record<string, unknown> = JSON.parse(event.data as string);
        const payload: SseMessagePayload = {
          type: typeof raw.type === "string" ? raw.type : "",
          documentId:
            typeof raw.documentId === "string" ? raw.documentId : undefined,
          status: typeof raw.status === "string" ? raw.status : undefined,
          currentStage:
            typeof raw.currentStage === "string"
              ? raw.currentStage
              : undefined,
          processingVersion:
            typeof raw.processingVersion === "number"
              ? raw.processingVersion
              : undefined,
        };
        if (payload.type === "connected") {
          return;
        }
        if (
          payload.type === "document.state.changed" &&
          payload.documentId &&
          payload.status &&
          payload.currentStage
        ) {
          applyDocumentStateUpdate({
            documentId: payload.documentId,
            status: payload.status,
            currentStage: payload.currentStage,
            processingVersion: payload.processingVersion ?? 0,
          });
        }
      } catch {
        // 忽略解析失败的 SSE 事件
      }
    };

    sseConnection.onerror = () => {
      if (sseConnection?.readyState === EventSource.CLOSED) {
        sseConnection = null;
        sseKbId = null;
      }
    };
  }

  /**
   * 断开 SSE 连接。
   */
  function disconnectDocumentStream() {
    if (sseConnection) {
      sseConnection.close();
      sseConnection = null;
      sseKbId = null;
    }
  }

  /**
   * 将 SSE 推送的状态变更原地应用到文档列表。
   */
  function applyDocumentStateUpdate(payload: {
    documentId: string;
    status: string;
    currentStage: string;
    processingVersion: number;
  }) {
    const index = documents.value.findIndex(
      (doc) => doc.id === payload.documentId,
    );
    if (index === -1) {
      return;
    }

    const updated = { ...documents.value[index] };
    updated.status = payload.status;
    updated.currentStage =
      payload.currentStage as KnowledgeBaseDocumentItem["currentStage"];
    updated.processingVersion = payload.processingVersion;
    updated.updatedAt = new Date().toISOString();

    documents.value = [
      ...documents.value.slice(0, index),
      updated,
      ...documents.value.slice(index + 1),
    ];
  }

  onUnmounted(() => {
    disconnectDocumentStream();
  });

  return {
    kb,
    hasKnowledgeBase,
    isLoading,
    isMutating,
    documents,
    documentQuery,
    documentPagination,
    fetchKnowledgeBase,
    fetchDocuments,
    reload,
    updateSettings,
    removeKnowledgeBaseItem,
    removeDocument,
    reparseDocument,
    downloadDocument,
    connectDocumentStream,
    disconnectDocumentStream,
  };
}
