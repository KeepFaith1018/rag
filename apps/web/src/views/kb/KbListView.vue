<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import KbCard from "@/components/kb/KbCard.vue";
import { useKnowledgeBaseList } from "@/composables/useKnowledgeBaseList";
import { useMessage } from "@/composables/useMessage";
import { useGlobalConfirmDialog } from "@/composables/useGlobalConfirmDialog";
import { ApiError } from "@/types/api";
import type {
  CreateKnowledgeBasePayload,
  KnowledgeBaseListItem,
  KnowledgeBaseOwnership,
  KnowledgeBaseVisibility,
  MineKnowledgeBaseSortBy,
  PublicKnowledgeBaseSortBy,
  UpdateKnowledgeBasePayload,
} from "@/types/knowledge-base";

const message = useMessage();
const { confirm } = useGlobalConfirmDialog();
const route = useRoute();
const kbList = useKnowledgeBaseList();
const searchKeyword = ref("");
const showManageModal = ref(false);
const showJoinModal = ref(false);
const editingKb = ref<KnowledgeBaseListItem | null>(null);
const submitError = ref("");
const joinError = ref("");
const manageForm = reactive({
  name: "",
  description: "",
  visibility: "private" as KnowledgeBaseVisibility,
  allowPublicDownload: false,
});
const joinForm = reactive({
  inviteCode: "",
});

const ownershipOptions: Array<{
  label: string;
  value: KnowledgeBaseOwnership;
}> = [
  { label: "全部", value: "all" },
  { label: "我创建的", value: "owned" },
  { label: "我加入的", value: "joined" },
];

const publicSortOptions: Array<{
  label: string;
  value: PublicKnowledgeBaseSortBy;
}> = [
  { label: "最新更新", value: "latest" },
  { label: "热度优先", value: "hot" },
];

const mineSortOptions: Array<{
  label: string;
  value: MineKnowledgeBaseSortBy;
}> = [
  { label: "最近更新", value: "updated_desc" },
  { label: "最早更新", value: "updated_asc" },
  { label: "最多文档", value: "documents_desc" },
  { label: "名称 A-Z", value: "name_asc" },
];

/**
 * 当前弹窗标题。
 */
const modalTitle = computed(() =>
  editingKb.value ? "编辑知识库" : "创建知识库",
);

/**
 * 列表空态文案。
 */
const emptyText = computed(() => {
  if (kbList.isPublicScope.value) {
    return "当前没有匹配的公开知识库，可以稍后再试或调整搜索关键词。";
  }

  if (kbList.query.keyword) {
    return "没有搜索到匹配的知识库，试试更短的关键词。";
  }

  return "当前还没有知识库，先创建第一个知识库开始联调。";
});

/**
 * 是否允许继续上一页。
 */
const canGoPrev = computed(() => kbList.pagination.page > 1);

/**
 * 是否允许继续下一页。
 */
const canGoNext = computed(
  () =>
    kbList.pagination.page * kbList.pagination.pageSize <
    kbList.pagination.total,
);

/**
 * 初始化或刷新列表。
 */
async function loadList() {
  try {
    await kbList.fetchList();
  } catch (error) {
    message.error(resolveErrorMessage(error, "知识库列表加载失败"));
  }
}

/**
 * 打开创建弹窗。
 */
function openCreateModal() {
  editingKb.value = null;
  submitError.value = "";
  manageForm.name = "";
  manageForm.description = "";

  // 根据当前所在页面动态设置默认可见性
  manageForm.visibility =
    kbList.query.visibility !== "all" ? kbList.query.visibility : "private";

  manageForm.allowPublicDownload = false;
  showManageModal.value = true;
}

/**
 * 打开编辑弹窗。
 */
function openEditModal(kb: KnowledgeBaseListItem) {
  editingKb.value = kb;
  submitError.value = "";
  manageForm.name = kb.name;
  manageForm.description = kb.description || "";
  manageForm.visibility = kb.visibility;
  manageForm.allowPublicDownload = kb.allowPublicDownload;
  showManageModal.value = true;
}

/**
 * 关闭创建或编辑弹窗。
 */
function closeManageModal() {
  showManageModal.value = false;
}

/**
 * 关闭邀请码加入弹窗。
 */
