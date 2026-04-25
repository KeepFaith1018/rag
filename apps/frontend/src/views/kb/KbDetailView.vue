<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import BaseButton from "@/components/ui/BaseButton.vue";
import BaseInput from "@/components/ui/BaseInput.vue";
import { useKnowledgeBaseDetail } from "@/composables/useKnowledgeBaseDetail";
import { useKbMembers } from "@/composables/useKbMembers";
import { useMessage } from "@/composables/useMessage";
import { useChunkUpload } from "@/modules/document-upload/composables/useChunkUpload";
import { ApiError } from "@/types/api";
import type {
  KnowledgeBaseDetail,
  KnowledgeBaseDocumentItem,
  KnowledgeBaseDocumentStatus,
  KnowledgeBaseInvitationItem,
  KnowledgeBaseMemberItem,
  KnowledgeBaseMemberRole,
} from "@/types/knowledge-base";

const API_BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.trim() ||
  "http://localhost:3000/api";

const router = useRouter();
const route = useRoute();
const message = useMessage();
const fileInputRef = ref<HTMLInputElement | null>(null);
const activeTab = ref<"documents" | "members" | "settings">("documents");
const documentKeyword = ref("");
const documentView = useKnowledgeBaseDetail();
const memberView = useKbMembers();
const { state, isUploading, startUpload, cancel } = useChunkUpload();
const settingsForm = reactive({
  name: "",
  description: "",
  visibility: "private" as "private" | "shared",
  isPublic: false,
  allowPublicDownload: false,
});
const inviteForm = reactive({
  role: "member" as KnowledgeBaseMemberRole,
  expiredInHours: 72,
});
const settingsError = ref("");
const memberError = ref("");

const kbId = computed(() => String(route.params.id || ""));
const kb = computed(() => documentView.kb.value);

/**
 * 详情页标签集合。
 */
const tabs = computed(() => {
  const result: Array<{
    key: "documents" | "members" | "settings";
    label: string;
  }> = [{ key: "documents", label: "文档" }];

  if (kb.value?.visibility === "shared") {
    result.push({ key: "members", label: "成员" });
  }

  if (
    kb.value &&
    (kb.value.accessRole === "owner" || kb.value.accessRole === "manager")
  ) {
    result.push({ key: "settings", label: "设置" });
  }

  return result;
});

/**
 * 文档状态说明。
 */
const uploadStatusText = computed(() => {
  switch (state.status) {
    case "hashing":
      return "正在计算文件哈希，准备执行秒传与断点续传校验";
    case "initializing":
      return "正在初始化上传会话";
    case "uploading":
      return `正在上传分片，已完成 ${state.progress}%`;
    case "merging":
      return "分片上传完成，正在请求服务端合并";
    case "completed":
      return "上传完成，文档已进入后端处理入口状态";
    case "instantCompleted":
      return "命中秒传，已直接复用已有源文件";
    case "failed":
      return state.errorMessage || "上传失败，请稍后重试";
    default:
      return "拖拽 PDF、Word、TXT 或 Markdown 文件至此，体验分片上传、断点续传与秒传";
  }
});

/**
 * 当前角色文案。
 */
const roleLabel = computed(() => {
  if (!kb.value) {
    return "";
  }

  const map = {
    owner: "拥有者",
    manager: "管理员",
    collaborator: "协作者",
    member: "成员",
    publicVisitor: "公开访问",
  } as const;

  return map[kb.value.accessRole];
});

/**
 * 是否允许上传文档。
 */
const canUpload = computed(() => kb.value?.permissions.canUpload === true);

/**
 * 是否允许管理成员。
 */
const canManageMembers = computed(
  () => kb.value?.permissions.canManageMembers === true,
);

/**
 * 是否允许管理知识库设置。
 */
const canManageKnowledgeBase = computed(
  () => kb.value?.permissions.canManageKnowledgeBase === true,
);

/**
 * 文档状态筛选项。
 */
const documentStatusFilters: Array<{
  label: string;
  value: KnowledgeBaseDocumentStatus | "all";
}> = [
  { label: "全部", value: "all" },
  { label: "处理中", value: "queued" },
  { label: "解析中", value: "parsing" },
  { label: "切块中", value: "chunking" },
  { label: "向量化", value: "embedding" },
  { label: "已就绪", value: "ready" },
  { label: "失败", value: "failed" },
];

/**
 * 拉取知识库详情页数据。
 */
async function loadPage() {
  if (!kbId.value) {
    return;
  }

  try {
    await documentView.reload(kbId.value);
    syncSettingsForm(documentView.kb.value);

    if (kb.value?.visibility === "shared" && canManageMembers.value) {
      await memberView.reload(kbId.value);
    }
  } catch (error) {
    message.error(resolveErrorMessage(error, "知识库详情加载失败"));
  }
}

/**
 * 同步设置表单。
 */
