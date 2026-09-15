<script setup lang="ts">
/**
 * 知识库详情页 — 顶层编排器，委托渲染到三个子面板。
 */
import { computed, reactive, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import BaseButton from "@/components/ui/BaseButton.vue";
import { useKnowledgeBaseDetail } from "@/composables/useKnowledgeBaseDetail";
import { useKbMembers } from "@/composables/useKbMembers";
import { useMessage } from "@/composables/useMessage";
import { useGlobalConfirmDialog } from "@/composables/useGlobalConfirmDialog";
import { useUploadQueue } from "@/modules/document-upload/composables/useUploadQueue";
import {
  joinKnowledgeBaseByInvite,
  joinPublicKnowledgeBase,
  leaveKnowledgeBase,
} from "@/api/kb-member";
import KbMemberPanel from "./KbMemberPanel.vue";
import KbSettingsPanel from "./KbSettingsPanel.vue";
import KbDocumentPanel from "./KbDocumentPanel.vue";
import DocumentPreviewModal from "@/components/document/DocumentPreviewModal.vue";
import { ApiError } from "@/types/api";
import type {
  KnowledgeBaseDetail,
  KnowledgeBaseInvitationItem,
  KnowledgeBaseMemberItem,
  KnowledgeBaseMemberRole,
  KnowledgeBaseDocumentItem,
  KnowledgeBaseDocumentStatus,
} from "@/types/knowledge-base";

const router = useRouter();
const route = useRoute();
const message = useMessage();
const { confirm } = useGlobalConfirmDialog();

const activeTab = ref<"overview" | "members" | "settings">("overview");

const documentView = useKnowledgeBaseDetail();
const memberView = useKbMembers();
const uploadQueue = useUploadQueue();
const fileInput = ref<HTMLInputElement | null>(null);
const previewDocument = ref<KnowledgeBaseDocumentItem | null>(null);

const settingsForm = reactive({
  name: "",
  description: "",
  visibility: "private" as "private" | "collaborative" | "public",
  allowPublicDownload: false,
});
const settingsError = ref("");
const memberError = ref("");
const showJoinDialog = ref(false);
const joinInviteCode = ref("");
const joinError = ref("");
const joinLoading = ref(false);

const kbId = computed(() => String(route.params.id || ""));
const kb = computed(() => documentView.kb.value);

const canManageMembers = computed(
  () => kb.value?.permissions.canManageMembers === true,
);
const isPublicVisitor = computed(
  () => kb.value?.accessRole === "publicVisitor",
);
const canLeave = computed(() => {
  const role = kb.value?.accessRole;
  return role === "manager" || role === "collaborator" || role === "member";
});

const roleLabel = computed(() => {
  const map: Record<string, string> = {
    owner: "拥有者",
    manager: "管理员",
    collaborator: "协作者",
    member: "成员",
    publicVisitor: "公开访问",
  };
  return kb.value ? (map[kb.value.accessRole] ?? "") : "";
});

const tabs = computed(() => {
  const result: Array<{
    key: "overview" | "members" | "settings";
    label: string;
  }> = [{ key: "overview", label: "概览" }];
  if (canManageMembers.value) result.push({ key: "members", label: "成员" });
  if (
    kb.value &&
    (kb.value.accessRole === "owner" || kb.value.accessRole === "manager")
  )
    result.push({ key: "settings", label: "设置" });
  return result;
});

// ── 数据加载 ──

async function loadPage() {
  if (!kbId.value) return;
  try {
    await documentView.reload(kbId.value);
    syncSettingsForm(documentView.kb.value);
    if (canManageMembers.value) {
      await memberView.reload(kbId.value);
    }
  } catch (error) {
    message.error(resolveErrorMessage(error, "知识库详情加载失败"));
  }
}

function syncSettingsForm(detail: KnowledgeBaseDetail | null) {
  if (!detail) return;
  settingsForm.name = detail.name;
  settingsForm.description = detail.description || "";
  settingsForm.visibility = detail.visibility;
  settingsForm.allowPublicDownload = detail.allowPublicDownload;
}

watch(
  () => kbId.value,
  () => {
    void loadPage();
  },
  { immediate: true },
);

uploadQueue.setCompletedHandler(() => {
  if (!kbId.value) return;
  void Promise.all([
    documentView.fetchKnowledgeBase(kbId.value),
    documentView.fetchDocuments(kbId.value),
  ]);
});

watch(
  () => settingsForm.visibility,
  (val) => {
    if (val !== "public") settingsForm.allowPublicDownload = false;
  },
);

// ── 导航 ──

function goBack() {
  router.back();
}

function openFilePicker() {
  fileInput.value?.click();
}

function handleFileInput(event: Event) {
  const input = event.target as HTMLInputElement;
  if (input.files?.length) handleFiles(input.files);
  input.value = "";
}

function handleFiles(files: FileList | File[]) {
  const accepted = [".pdf", ".docx", ".txt", ".md"];
  const valid = Array.from(files).filter((file) => {
    const extension = file.name.slice(file.name.lastIndexOf(".")).toLowerCase();
    if (!accepted.includes(extension)) {
      message.error(`${file.name}：不支持的文件类型`);
      return false;
    }
    if (file.size < 1 || file.size > 20 * 1024 * 1024) {
      message.error(`${file.name}：文件必须大于 0 且不超过 20MB`);
      return false;
    }
    return true;
  });
  if (valid.length) uploadQueue.enqueue(valid, kbId.value);
}

function setDocumentStatus(status: KnowledgeBaseDocumentStatus | "all") {
  documentView.documentQuery.status = status;
  documentView.documentPagination.page = 1;
  void documentView.fetchDocuments(kbId.value);
}

function searchDocuments(keyword: string) {
  documentView.documentQuery.keyword = keyword;
  documentView.documentPagination.page = 1;
  void documentView.fetchDocuments(kbId.value);
}

async function removeDocument(document: KnowledgeBaseDocumentItem) {
  const confirmed = await confirm({
    title: "删除文档",
    message: `确认删除文档“${document.title}”吗？源文件也会被清理。`,
  });
  if (!confirmed) return;
  try {
    await documentView.removeDocument(kbId.value, document.id);
    message.success("文档已进入删除队列");
    await documentView.fetchKnowledgeBase(kbId.value);
  } catch (error) {
    message.error(resolveErrorMessage(error, "删除文档失败"));
  }
}

async function updateDocument(
  document: KnowledgeBaseDocumentItem,
  currentTitle: string,
) {
  const title = window.prompt("请输入新的文档标题", currentTitle)?.trim();
  if (!title || title === currentTitle) return;
  if (title.length > 255) {
    message.error("文档标题不能超过 255 个字符");
    return;
  }
  try {
    await documentView.updateDocument(kbId.value, document.id, title);
    message.success("文档标题已更新");
  } catch (error) {
    message.error(resolveErrorMessage(error, "修改文档标题失败"));
  }
}

async function downloadDocument(document: KnowledgeBaseDocumentItem) {
  try {
    const result = await documentView.downloadDocument(kbId.value, document.id);
    const url = URL.createObjectURL(result.blob);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download =
      result.fileName || document.originalFilename || document.title;
    anchor.click();
    URL.revokeObjectURL(url);
  } catch (error) {
    message.error(resolveErrorMessage(error, "下载文档失败"));
  }
}

// ── 成员操作 ──

async function reloadMembers() {
  try {
    await memberView.reload(kbId.value);
  } catch (error) {
    memberError.value = resolveErrorMessage(error, "成员数据加载失败");
  }
}

async function createInvitation(role: KnowledgeBaseMemberRole) {
  memberError.value = "";
  try {
    const invitation = await memberView.createInvitation(kbId.value, {
      role,
      expiredInHours: 72,
    });
    await navigator.clipboard?.writeText(invitation.inviteCode);
    message.success("邀请码已生成并复制到剪贴板");
  } catch (error) {
    memberError.value = resolveErrorMessage(error, "创建邀请码失败");
  }
}

async function cancelInvitation(invitation: KnowledgeBaseInvitationItem) {
  try {
    await memberView.cancelInvitation(kbId.value, invitation.id);
    message.success("邀请码已取消");
  } catch (error) {
    memberError.value = resolveErrorMessage(error, "取消邀请码失败");
  }
}

async function removeMember(member: KnowledgeBaseMemberItem) {
  const confirmed = await confirm({
    title: "移除成员",
    message: `确认移除成员"${member.fullName}"吗？`,
  });
  if (!confirmed) return;
  try {
    await memberView.removeMember(kbId.value, member.userId);
    message.success("成员已移除");
  } catch (error) {
    memberError.value = resolveErrorMessage(error, "移除成员失败");
  }
}

async function updateMemberRole(
  member: KnowledgeBaseMemberItem,
  role: KnowledgeBaseMemberRole,
) {
  try {
    await memberView.updateMemberRole(kbId.value, member.userId, role);
    message.success("成员角色已更新");
  } catch (error) {
    memberError.value = resolveErrorMessage(error, "角色更新失败");
  }
}

// ── 加入操作 ──

async function joinPublic() {
  joinLoading.value = true;
  try {
    await joinPublicKnowledgeBase(kbId.value);
    message.success("已成功加入知识库");
    await loadPage();
  } catch (error) {
    message.error(resolveErrorMessage(error, "加入知识库失败"));
  } finally {
    joinLoading.value = false;
  }
}

async function leaveKb() {
  const confirmed = await confirm({
    title: "退出知识库",
    message: `确认退出知识库"${kb.value?.name}"吗？退出后你将失去访问权限。`,
  });
  if (!confirmed) return;
  joinLoading.value = true;
  try {
    await leaveKnowledgeBase(kbId.value);
    message.success("已退出知识库");
    router.push("/kb");
  } catch (error) {
    message.error(resolveErrorMessage(error, "退出知识库失败"));
  } finally {
    joinLoading.value = false;
  }
}

async function handleJoinByInvite() {
  joinError.value = "";
  const code = joinInviteCode.value.trim();
  if (!code) {
    joinError.value = "请输入邀请码";
    return;
  }
  joinLoading.value = true;
  try {
    await joinKnowledgeBaseByInvite({ inviteCode: code });
    message.success("已成功加入知识库");
    showJoinDialog.value = false;
    joinInviteCode.value = "";
    await loadPage();
  } catch (error) {
    joinError.value = resolveErrorMessage(error, "加入知识库失败");
  } finally {
    joinLoading.value = false;
  }
}

function validateSettingsForm() {
  const name = settingsForm.name.trim();
  if (!name) return "知识库名称不能为空";
  if (name.length > 20) return "知识库名称不能超过 20 个字符";
  if (settingsForm.description.trim().length > 200)
    return "知识库描述不能超过 200 个字符";
  return "";
}

async function saveSettings() {
  settingsError.value = validateSettingsForm();
  if (settingsError.value || !kbId.value) return;
  try {
    await documentView.updateSettings(kbId.value, {
      name: settingsForm.name.trim(),
      description: settingsForm.description.trim() || undefined,
      visibility: settingsForm.visibility,
      allowPublicDownload:
        settingsForm.visibility === "public"
          ? settingsForm.allowPublicDownload
          : false,
    });
    message.success("知识库设置已更新");
  } catch (error) {
    settingsError.value = resolveErrorMessage(error, "知识库设置保存失败");
  }
}

async function removeKnowledgeBase() {
  const confirmed = await confirm({
    title: "删除知识库",
    message: `确认删除知识库"${kb.value?.name}"吗？`,
  });
  if (!confirmed) return;
  try {
    await documentView.removeKnowledgeBaseItem(kbId.value);
    message.success("知识库已删除");
    router.push("/kb");
  } catch (error) {
    message.error(resolveErrorMessage(error, "删除知识库失败"));
  }
}

// ── 工具 ──

function resolveErrorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return fallback;
}
</script>

