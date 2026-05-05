<script setup lang="ts">
import { useGlobalConfirmDialog } from '@/composables/useGlobalConfirmDialog'

const { visible, opts, loading, handleCancel, handleConfirm } = useGlobalConfirmDialog()
</script>

<template>
  <Teleport to="body">
    <Transition
      enter-active-class="transition-all duration-200 ease-out"
      enter-from-class="opacity-0"
      enter-to-class="opacity-100"
      leave-active-class="transition-all duration-150 ease-in"
      leave-from-class="opacity-100"
      leave-to-class="opacity-0"
    >
      <div
        v-if="visible"
        class="fixed inset-0 z-[200] flex items-center justify-center p-4"
      >
        <!-- 遮罩层 -->
        <div
          class="absolute inset-0 bg-black/50 backdrop-blur-sm"
          @click="handleCancel"
        />

        <!-- 弹窗 -->
        <div
          class="relative w-full max-w-sm bg-surface-container-low border border-outline-variant/20 rounded-2xl shadow-2xl overflow-hidden"
          @click.stop
        >
          <!-- 标题 -->
          <div class="px-6 pt-6 pb-2">
            <h2 class="text-base font-headline font-semibold text-on-surface">
              {{ opts.title }}
            </h2>
          </div>

          <!-- 消息 -->
          <div class="px-6 pb-6">
            <p class="text-sm text-on-surface-variant leading-relaxed whitespace-pre-line">
              {{ opts.message }}
            </p>
          </div>

          <!-- 操作按钮 -->
          <div class="flex items-center justify-end gap-2 px-6 pb-6">
            <button
              class="px-4 py-2 text-sm font-headline rounded-lg bg-surface-container-high text-on-surface hover:bg-surface-container-high/80 transition-colors focus:outline-none focus:ring-2 focus:ring-outline-variant/40"
              :disabled="loading"
              @click="handleCancel"
            >
              {{ opts.cancelText }}
            </button>
            <button
              class="px-4 py-2 text-sm font-headline rounded-lg transition-colors focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed"
              :class="opts.danger
                ? 'bg-error-container text-on-error-container hover:bg-error/20 focus:ring-error/40'
                : 'bg-primary-container text-on-primary-container hover:bg-primary focus:ring-primary/40'"
              :disabled="loading"
              @click="handleConfirm"
            >
              {{ opts.confirmText }}
            </button>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
