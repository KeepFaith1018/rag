import { computed, onScopeDispose, reactive, ref } from "vue";
import {
  deleteKnowledgeBase,
  getKnowledgeBaseDetail,
  updateKnowledgeBase,
} from "@/api/knowledge-base";
import {
  deleteKnowledgeBaseDocument,
  downloadKnowledgeBaseDocument,
  listKnowledgeBaseDocuments,
  updateKnowledgeBaseDocument,
  consumeDocumentProcessingEvents,
} from "@/api/document";
import type {
  KnowledgeBaseDetail,
  KnowledgeBaseDocumentItem,
  KnowledgeBaseDocumentStatus,
  UpdateKnowledgeBasePayload,
} from "@/types/knowledge-base";

/** 知识库详情与文档处理状态协调：REST 为权威，SSE 负责唤醒，轮询负责兜底。 */
export function useKnowledgeBaseDetail() {
  const isLoading = ref(false);
  const isMutating = ref(false);
  const kb = ref<KnowledgeBaseDetail | null>(null);
  const documents = ref<KnowledgeBaseDocumentItem[]>([]);
  const documentPagination = reactive({ page: 1, pageSize: 20, total: 0 });
  const documentQuery = reactive<{
    keyword: string;
    status: KnowledgeBaseDocumentStatus | "all";
  }>({ keyword: "", status: "all" });

  const hasKnowledgeBase = computed(() => Boolean(kb.value));
  let monitoredKbId = "";
  let streamController: AbortController | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  let reconnectAttempt = 0;

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
    reconcileMonitoring(kbId);
    return result;
  }

  async function reload(kbId: string) {
    if (monitoredKbId && monitoredKbId !== kbId) stopMonitoring();
    monitoredKbId = kbId;
    await Promise.all([fetchKnowledgeBase(kbId), fetchDocuments(kbId)]);
    reconcileMonitoring(kbId);
  }

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

  async function removeKnowledgeBaseItem(kbId: string) {
    isMutating.value = true;
    try {
      return await deleteKnowledgeBase(kbId);
    } finally {
      isMutating.value = false;
    }
  }

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

  async function downloadDocument(kbId: string, documentId: string) {
    isMutating.value = true;
    try {
      return await downloadKnowledgeBaseDocument(kbId, documentId);
    } finally {
      isMutating.value = false;
    }
  }

  async function updateDocument(
    kbId: string,
    documentId: string,
    title: string,
  ) {
    isMutating.value = true;
    try {
      const updated = await updateKnowledgeBaseDocument(kbId, documentId, {
        title,
      });
      const index = documents.value.findIndex((item) => item.id === documentId);
      if (index >= 0) documents.value[index] = updated;
      return updated;
    } finally {
      isMutating.value = false;
    }
  }

  function hasActiveProcessing() {
    return documents.value.some(
      (item) => item.status === "processing" || item.status === "deleting",
    );
  }

  function reconcileMonitoring(kbId: string) {
    if (kbId !== monitoredKbId || !hasActiveProcessing()) {
      stopTransportOnly();
      return;
    }
    if (!pollTimer) {
      pollTimer = setInterval(() => {
        if (monitoredKbId && hasActiveProcessing())
          void fetchDocuments(monitoredKbId).catch(() => undefined);
      }, 5000);
    }
    if (!streamController && !reconnectTimer) connectStream(kbId);
  }

  function connectStream(kbId: string) {
    if (kbId !== monitoredKbId || !hasActiveProcessing()) return;
    const controller = new AbortController();
    streamController = controller;
    void consumeDocumentProcessingEvents(kbId, controller.signal, {
      connected: () => {
        reconnectAttempt = 0;
        scheduleAuthoritativeRefresh(kbId, 0);
      },
      changed: () => scheduleAuthoritativeRefresh(kbId, 100),
    })
      .catch(() => undefined)
      .finally(() => {
        if (streamController === controller) streamController = null;
        if (
          controller.signal.aborted ||
          kbId !== monitoredKbId ||
          !hasActiveProcessing()
        )
          return;
        const delays = [1000, 2000, 5000, 10000];
        const delay = delays[Math.min(reconnectAttempt++, delays.length - 1)];
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          connectStream(kbId);
        }, delay);
      });
  }

  function scheduleAuthoritativeRefresh(kbId: string, delay: number) {
    if (refreshTimer) return;
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (kbId === monitoredKbId)
        void fetchDocuments(kbId).catch(() => undefined);
    }, delay);
  }

  function stopTransportOnly() {
    streamController?.abort();
    streamController = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    reconnectTimer = null;
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
    reconnectAttempt = 0;
  }

  function stopMonitoring() {
    stopTransportOnly();
    if (refreshTimer) clearTimeout(refreshTimer);
    refreshTimer = null;
    monitoredKbId = "";
  }

  onScopeDispose(stopMonitoring);

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
    downloadDocument,
    updateDocument,
  };
}