function syncSettingsForm(detail: KnowledgeBaseDetail | null) {
  if (!detail) {
    return;
  }

  settingsForm.name = detail.name;
  settingsForm.description = detail.description || "";
  settingsForm.visibility = detail.visibility;
  settingsForm.isPublic = detail.isPublic;
  settingsForm.allowPublicDownload = detail.allowPublicDownload;
}

/**
 * 返回上一页。
 */
function goBack() {
  router.back();
}

/**
 * 选择文件。
 */
function openFilePicker() {
  if (!canUpload.value) {
    return;
  }

  fileInputRef.value?.click();
}

/**
 * 选择文件后开始上传。
 */
async function handleFileChange(event: Event) {
  const target = event.target as HTMLInputElement | null;
  const file = target?.files?.[0];

  if (!file || !kbId.value) {
    return;
  }

  try {
    await startUpload({
      kbId: kbId.value,
      file,
      onSuccess: async () => {
        message.success("文档上传成功，已进入处理流水线");
        await documentView.fetchDocuments(kbId.value);
      },
      onError: (errorMessage) => {
        message.error(errorMessage);
      },
    });
  } finally {
    if (target) {
      target.value = "";
    }
  }
}

/**
 * 取消当前上传任务。
 */
async function cancelCurrentUpload() {
  if (!kbId.value || !state.uploadId) {
    return;
  }

  try {
    await cancel(kbId.value);
    message.info("已取消当前上传任务");
  } catch (error) {
    message.error(resolveErrorMessage(error, "取消上传失败"));
  }
}

/**
 * 切换文档状态筛选。
 */
async function setDocumentStatus(status: KnowledgeBaseDocumentStatus | "all") {
  documentView.documentQuery.status = status;
  await reloadDocuments();
}

/**
 * 单独刷新文档列表。
 */
async function reloadDocuments() {
  if (!kbId.value) {
    return;
  }

  try {
    await documentView.fetchDocuments(kbId.value);
  } catch (error) {
    message.error(resolveErrorMessage(error, "文档列表加载失败"));
  }
}

/**
 * 刷新成员与邀请数据。
 */
async function reloadMembers() {
  if (!kbId.value || !canManageMembers.value) {
    return;
  }

  try {
    await memberView.reload(kbId.value);
  } catch (error) {
    memberError.value = resolveErrorMessage(error, "成员数据加载失败");
  }
}

/**
 * 保存知识库设置。
 */
async function saveSettings() {
  settingsError.value = validateSettingsForm();
  if (settingsError.value || !kbId.value) {
    return;
  }

  try {
    await documentView.updateSettings(kbId.value, {
      name: settingsForm.name.trim(),
      description: settingsForm.description.trim() || undefined,
      visibility: settingsForm.visibility,
      isPublic:
        settingsForm.visibility === "shared" ? settingsForm.isPublic : false,
      allowPublicDownload:
        settingsForm.visibility === "shared"
          ? settingsForm.allowPublicDownload
          : false,
    });
    syncSettingsForm(documentView.kb.value);
    message.success("知识库设置已更新");
  } catch (error) {
    settingsError.value = resolveErrorMessage(error, "知识库设置保存失败");
  }
}

/**
 * 删除当前知识库。
 */
async function removeKnowledgeBase() {
  if (!kb.value || !kbId.value) {
    return;
  }

  const confirmed = window.confirm(
    `确认删除知识库“${kb.value.name}”吗？该操作不可撤销。`,
  );
  if (!confirmed) {
    return;
  }

  try {
    await documentView.removeKnowledgeBaseItem(kbId.value);
    message.success("知识库已删除");
    await router.replace("/kb");
  } catch (error) {
    message.error(resolveErrorMessage(error, "知识库删除失败"));
  }
}

/**
 * 删除文档。
 */
async function removeDocument(document: KnowledgeBaseDocumentItem) {
  if (!kbId.value) {
    return;
  }

  const confirmed = window.confirm(`确认删除文档“${document.title}”吗？`);
  if (!confirmed) {
    return;
  }

  try {
    await documentView.removeDocument(kbId.value, document.id);
    message.success("文档已删除");
  } catch (error) {
    message.error(resolveErrorMessage(error, "文档删除失败"));
  }
}

/**
 * 触发文档重解析。
 */
async function reparseDocument(document: KnowledgeBaseDocumentItem) {
  if (!kbId.value) {
    return;
  }

  try {
    await documentView.reparseDocument(kbId.value, document.id);
    message.success("已触发重解析");
  } catch (error) {
    message.error(resolveErrorMessage(error, "触发重解析失败"));
  }
}

/**
 * 下载原始文档。
 */
function downloadDocument(document: KnowledgeBaseDocumentItem) {
  if (!kbId.value) {
    return;
  }

  window.open(
    `${API_BASE_URL}/knowledge-bases/${kbId.value}/documents/${document.id}/download`,
    "_blank",
  );
}