function closeJoinModal() {
  showJoinModal.value = false;
  joinError.value = "";
  joinForm.inviteCode = "";
}

/**
 * 切换 ownership。
 */
async function changeOwnership(ownership: KnowledgeBaseOwnership) {
  kbList.setOwnership(ownership);
  await loadList();
}

/**
 * 切换我的知识库排序（再次点击已选中项回退到默认排序）。
 */
async function changeMineSort(sortBy: MineKnowledgeBaseSortBy) {
  if (kbList.query.sortBy === sortBy) {
    kbList.setSortBy("updated_desc");
  } else {
    kbList.setSortBy(sortBy);
  }
  await loadList();
}

/**
 * 切换公开知识库排序。
 */
async function changePublicSort(sortBy: PublicKnowledgeBaseSortBy) {
  kbList.setSortBy(sortBy);
  await loadList();
}

/**
 * 提交创建或更新。
 */
async function submitManageForm() {
  submitError.value = validateKnowledgeBaseForm();
  if (submitError.value) {
    return;
  }

  const payload = buildManagePayload();

  try {
    if (editingKb.value) {
      await kbList.updateItem(
        editingKb.value.id,
        payload as UpdateKnowledgeBasePayload,
      );
      message.success("知识库已更新");
    } else {
      await kbList.createItem(payload);
      message.success("知识库已创建");
    }

    closeManageModal();
  } catch (error) {
    submitError.value = resolveErrorMessage(error, "知识库保存失败");
  }
}

/**
 * 删除知识库。
 */
async function handleDelete(kb: KnowledgeBaseListItem) {
  const confirmed = await confirm({
    title: "删除知识库",
    message: `确认删除知识库"${kb.name}"吗？该操作不可撤销。`,
    confirmText: "删除",
    cancelText: "取消",
    danger: true,
  });
  if (!confirmed) {
    return;
  }

  try {
    await kbList.removeItem(kb.id);
    message.success("知识库已删除");
  } catch (error) {
    message.error(resolveErrorMessage(error, "知识库删除失败"));
  }
}

/**
 * 提交邀请码加入。
 */
async function submitJoinForm() {
  joinError.value = "";
  const inviteCode = joinForm.inviteCode.trim();
  if (!inviteCode) {
    joinError.value = "请输入邀请码";
    return;
  }

  try {
    await kbList.joinByInvite(inviteCode);
    message.success("已成功加入共享知识库");
    closeJoinModal();
  } catch (error) {
    joinError.value = resolveErrorMessage(error, "加入知识库失败");
  }
}

/**
 * 翻到上一页。
 */
async function goPrevPage() {
  if (!canGoPrev.value) {
    return;
  }

  kbList.query.page -= 1;
  await loadList();
}

/**
 * 翻到下一页。
 */
async function goNextPage() {
  if (!canGoNext.value) {
    return;
  }

  kbList.query.page += 1;
  await loadList();
}

/**
 * 构造创建或更新参数。
 */
function buildManagePayload(): CreateKnowledgeBasePayload {
  return {
    name: manageForm.name.trim(),
    description: manageForm.description.trim() || undefined,
    visibility: manageForm.visibility,
    allowPublicDownload:
      manageForm.visibility === "public"
        ? manageForm.allowPublicDownload
        : false,
  };
}

/**
 * 校验知识库表单。
 */
function validateKnowledgeBaseForm() {
  const name = manageForm.name.trim();

  if (!name) {
    return "请输入知识库名称";
  }

  if (name.length > 100) {
    return "知识库名称不能超过 100 个字符";
  }

  if (manageForm.description.trim().length > 2000) {
    return "知识库描述不能超过 2000 个字符";
  }

  return "";
}

/**
 * 统一解析错误文案。
 */
function resolveErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message || fallback;
  }

  if (error instanceof Error) {
    return error.message || fallback;
  }

  return fallback;
}

watch(
  searchKeyword,
  (value, _, onCleanup) => {
    const timer = window.setTimeout(() => {
      kbList.setKeyword(value.trim());
      void loadList();
    }, 280);

    onCleanup(() => {
      window.clearTimeout(timer);
    });
  },
  { flush: "post" },
);

watch(
  () => manageForm.visibility,
  (visibility) => {
    if (visibility !== "public") {
      manageForm.allowPublicDownload = false;
    }
  },
);

