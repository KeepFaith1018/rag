import { computed, reactive, ref } from "vue";
import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  listMyKnowledgeBases,
  listPublicKnowledgeBases,
  updateKnowledgeBase,
} from "@/api/knowledge-base";
import {
  joinKnowledgeBaseByInvite,
} from "@/api/kb-member";
import type {
  CreateKnowledgeBasePayload,
  KnowledgeBaseListItem,
  KnowledgeBaseOwnership,
  KnowledgeBaseVisibility,
  PublicKnowledgeBaseSortBy,
  UpdateKnowledgeBasePayload,
} from "@/types/knowledge-base";

type ListScope = "mine" | "public";

/**
 * 知识库列表页业务状态与操作封装。
 */
export function useKnowledgeBaseList() {
  const isLoading = ref(false);
  const isSubmitting = ref(false);
  const scope = ref<ListScope>("mine");
  const items = ref<KnowledgeBaseListItem[]>([]);
  const query = reactive<{
    keyword: string;
    ownership: KnowledgeBaseOwnership;
    visibility: KnowledgeBaseVisibility | "all";
    sortBy: PublicKnowledgeBaseSortBy;
    page: number;
    pageSize: number;
  }>({
    keyword: "",
    ownership: "all",
    visibility: "all",
    sortBy: "latest",
    page: 1,
    pageSize: 12,
  });
  const pagination = reactive({
    page: 1,
    pageSize: 12,
    total: 0,
  });

  /**
   * 当前是否处于公开知识库视图。
   */
  const isPublicScope = computed(() => scope.value === "public");

  /**
   * 拉取知识库列表。
   */
  async function fetchList() {
    isLoading.value = true;

    try {
      const result = isPublicScope.value
        ? await listPublicKnowledgeBases({
            keyword: query.keyword || undefined,
            page: query.page,
            pageSize: query.pageSize,
            sortBy: query.sortBy,
          })
        : await listMyKnowledgeBases({
            keyword: query.keyword || undefined,
            ownership: query.ownership,
            visibility:
              query.visibility === "all" ? undefined : query.visibility,
            page: query.page,
            pageSize: query.pageSize,
          });

      items.value = result.list;
      pagination.page = result.pagination.page;
      pagination.pageSize = result.pagination.pageSize;
      pagination.total = result.pagination.total;

      return result;
    } finally {
      isLoading.value = false;
    }
  }

  /**
   * 切换列表作用域。
   */
  function setScope(nextScope: ListScope) {
    scope.value = nextScope;
    query.page = 1;
  }

  /**
   * 更新关键字并回到第一页。
   */
  function setKeyword(keyword: string) {
    query.keyword = keyword;
    query.page = 1;
  }

  /**
   * 更新 ownership 过滤。
   */
  function setOwnership(ownership: KnowledgeBaseOwnership) {
    query.ownership = ownership;
    query.page = 1;
  }

  /**
   * 更新可见性过滤。
   */
  function setVisibility(visibility: KnowledgeBaseVisibility | "all") {
    query.visibility = visibility;
    query.page = 1;
  }

  /**
   * 更新公开知识库排序方式。
   */
  function setSortBy(sortBy: PublicKnowledgeBaseSortBy) {
    query.sortBy = sortBy;
    query.page = 1;
  }

  /**
   * 创建知识库并刷新列表。
   */
  async function createItem(payload: CreateKnowledgeBasePayload) {
    isSubmitting.value = true;

    try {
      const created = await createKnowledgeBase(payload);
      await fetchList();
      return created;
    } finally {
      isSubmitting.value = false;
    }
  }

  /**
   * 更新知识库并同步刷新列表。
   */
  async function updateItem(
    kbId: string,
    payload: UpdateKnowledgeBasePayload,
  ) {
    isSubmitting.value = true;

    try {
      const updated = await updateKnowledgeBase(kbId, payload);
      await fetchList();
      return updated;
    } finally {
      isSubmitting.value = false;
    }
  }

  /**
   * 删除知识库并刷新列表。
   */
  async function removeItem(kbId: string) {
    isSubmitting.value = true;

    try {
      const result = await deleteKnowledgeBase(kbId);
      await fetchList();
      return result;
    } finally {
      isSubmitting.value = false;
    }
  }

  /**
   * 通过邀请码加入知识库并刷新列表。
   */
  async function joinByInvite(inviteCode: string) {
    isSubmitting.value = true;

    try {
      const result = await joinKnowledgeBaseByInvite({ inviteCode });
      if (!isPublicScope.value) {
        await fetchList();
      }
      return result;
    } finally {
      isSubmitting.value = false;
    }
  }

  return {
    scope,
    isPublicScope,
    isLoading,
    isSubmitting,
    items,
    query,
    pagination,
    fetchList,
    setScope,
    setKeyword,
    setOwnership,
    setVisibility,
    setSortBy,
    createItem,
    updateItem,
    removeItem,
    joinByInvite,
  };
}
