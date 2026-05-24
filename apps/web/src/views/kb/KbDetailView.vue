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
import { useChunkUpload } from "@/modules/document-upload/composables/useChunkUpload";
import DocumentPreviewModal from "@/components/document/DocumentPreviewModal.vue";
import KbDocumentPanel from "./KbDocumentPanel.vue";
import KbMemberPanel from "./KbMemberPanel.vue";
import KbSettingsPanel from "./KbSettingsPanel.vue";
import { ApiError } from "@/types/api";
import type {
  KnowledgeBaseDetail,
  KnowledgeBaseDocumentItem,
  KnowledgeBaseDocumentStatus,
  KnowledgeBaseInvitationItem,
  KnowledgeBaseMemberItem,
  KnowledgeBaseMemberRole,
} from "@/types/knowledge-base";

const router = useRouter();
const route = useRoute();
const message = useMessage();
const { confirm } = useGlobalConfirmDialog();

const fileInputRef = ref<HTMLInputElement | null>(null);
const activeTab = ref<"documents" | "members" | "settings">("documents");
const documentKeyword = ref("");
const previewOpen = ref(false);
const previewDoc = ref<KnowledgeBaseDocumentItem | null>(null);

const documentView = useKnowledgeBaseDetail();
const memberView = useKbMembers();
const { state, isUploading, startUpload, cancel, resetState } = useChunkUpload();

const settingsForm = reactive({
  name: "",
  description: "",
  visibility: "private" as "private" | "shared",
  isPublic: false,
  allowPublicDownload: false,
});
const settingsError = ref("");
const memberError = ref("");

const kbId = computed(() => String(route.params.id || ""));
const kb = computed(() => documentView.kb.value);

const canUpload = computed(() => kb.value?.permissions.canUpload === true);
const canManageMembers = computed(() => kb.value?.permissions.canManageMembers === true);

const roleLabel = computed(() => {
  const map: Record<string, string> = { owner: "拥有者", manager: "管理员", collaborator: "协作者", member: "成员", publicVisitor: "公开访问" };
  return kb.value ? map[kb.value.accessRole] ?? "" : "";
});

const tabs = computed(() => {
  const result: Array<{ key: "documents" | "members" | "settings"; label: string }> = [{ key: "documents", label: "文档" }];
  if (kb.value?.visibility === "shared") result.push({ key: "members", label: "成员" });
  if (kb.value && (kb.value.accessRole === "owner" || kb.value.accessRole === "manager")) result.push({ key: "settings", label: "设置" });
  return result;
});

// ── 数据加载 ──