watch(
  () => [route.path, route.query],
  ([newPath, newQuery]) => {
    if (newPath === "/public-kb") {
      kbList.setScope("public");
      void loadList();
    } else if (newPath === "/kb") {
      kbList.setScope("mine");

      const q = newQuery as Record<string, string>;
      const ownership = (q.ownership as KnowledgeBaseOwnership) || "all";
      const visibility =
        (q.visibility as KnowledgeBaseVisibility | "all") || "private";

      kbList.query.ownership = ownership;
      kbList.query.visibility = visibility;

      void loadList();
    }
  },
  { deep: true },
);

onMounted(() => {
  if (route.path === "/public-kb") {
    kbList.setScope("public");
  } else {
    kbList.setScope("mine");
    const q = route.query as Record<string, string>;
    kbList.query.ownership = (q.ownership as KnowledgeBaseOwnership) || "all";
    kbList.query.visibility =
      (q.visibility as KnowledgeBaseVisibility | "all") || "private";
  }
  void loadList();
});
</script>

<template>
  <div class="flex flex-col h-full w-full relative">
    <!-- ===== 公开知识库广场 Hero ===== -->
    <section
      v-if="kbList.isPublicScope.value"
      class="relative px-6 md:px-12 pt-12 pb-8"
    >
      <!-- 渐变光球装饰 -->
      <div
        class="absolute top-[-20%] left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-primary-container/20 blur-[120px] rounded-full pointer-events-none"
      />
      <div
        class="absolute top-[10%] right-[15%] w-[200px] h-[200px] bg-secondary-container/15 blur-[80px] rounded-full pointer-events-none"
      />

      <div
        class="relative z-10 flex flex-col items-center text-center max-w-3xl mx-auto"
      >
        <div
          class="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-outline-variant/20 bg-surface-container-high/60 backdrop-blur-sm mb-6"
        >
          <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span
            class="text-[11px] font-label uppercase tracking-[0.12em] text-on-surface-variant"
            >发现社区智慧</span
          >
        </div>
        <h1
          class="font-headline text-4xl md:text-5xl font-bold text-on-surface tracking-tight leading-tight"
        >
          探索知识库
        </h1>
        <p class="text-on-surface-variant text-base md:text-lg mt-4 max-w-xl">
          发现、加入、学习社区共享的智能知识库
        </p>

        <!-- 搜索栏 -->
        <div class="relative w-full max-w-[560px] mt-8 group">
          <span
            class="material-symbols-outlined absolute left-5 top-1/2 -translate-y-1/2 text-outline text-xl group-focus-within:text-primary transition-colors"
            >search</span
          >
          <input
            v-model="searchKeyword"
            type="text"
            placeholder="搜索知识库名称或描述..."
            class="w-full bg-surface-container-highest border border-outline-variant/15 rounded-2xl pl-14 pr-6 py-4 text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all placeholder:text-outline/50 shadow-sm"
          />
        </div>
      </div>
    </section>

    <!-- ===== 我的知识库头部 ===== -->
    <header
      v-else
      class="flex flex-col gap-5 w-full px-6 md:px-12 py-6 sticky top-0 z-40 bg-surface/80 backdrop-blur-xl border-b border-outline-variant/5"
    >
      <div
        class="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4"
      >
        <div class="flex flex-col gap-1">
          <h1 class="font-headline text-2xl font-bold text-on-surface">
            {{
              kbList.query.visibility === "collaborative"
                ? "协作知识库"
                : kbList.query.visibility === "public"
                  ? "公开知识库"
                  : kbList.query.visibility === "all"
                    ? "全部知识库"
                    : "私有知识库"
            }}
          </h1>
          <p class="text-sm text-on-surface-variant">
            {{
              kbList.query.visibility === "collaborative"
                ? "我与团队共建的知识空间"
                : kbList.query.visibility === "public"
                  ? "所有已登录用户可访问的知识空间"
                  : "当前账号可访问的知识资产"
            }}
          </p>
        </div>

        <div class="flex flex-col md:flex-row md:items-center gap-3">
          <div class="relative group min-w-[18rem]">
            <span
              class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline text-lg group-focus-within:text-primary transition-colors"
              >search</span
            >
            <input
              v-model="searchKeyword"
              type="text"
              placeholder="搜索知识库名称..."
              class="w-full bg-surface-container-highest border border-outline-variant/15 rounded-xl pl-12 pr-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary transition-all placeholder:text-outline/50"
            />
          </div>
          <BaseButton
            v-if="kbList.query.visibility === 'collaborative'"
            variant="outline"
            @click="showJoinModal = true"
          >
            <span class="material-symbols-outlined text-[18px]">group_add</span>
            邀请码加入
          </BaseButton>
          <BaseButton @click="openCreateModal">
            <span class="material-symbols-outlined text-[18px]">add</span>
            新建知识库
          </BaseButton>
        </div>
      </div>

      <!-- 过滤器与排序 -->
      <div
        class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
      >
        <div class="flex items-center gap-2 flex-wrap">
          <template v-if="kbList.query.visibility === 'collaborative'">
            <button
              v-for="option in ownershipOptions"
              :key="option.value"
              type="button"
              class="filter-chip"
              :class="{
                'filter-chip-active': kbList.query.ownership === option.value,
              }"
              @click="changeOwnership(option.value)"
            >
              {{ option.label }}
            </button>
          </template>
        </div>
        <div class="flex items-center gap-2 flex-wrap">
          <span
            class="text-xs font-label uppercase tracking-widest text-outline mr-1"
            >排序：</span
          >
          <button
            v-for="option in mineSortOptions"
            :key="option.value"
            type="button"
            class="sort-chip"
            :class="{
              'sort-chip-active': kbList.query.sortBy === option.value,
            }"
            @click="changeMineSort(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
    </header>

    <!-- ===== 公开广场：分类 + 排序 ===== -->
    <div
      v-if="kbList.isPublicScope.value"
      class="px-6 md:px-12 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
    >
      <div class="flex items-center gap-2 flex-wrap">
        <button
          v-for="option in publicSortOptions"
          :key="option.value"
          type="button"
          class="sort-chip"
          :class="{ 'sort-chip-active': kbList.query.sortBy === option.value }"
          @click="changePublicSort(option.value)"
        >
          {{ option.label }}
        </button>
      </div>
      <div class="text-sm text-on-surface-variant">
        共
        <span class="font-semibold text-on-surface">{{
          kbList.pagination.total
        }}</span>
        个公开知识库
      </div>
    </div>

    <!-- ===== 主内容区 ===== -->
    <div class="flex-1 overflow-y-auto relative pb-20">
      <section
        class="px-6 md:px-12 py-8"
        :class="{ 'pt-2': kbList.isPublicScope.value }"
      >
        <!-- 骨架屏加载态 -->
        <div
          v-if="kbList.isLoading.value"
          class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
        >
          <div v-for="i in 9" :key="i" class="skeleton-card">
            <div class="flex items-start gap-4">
              <div class="w-12 h-12 rounded-xl skeleton-shimmer shrink-0" />
              <div class="flex-1 space-y-3">
                <div class="h-3 w-16 rounded-full skeleton-shimmer" />
                <div class="h-5 w-3/5 rounded-lg skeleton-shimmer" />
                <div class="h-3 w-full rounded-lg skeleton-shimmer" />
                <div class="h-3 w-2/3 rounded-lg skeleton-shimmer" />
              </div>
            </div>
            <div class="grid grid-cols-2 gap-3 mt-5">
              <div class="h-[52px] rounded-[0.9rem] skeleton-shimmer" />
              <div class="h-[52px] rounded-[0.9rem] skeleton-shimmer" />
            </div>
            <div
              class="flex items-center justify-between mt-5 pt-4 border-t border-outline-variant/5"
            >
              <div class="h-3 w-20 rounded-full skeleton-shimmer" />
              <div class="h-3 w-16 rounded-full skeleton-shimmer" />
            </div>
          </div>
        </div>

        <!-- 卡片网格 -->
        <div
          v-else-if="kbList.items.value.length"
          class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6"
        >
          <KbCard
            v-for="kb in kbList.items.value"
            :key="kb.id"
            :kb="kb"
            :hide-chips="kbList.isPublicScope.value"
            @edit="openEditModal"
            @delete="handleDelete"
          />

          <!-- 新建入口卡片 -->
          <div
            v-if="!kbList.isPublicScope.value"
            class="new-kb-card group"
            @click="openCreateModal"
          >
            <div
              class="w-14 h-14 rounded-2xl bg-surface-container-high flex items-center justify-center group-hover:scale-110 transition-transform duration-300 shadow-sm"
            >
              <span
                class="material-symbols-outlined text-outline text-3xl group-hover:text-primary transition-colors"
                >add</span
              >
            </div>
            <p
              class="font-headline text-lg font-semibold text-outline group-hover:text-on-surface transition-colors mt-4"
            >
              初始化新知识库
            </p>
            <p
              class="text-[10px] font-label text-outline/60 uppercase tracking-widest mt-2"
            >
              准备构建
            </p>
          </div>
        </div>

        <!-- 空态 -->
        <div v-else class="empty-state">
          <div
            class="w-20 h-20 rounded-3xl bg-surface-container-high flex items-center justify-center mb-6"
          >
            <span class="material-symbols-outlined text-4xl text-outline">
              {{ kbList.isPublicScope.value ? "globe" : "database" }}
            </span>
          </div>
          <h3 class="font-headline text-xl font-bold text-on-surface mb-3">
            {{
              kbList.isPublicScope.value ? "暂无公开知识库" : "暂无可展示知识库"
            }}
          </h3>
          <p class="text-sm text-on-surface-variant max-w-md text-center mb-8">
            {{ emptyText }}
          </p>
          <BaseButton
            v-if="!kbList.isPublicScope.value"
            @click="openCreateModal"
          >
            创建第一个知识库
          </BaseButton>
        </div>

        <!-- 分页 -->
        <div
          v-if="kbList.items.value.length"
          class="mt-10 flex items-center justify-center gap-3"
        >
          <button
            class="page-btn"
            :class="{ 'page-btn-disabled': !canGoPrev }"
            :disabled="!canGoPrev"
            @click="goPrevPage"
          >
            <span class="material-symbols-outlined text-[18px]"
              >chevron_left</span
            >
            上一页
          </button>
          <span class="text-sm text-on-surface-variant px-4">
            {{ kbList.pagination.page }} /
            {{
              Math.max(
                1,
                Math.ceil(kbList.pagination.total / kbList.pagination.pageSize),
              )
            }}
          </span>
          <button
            class="page-btn"
            :class="{ 'page-btn-disabled': !canGoNext }"
            :disabled="!canGoNext"
            @click="goNextPage"
          >
            下一页
            <span class="material-symbols-outlined text-[18px]"
              >chevron_right</span
            >
          </button>
        </div>
      </section>
    </div>

    <!-- ===== 创建/编辑弹窗 ===== -->
    <div
      v-if="showManageModal"
      class="modal-overlay"
      @click.self="closeManageModal"
    >
      <div class="modal-container modal-xl">
        <div class="modal-header">
          <div>
            <h3 class="font-headline text-xl font-bold">{{ modalTitle }}</h3>
            <p class="text-sm text-on-surface-variant mt-1">
              配置知识库基本信息与访问策略
            </p>
          </div>
          <button
            type="button"
            class="modal-close-btn"
            @click="closeManageModal"
          >
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div class="modal-body space-y-5">
          <div>
            <label class="form-label">知识库名称</label>
            <BaseInput
              v-model="manageForm.name"
              placeholder="例如：后端接口规范库"
            />
          </div>
          <div>
            <label class="form-label">知识库描述</label>
            <textarea
              v-model="manageForm.description"
              rows="4"
              class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-xl px-4 py-3 text-sm text-on-surface placeholder:text-outline/40 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all resize-none"
              placeholder="描述该知识库面向的业务范围、成员边界和使用方式"
            />
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-5">
            <div>
              <label class="form-label">可见性</label>
              <div class="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  class="visibility-card"
                  :class="{
                    'visibility-card-active':
                      manageForm.visibility === 'private',
                  }"
                  @click="manageForm.visibility = 'private'"
                >
                  <span class="material-symbols-outlined">lock</span>
                  <span>私有</span>
                </button>
                <button
                  type="button"
                  class="visibility-card"
                  :class="{
                    'visibility-card-active':
                      manageForm.visibility === 'collaborative',
                  }"
                  @click="manageForm.visibility = 'collaborative'"
                >
                  <span class="material-symbols-outlined">groups</span>
                  <span>协作</span>
                </button>
                <button
                  type="button"
                  class="visibility-card"
                  :class="{
                    'visibility-card-active':
                      manageForm.visibility === 'public',
                  }"
                  @click="manageForm.visibility = 'public'"
                >
                  <span class="material-symbols-outlined">public</span>
                  <span>公开</span>
                </button>
              </div>
            </div>

            <div
              class="rounded-2xl border border-outline-variant/10 bg-surface-container-high/40 p-4"
            >
              <div class="font-medium text-sm text-on-surface mb-3">
                公开策略
              </div>
              <label class="toggle-row">
                <input
                  v-model="manageForm.allowPublicDownload"
                  type="checkbox"
                  :disabled="manageForm.visibility !== 'public'"
                />
                <span>允许公开下载</span>
              </label>
            </div>
          </div>

          <p v-if="submitError" class="text-sm text-error">{{ submitError }}</p>
        </div>

        <div class="modal-footer">
          <BaseButton variant="ghost" @click="closeManageModal"
            >取消</BaseButton
          >
          <BaseButton
            :disabled="kbList.isSubmitting.value"
            @click="submitManageForm"
          >
            {{ kbList.isSubmitting.value ? "保存中..." : "确认保存" }}
          </BaseButton>
        </div>
      </div>
    </div>

    <!-- ===== 邀请码加入弹窗 ===== -->
    <div
      v-if="showJoinModal"
      class="modal-overlay"
      @click.self="closeJoinModal"
    >
      <div class="modal-container modal-sm">
        <div class="modal-header">
          <div>
            <h3 class="font-headline text-lg font-bold">邀请码加入</h3>
            <p class="text-sm text-on-surface-variant mt-1">
              输入共享知识库邀请码
            </p>
          </div>
          <button type="button" class="modal-close-btn" @click="closeJoinModal">
            <span class="material-symbols-outlined">close</span>
          </button>
        </div>

        <div class="modal-body space-y-4">
          <div>
            <label class="form-label">邀请码</label>
            <BaseInput
              v-model="joinForm.inviteCode"
              placeholder="请输入邀请码"
            />
          </div>
          <p v-if="joinError" class="text-sm text-error">{{ joinError }}</p>
        </div>

        <div class="modal-footer">
          <BaseButton variant="ghost" @click="closeJoinModal">取消</BaseButton>
          <BaseButton
            :disabled="kbList.isSubmitting.value"
            @click="submitJoinForm"
          >
            {{ kbList.isSubmitting.value ? "加入中..." : "立即加入" }}
          </BaseButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ----- 骨架屏 ----- */
