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
import { getAccessToken, setAccessToken } from "@/utils/token";
import { isTokenExpiredOrSoon } from "@/utils/jwt";

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
  // SSE 重连次数上限（防止无限重试）
  const MAX_SSE_RECONNECT = 2;
  let sseReconnectCount = 0;
  // 最后收到消息的时间（用于心跳检测）
  let lastMessageAt = 0;
  // 心跳超时阈值（毫秒），收到 ping 超此时间未更新则降级轮询
  const HEARTBEAT_TIMEOUT_MS = 45_000;

  // 轮询相关状态
  let pollingInterval: ReturnType<typeof setInterval> | null = null;
  const POLLING_INTERVAL_MS = 10_000;

  /**
   * 刷新 accessToken 并返回新 token。
   */
  async function refreshAccessToken(): Promise<string | null> {
    const refreshToken =
      typeof window !== "undefined"
        ? localStorage.getItem("rag_kb_refresh_token") ||
          sessionStorage.getItem("rag_kb_refresh_token") ||
          ""
        : "";

    if (!refreshToken) {
      return null;
    }

    try {
      const baseUrl =
        (import.meta.env.VITE_API_BASE_URL as string) || "http://localhost:3000";
      const url = `${baseUrl}/auth/refresh`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ refreshToken }),
      });

      const result = (await response.json()) as { success?: boolean; data?: { accessToken?: string } };

      if (response.ok && result?.success && result.data?.accessToken) {
        const newToken = result.data.accessToken;
        setAccessToken(newToken);
        return newToken;
      }
    } catch {
      // 网络错误
    }
    return null;
  }

  /**
   * 启动轮询降级：定期拉取文档列表并更新状态。
   */
  function startPolling(kbId: string) {
    stopPolling();
    pollingInterval = setInterval(async () => {
      try {
        const result = await listKnowledgeBaseDocuments(kbId, {
          page: 1,
          pageSize: documentPagination.pageSize,
        });
        documents.value = result.list;
      } catch {
        // 轮询期间静默失败，不影响用户体验
      }
    }, POLLING_INTERVAL_MS);
  }

  /**
   * 停止轮询降级。
   */
  function stopPolling() {
    if (pollingInterval !== null) {
      clearInterval(pollingInterval);
      pollingInterval = null;
    }
  }

  /**
   * 建立 SSE 连接，附带 token 预检 + 401 降级刷新 + 轮询兜底。
   */
  async function connectDocumentStream(kbId: string) {
    if (sseConnection && sseKbId === kbId) {
      return;
    }

    disconnectDocumentStream();
    stopPolling();

    const authStore = useAuthStore();
    if (!authStore.isAuthenticated) {
      return;
    }

    let token = getAccessToken();
    if (!token) {
      return;
    }

    // 预检：token 即将过期则先刷新
    if (isTokenExpiredOrSoon(token, 120)) {
      const refreshed = await refreshAccessToken();
      if (!refreshed) {
        // 刷新失败，降级轮询
        startPolling(kbId);
        return;
      }
      token = refreshed;
    }

    const baseUrl: string =
      (import.meta.env.VITE_API_BASE_URL as string) || "http://localhost:3000";
    const url = `${baseUrl}/knowledge-bases/${kbId}/documents-stream?token=${encodeURIComponent(token)}`;

    sseConnection = new EventSource(url);
    sseKbId = kbId;
    sseReconnectCount = 0;

    sseConnection.onmessage = (event) => {
      lastMessageAt = Date.now();
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
        if (payload.type === "connected" || payload.type === "ping") {
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

    sseConnection.onerror = async () => {
      // readyState 为 CLOSED 时说明连接已真正结束
      if (sseConnection?.readyState === EventSource.CLOSED) {
        // 保存当前 kbId，因为下面会置 null
        const currentKbId = sseKbId;
        const currentBaseUrl = baseUrl;

        // 彻底清理旧连接，防止重复请求
        sseConnection.close();
        sseConnection = null;
        sseKbId = null;

        // 心跳超时：超过 HEARTBEAT_TIMEOUT_MS 未收到任何消息，降级轮询
        if (lastMessageAt > 0 && Date.now() - lastMessageAt > HEARTBEAT_TIMEOUT_MS) {
          if (currentKbId) startPolling(currentKbId);
          return;
        }

        // 重连次数上限（最多 2 次）
        if (sseReconnectCount < MAX_SSE_RECONNECT) {
          sseReconnectCount++;
          const newToken = await refreshAccessToken();
          if (newToken && currentKbId) {
            const retryUrl = `${currentBaseUrl}/knowledge-bases/${currentKbId}/documents-stream?token=${encodeURIComponent(newToken)}`;
            // 创建新连接前已关闭旧连接，不会重复请求
            sseConnection = new EventSource(retryUrl);
            sseKbId = currentKbId;
            return;
          }
        }

        // 重连失败，降级为轮询
        if (currentKbId) startPolling(currentKbId);
      }
    };
  }

  /**
   * 断开 SSE 连接并停止轮询。
   */
  function disconnectDocumentStream() {
    if (sseConnection) {
      sseConnection.close();
      sseConnection = null;
      sseKbId = null;
    }
    stopPolling();
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
