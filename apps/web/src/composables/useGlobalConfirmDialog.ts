import { ref } from 'vue'

export interface ConfirmDialogOptions {
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

// 全局单例状态（模块级别，多处引用同一实例）
const visible = ref(false)
const opts = ref<Required<ConfirmDialogOptions>>({
  title: '确认操作',
  message: '确定要继续吗？',
  confirmText: '确定',
  cancelText: '取消',
  danger: false,
})
const loading = ref(false)
let resolveRef: ((value: boolean) => void) | null = null

function confirm(options: ConfirmDialogOptions = {}): Promise<boolean> {
  opts.value = {
    title: options.title ?? '确认操作',
    message: options.message ?? '确定要继续吗？',
    confirmText: options.confirmText ?? '确定',
    cancelText: options.cancelText ?? '取消',
    danger: options.danger ?? false,
  }
  visible.value = true
  return new Promise<boolean>((resolve) => {
    resolveRef = resolve
  })
}

function handleCancel() {
  visible.value = false
  resolveRef?.(false)
  resolveRef = null
}

function handleConfirm() {
  loading.value = true
  resolveRef?.(true)
  setTimeout(() => {
    loading.value = false
    visible.value = false
    resolveRef = null
  }, 300)
}

/**
 * 全局确认对话框。
 *
 * 用法：
 * ```ts
 * const confirmed = await useGlobalConfirmDialog().confirm({
 *   title: '删除会话',
 *   message: '确认删除该会话？此操作不可撤销。',
 *   danger: true,
 * })
 * ```
 */
export function useGlobalConfirmDialog() {
  return {
    visible,
    opts,
    loading,
    confirm,
    handleCancel,
    handleConfirm,
  }
}
