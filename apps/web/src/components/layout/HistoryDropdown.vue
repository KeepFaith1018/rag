<script setup lang="ts">
import { ref, computed } from 'vue'
import type { ChatSessionSummary } from '@/modules/chat/types/chat'
import { useGlobalConfirmDialog } from '@/composables/useGlobalConfirmDialog'

const props = defineProps<{
  sessions: ChatSessionSummary[]
  currentSessionId?: string
}>()

const emit = defineEmits<{
  select: [sessionId: string]
  rename: [sessionId: string, title: string]
  delete: [sessionId: string]
}>()

const searchQuery = ref('')
const editingId = ref<string | null>(null)
const editingTitle = ref('')

const filteredSessions = computed(() => {
  const q = searchQuery.value.toLowerCase().trim()
  if (!q) return props.sessions
  return props.sessions.filter((s) => s.title.toLowerCase().includes(q))
})

function formatTime(isoString?: string): string {
  if (!isoString) return ''
  const date = new Date(isoString)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const dayMs = 86400000
  if (diff < dayMs) return '今天'
  if (diff < 2 * dayMs) return '昨天'
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function startEdit(session: ChatSessionSummary, e: MouseEvent) {
  e.stopPropagation()
  editingId.value = session.id
  editingTitle.value = session.title
}

function confirmEdit() {
  if (editingId.value && editingTitle.value.trim()) {
    emit('rename', editingId.value, editingTitle.value.trim())
  }
  editingId.value = null
}

function cancelEdit() {
  editingId.value = null
}

function handleDelete(sessionId: string, e: MouseEvent) {
  e.stopPropagation()
  const { confirm } = useGlobalConfirmDialog()
  confirm({
    title: '删除会话',
    message: '确认删除该会话？此操作不可撤销。',
    confirmText: '删除',
    cancelText: '取消',
    danger: true,
  }).then((confirmed) => {
    if (confirmed) {
      emit('delete', sessionId)
    }
  })
}
</script>

<template>
  <div class="absolute right-0 top-full mt-2 w-80 bg-surface-container-high border border-outline-variant/15 rounded-xl shadow-2xl overflow-hidden z-50">
    <!-- 搜索框 -->
    <div class="p-3 border-b border-outline-variant/10">
      <div class="relative">
        <span class="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-outline text-sm">search</span>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索会话..."
          class="w-full bg-surface-container-lowest border border-outline-variant/15 rounded-lg pl-9 pr-3 py-1.5 text-xs text-on-surface placeholder:text-outline focus:outline-none focus:border-primary"
        />
      </div>
    </div>

    <!-- 会话列表 -->
    <div class="max-h-64 overflow-y-auto">
      <div v-if="filteredSessions.length === 0" class="p-6 text-center text-xs text-outline">
        暂无会话记录
      </div>

      <div
        v-for="session in filteredSessions"
        :key="session.id"
        class="group relative flex items-center px-3 py-2 cursor-pointer border-b border-outline-variant/5 last:border-b-0 hover:bg-surface-container-low/50 transition-colors"
        :class="session.id === currentSessionId ? 'bg-primary/5' : ''"
        @click="emit('select', session.id)"
      >
        <!-- 普通状态 -->
        <template v-if="editingId !== session.id">
          <div class="relative min-w-0 flex-1">
            <span class="truncate text-xs text-on-surface">{{ session.title || '新建会话' }}</span>
          </div>
          <!-- 右侧绝对定位区域：时间默认显示，hover 时显示图标，不占用 flex 空间 -->
          <div class="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-0.5">
            <span class="text-[10px] text-outline group-hover:hidden">{{ formatTime(session.updatedAt || session.createdAt) }}</span>
            <div class="hidden group-hover:flex items-center gap-0.5">
              <button
                class="p-1 hover:bg-surface-container-low rounded transition-colors"
                @click="(e) => startEdit(session, e)"
              >
                <span class="material-symbols-outlined text-xs text-outline hover:text-primary">edit</span>
              </button>
              <button
                class="p-1 hover:bg-surface-container-low rounded transition-colors"
                @click="(e) => handleDelete(session.id, e)"
              >
                <span class="material-symbols-outlined text-xs text-outline hover:text-error">delete</span>
              </button>
            </div>
          </div>
        </template>

        <!-- 编辑状态 -->
        <template v-else>
          <div class="relative min-w-0 flex-1 pr-16">
            <input
              v-model="editingTitle"
              type="text"
              class="w-full bg-surface-container-lowest border border-primary rounded px-2 py-0.5 text-xs text-on-surface focus:outline-none"
              @keydown.enter="confirmEdit"
              @keydown.escape="cancelEdit"
              @click.stop
              autofocus
            />
          </div>
          <div class="flex items-center gap-1 ml-2">
            <button @click.stop="confirmEdit" class="p-1 hover:bg-surface-container-low rounded transition-colors">
              <span class="material-symbols-outlined text-xs text-primary">check</span>
            </button>
            <button @click.stop="cancelEdit" class="p-1 hover:bg-surface-container-low rounded transition-colors">
              <span class="material-symbols-outlined text-xs text-outline">close</span>
            </button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>
