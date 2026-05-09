<script setup lang="ts">
import { computed, ref } from 'vue';
import { useChatStore } from '@/stores/chat';

const props = withDefaults(
  defineProps<{
    /** 紧凑模式：去除外层容器，仅保留触发按钮+下拉 */
    compact?: boolean;
  }>(),
  { compact: false },
);

const chatStore = useChatStore();

/** RAG 模式下且有可用知识库时显示 */
const visible = computed(() => {
  if (props.compact) return true; // compact 模式由父组件控制 v-if
  return chatStore.chatMode === 'rag' && chatStore.availableKbs.length > 0;
});

/** 权限配置 */
const permissionConfig: Record<string, { label: string; color: string }> = {
  owner: { label: '所有者', color: 'text-purple-400' },
  manager: { label: '管理员', color: 'text-red-400' },
  collaborator: { label: '协作者', color: 'text-blue-400' },
  member: { label: '成员', color: 'text-green-400' },
  publicVisitor: { label: '访客', color: 'text-gray-400' },
};

/** 是否展开下拉 */
const isOpen = ref(false);

/** 切换下拉展开 */
function toggleDropdown() {
  isOpen.value = !isOpen.value;
}

/** 切换知识库选中状态 */
function toggleKb(kbId: string) {
  chatStore.toggleKb(kbId);
}

/** 检查知识库是否选中 */
function isSelected(kbId: string): boolean {
  return chatStore.selectedKbIds.includes(kbId);
}

/** 选中所有私人知识库 */
function selectAllPrivate() {
  const privateKbs = chatStore.availableKbs.filter(
    (kb) => kb.visibility === 'private',
  );
  const ids = privateKbs.map((kb) => kb.kbId);
  chatStore.setSelectedKbIds([...new Set([...chatStore.selectedKbIds, ...ids])]);
}

/** 选中所有共享-我创建知识库 */
function selectAllSharedOwned() {
  const sharedOwned = chatStore.availableKbs.filter(
    (kb) => kb.visibility === 'shared' && kb.permission === 'owner',
  );
  const ids = sharedOwned.map((kb) => kb.kbId);
  chatStore.setSelectedKbIds([...new Set([...chatStore.selectedKbIds, ...ids])]);
}

/** 选中所有共享-我加入知识库 */
function selectAllSharedJoined() {
  const sharedJoined = chatStore.availableKbs.filter(
    (kb) =>
      kb.visibility === 'shared' &&
      kb.permission !== 'owner' &&
      kb.permission !== 'publicVisitor',
  );
  const ids = sharedJoined.map((kb) => kb.kbId);
  chatStore.setSelectedKbIds([...new Set([...chatStore.selectedKbIds, ...ids])]);
}

/** 清除所有选中 */
function clearAll() {
  chatStore.setSelectedKbIds([]);
}

/** 已选中的知识库名称（用于显示） */
const displayNames = computed(() => {
  const names = chatStore.selectedKbIds
    .map((id) => {
      const kb = chatStore.availableKbs.find((k) => k.kbId === id);
      return kb?.kbName || '';
    })
    .filter(Boolean);

  if (names.length === 0) return '';
  if (names.length <= 3) return names.join(', ');
  return names.slice(0, 3).join(', ') + ` +${names.length - 3}`;
});

/** 私人知识库列表 */
const privateKbs = computed(() =>
  chatStore.availableKbs.filter((kb) => kb.visibility === 'private'),
);

/** 共享-我创建知识库列表 */
const sharedOwnedKbs = computed(() =>
  chatStore.availableKbs.filter(
    (kb) => kb.visibility === 'shared' && kb.permission === 'owner',
  ),
);

/** 共享-我加入知识库列表 */
const sharedJoinedKbs = computed(() =>
  chatStore.availableKbs.filter(
    (kb) =>
      kb.visibility === 'shared' &&
      kb.permission !== 'owner' &&
      kb.permission !== 'publicVisitor',
  ),
);

/** 公开知识库列表 */
const publicKbs = computed(() =>
  chatStore.availableKbs.filter((kb) => kb.permission === 'publicVisitor'),
);
</script>