.skeleton-card {
  background: var(--color-surface-container-low);
  border: 1px solid
    color-mix(in srgb, var(--color-outline-variant) 5%, transparent);
  border-radius: 1.25rem;
  padding: 1.25rem;
}

.skeleton-shimmer {
  background: linear-gradient(
    90deg,
    color-mix(in srgb, var(--color-surface-container-high) 40%, transparent) 25%,
    color-mix(in srgb, var(--color-surface-container-highest) 60%, transparent)
      50%,
    color-mix(in srgb, var(--color-surface-container-high) 40%, transparent) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.5s infinite;
}

@keyframes shimmer {
  0% {
    background-position: 200% 0;
  }
  100% {
    background-position: -200% 0;
  }
}

/* ----- 新建入口卡片 ----- */
.new-kb-card {
  border: 2px dashed
    color-mix(in srgb, var(--color-outline-variant) 20%, transparent);
  border-radius: 1.25rem;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 14rem;
  cursor: pointer;
  background: color-mix(in srgb, var(--color-surface) 60%, transparent);
}
.new-kb-card:hover {
  border-color: color-mix(in srgb, var(--color-primary) 40%, transparent);
  background: var(--color-surface-container-low);
}

/* ----- 空态 ----- */
.empty-state {
  border: 2px dashed
    color-mix(in srgb, var(--color-outline-variant) 15%, transparent);
  border-radius: 1.5rem;
  background: color-mix(
    in srgb,
    var(--color-surface-container-low) 70%,
    transparent
  );
  padding: 3rem 1.5rem;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

/* ----- 分页 ----- */
.page-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 1.25rem;
  border-radius: 0.75rem;
  font-size: 0.875rem;
  font-weight: 500;
  font-family: var(--font-headline);
  background: var(--color-surface-container-low);
  border: 1px solid
    color-mix(in srgb, var(--color-outline-variant) 15%, transparent);
  color: var(--color-on-surface);
  transition: all 0.2s ease;
  cursor: pointer;
}
.page-btn:hover {
  background: var(--color-surface-container-high);
}
.page-btn-disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* ----- Filter chips (我的知识库) ----- */
.filter-chip {
  border-radius: 999px;
  padding: 0.45rem 0.85rem;
  font-size: 0.78rem;
  color: var(--color-on-surface-variant);
  background: color-mix(
    in srgb,
    var(--color-surface-container-low) 75%,
    transparent
  );
  border: 1px solid transparent;
  transition: all 0.2s ease;
  cursor: pointer;
}
.filter-chip:hover {
  background: color-mix(
    in srgb,
    var(--color-surface-container-high) 60%,
    transparent
  );
}
.filter-chip-active {
  color: var(--color-on-surface);
  background: color-mix(
    in srgb,
    var(--color-surface-container-high) 92%,
    transparent
  );
  border-color: color-mix(
    in srgb,
    var(--color-outline-variant) 22%,
    transparent
  );
  box-shadow: var(--shadow-glass-value);
}

/* ----- 排序 chip ----- */
.sort-chip {
  border-radius: 999px;
  padding: 0.38rem 0.78rem;
  font-size: 0.74rem;
  color: var(--color-on-surface-variant);
  background: transparent;
  border: 1px solid
    color-mix(in srgb, var(--color-outline-variant) 18%, transparent);
  transition: all 0.2s ease;
  cursor: pointer;
}
.sort-chip:hover {
  background: color-mix(
    in srgb,
    var(--color-surface-container-high) 60%,
    transparent
  );
  border-color: color-mix(
    in srgb,
    var(--color-outline-variant) 35%,
    transparent
  );
}
.sort-chip-active {
  color: var(--color-primary);
  border-color: color-mix(in srgb, var(--color-primary) 30%, transparent);
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
}

/* ----- 弹窗通用 ----- */
.modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
}
.modal-container {
  width: 100%;
  border-radius: 1.5rem;
  border: 1px solid
    color-mix(in srgb, var(--color-outline-variant) 10%, transparent);
  background: var(--color-surface-container-low);
  box-shadow: 0 28px 120px rgba(0, 0, 0, 0.35);
}
.modal-xl {
  max-width: 42rem;
}
.modal-sm {
  max-width: 32rem;
}
.modal-header {
  padding: 1.5rem 1.75rem;
  border-bottom: 1px solid
    color-mix(in srgb, var(--color-outline-variant) 10%, transparent);
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 1rem;
}
.modal-close-btn {
  width: 2.5rem;
  height: 2.5rem;
  border-radius: 0.75rem;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
  flex-shrink: 0;
}
.modal-close-btn:hover {
  background: var(--color-surface-container-high);
}
.modal-body {
  padding: 1.5rem 1.75rem;
}
.modal-footer {
  padding: 1.25rem 1.75rem;
  border-top: 1px solid
    color-mix(in srgb, var(--color-outline-variant) 10%, transparent);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
}

/* ----- 表单 ----- */
.form-label {
  display: inline-flex;
  margin-bottom: 0.65rem;
  font-size: 0.78rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-outline);
}
.visibility-card {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  border-radius: 1rem;
  border: 1px solid
    color-mix(in srgb, var(--color-outline-variant) 18%, transparent);
  background: color-mix(
    in srgb,
    var(--color-surface-container-high) 65%,
    transparent
  );
  padding: 1rem;
  transition: all 0.2s ease;
  cursor: pointer;
}
.visibility-card:hover {
  background: color-mix(
    in srgb,
    var(--color-surface-container-high) 85%,
    transparent
  );
}
.visibility-card-active {
  border-color: color-mix(in srgb, var(--color-primary) 35%, transparent);
  background: color-mix(in srgb, var(--color-primary) 12%, transparent);
  color: var(--color-primary);
}
.toggle-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  font-size: 0.9rem;
  color: var(--color-on-surface);
}
.toggle-row + .toggle-row {
  margin-top: 0.9rem;
}
</style>