<template>
  <div class="flex flex-col h-full w-full relative bg-surface">
    <!-- 头部 -->
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
              class="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-surface-container-high transition-colors"
            >
              <span
                class="material-symbols-outlined text-on-surface-variant text-xl"
                >arrow_back</span
              >
            </button>
            <div v-if="kb">
              <div class="flex flex-wrap items-center gap-2 mb-3">
                <span class="header-chip">{{
                  kb.visibility === "private"
                    ? "私有"
                    : kb.visibility === "collaborative"
                      ? "协作"
                      : "公开"
                }}</span>
                <span
                  v-if="kb.visibility === 'public'"
                  class="header-chip header-chip-primary"
                  >公开访问</span
                >
                <span class="header-chip">{{ roleLabel }}</span>
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
              />
              <div
                class="h-4 w-80 rounded bg-surface-container-high animate-pulse"
              />
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <BaseButton
              v-if="isPublicVisitor && kb?.visibility === 'public'"
              variant="primary"
              :disabled="joinLoading"
              @click="joinPublic"
            >
              <span class="material-symbols-outlined text-[18px]"
                >person_add</span
              >
              {{ joinLoading ? "加入中..." : "加入" }}
            </BaseButton>
            <BaseButton
              v-if="canLeave"
              variant="outline"
              class="hover:!text-error"
              @click="leaveKb"
            >
              <span class="material-symbols-outlined text-[18px]">logout</span>
              退出
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
            class="pb-4 text-sm font-medium transition-colors"
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

    <!-- 主内容区 -->
    <div class="flex-1 overflow-y-auto px-6 md:px-8 pb-12 pt-6">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div class="lg:col-span-8 flex flex-col gap-6">
          <KbDocumentPanel
            v-if="activeTab === 'overview'"
            :can-upload="kb?.permissions.canUpload === true"
            :documents="documentView.documents.value"
            :total-count="documentView.documentPagination.total"
            :active-status="documentView.documentQuery.status"
            :queue-tasks="uploadQueue.tasks.value"
            :queue-progress="uploadQueue.overallProgress.value"
            :queue-busy="uploadQueue.isBusy.value"
            :can-download="kb?.permissions.canDownload === true"
            :can-delete-any-document="
              kb?.permissions.canDeleteAnyDocument === true
            "
            :can-delete-own-document="
              kb?.permissions.canDeleteOwnDocument === true
            "
            @open-file-picker="openFilePicker"
            @drop-file="handleFiles"
            @pause-all="uploadQueue.pauseAll"
            @resume-all="uploadQueue.resumeAll"
            @clear-completed="uploadQueue.clearCompleted"
            @retry-task="uploadQueue.retryTask"
            @cancel-task="uploadQueue.cancelTask"
            @set-status="setDocumentStatus"
            @update-search-keyword="searchDocuments"
            @preview-document="previewDocument = $event"
            @download-document="downloadDocument"
            @remove-document="removeDocument"
            @update-document="updateDocument"
          />

          <KbMemberPanel
            v-else-if="activeTab === 'members'"
            :members="memberView.members.value"
            :member-count="kb?.memberCount || 0"
            :invitations="memberView.invitations.value"
            :error="memberError"
            :can-manage="canManageMembers"
            @reload="reloadMembers"
            @create-invitation="createInvitation"
            @cancel-invitation="cancelInvitation"
            @remove-member="removeMember"
            @update-role="updateMemberRole"
          />

          <KbSettingsPanel
            v-else-if="activeTab === 'settings'"
            :name="settingsForm.name"
            :description="settingsForm.description"
            :visibility="settingsForm.visibility"
            :allow-public-download="settingsForm.allowPublicDownload"
            :error="settingsError"
            :is-saving="documentView.isMutating.value"
            :can-delete="kb?.permissions.canDelete === true"
            @update:name="settingsForm.name = $event"
            @update:description="settingsForm.description = $event"
            @update:visibility="settingsForm.visibility = $event"
            @update:allow-public-download="
              settingsForm.allowPublicDownload = $event
            "
            @save="saveSettings"
            @delete="removeKnowledgeBase"
          />
        </div>

        <!-- 侧边栏 -->
        <aside class="lg:col-span-4 flex flex-col gap-5">
          <div
            v-if="kb"
            class="bg-surface-container-low rounded-xl p-5 shadow-inner border border-outline-variant/5 space-y-4"
          >
            <div class="flex items-center justify-between">
              <span class="text-xs text-on-surface-variant">文档总数</span>
              <span class="font-bold text-lg">{{ kb.documentCount }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-xs text-on-surface-variant">成员数量</span>
              <span class="font-bold text-lg">{{ kb.memberCount }}</span>
            </div>
          </div>
          <div
            v-if="!kb"
            class="bg-surface-container-low rounded-xl p-5 text-xs text-outline"
          >
            当前还没有可展示的文档处理状态。
          </div>
        </aside>
      </div>
    </div>

    <input
      ref="fileInput"
      class="hidden"
      type="file"
      multiple
      accept=".pdf,.docx,.txt,.md"
      @change="handleFileInput"
    />

    <DocumentPreviewModal
      v-if="previewDocument"
      :open="Boolean(previewDocument)"
      :kb-id="kbId"
      :document-id="previewDocument.id"
      :file-name="previewDocument.originalFilename || previewDocument.title"
      :file-type="previewDocument.fileExtension || ''"
      @close="previewDocument = null"
    />

    <!-- 加入知识库弹窗 -->
    <div
      v-if="showJoinDialog"
      class="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex items-center justify-center px-4"
      @click.self="showJoinDialog = false"
    >
      <div
        class="w-full max-w-md rounded-[20px] border border-outline-variant/10 bg-surface-container-low shadow-[0_28px_120px_rgba(0,0,0,0.35)]"
      >
        <div class="px-6 py-5 border-b border-outline-variant/10">
          <div class="flex items-center justify-between gap-4">
            <h3 class="font-headline text-lg font-bold">加入知识库</h3>
            <button
              type="button"
              class="w-8 h-8 rounded-xl hover:bg-surface-container-high transition-colors flex items-center justify-center text-on-surface-variant"
              @click="
                showJoinDialog = false;
                joinInviteCode = '';
                joinError = '';
              "
            >
              <span class="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>
        <div class="px-6 py-5 space-y-4">
          <p class="text-sm text-on-surface-variant">
            输入邀请码以加入此知识库，获取更多权限。
          </p>
          <div>
            <input
              v-model="joinInviteCode"
              type="text"
              placeholder="请输入邀请码"
              class="w-full bg-surface-container-highest border border-outline-variant/15 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              @keyup.enter="handleJoinByInvite"
            />
            <p v-if="joinError" class="text-sm text-error mt-2">
              {{ joinError }}
            </p>
          </div>
        </div>
        <div
          class="px-6 py-5 border-t border-outline-variant/10 flex items-center justify-end gap-3"
        >
          <button
            class="px-4 py-2 rounded-lg text-sm text-outline hover:bg-surface-container-high transition-colors"
            @click="
              showJoinDialog = false;
              joinInviteCode = '';
              joinError = '';
            "
          >
            取消
          </button>
          <button
            class="px-4 py-2 rounded-lg text-sm font-medium bg-primary-container text-on-primary-container hover:brightness-110 transition-all disabled:opacity-50"
            :disabled="joinLoading"
            @click="handleJoinByInvite"
          >
            {{ joinLoading ? "加入中..." : "加入" }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