/**
 * 创建邀请。
 */
async function createInvitation() {
  if (!kbId.value) {
    return;
  }

  memberError.value = "";

  try {
    const invitation = await memberView.createInvitation(kbId.value, {
      role: inviteForm.role,
      expiredInHours: inviteForm.expiredInHours,
    });
    await navigator.clipboard?.writeText(invitation.inviteCode);
    message.success("邀请码已生成并尝试复制到剪贴板");
  } catch (error) {
    memberError.value = resolveErrorMessage(error, "创建邀请码失败");
  }
}

/**
 * 复制邀请码。
 */
async function copyInviteCode(inviteCode: string) {
  try {
    await window.navigator.clipboard?.writeText(inviteCode);
    message.success("邀请码已复制");
  } catch (error) {
    message.error(resolveErrorMessage(error, "复制邀请码失败"));
  }
}

/**
 * 取消邀请。
 */
async function cancelInvitation(invitation: KnowledgeBaseInvitationItem) {
  if (!kbId.value) {
    return;
  }

  try {
    await memberView.cancelInvitation(kbId.value, invitation.id);
    message.success("邀请码已取消");
  } catch (error) {
    memberError.value = resolveErrorMessage(error, "取消邀请码失败");
  }
}

/**
 * 移除成员。
 */
async function removeMember(member: KnowledgeBaseMemberItem) {
  if (!kbId.value) {
    return;
  }

  const confirmed = window.confirm(`确认移除成员“${member.fullName}”吗？`);
  if (!confirmed) {
    return;
  }

  try {
    await memberView.removeMember(kbId.value, member.userId);
    message.success("成员已移除");
  } catch (error) {
    memberError.value = resolveErrorMessage(error, "移除成员失败");
  }
}

/**
 * 校验设置表单。
 */
function validateSettingsForm() {
  const name = settingsForm.name.trim();

  if (!name) {
    return "请输入知识库名称";
  }

  if (name.length > 20) {
    return "知识库名称不能超过 20 个字符";
  }

  if (settingsForm.description.trim().length > 200) {
    return "知识库描述不能超过 200 个字符";
  }

  return "";
}

/**
 * 获取文档状态文案。
 */
function getDocumentStatusLabel(status: string) {
  const map: Record<string, string> = {
    pending: "待处理",
    uploaded: "已上传",
    queued: "排队中",
    parsing: "解析中",
    chunking: "切块中",
    embedding: "向量化",
    ready: "已就绪",
    failed: "失败",
  };

  return map[status] || status;
}

/**
 * 获取文档状态样式类。
 */
function getDocumentStatusClass(status: string) {
  if (status === "ready") {
    return "status-badge-ready";
  }

  if (status === "failed") {
    return "status-badge-failed";
  }

  return "status-badge-processing";
}

/**
 * 获取成员角色文案。
 */
function getMemberRoleLabel(role: KnowledgeBaseMemberItem["role"]) {
  const map = {
    owner: "拥有者",
    manager: "管理员",
    collaborator: "协作者",
    member: "成员",
  } as const;

  return map[role];
}

/**
 * 统一日期格式化。
 */