async function loadPage() {
  if (!kbId.value) return;
  try {
    await documentView.reload(kbId.value);
    syncSettingsForm(documentView.kb.value);
    if (kb.value?.visibility === "shared") {
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
  settingsForm.isPublic = detail.isPublic;
  settingsForm.allowPublicDownload = detail.allowPublicDownload;
}

watch(() => kbId.value, (newId, oldId) => {
  if (oldId) documentView.disconnectDocumentStream();
  if (newId) documentView.connectDocumentStream(newId);
  void loadPage();
}, { immediate: true });

watch(documentKeyword, (value, _, onCleanup) => {
  const timer = window.setTimeout(() => {
    documentView.documentQuery.keyword = value.trim();
    void reloadDocuments();
  }, 280);
  onCleanup(() => window.clearTimeout(timer));
});

watch(() => settingsForm.visibility, (val) => {
  if (val === "private") { settingsForm.isPublic = false; settingsForm.allowPublicDownload = false; }
});

// ── 导航 ──

function goBack() { router.back(); }

// ── 文档操作 ──

const SUPPORTED_EXTENSIONS = ['.pdf', '.doc', '.docx', '.txt', '.md'] as const;

function validateFileType(file: File): boolean {
  const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
  if (!(SUPPORTED_EXTENSIONS as readonly string[]).includes(ext)) {
    message.warning(`不支持的文件类型（${ext}），仅支持 PDF、Word、TXT、Markdown`);
    return false;
  }
  return true;
}

async function uploadFiles(files: File[]) {
  if (!kbId.value) return;
  const valid = files.filter((f) => validateFileType(f));
  if (!valid.length) return;

  let successCount = 0;
  for (const file of valid) {
    try {
      await startUpload({ file, kbId: kbId.value });
      successCount++;
      resetState();
    } catch { /* handled by store */ }
  }
  if (successCount > 0) {
    message.success(`${successCount} 个文档上传成功，已进入处理流水线`);
    void reloadDocuments();
  }
}

function openFilePicker() {
  if (!canUpload.value) return;
  fileInputRef.value?.click();
}

async function handleFileChange(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = input.files ? [...input.files] : [];
  input.value = '';
  if (!files.length) return;
  await uploadFiles(files);
}

function handleDropFile(files: FileList | File[]) {
  if (!canUpload.value) return;
  uploadFiles([...files]);
}

async function cancelCurrentUpload() {
  if (state.uploadId) await cancel(state.uploadId);
}

function setDocumentStatus(status: KnowledgeBaseDocumentStatus | "all") {
  documentView.documentQuery.status = status;
  void reloadDocuments();
}

async function reloadDocuments() {
  try {
    await documentView.fetchDocuments(kbId.value);
  } catch (error) {
    message.error(resolveErrorMessage(error, "文档列表加载失败"));
  }
}

async function removeDocument(doc: KnowledgeBaseDocumentItem) {
  const confirmed = await confirm({ title: '删除文档', message: `确认删除文档"${doc.title}"吗？` });
  if (!confirmed) return;
  try {
    await documentView.removeDocument(kbId.value, doc.id);
    message.success("文档已删除");
  } catch (error) {
    message.error(resolveErrorMessage(error, "文档删除失败"));
  }
}

async function reparseDocument(doc: KnowledgeBaseDocumentItem) {
  try {
    await documentView.reparseDocument(kbId.value, doc.id);
    message.success("已提交重解析请求");
  } catch (error) {
    message.error(resolveErrorMessage(error, "重解析失败"));
  }
}

function previewDocument(doc: KnowledgeBaseDocumentItem) {
  previewDoc.value = doc;
  previewOpen.value = true;
}

async function downloadDocument(doc: KnowledgeBaseDocumentItem) {
  try {
    const payload = await documentView.downloadDocument(kbId.value, doc.id);
    const anchor = window.document.createElement("a");
    anchor.href = window.URL.createObjectURL(payload.blob);
    anchor.download = payload.fileName || doc.title;
    anchor.click();
    anchor.remove();
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
    const invitation = await memberView.createInvitation(kbId.value, { role, expiredInHours: 72 });
    await navigator.clipboard?.writeText(invitation.inviteCode);
    message.success("邀请码已生成并复制到剪贴板");
  } catch (error) {
    memberError.value = resolveErrorMessage(error, "创建邀请码失败");
  }
}

async function copyInviteCode(inviteCode: string) {
  try {
    await window.navigator.clipboard?.writeText(inviteCode);
    message.success("邀请码已复制");
  } catch (error) {
    message.error(resolveErrorMessage(error, "复制邀请码失败"));
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
  const confirmed = await confirm({ title: '移除成员', message: `确认移除成员"${member.fullName}"吗？` });
  if (!confirmed) return;
  try {
    await memberView.removeMember(kbId.value, member.userId);
    message.success("成员已移除");
  } catch (error) {
    memberError.value = resolveErrorMessage(error, "移除成员失败");
  }
}

async function updateMemberRole(member: KnowledgeBaseMemberItem, role: KnowledgeBaseMemberRole) {
  try {
    await memberView.updateMemberRole(kbId.value, member.userId, role);
    message.success("成员角色已更新");
  } catch (error) {
    memberError.value = resolveErrorMessage(error, "角色更新失败");
  }
}

// ── 设置操作 ──

function validateSettingsForm() {
  const name = settingsForm.name.trim();
  if (!name) return "知识库名称不能为空";
  if (name.length > 20) return "知识库名称不能超过 20 个字符";
  if (settingsForm.description.trim().length > 200) return "知识库描述不能超过 200 个字符";
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
      isPublic: settingsForm.visibility === "shared" ? settingsForm.isPublic : false,
      allowPublicDownload: settingsForm.visibility === "shared" ? settingsForm.allowPublicDownload : false,
    });
    message.success("知识库设置已更新");
  } catch (error) {
    settingsError.value = resolveErrorMessage(error, "知识库设置保存失败");
  }
}

