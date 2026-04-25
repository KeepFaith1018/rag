<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import FilterBar from "@/components/kb/FilterBar.vue";
import KbCard from "@/components/kb/KbCard.vue";
import { useKnowledgeBaseList } from "@/composables/useKnowledgeBaseList";
import { useMessage } from "@/composables/useMessage";
import { ApiError } from "@/types/api";
import type {
  CreateKnowledgeBasePayload,
  KnowledgeBaseListItem,
  KnowledgeBaseOwnership,
  KnowledgeBaseVisibility,
  PublicKnowledgeBaseSortBy,
  UpdateKnowledgeBasePayload,
} from "@/types/knowledge-base";

const message = useMessage();
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
  isPublic: false,
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

/**
 * 当前弹窗标题。
 */
const modalTitle = computed(() =>
  editingKb.value ? "编辑知识库" : "创建知识库",
);

/**
 * 当前列表排序文案。
 */
const sortLabel = computed(() => {
  if (kbList.isPublicScope.value) {
    return kbList.query.sortBy === "hot" ? "热度优先" : "最新更新";
  }

  return "修改日期";
});

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
  manageForm.visibility = "private";
  manageForm.isPublic = false;
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
  manageForm.isPublic = kb.isPublic;
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
 * 切换顶部作用域。
 */
async function switchScope(scope: "mine" | "public") {
  kbList.setScope(scope);
  await loadList();
}

/**
 * 切换 ownership。
 */
async function changeOwnership(ownership: KnowledgeBaseOwnership) {
  kbList.setOwnership(ownership);
  await loadList();
}

/**
 * 切换可见性筛选。
 */