function formatDateTime(value: string | null) {
  if (!value) {
    return "暂无";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

/**
 * 文件大小格式化。
 */
function formatFileSize(fileSize: string) {
  const size = Number(fileSize);
  if (!Number.isFinite(size)) {
    return fileSize;
  }

  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  if (size < 1024 * 1024 * 1024) {
    return `${(size / (1024 * 1024)).toFixed(1)} MB`;
  }

  return `${(size / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * 统一错误文案。
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
  () => kbId.value,
  () => {
    void loadPage();
  },
  { immediate: true },
);

watch(
  documentKeyword,
  (value, _, onCleanup) => {
    const timer = window.setTimeout(() => {
      documentView.documentQuery.keyword = value.trim();
      void reloadDocuments();
    }, 280);

    onCleanup(() => {
      window.clearTimeout(timer);
    });
  },
  { flush: "post" },
);

watch(
  () => settingsForm.visibility,
  (visibility) => {
    if (visibility === "private") {
      settingsForm.isPublic = false;
      settingsForm.allowPublicDownload = false;
    }
  },
);

watch(
  tabs,
  (nextTabs) => {
    if (!nextTabs.some((tab) => tab.key === activeTab.value)) {
      activeTab.value = nextTabs[0]?.key || "documents";
    }
  },
  { immediate: true },
);

watch(activeTab, (tab) => {
  if (tab === "members") {
    void reloadMembers();
  }
});

onMounted(() => {
  void loadPage();
});
</script>

<template>
  <div class="flex flex-col h-full w-full relative bg-surface">
    <header
      class="bg-surface/80 backdrop-blur-xl sticky top-0 z-40 px-6 md:px-8 py-5 border-b border-outline-variant/5"
    >
      <div class="flex flex-col gap-4">
        <div
          class="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4"
        >
          <div class="flex items-start gap-4">
            <button
              @click="goBack"
              class="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-surface-container-high transition-colors focus:outline-none"
            >
              <span
                class="material-symbols-outlined text-on-surface-variant text-xl"
              >
                arrow_back
              </span>
            </button>
            <div v-if="kb">
              <div class="flex flex-wrap items-center gap-2 mb-3">
                <span class="header-chip">
                  {{ kb.visibility === "private" ? "私有" : "共享" }}
                </span>
                <span
                  v-if="kb.isPublic"
                  class="header-chip header-chip-primary"
                >
                  公开访问
                </span>
                <span class="header-chip">
                  {{ roleLabel }}
                </span>
              </div>
              <h2
                class="font-headline text-2xl font-bold tracking-tight text-on-surface"
              >
                {{ kb.name }}
              </h2>
              <p class="text-sm text-on-surface-variant mt-2 max-w-3xl">
                {{
                  kb.description ||
                  "当前知识库暂无描述，可在设置中补充业务边界、成员规则与公开策略。"
                }}
              </p>
            </div>
            <div v-else class="space-y-3">
              <div
                class="h-8 w-56 rounded bg-surface-container-high animate-pulse"
              ></div>
              <div
                class="h-4 w-80 rounded bg-surface-container-high animate-pulse"
              ></div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-3">
            <BaseButton
              v-if="kb?.permissions.canReparse"
              variant="outline"
              @click="reloadDocuments"
            >
              <span class="material-symbols-outlined text-[18px]">sync</span>
              刷新文档
            </BaseButton>
            <BaseButton
              v-if="kb?.permissions.canManageKnowledgeBase"
              variant="outline"
              @click="activeTab = 'settings'"
            >
              <span class="material-symbols-outlined text-[18px]"
                >settings</span
              >
              管理设置
            </BaseButton>
            <BaseButton
              v-if="kb?.permissions.canDelete"
              variant="outline"
              class="hover:!text-error"
              @click="removeKnowledgeBase"
            >
              <span class="material-symbols-outlined text-[18px]">delete</span>
              删除知识库
            </BaseButton>
          </div>
        </div>

        <div class="flex gap-8 border-b border-outline-variant/10">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            type="button"
            class="pb-4 text-sm font-medium transition-colors focus:outline-none"
            :class="
              activeTab === tab.key
                ? 'text-primary border-b-2 border-primary'
                : 'text-on-surface-variant hover:text-on-surface'
            "
            @click="activeTab = tab.key"
          >
            {{ tab.label }}
          </button>
        </div>
      </div>
    </header>

    <div class="flex-1 overflow-y-auto px-6 md:px-8 pb-12 pt-6">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div class="lg:col-span-8 flex flex-col gap-6">
          <template v-if="activeTab === 'documents'">
            <div
              class="bg-surface-container-low p-8 rounded-xl border border-dashed border-outline-variant/20 flex flex-col items-center justify-center group transition-all shadow-md"
              :class="
                canUpload
                  ? 'hover:border-primary/40 cursor-pointer'
                  : 'opacity-80 cursor-not-allowed'
              "
              @click="openFilePicker"
            >
              <input
                ref="fileInputRef"
                type="file"
                class="hidden"
                accept=".pdf,.doc,.docx,.txt,.md"
                @change="handleFileChange"
              />
              <div
                class="w-16 h-16 bg-surface-container-high rounded-full flex items-center justify-center mb-4 transition-transform shadow-inner"
                :class="canUpload ? 'group-hover:scale-110' : ''"
              >
                <span
                  class="material-symbols-outlined text-3xl text-primary drop-shadow-[0_0_8px_rgba(195,192,255,0.5)]"
                >
                  cloud_upload
                </span>
              </div>
              <h3 class="font-headline text-lg font-bold mb-1">
                {{ canUpload ? "上传知识资产" : "当前角色无上传权限" }}
              </h3>
              <p class="text-on-surface-variant text-sm mb-6 text-center">
                {{
                  canUpload
                    ? uploadStatusText
                    : "你可以浏览文档列表，但上传入口仅对有权限的角色开放。"
                }}
              </p>
              <div v-if="state.status !== 'idle'" class="w-full max-w-xl mb-6">
                <div
                  class="w-full bg-surface-container-highest h-2 rounded-full overflow-hidden shadow-inner"
                >
                  <div
                    class="bg-primary h-full rounded-full transition-all duration-300"
                    :style="{ width: `${state.progress}%` }"
                  ></div>
                </div>
                <div
                  class="mt-3 flex items-center justify-between text-xs text-on-surface-variant"
                >
                  <span class="truncate">{{
                    state.fileName || "等待选择文件"
                  }}</span>
                  <span>{{ state.progress }}%</span>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <BaseButton :disabled="!canUpload" @click.stop="openFilePicker">
                  浏览文件
                </BaseButton>
                <BaseButton
                  v-if="isUploading && state.uploadId"
                  variant="outline"
                  @click.stop="cancelCurrentUpload"
                >
                  取消上传
                </BaseButton>
              </div>
            </div>

            <div
              class="bg-surface-container-low rounded-xl overflow-hidden shadow-lg border border-outline-variant/5"
            >
              <div
                class="px-6 py-4 flex flex-col gap-4 border-b border-outline-variant/5 bg-surface-container-high/30"
              >
                <div
                  class="flex flex-col md:flex-row md:items-center md:justify-between gap-3"
                >
                  <h4
                    class="text-sm font-bold uppercase tracking-widest text-on-surface-variant font-label"
                  >
                    当前文件 ({{ documentView.documentPagination.total }})
                  </h4>
                  <div class="relative w-full md:w-80">
                    <span
                      class="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-outline text-lg"
                    >
                      search
                    </span>
                    <input
                      v-model="documentKeyword"
                      type="text"
                      placeholder="搜索文档标题或原文件名"
                      class="w-full bg-surface-container-highest border border-outline-variant/15 rounded-xl pl-12 pr-4 py-2.5 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>
                <div class="flex items-center gap-2 flex-wrap">
                  <button
                    v-for="option in documentStatusFilters"
                    :key="option.value"
                    type="button"
                    class="filter-chip"
                    :class="{
                      'filter-chip-active':
                        documentView.documentQuery.status === option.value,
                    }"
                    @click="setDocumentStatus(option.value)"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>

              <div
                v-if="documentView.documents.value.length"
                class="divide-y divide-outline-variant/5"
              >
                <div
                  v-for="document in documentView.documents.value"
                  :key="document.id"
                  class="px-6 py-5 flex flex-col gap-4 hover:bg-surface-container-high/40 transition-colors"
                >
                  <div class="flex flex-col sm:flex-row sm:items-start gap-4">
                    <div
                      class="w-11 h-11 bg-surface-container-high rounded-xl flex items-center justify-center flex-shrink-0"
                    >
                      <span class="material-symbols-outlined text-primary"
                        >description</span
                      >
                    </div>
                    <div class="flex-1 min-w-0">
                      <div class="flex flex-wrap items-center gap-2 mb-2">
                        <span class="font-semibold text-sm truncate">
                          {{ document.title }}
                        </span>
                        <span
                          class="status-badge"
                          :class="getDocumentStatusClass(document.status)"
                        >
                          {{ getDocumentStatusLabel(document.status) }}
                        </span>
                      </div>
                      <p class="text-xs text-on-surface-variant truncate">
                        原文件：{{ document.originalFilename }}
                      </p>
                      <div
                        class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-on-surface-variant"
                      >
                        <span
                          >大小：{{ formatFileSize(document.fileSize) }}</span
                        >
                        <span>切片：{{ document.chunkCount }}</span>
                        <span
                          >上传者：{{
                            document.uploader?.fullName || "未知"
                          }}</span
                        >
                        <span
                          >更新时间：{{
                            formatDateTime(document.updatedAt)
                          }}</span
                        >
                      </div>
                    </div>
                    <div class="flex items-center gap-2">
                      <BaseButton
                        v-if="kb?.permissions.canDownload"
                        variant="outline"
                        class="!px-3 !py-2"
                        @click="downloadDocument(document)"
                      >
                        下载
                      </BaseButton>
                      <BaseButton
                        v-if="kb?.permissions.canReparse"
                        variant="outline"
                        class="!px-3 !py-2"
                        @click="reparseDocument(document)"
                      >
                        重解析
                      </BaseButton>
                      <BaseButton
                        v-if="
                          kb?.permissions.canDeleteAnyDocument ||
                          kb?.permissions.canDeleteOwnDocument
                        "
                        variant="outline"
                        class="!px-3 !py-2 hover:!text-error"
                        @click="removeDocument(document)"
                      >
                        删除
                      </BaseButton>
                    </div>
                  </div>
                  <div
                    v-if="document.status !== 'ready' && document.currentStage"
                    class="rounded-xl border border-outline-variant/10 bg-surface-container-high/40 px-4 py-3 text-xs text-on-surface-variant"
                  >
                    当前阶段：{{ document.currentStage
                    }}<span v-if="document.errorMessage"
                      >，错误：{{ document.errorMessage }}</span
                    >
                  </div>
                </div>
              </div>

              <div v-else class="px-6 py-14 text-center">
                <div class="text-lg font-headline font-semibold">暂无文档</div>
                <p class="text-sm text-on-surface-variant mt-3">
                  该知识库当前没有符合筛选条件的文档。
                </p>
              </div>
            </div>
          </template>

          <template v-else-if="activeTab === 'members'">
            <div
              class="bg-surface-container-low rounded-xl overflow-hidden shadow-lg border border-outline-variant/5"
            >
              <div class="px-6 py-5 border-b border-outline-variant/5">
                <div
                  class="flex flex-col md:flex-row md:items-center md:justify-between gap-4"
                >
                  <div>
                    <h4 class="text-lg font-headline font-bold">成员管理</h4>
                    <p class="text-sm text-on-surface-variant mt-2">
                      当前后端成员列表接口仅对 `owner / manager` 开放。
                    </p>
                  </div>
                  <BaseButton
                    v-if="canManageMembers"
                    variant="outline"
                    @click="reloadMembers"
                  >
                    刷新成员
                  </BaseButton>
                </div>
              </div>

              <div v-if="canManageMembers" class="p-6 space-y-6">
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-6">
                  <div
                    class="rounded-2xl border border-outline-variant/10 bg-surface-container-high/35 p-5"
                  >
                    <div class="text-sm font-semibold mb-4">创建邀请</div>
                    <div class="space-y-4">
                      <div>
                        <label class="field-label">角色</label>
                        <div class="flex gap-2">
                          <button
                            v-for="role in [
                              'manager',
                              'collaborator',
                              'member',
                            ]"
                            :key="role"
                            type="button"
                            class="filter-chip"
                            :class="{
                              'filter-chip-active': inviteForm.role === role,
                            }"
                            @click="
                              inviteForm.role = role as KnowledgeBaseMemberRole
                            "
                          >
                            {{ role }}
                          </button>
                        </div>
                      </div>
                      <div>
                        <label class="field-label">有效时长（小时）</label>
                        <BaseInput
                          v-model="inviteForm.expiredInHours"
                          type="number"
                          placeholder="72"
                        />
                      </div>
                      <BaseButton @click="createInvitation">
                        生成邀请码
                      </BaseButton>
                    </div>
                  </div>

                  <div
                    class="rounded-2xl border border-outline-variant/10 bg-surface-container-high/35 p-5"
                  >
                    <div class="text-sm font-semibold mb-4">当前成员</div>
                    <div
                      v-if="memberView.members.value.length"
                      class="space-y-3"
                    >
                      <div
                        v-for="member in memberView.members.value"
                        :key="member.userId"
                        class="rounded-xl border border-outline-variant/10 bg-surface-container-lowest/20 px-4 py-3 flex items-center justify-between gap-4"
                      >
                        <div class="min-w-0">
                          <div class="font-medium truncate">
                            {{ member.fullName }}
                          </div>
                          <div
                            class="text-xs text-on-surface-variant mt-1 truncate"
                          >
                            {{ member.email }} ·
                            {{ getMemberRoleLabel(member.role) }}
                          </div>
                        </div>
                        <BaseButton
                          v-if="member.role !== 'owner'"
                          variant="outline"
                          class="!px-3 !py-2"
                          @click="removeMember(member)"
                        >
                          移除
                        </BaseButton>
                      </div>
                    </div>
                    <div v-else class="text-sm text-on-surface-variant">
                      当前没有额外成员。
                    </div>
                  </div>
                </div>

                <div
                  class="rounded-2xl border border-outline-variant/10 bg-surface-container-high/35 p-5"
                >
                  <div class="text-sm font-semibold mb-4">有效邀请码</div>
                  <div
                    v-if="memberView.invitations.value.length"
                    class="space-y-3"
                  >
                    <div
                      v-for="invitation in memberView.invitations.value"
                      :key="invitation.id"
                      class="rounded-xl border border-outline-variant/10 bg-surface-container-lowest/20 px-4 py-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4"
                    >
                      <div class="min-w-0">
                        <div class="font-mono text-sm text-primary truncate">
                          {{ invitation.inviteCode }}
                        </div>
                        <div class="text-xs text-on-surface-variant mt-2">
                          角色：{{ invitation.role }} · 失效时间：{{
                            formatDateTime(invitation.expiresAt)
                          }}
                        </div>
                      </div>
                      <div class="flex items-center gap-2">
                        <BaseButton
                          variant="outline"
                          class="!px-3 !py-2"
                          @click="copyInviteCode(invitation.inviteCode)"
                        >
                          复制
                        </BaseButton>
                        <BaseButton
                          variant="outline"
                          class="!px-3 !py-2 hover:!text-error"
                          @click="cancelInvitation(invitation)"
                        >
                          取消
                        </BaseButton>
                      </div>
                    </div>
                  </div>
                  <div v-else class="text-sm text-on-surface-variant">
                    当前没有有效邀请码。
                  </div>
                </div>

                <p v-if="memberError" class="text-sm text-error">
                  {{ memberError }}
                </p>
              </div>

              <div v-else class="px-6 py-14 text-center">
                <div class="text-lg font-headline font-semibold">
                  当前角色无成员管理权限
                </div>
                <p class="text-sm text-on-surface-variant mt-3">
                  后端当前只对 `owner / manager`
                  开放成员与邀请列表接口，因此这里展示只读提示。
                </p>
              </div>
            </div>
          </template>

          <template v-else-if="activeTab === 'settings'">
            <div
              class="bg-surface-container-low rounded-xl overflow-hidden shadow-lg border border-outline-variant/5"
            >
              <div class="px-6 py-5 border-b border-outline-variant/5">
                <h4 class="text-lg font-headline font-bold">知识库设置</h4>
                <p class="text-sm text-on-surface-variant mt-2">
                  owner 可编辑核心配置，manager 当前展示只读概览。
                </p>
              </div>

              <div class="p-6 space-y-5">
                <div>
                  <label class="field-label">知识库名称</label>
                  <BaseInput
                    v-model="settingsForm.name"
                    :disabled="!canManageKnowledgeBase"
                    placeholder="请输入知识库名称"
                  />
                </div>
                <div>
                  <label class="field-label">知识库描述</label>
                  <textarea
                    v-model="settingsForm.description"
                    rows="4"
                    :disabled="!canManageKnowledgeBase"
                    class="w-full bg-surface-container-highest border border-outline-variant/20 rounded-lg px-4 py-3 text-sm text-on-surface placeholder:text-outline/40 focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 transition-all disabled:opacity-60"
                    placeholder="请输入知识库描述"
                  ></textarea>
                </div>
                <div class="grid grid-cols-1 xl:grid-cols-2 gap-5">
                  <div
                    class="rounded-2xl border border-outline-variant/10 bg-surface-container-high/35 p-5"
                  >
                    <div class="field-label">可见性</div>
                    <div class="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        class="visibility-card"
                        :class="{
                          'visibility-card-active':
                            settingsForm.visibility === 'private',
                        }"
                        :disabled="!canManageKnowledgeBase"
                        @click="settingsForm.visibility = 'private'"
                      >
                        私有
                      </button>
                      <button
                        type="button"
                        class="visibility-card"
                        :class="{
                          'visibility-card-active':
                            settingsForm.visibility === 'shared',
                        }"
                        :disabled="!canManageKnowledgeBase"
                        @click="settingsForm.visibility = 'shared'"
                      >
                        共享
                      </button>
                    </div>
                  </div>
                  <div
                    class="rounded-2xl border border-outline-variant/10 bg-surface-container-high/35 p-5"
                  >
                    <div class="field-label">共享策略</div>
                    <label class="toggle-row">
                      <input
                        v-model="settingsForm.isPublic"
                        type="checkbox"
                        :disabled="
                          !canManageKnowledgeBase ||
                          settingsForm.visibility !== 'shared'
                        "
                      />
                      <span>允许公开访问</span>
                    </label>
                    <label class="toggle-row">
                      <input
                        v-model="settingsForm.allowPublicDownload"
                        type="checkbox"
                        :disabled="
                          !canManageKnowledgeBase ||
                          settingsForm.visibility !== 'shared'
                        "
                      />
                      <span>允许公开下载</span>
                    </label>
                  </div>
                </div>

                <p v-if="settingsError" class="text-sm text-error">
                  {{ settingsError }}
                </p>

                <div class="flex justify-end">
                  <BaseButton
                    :disabled="
                      !canManageKnowledgeBase || documentView.isMutating.value
                    "
                    @click="saveSettings"
                  >
                    {{
                      documentView.isMutating.value ? "保存中..." : "保存设置"
                    }}
                  </BaseButton>
                </div>
              </div>
            </div>
          </template>
        </div>

        <div class="lg:col-span-4 flex flex-col gap-6">
          <div
            class="bg-surface-container-low rounded-xl p-6 relative overflow-hidden shadow-lg border border-outline-variant/5"
          >
            <div class="absolute -right-4 -top-4 opacity-5">
              <span class="material-symbols-outlined text-[120px]"
                >database</span
              >
            </div>
            <h4
              class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-label mb-6"
            >
              知识库概览
            </h4>
            <div v-if="kb" class="space-y-6 relative z-10">
              <div>
                <div class="flex justify-between items-end mb-2">
                  <span
                    class="text-3xl font-headline font-bold text-primary drop-shadow-[0_0_8px_rgba(195,192,255,0.2)]"
                  >
                    {{ kb.documentCount }}
                  </span>
                  <span class="text-xs text-on-surface-variant">文档总数</span>
                </div>
                <div
                  class="w-full bg-surface-container-highest h-1.5 rounded-full overflow-hidden shadow-inner"
                >
                  <div
                    class="bg-primary h-full shadow-[0_0_8px_var(--color-primary)]"
                    :style="{
                      width: `${Math.min(100, Math.max(12, kb.documentCount * 8))}%`,
                    }"
                  ></div>
                </div>
              </div>
              <div class="grid grid-cols-2 gap-4">
                <div class="info-card">
                  <p class="info-card-label">成员数量</p>
                  <p class="info-card-value">{{ kb.memberCount }}</p>
                </div>
                <div class="info-card">
                  <p class="info-card-label">当前角色</p>
                  <p class="info-card-value">{{ roleLabel }}</p>
                </div>
              </div>
              <div
                class="rounded-xl border border-outline-variant/10 bg-surface-container-high/40 px-4 py-4"
              >
                <div
                  class="text-xs uppercase tracking-[0.22em] text-outline mb-2"
                >
                  最近更新时间
                </div>
                <div class="text-sm text-on-surface">
                  {{ formatDateTime(kb.updatedAt) }}
                </div>
              </div>
            </div>
          </div>

          <div
            class="bg-surface-container-low rounded-xl p-6 shadow-lg border border-outline-variant/5"
          >
            <h4
              class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-label mb-4"
            >
              当前处理状态
            </h4>
            <div v-if="documentView.documents.value.length" class="space-y-3">
              <div
                v-for="document in documentView.documents.value.slice(0, 4)"
                :key="document.id"
                class="rounded-xl border border-outline-variant/10 bg-surface-container-high/35 px-4 py-3"
              >
                <div class="flex items-center justify-between gap-3">
                  <div class="min-w-0">
                    <div class="text-sm font-medium truncate">
                      {{ document.title }}
                    </div>
                    <div class="text-xs text-on-surface-variant mt-1">
                      {{
                        document.currentStage ||
                        getDocumentStatusLabel(document.status)
                      }}
                    </div>
                  </div>
                  <span
                    class="status-badge"
                    :class="getDocumentStatusClass(document.status)"
                  >
                    {{ getDocumentStatusLabel(document.status) }}
                  </span>
                </div>
              </div>
            </div>
            <div v-else class="text-sm text-on-surface-variant">
              当前还没有可展示的文档处理状态。
            </div>
          </div>

          <div
            class="bg-surface-container-low rounded-xl p-6 shadow-lg border border-outline-variant/5"
          >
            <h4
              class="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant font-label mb-4"
            >
              联调提示
            </h4>
            <div class="space-y-4 text-sm text-on-surface-variant leading-6">
              <p>
                当前页已接入真实知识库详情、文档列表、设置写入和成员管理接口。
              </p>
              <p>
                成员列表与邀请列表目前受后端权限约束，仅 owner / manager
                可查看。
              </p>
              <p>
                后续建议继续补齐页面截图、公开访客视角和更细的成员只读展示。
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.header-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.25rem 0.6rem;
  background: color-mix(in srgb, var(--color-outline-variant) 16%, transparent);
  color: var(--color-on-surface-variant);
  font-size: 0.68rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.header-chip-primary {
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  color: var(--color-primary);
}

.filter-chip {
  border-radius: 999px;
  padding: 0.4rem 0.8rem;
  font-size: 0.78rem;
  color: var(--color-on-surface-variant);
  background: color-mix(
    in srgb,
    var(--color-surface-container-low) 74%,
    transparent
  );
  border: 1px solid transparent;
  transition: all 0.2s ease;
}

.filter-chip-active {
  color: var(--color-primary);
  border-color: color-mix(in srgb, var(--color-primary) 30%, transparent);
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
}

.status-badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.22rem 0.56rem;
  font-size: 0.65rem;
  font-weight: 800;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.status-badge-ready {
  background: color-mix(in srgb, var(--color-secondary) 14%, transparent);
  color: var(--color-secondary);
}

.status-badge-processing {
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  color: var(--color-primary);
}

.status-badge-failed {
  background: color-mix(in srgb, var(--color-error) 15%, transparent);
  color: var(--color-error);
}

.field-label {
  display: inline-flex;
  margin-bottom: 0.65rem;
  font-size: 0.76rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: var(--color-outline);
}

.visibility-card {
  border-radius: 1rem;
  border: 1px solid
    color-mix(in srgb, var(--color-outline-variant) 18%, transparent);
  background: color-mix(
    in srgb,
    var(--color-surface-container-low) 80%,
    transparent
  );
  padding: 1rem;
  transition: all 0.2s ease;
}

.visibility-card-active {
  color: var(--color-primary);
  border-color: color-mix(in srgb, var(--color-primary) 30%, transparent);
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
}

.toggle-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  color: var(--color-on-surface);
}

.toggle-row + .toggle-row {
  margin-top: 0.9rem;
}

.info-card {
  border-radius: 1rem;
  border: 1px solid
    color-mix(in srgb, var(--color-outline-variant) 14%, transparent);
  background: color-mix(
    in srgb,
    var(--color-surface-container-high) 72%,
    transparent
  );
  padding: 1rem;
}

.info-card-label {
  color: var(--color-outline);
  font-size: 0.68rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  margin-bottom: 0.35rem;
}

.info-card-value {
  font-family: var(--font-headline);
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--color-on-surface);
}
</style>