async function removeKnowledgeBase() {
  const confirmed = await confirm({ title: '删除知识库', message: `确认删除知识库"${kb.value?.name}"吗？` });
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

const uploadStatusText = computed(() => {
  switch (state.status) {
    case "hashing": return "正在计算文件哈希，准备执行秒传与断点续传校验";
    case "initializing": return "正在初始化上传会话";
    case "uploading": return `正在上传分片，已完成 ${state.progress}%`;
    case "merging": return "分片上传完成，正在请求服务端合并";
    case "completed": return "上传完成，文档已进入后端处理入口状态";
    case "instantCompleted": return "命中秒传，已直接复用已有源文件";
    case "failed": return state.errorMessage || "上传失败，请稍后重试";
    default: return "拖拽 PDF、Word、TXT 或 Markdown 文件至此，体验分片上传、断点续传与秒传";
  }
});
</script>

<template>
  <div class="flex flex-col h-full w-full relative bg-surface">
    <!-- 头部 -->
    <header class="bg-surface/80 backdrop-blur-xl sticky top-0 z-40 px-6 md:px-8 py-5 border-b border-outline-variant/5">
      <div class="flex flex-col gap-4">
        <div class="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-4">
          <div class="flex items-start gap-4">
            <button @click="goBack" class="w-10 h-10 flex items-center justify-center rounded-lg hover:bg-surface-container-high transition-colors">
              <span class="material-symbols-outlined text-on-surface-variant text-xl">arrow_back</span>
            </button>
            <div v-if="kb">
              <div class="flex flex-wrap items-center gap-2 mb-3">
                <span class="header-chip">{{ kb.visibility === "private" ? "私有" : "共享" }}</span>
                <span v-if="kb.isPublic" class="header-chip header-chip-primary">公开访问</span>
                <span class="header-chip">{{ roleLabel }}</span>
              </div>
              <h2 class="font-headline text-2xl font-bold tracking-tight text-on-surface">{{ kb.name }}</h2>
              <p class="text-sm text-on-surface-variant mt-2 max-w-3xl">{{ kb.description || "当前知识库暂无描述，可在设置中补充业务边界、成员规则与公开策略。" }}</p>
            </div>
            <div v-else class="space-y-3">
              <div class="h-8 w-56 rounded bg-surface-container-high animate-pulse" />
              <div class="h-4 w-80 rounded bg-surface-container-high animate-pulse" />
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-3">
            <BaseButton v-if="kb?.permissions.canReparse" variant="outline" @click="reloadDocuments">
              <span class="material-symbols-outlined text-[18px]">sync</span> 刷新文档
            </BaseButton>
            <BaseButton v-if="kb?.permissions.canManageKnowledgeBase" variant="outline" @click="activeTab = 'settings'">
              <span class="material-symbols-outlined text-[18px]">settings</span> 管理设置
            </BaseButton>
            <BaseButton v-if="kb?.permissions.canDelete" variant="outline" class="hover:!text-error" @click="removeKnowledgeBase">
              <span class="material-symbols-outlined text-[18px]">delete</span> 删除知识库
            </BaseButton>
          </div>
        </div>
        <div class="flex gap-8 border-b border-outline-variant/10">
          <button v-for="tab in tabs" :key="tab.key" type="button" class="pb-4 text-sm font-medium transition-colors" :class="activeTab === tab.key ? 'text-primary border-b-2 border-primary' : 'text-on-surface-variant hover:text-on-surface'" @click="activeTab = tab.key">{{ tab.label }}</button>
        </div>
      </div>
    </header>

    <!-- 主内容区 -->
    <div class="flex-1 overflow-y-auto px-6 md:px-8 pb-12 pt-6">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div class="lg:col-span-8 flex flex-col gap-6">
          <input ref="fileInputRef" type="file" class="hidden" accept=".pdf,.doc,.docx,.txt,.md" multiple @change="handleFileChange" />

          <KbDocumentPanel
            v-if="activeTab === 'documents'"
            :can-upload="canUpload"
            :documents="documentView.documents.value"
            :total-count="documentView.documentPagination.total"
            :active-status="documentView.documentQuery.status"
            :is-uploading="isUploading"
            :upload-progress="state.progress"
            :upload-file-name="state.fileName || ''"
            :upload-status-text="uploadStatusText"
            :upload-id="state.uploadId"
            :kb-permissions="kb?.permissions || {}"
            @open-file-picker="openFilePicker"
            @cancel-upload="cancelCurrentUpload"
            @set-status="setDocumentStatus"
            @update:search-keyword="(v: string) => documentKeyword = v"
            @preview-document="previewDocument"
            @download-document="downloadDocument"
            @reparse-document="reparseDocument"
            @remove-document="removeDocument"
            @drop-file="handleDropFile"
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
            @copy-invite-code="copyInviteCode"
            @cancel-invitation="cancelInvitation"
            @remove-member="removeMember"
            @update-role="updateMemberRole"
          />

          <KbSettingsPanel
            v-else-if="activeTab === 'settings'"
            :name="settingsForm.name"
            :description="settingsForm.description"
            :visibility="settingsForm.visibility"
            :is-public="settingsForm.isPublic"
            :allow-public-download="settingsForm.allowPublicDownload"
            :error="settingsError"
            :is-saving="documentView.isMutating.value"
            :can-delete="kb?.permissions.canDelete === true"
            @update:name="settingsForm.name = $event"
            @update:description="settingsForm.description = $event"
            @update:visibility="settingsForm.visibility = $event"
            @update:is-public="settingsForm.isPublic = $event"
            @update:allow-public-download="settingsForm.allowPublicDownload = $event"
            @save="saveSettings"
            @delete="removeKnowledgeBase"
          />
        </div>

        <!-- 侧边栏 -->
        <aside class="lg:col-span-4 flex flex-col gap-5">
          <div v-if="kb" class="bg-surface-container-low rounded-xl p-5 shadow-inner border border-outline-variant/5 space-y-4">
            <div class="flex items-center justify-between">
              <span class="text-xs text-on-surface-variant">文档总数</span>
              <span class="font-bold text-lg">{{ kb.documentCount }}</span>
            </div>
            <div class="flex items-center justify-between">
              <span class="text-xs text-on-surface-variant">成员数量</span>
              <span class="font-bold text-lg">{{ kb.memberCount }}</span>
            </div>
          </div>
          <div v-if="!kb" class="bg-surface-container-low rounded-xl p-5 text-xs text-outline">当前还没有可展示的文档处理状态。</div>
        </aside>
      </div>
    </div>

    <!-- 文档预览模态框 -->
    <DocumentPreviewModal v-if="previewDoc" :open="previewOpen" :kb-id="kbId" :document-id="previewDoc.id" :file-name="previewDoc.originalFilename || previewDoc.title" :file-type="previewDoc.fileType || ''" @close="previewOpen = false; previewDoc = null" />
  </div>
</template>
