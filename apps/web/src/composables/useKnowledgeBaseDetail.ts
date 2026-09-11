import { computed, reactive, ref } from "vue";
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
} from "@/api/document";
import type {
  KnowledgeBaseDetail,
  KnowledgeBaseDocumentItem,
  KnowledgeBaseDocumentStatus,
  UpdateKnowledgeBasePayload,
} from "@/types/knowledge-base";

/** 知识库详情与首期文档管理数据。处理流水线未接入，因此不建立 SSE/轮询。 */
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
    return result;
  }

  async function reload(kbId: string) {
    await Promise.all([fetchKnowledgeBase(kbId), fetchDocuments(kbId)]);
  }

  async function updateSettings(kbId: string, payload: UpdateKnowledgeBasePayload) {
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

  async function updateDocument(kbId: string, documentId: string, title: string) {
    isMutating.value = true;
    try {
      const updated = await updateKnowledgeBaseDocument(kbId, documentId, { title });
      const index = documents.value.findIndex((item) => item.id === documentId);
      if (index >= 0) documents.value[index] = updated;
      return updated;
    } finally {
      isMutating.value = false;
    }
  }

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
