import { ref } from 'vue'

interface ConfirmDialogOptions {
  title?: string
  message?: string
  confirmText?: string
  cancelText?: string
  danger?: boolean
}

/**
 * promise-based 确认对话框。
 *
 * 用法：
 * ```ts
 * const confirmed = await useConfirmDialog().confirm({
 *   title: '删除会话',
 *   message: '确认删除该会话？此操作不可撤销。',
 *   danger: true,
 * })
 * if (confirmed) { ... }
 * ```
 */
export function useConfirmDialog() {
  const visible = ref(false)
  const options = ref<ConfirmDialogOptions>({
    title: '确认操作',
    message: '确定要继续吗？',
    confirmText: '确定',
    cancelText: '取消',
    danger: false,
  })
  let resolvePromise: ((value: boolean) => void) | null = null

  function confirm(opts: ConfirmDialogOptions = {}): Promise<boolean> {
    options.value = {
      title: opts.title ?? '确认操作',
      message: opts.message ?? '确定要继续吗？',
      confirmText: opts.confirmText ?? '确定',
      cancelText: opts.cancelText ?? '取消',
      danger: opts.danger ?? false,
    }
    visible.value = true
    return new Promise<boolean>((resolve) => {
      resolvePromise = resolve
    })
  }

  function handleConfirm() {
    visible.value = false
    resolvePromise?.(true)
    resolvePromise = null
  }

  function handleCancel() {
    visible.value = false
    resolvePromise?.(false)
    resolvePromise = null
  }

  return {
    visible,
    options,
    confirm,
    handleConfirm,
    handleCancel,
  }
}
