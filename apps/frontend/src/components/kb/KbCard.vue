<script setup lang="ts">
import { computed } from "vue";
import { useRouter } from "vue-router";
import type { KnowledgeBaseListItem } from "@/types/knowledge-base";

const props = defineProps<{
  kb: KnowledgeBaseListItem;
}>();

const emit = defineEmits<{
  (event: "edit", kb: KnowledgeBaseListItem): void;
  (event: "delete", kb: KnowledgeBaseListItem): void;
}>();

const router = useRouter();

/**
 * 角色文案映射。
 */
const roleLabel = computed(() => {
  const map = {
    owner: "拥有者",
    manager: "管理员",
    collaborator: "协作者",
    member: "成员",
    publicVisitor: "公开访问",
  } as const;

  return map[props.kb.accessRole];
});

/**
 * 类型文案。
 */
const visibilityLabel = computed(() =>
  props.kb.visibility === "private" ? "私有" : "共享",
);

/**
 * 卡片图标。
 */
const iconName = computed(() => {
  if (props.kb.visibility === "private") {
    return "lock";
  }

  return props.kb.isPublic ? "public" : "groups";
});

/**
 * 卡片高亮色。
 */
const accentClass = computed(() => {
  if (props.kb.accessRole === "owner") {
    return "card-accent-primary";
  }

  if (props.kb.accessRole === "manager") {
    return "card-accent-secondary";
  }

  return "card-accent-tertiary";
});

/**
 * 跳转到详情页。
 */
function goDetail() {
  void router.push(`/kb/${props.kb.id}`);
}

/**
 * 格式化日期。
 */
function formatDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/**
 * 触发编辑事件。
 */
function handleEdit() {
  emit("edit", props.kb);
}

/**
 * 触发删除事件。
 */
function handleDelete() {
  emit("delete", props.kb);
}
</script>

<template>
  <div
    class="group bg-surface-container-low hover:bg-surface-container-high p-8 rounded-[var(--radius-card)] transition-all duration-300 flex flex-col h-80 justify-between cursor-pointer border border-transparent hover:border-outline-variant/10"
    :class="accentClass"
    @click="goDetail"
  >
    <div class="flex items-start justify-between gap-4">
      <div class="flex items-start gap-4 min-w-0">
        <div
          class="w-12 h-12 rounded-xl flex items-center justify-center transition-transform group-hover:-translate-y-1 duration-300 shadow-md icon-shell"
        >
          <span class="material-symbols-outlined icon-filled icon-mark">
            {{ iconName }}
          </span>
        </div>
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2 mb-3">
            <span class="kb-chip">
              {{ visibilityLabel }}
            </span>
            <span v-if="props.kb.isPublic" class="kb-chip kb-chip-public">
              公开
            </span>
            <span class="kb-chip kb-chip-role">
              {{ roleLabel }}
            </span>
          </div>
          <h3
            class="font-headline text-xl font-bold transition-colors duration-300 text-on-surface truncate"
          >
            {{ props.kb.name }}
          </h3>
          <p class="text-sm text-on-surface-variant mt-2 line-clamp-2 min-h-10">
            {{ props.kb.description || "暂无知识库说明，进入详情页后可继续完善描述与权限配置。" }}
          </p>
        </div>
      </div>

      <div class="flex items-center gap-1">
        <button
          v-if="props.kb.permissions.canManageKnowledgeBase"
          type="button"
          class="w-9 h-9 rounded-lg border border-outline-variant/10 hover:bg-surface-container-highest transition-colors"
          @click.stop="handleEdit"
        >
          <span class="material-symbols-outlined text-[18px]">edit</span>
        </button>
        <button
          v-if="props.kb.permissions.canDelete"
          type="button"
          class="w-9 h-9 rounded-lg border border-outline-variant/10 hover:bg-error-container/20 hover:text-error transition-colors"
          @click.stop="handleDelete"
        >
          <span class="material-symbols-outlined text-[18px]">delete</span>
        </button>
      </div>
    </div>

    <div class="space-y-4">
      <div class="grid grid-cols-2 gap-3">
        <div class="metric-card">
          <span class="metric-label">文档数</span>
          <span class="metric-value">{{ props.kb.documentCount }}</span>
        </div>
        <div class="metric-card">
          <span class="metric-label">成员数</span>
          <span class="metric-value">{{ props.kb.memberCount }}</span>
        </div>
      </div>

      <div class="flex items-center gap-3 text-xs text-outline">
        <span class="inline-flex items-center gap-1.5">
          <span class="material-symbols-outlined text-[16px]">schedule</span>
          更新于 {{ formatDate(props.kb.updatedAt) }}
        </span>
        <span
          v-if="props.kb.allowPublicDownload"
          class="inline-flex items-center gap-1.5"
        >
          <span class="material-symbols-outlined text-[16px]">download</span>
          可公开下载
        </span>
      </div>

      <div
        class="flex items-center justify-between pt-5 border-t border-outline-variant/10"
      >
        <span class="text-[10px] font-label text-outline/80 uppercase tracking-wider">
          创建于 {{ formatDate(props.kb.createdAt) }}
        </span>
        <span
          class="inline-flex items-center gap-1 text-xs text-primary group-hover:translate-x-0.5 transition-transform"
        >
          查看详情
          <span class="material-symbols-outlined text-[16px]">arrow_forward</span>
        </span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card-accent-primary .icon-shell {
  background: color-mix(in srgb, var(--color-primary) 16%, transparent);
}

.card-accent-primary .icon-mark,
.card-accent-primary .kb-chip-role,
.card-accent-primary .metric-value {
  color: var(--color-primary);
}

.card-accent-secondary .icon-shell {
  background: color-mix(in srgb, var(--color-secondary) 16%, transparent);
}

.card-accent-secondary .icon-mark,
.card-accent-secondary .kb-chip-role,
.card-accent-secondary .metric-value {
  color: var(--color-secondary);
}

.card-accent-tertiary .icon-shell {
  background: color-mix(in srgb, var(--color-tertiary) 14%, transparent);
}

.card-accent-tertiary .icon-mark,
.card-accent-tertiary .kb-chip-role,
.card-accent-tertiary .metric-value {
  color: var(--color-tertiary);
}

.kb-chip {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 0.25rem 0.55rem;
  background: color-mix(in srgb, var(--color-outline-variant) 18%, transparent);
  color: var(--color-on-surface-variant);
  font-size: 0.65rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.kb-chip-public {
  background: color-mix(in srgb, var(--color-primary) 14%, transparent);
  color: var(--color-primary);
}

.kb-chip-role {
  background: transparent;
  border: 1px solid color-mix(in srgb, currentColor 24%, transparent);
}

.metric-card {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  border-radius: 0.9rem;
  border: 1px solid color-mix(in srgb, var(--color-outline-variant) 14%, transparent);
  background: color-mix(in srgb, var(--color-surface-container-high) 72%, transparent);
  padding: 0.9rem 1rem;
}

.metric-label {
  color: var(--color-outline);
  font-size: 0.72rem;
}

.metric-value {
  font-family: var(--font-headline);
  font-size: 1.1rem;
  font-weight: 700;
}
</style>
