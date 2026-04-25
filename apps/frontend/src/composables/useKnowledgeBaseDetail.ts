import { computed, reactive, ref } from "vue";
import {
  deleteKnowledgeBase,
  getKnowledgeBaseDetail,
  updateKnowledgeBase,
} from "@/api/knowledge-base";
import {
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
  };
}
