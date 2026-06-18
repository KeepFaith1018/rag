<script setup lang="ts">
import { computed } from "vue";
import { useMessage, type AppMessageItem } from "@/composables/useMessage";

const message = useMessage();

/**
 * 不同消息类型的展示样式。
 */
function getMessageClass(type: AppMessageItem["type"]) {
  const classMap = {
    success:
      "border-emerald-400/30 bg-emerald-500/12 text-emerald-100 shadow-[0_12px_40px_rgba(16,185,129,0.18)]",
    error:
      "border-rose-400/30 bg-rose-500/12 text-rose-100 shadow-[0_12px_40px_rgba(244,63,94,0.18)]",
    warning:
      "border-amber-400/30 bg-amber-500/12 text-amber-100 shadow-[0_12px_40px_rgba(245,158,11,0.18)]",
    info:
      "border-sky-400/30 bg-sky-500/12 text-sky-100 shadow-[0_12px_40px_rgba(14,165,233,0.18)]",
  } as const;

  return classMap[type];
}

const messages = computed(() => message.messages.value);
</script>

<template>
  <Teleport to="body">
    <div class="fixed top-6 right-6 z-[120] flex w-[min(92vw,380px)] flex-col gap-3">
      <TransitionGroup name="app-message">
        <div
          v-for="item in messages"
          :key="item.id"
          :class="[
            'rounded-2xl border px-4 py-3 backdrop-blur-xl',
            'flex items-start gap-3',
            getMessageClass(item.type),
          ]"
        >
          <span class="material-symbols-outlined mt-0.5 text-base">
            {{
              item.type === "success"
                ? "check_circle"
                : item.type === "error"
                  ? "error"
                  : item.type === "warning"
                    ? "warning"
                    : "info"
            }}
          </span>

          <div class="min-w-0 flex-1 overflow-hidden">
            <p class="text-sm leading-6 break-words max-h-32 overflow-y-auto">{{ item.text }}</p>
          </div>

          <button
            type="button"
            class="text-current/70 transition-colors hover:text-current"
            @click="message.remove(item.id)"
          >
            <span class="material-symbols-outlined text-base">close</span>
          </button>
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.app-message-enter-active,
.app-message-leave-active {
  transition: all 0.22s ease;
}

.app-message-enter-from,
.app-message-leave-to {
  opacity: 0;
  transform: translateY(-10px) scale(0.98);
}
</style>