<template>
  <!-- compact 模式：仅触发按钮 + 下拉 -->
  <template v-if="compact">
    <div class="relative">
      <button
        class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all border"
        :class="isOpen
          ? 'border-primary/30 bg-primary-container/10 text-primary'
          : 'border-outline-variant/20 hover:border-outline text-outline hover:text-on-surface'"
        @click="toggleDropdown"
      >
        <span class="material-symbols-outlined text-[14px]">
          {{ chatStore.selectedKbCount > 0 ? 'library_books' : 'folder_open' }}
        </span>
        <span v-if="displayNames" class="truncate max-w-[120px]">{{ displayNames }}</span>
        <span v-else class="text-outline/70">知识库</span>
        <span
          :class="[
            'material-symbols-outlined text-[12px] transition-transform',
            isOpen ? 'rotate-180' : '',
          ]"
        >expand_more</span>
      </button>

      <!-- 下拉面板（复用的完整列表） -->
      <Transition
        enter-active-class="transition-all duration-200 ease-out"
        enter-from-class="opacity-0 translate-y-1"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition-all duration-150 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 translate-y-1"
      >
        <div
          v-if="isOpen"
          class="kb-selector-dropdown absolute z-50 bottom-full mb-1 left-0 bg-surface-container rounded-xl border border-outline-variant/20 shadow-lg overflow-hidden"
          style="width: 320px;"
          @click.stop
        >
          <div class="max-h-[300px] overflow-y-auto p-2">
            <!-- 私人知识库 -->
            <div v-if="privateKbs.length > 0" class="mb-3">
              <div class="flex items-center justify-between px-2 py-1">
                <span class="text-xs font-medium text-outline">私人</span>
                <button
                  class="text-[10px] text-primary hover:text-primary-container"
                  @click="selectAllPrivate"
                >全选</button>
              </div>
              <div class="space-y-1">
                <button
                  v-for="kb in privateKbs" :key="kb.kbId"
                  :class="[
                    'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border',
                    isSelected(kb.kbId)
                      ? 'bg-primary-container/50 border-primary/30 text-on-primary-container'
                      : 'bg-transparent border-transparent hover:bg-surface-container-high',
                  ]"
                  @click="toggleKb(kb.kbId)"
                >
                  <span :class="['material-symbols-outlined text-[14px]', isSelected(kb.kbId) ? 'text-primary' : 'opacity-0']">check_circle</span>
                  <span class="flex-1 text-left truncate">{{ kb.kbName }}</span>
                  <span :class="['text-[10px] px-1 py-0.5 rounded', permissionConfig[kb.permission]?.color || 'text-gray-400']">
                    {{ permissionConfig[kb.permission]?.label }}
                  </span>
                </button>
              </div>
            </div>

            <!-- 共享知识库 -->
            <div v-if="sharedOwnedKbs.length > 0 || sharedJoinedKbs.length > 0" class="mb-3">
              <div class="flex items-center justify-between px-2 py-1">
                <span class="text-xs font-medium text-outline">共享</span>
              </div>
              <div v-if="sharedOwnedKbs.length > 0" class="ml-2 mb-2">
                <div class="flex items-center justify-between px-2 py-1">
                  <span class="text-[10px] text-outline/70">我创建</span>
                  <button class="text-[10px] text-primary hover:text-primary-container" @click="selectAllSharedOwned">全选</button>
                </div>
                <div class="space-y-1">
                  <button
                    v-for="kb in sharedOwnedKbs" :key="kb.kbId"
                    :class="[
                      'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border',
                      isSelected(kb.kbId)
                        ? 'bg-primary-container/50 border-primary/30 text-on-primary-container'
                        : 'bg-transparent border-transparent hover:bg-surface-container-high',
                    ]"
                    @click="toggleKb(kb.kbId)"
                  >
                    <span :class="['material-symbols-outlined text-[14px]', isSelected(kb.kbId) ? 'text-primary' : 'opacity-0']">check_circle</span>
                    <span class="flex-1 text-left truncate">{{ kb.kbName }}</span>
                    <span :class="['text-[10px] px-1 py-0.5 rounded', permissionConfig[kb.permission]?.color || 'text-gray-400']">
                      {{ permissionConfig[kb.permission]?.label }}
                    </span>
                  </button>
                </div>
              </div>
              <div v-if="sharedJoinedKbs.length > 0" class="ml-2">
                <div class="flex items-center justify-between px-2 py-1">
                  <span class="text-[10px] text-outline/70">我加入</span>
                  <button class="text-[10px] text-primary hover:text-primary-container" @click="selectAllSharedJoined">全选</button>
                </div>
                <div class="space-y-1">
                  <button
                    v-for="kb in sharedJoinedKbs" :key="kb.kbId"
                    :class="[
                      'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border',
                      isSelected(kb.kbId)
                        ? 'bg-primary-container/50 border-primary/30 text-on-primary-container'
                        : 'bg-transparent border-transparent hover:bg-surface-container-high',
                    ]"
                    @click="toggleKb(kb.kbId)"
                  >
                    <span :class="['material-symbols-outlined text-[14px]', isSelected(kb.kbId) ? 'text-primary' : 'opacity-0']">check_circle</span>
                    <span class="flex-1 text-left truncate">{{ kb.kbName }}</span>
                    <span :class="['text-[10px] px-1 py-0.5 rounded', permissionConfig[kb.permission]?.color || 'text-gray-400']">
                      {{ permissionConfig[kb.permission]?.label }}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <!-- 公开知识库 -->
            <div v-if="publicKbs.length > 0">
              <div class="flex items-center justify-between px-2 py-1">
                <span class="text-xs font-medium text-outline/50">公开</span>
              </div>
              <div class="space-y-1 opacity-50">
                <div v-for="kb in publicKbs" :key="kb.kbId"
                  class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border border-transparent bg-transparent cursor-not-allowed">
                  <span class="material-symbols-outlined text-[14px] opacity-0">check_circle</span>
                  <span class="flex-1 text-left truncate">{{ kb.kbName }}</span>
                  <span class="text-[10px] px-1 py-0.5 rounded text-gray-400">访客</span>
                </div>
              </div>
              <div class="px-2 py-1 text-[10px] text-amber-400/70">公开知识库需要先加入才能提问</div>
            </div>
          </div>
          <div class="flex items-center justify-between px-3 py-2 border-t border-outline-variant/10 bg-surface-container-low">
            <button class="text-xs text-outline hover:text-on-primary-container" @click="clearAll">清除全部</button>
            <button class="text-xs text-primary hover:text-primary-container font-medium" @click="isOpen = false">完成</button>
          </div>
        </div>
      </Transition>
    </div>
  </template>

  <!-- 非 compact 模式：保持原样 -->
  <template v-else>
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0 -translate-y-2"
      enter-to-class="opacity-100 translate-y-0"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100 translate-y-0"
      leave-to-class="opacity-0 -translate-y-2"
    >
      <div
        v-if="visible"
        class="relative px-4 py-3 bg-surface-container-low/50 rounded-xl border border-outline-variant/10"
      >
        <span class="text-xs text-outline font-medium mr-1 flex items-center gap-1">
          <span class="material-symbols-outlined text-[14px]">folder_open</span>
          选择知识库
        </span>

        <!-- 级联选择器触发按钮 -->
        <button
          class="mt-2 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border border-outline-variant/10 bg-surface-container hover:border-outline min-w-[200px]"
          @click="toggleDropdown"
        >
          <span class="material-symbols-outlined text-[14px] text-primary">
            library_add
          </span>
          <span v-if="displayNames" class="flex-1 text-left truncate">
            {{ displayNames }}
          </span>
          <span v-else class="flex-1 text-outline">请选择知识库</span>
          <span
            :class="[
              'material-symbols-outlined text-[14px] transition-transform',
              isOpen ? 'rotate-180' : '',
            ]"
          >
            expand_more
          </span>
        </button>

      <!-- 下拉面板 -->
      <Transition
        enter-active-class="transition-all duration-200 ease-out"
        enter-from-class="opacity-0 translate-y-1"
        enter-to-class="opacity-100 translate-y-0"
        leave-active-class="transition-all duration-150 ease-in"
        leave-from-class="opacity-100 translate-y-0"
        leave-to-class="opacity-0 translate-y-1"
      >
        <div
          v-if="isOpen"
          class="kb-selector-dropdown absolute z-50 mt-1 left-4 right-4 bg-surface-container rounded-xl border border-outline-variant/20 shadow-lg overflow-hidden"
          @click.stop
        >
          <div class="max-h-[300px] overflow-y-auto p-2">
            <!-- 私人知识库 -->
            <div v-if="privateKbs.length > 0" class="mb-3">
              <div class="flex items-center justify-between px-2 py-1">
                <span class="text-xs font-medium text-outline">私人</span>
                <button
                  class="text-[10px] text-primary hover:text-primary-container"
                  @click="selectAllPrivate"
                >
                  全选
                </button>
              </div>
              <div class="space-y-1">
                <button
                  v-for="kb in privateKbs"
                  :key="kb.kbId"
                  :class="[
                    'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border',
                    isSelected(kb.kbId)
                      ? 'bg-primary-container/50 border-primary/30 text-on-primary-container'
                      : 'bg-transparent border-transparent hover:bg-surface-container-high',
                  ]"
                  @click="toggleKb(kb.kbId)"
                >
                  <span
                    :class="[
                      'material-symbols-outlined text-[14px]',
                      isSelected(kb.kbId) ? 'text-primary' : 'opacity-0',
                    ]"
                  >
                    check_circle
                  </span>
                  <span class="flex-1 text-left truncate">{{ kb.kbName }}</span>
                  <span
                    :class="[
                      'text-[10px] px-1 py-0.5 rounded',
                      permissionConfig[kb.permission]?.color || 'text-gray-400',
                    ]"
                  >
                    {{ permissionConfig[kb.permission]?.label }}
                  </span>
                </button>
              </div>
            </div>

            <!-- 共享知识库 -->
            <div v-if="sharedOwnedKbs.length > 0 || sharedJoinedKbs.length > 0" class="mb-3">
              <div class="flex items-center justify-between px-2 py-1">
                <span class="text-xs font-medium text-outline">共享</span>
              </div>

              <!-- 我创建 -->
              <div v-if="sharedOwnedKbs.length > 0" class="ml-2 mb-2">
                <div class="flex items-center justify-between px-2 py-1">
                  <span class="text-[10px] text-outline/70">我创建</span>
                  <button
                    class="text-[10px] text-primary hover:text-primary-container"
                    @click="selectAllSharedOwned"
                  >
                    全选
                  </button>
                </div>
                <div class="space-y-1">
                  <button
                    v-for="kb in sharedOwnedKbs"
                    :key="kb.kbId"
                    :class="[
                      'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border',
                      isSelected(kb.kbId)
                        ? 'bg-primary-container/50 border-primary/30 text-on-primary-container'
                        : 'bg-transparent border-transparent hover:bg-surface-container-high',
                    ]"
                    @click="toggleKb(kb.kbId)"
                  >
                    <span
                      :class="[
                        'material-symbols-outlined text-[14px]',
                        isSelected(kb.kbId) ? 'text-primary' : 'opacity-0',
                      ]"
                    >
                      check_circle
                    </span>
                    <span class="flex-1 text-left truncate">{{ kb.kbName }}</span>
                    <span
                      :class="[
                        'text-[10px] px-1 py-0.5 rounded',
                        permissionConfig[kb.permission]?.color || 'text-gray-400',
                      ]"
                    >
                      {{ permissionConfig[kb.permission]?.label }}
                    </span>
                  </button>
                </div>
              </div>

              <!-- 我加入 -->
              <div v-if="sharedJoinedKbs.length > 0" class="ml-2">
                <div class="flex items-center justify-between px-2 py-1">
                  <span class="text-[10px] text-outline/70">我加入</span>
                  <button
                    class="text-[10px] text-primary hover:text-primary-container"
                    @click="selectAllSharedJoined"
                  >
                    全选
                  </button>
                </div>
                <div class="space-y-1">
                  <button
                    v-for="kb in sharedJoinedKbs"
                    :key="kb.kbId"
                    :class="[
                      'w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border',
                      isSelected(kb.kbId)
                        ? 'bg-primary-container/50 border-primary/30 text-on-primary-container'
                        : 'bg-transparent border-transparent hover:bg-surface-container-high',
                    ]"
                    @click="toggleKb(kb.kbId)"
                  >
                    <span
                      :class="[
                        'material-symbols-outlined text-[14px]',
                        isSelected(kb.kbId) ? 'text-primary' : 'opacity-0',
                      ]"
                    >
                      check_circle
                    </span>
                    <span class="flex-1 text-left truncate">{{ kb.kbName }}</span>
                    <span
                      :class="[
                        'text-[10px] px-1 py-0.5 rounded',
                        permissionConfig[kb.permission]?.color || 'text-gray-400',
                      ]"
                    >
                      {{ permissionConfig[kb.permission]?.label }}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <!-- 公开知识库（禁用选择） -->
            <div v-if="publicKbs.length > 0">
              <div class="flex items-center justify-between px-2 py-1">
                <span class="text-xs font-medium text-outline/50">公开</span>
              </div>
              <div class="space-y-1 opacity-50">
                <div
                  v-for="kb in publicKbs"
                  :key="kb.kbId"
                  class="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border border-transparent bg-transparent cursor-not-allowed"
                >
                  <span class="material-symbols-outlined text-[14px] opacity-0">
                    check_circle
                  </span>
                  <span class="flex-1 text-left truncate">{{ kb.kbName }}</span>
                  <span class="text-[10px] px-1 py-0.5 rounded text-gray-400">
                    访客
                  </span>
                </div>
              </div>
              <div class="px-2 py-1 text-[10px] text-amber-400/70">
                公开知识库需要先加入才能提问
              </div>
            </div>
          </div>

          <!-- 底部操作栏 -->
          <div
            class="flex items-center justify-between px-3 py-2 border-t border-outline-variant/10 bg-surface-container-low"
          >
            <button
              class="text-xs text-outline hover:text-on-primary-container"
              @click="clearAll"
            >
              清除全部
            </button>
            <button
              class="text-xs text-primary hover:text-primary-container font-medium"
              @click="isOpen = false"
            >
              完成
            </button>
          </div>
        </div>
      </Transition>

      <!-- 未选择知识库提示 -->
      <span
        v-if="chatStore.selectedKbIds.length === 0"
        class="mt-2 text-xs text-amber-400 flex items-center gap-1"
      >
        <span class="material-symbols-outlined text-[14px]">info</span>
        请选择至少一个知识库
      </span>
    </div>
  </Transition>
  </template>
</template>