async function changeVisibility(visibility: KnowledgeBaseVisibility | "all") {
  kbList.setVisibility(visibility);
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
  const confirmed = window.confirm(
    `确认删除知识库“${kb.name}”吗？该操作不可撤销。`,
  );
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
  const isShared = manageForm.visibility === "shared";

  return {
    name: manageForm.name.trim(),
    description: manageForm.description.trim() || undefined,
    visibility: manageForm.visibility,
    isPublic: isShared ? manageForm.isPublic : false,
    allowPublicDownload: isShared ? manageForm.allowPublicDownload : false,
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

  if (name.length > 20) {
    return "知识库名称不能超过 20 个字符";
  }

  if (manageForm.description.trim().length > 200) {
    return "知识库描述不能超过 200 个字符";
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
    if (visibility === "private") {
      manageForm.isPublic = false;
      manageForm.allowPublicDownload = false;
    }
  },
);

onMounted(() => {
  void loadList();
});
</script>

<template>
  <div class="flex flex-col h-full w-full relative">
    <header
      class="flex flex-col gap-5 w-full px-6 md:px-12 py-6 sticky top-0 z-40 bg-surface/80 backdrop-blur-xl border-b border-transparent"
    >
      <div
        class="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4"
      >
        <div class="flex flex-col gap-3">
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="scope-tab"
              :class="{ 'scope-tab-active': kbList.scope.value === 'mine' }"
              @click="switchScope('mine')"
            >
              我的知识库
            </button>
            <button
              type="button"
              class="scope-tab"
              :class="{ 'scope-tab-active': kbList.scope.value === 'public' }"
              @click="switchScope('public')"
            >
              公开知识库
            </button>
          </div>
          <div class="text-sm text-on-surface-variant">
            已接入真实知识库列表、创建/编辑/删除与邀请码加入流程。
          </div>
        </div>

        <div class="flex flex-col md:flex-row md:items-center gap-3">
          <div class="relative group min-w-[18rem]">
            <span
              class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline text-lg group-hover:text-primary transition-colors"
            >
              search
            </span>
            <input
              v-model="searchKeyword"
              type="text"
              placeholder="搜索知识库名称或描述..."
              class="bg-surface-container-highest border border-outline-variant/15 rounded-xl pl-12 pr-6 py-2.5 w-full focus:ring-1 focus:ring-primary focus:outline-none text-sm transition-all placeholder:text-outline/50"
            />
          </div>
          <BaseButton variant="outline" @click="showJoinModal = true">
            <span class="material-symbols-outlined text-[18px]">group_add</span>
            邀请码加入
          </BaseButton>
          <BaseButton
            v-if="!kbList.isPublicScope.value"
            @click="openCreateModal"
          >
            <span class="material-symbols-outlined text-[18px]">add</span>
            新建知识库
          </BaseButton>
        </div>
      </div>

      <div
        v-if="!kbList.isPublicScope.value"
        class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
      >
        <div class="flex items-center gap-2 flex-wrap">
          <button
            v-for="option in ownershipOptions"
            :key="option.value"
            type="button"
            class="ownership-chip"
            :class="{
              'ownership-chip-active': kbList.query.ownership === option.value,
            }"
            @click="changeOwnership(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
        <FilterBar
          :model-value="kbList.query.visibility"
          :sort-label="sortLabel"
          @update:model-value="changeVisibility"
        />
      </div>

      <div
        v-else
        class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
      >
        <div class="text-xs uppercase tracking-[0.24em] text-outline">
          仅展示已公开共享知识库
        </div>
        <div class="flex items-center gap-2">
          <button
            v-for="option in publicSortOptions"
            :key="option.value"
            type="button"
            class="ownership-chip"
            :class="{
              'ownership-chip-active': kbList.query.sortBy === option.value,
            }"
            @click="changePublicSort(option.value)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto relative pb-20">
      <section class="px-6 md:px-12 py-8">
        <div
          class="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6"
        >
          <div class="text-sm text-on-surface-variant">
            当前共 {{ kbList.pagination.total }} 个知识库
          </div>
          <div class="text-xs uppercase tracking-[0.22em] text-outline">
            第 {{ kbList.pagination.page }} /
            {{
              Math.max(
                1,
                Math.ceil(kbList.pagination.total / kbList.pagination.pageSize),
              )
            }}
            页
          </div>
        </div>

        <div
          v-if="kbList.isLoading.value"
          class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8"
        >
          <div
            v-for="index in 6"
            :key="index"
            class="h-80 rounded-[var(--radius-card)] bg-surface-container-low animate-pulse border border-outline-variant/5"
          ></div>
        </div>

        <div
          v-else-if="kbList.items.value.length"
          class="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-8"
        >
          <KbCard
            v-for="kb in kbList.items.value"
            :key="kb.id"
            :kb="kb"
            @edit="openEditModal"
            @delete="handleDelete"
          />

          <div
            v-if="!kbList.isPublicScope.value"
            class="group border-2 border-dashed border-outline-variant/20 hover:border-primary/40 p-8 rounded-xl transition-all duration-300 flex flex-col items-center justify-center h-80 cursor-pointer bg-surface/40 hover:bg-surface-container-low"
            @click="openCreateModal"
          >
            <div
              class="w-14 h-14 rounded-full bg-surface-container-high flex items-center justify-center mb-4 group-hover:scale-110 transition-transform shadow-lg"
            >
              <span
                class="material-symbols-outlined text-outline text-2xl group-hover:text-primary transition-colors"
              >
                add
              </span>
            </div>
            <p
              class="font-headline text-lg font-medium text-outline group-hover:text-on-surface transition-colors"
            >
              初始化新核心
            </p>
            <p
              class="text-[10px] font-label text-outline/60 uppercase tracking-widest mt-2"
            >
              准备部署
            </p>
          </div>
        </div>

        <div
          v-else
          class="rounded-[var(--radius-card)] border border-dashed border-outline-variant/15 bg-surface-container-low/70 px-8 py-14 flex flex-col items-center text-center"
        >
          <div
            class="w-16 h-16 rounded-full bg-surface-container-high flex items-center justify-center mb-5"
          >
            <span class="material-symbols-outlined text-3xl text-outline">
              database
            </span>
          </div>
          <h3 class="font-headline text-xl font-semibold text-on-surface">
            暂无可展示知识库
          </h3>
          <p class="text-sm text-on-surface-variant mt-3 max-w-lg">
            {{ emptyText }}
          </p>
          <BaseButton
            v-if="!kbList.isPublicScope.value"
            class="mt-6"
            @click="openCreateModal"
          >
            创建第一个知识库
          </BaseButton>
        </div>

        <div
          class="mt-8 flex items-center justify-between gap-4 border-t border-outline-variant/10 pt-6"
        >
          <div class="text-xs uppercase tracking-[0.22em] text-outline">
            排序：{{ sortLabel }}
          </div>
          <div class="flex items-center gap-3">
            <BaseButton
              variant="outline"
              :disabled="!canGoPrev"
              @click="goPrevPage"
            >
              上一页
            </BaseButton>
            <BaseButton
              variant="outline"
              :disabled="!canGoNext"
              @click="goNextPage"
            >
              下一页
            </BaseButton>
          </div>
        </div>
      </section>
    </div>

    <footer
      class="absolute bottom-0 left-0 w-full h-12 flex items-center px-12 justify-between border-t border-outline-variant/5 bg-surface/50 backdrop-blur-md"
    >
      <div class="flex gap-8">
        <span
          class="text-[10px] font-label tracking-tighter text-outline uppercase"
        >
          接口源: knowledge-base/*
        </span>
        <span
          class="text-[10px] font-label tracking-tighter text-outline uppercase"
        >
          当前条数: {{ kbList.items.value.length }}
        </span>
      </div>
      <div class="flex gap-4 items-center">
        <span
          class="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shadow-[0_0_5px_#c3c0ff]"
        ></span>
        <span
          class="text-[10px] font-label tracking-tighter text-outline uppercase"
        >
          数据同步: 已接入
        </span>
      </div>
    </footer>

    <div
      v-if="showManageModal"
      class="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex items-center justify-center px-4"
    >
      <div
        class="w-full max-w-2xl rounded-[24px] border border-outline-variant/10 bg-surface-container-low shadow-[0_28px_120px_rgba(0,0,0,0.35)]"
      >
        <div class="px-7 py-6 border-b border-outline-variant/10">
          <div class="flex items-center justify-between gap-4">
            <div>
              <h3 class="font-headline text-2xl font-bold">{{ modalTitle }}</h3>
              <p class="text-sm text-on-surface-variant mt-2">
                配置知识库基础信息、可见性以及公开访问策略。
              </p>
            </div>
            <button
              type="button"
              class="w-10 h-10 rounded-xl hover:bg-surface-container-high transition-colors"
              @click="closeManageModal"
            >
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        <div class="px-7 py-6 space-y-5">
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
              class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-lg px-4 py-3 text-sm text-on-surface placeholder:text-outline/40 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all"
              placeholder="描述该知识库面向的业务范围、成员边界和使用方式"
            ></textarea>
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
                      manageForm.visibility === 'shared',
                  }"
                  @click="manageForm.visibility = 'shared'"
                >
                  <span class="material-symbols-outlined">groups</span>
                  <span>共享</span>
                </button>
              </div>
            </div>

            <div
              class="rounded-2xl border border-outline-variant/10 bg-surface-container-high/40 p-4"
            >
              <div class="font-medium text-on-surface mb-3">共享策略</div>
              <label class="toggle-row">
                <input
                  v-model="manageForm.isPublic"
                  type="checkbox"
                  :disabled="manageForm.visibility !== 'shared'"
                />
                <span>允许公开访问</span>
              </label>
              <label class="toggle-row">
                <input
                  v-model="manageForm.allowPublicDownload"
                  type="checkbox"
                  :disabled="manageForm.visibility !== 'shared'"
                />
                <span>允许公开下载</span>
              </label>
            </div>
          </div>

          <p v-if="submitError" class="text-sm text-error">
            {{ submitError }}
          </p>
        </div>

        <div
          class="px-7 py-5 border-t border-outline-variant/10 flex items-center justify-end gap-3"
        >
          <BaseButton variant="ghost" @click="closeManageModal">
            取消
          </BaseButton>
          <BaseButton
            :disabled="kbList.isSubmitting.value"
            @click="submitManageForm"
          >
            {{ kbList.isSubmitting.value ? "保存中..." : "确认保存" }}
          </BaseButton>
        </div>
      </div>
    </div>

    <div
      v-if="showJoinModal"
      class="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex items-center justify-center px-4"
    >
      <div
        class="w-full max-w-lg rounded-[24px] border border-outline-variant/10 bg-surface-container-low shadow-[0_28px_120px_rgba(0,0,0,0.35)]"
      >
        <div class="px-7 py-6 border-b border-outline-variant/10">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="font-headline text-2xl font-bold">邀请码加入</h3>
              <p class="text-sm text-on-surface-variant mt-2">
                输入共享知识库邀请码，加入后会自动出现在“我的知识库”中。
              </p>
            </div>
            <button
              type="button"
              class="w-10 h-10 rounded-xl hover:bg-surface-container-high transition-colors"
              @click="closeJoinModal"
            >
              <span class="material-symbols-outlined">close</span>
            </button>
          </div>
        </div>

        <div class="px-7 py-6 space-y-4">
          <div>
            <label class="form-label">邀请码</label>
            <BaseInput
              v-model="joinForm.inviteCode"
              placeholder="请输入邀请码"
            />
          </div>
          <p v-if="joinError" class="text-sm text-error">
            {{ joinError }}
          </p>
        </div>

        <div
          class="px-7 py-5 border-t border-outline-variant/10 flex items-center justify-end gap-3"
        >
          <BaseButton variant="ghost" @click="closeJoinModal">
            取消
          </BaseButton>
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
.scope-tab {
  border-radius: 999px;
  border: 1px solid
    color-mix(in srgb, var(--color-outline-variant) 16%, transparent);
  background: color-mix(
    in srgb,
    var(--color-surface-container-low) 78%,
    transparent
  );
  padding: 0.6rem 1rem;
  font-size: 0.78rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-on-surface-variant);
  transition: all 0.2s ease;
}

.scope-tab-active {
  border-color: color-mix(in srgb, var(--color-primary) 40%, transparent);
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  color: var(--color-primary);
}

.ownership-chip {
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
}

.ownership-chip-active {
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
  box-shadow: var(--shadow-glass);
}

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
