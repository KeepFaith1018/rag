/** 从任意错误对象中提取可读的错误信息。 */
export function resolveErrorMessage(error: unknown, fallback = '操作失败'): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object') {
    const msg = (error as Record<string, unknown>).message;
    if (typeof msg === 'string') return msg;
    const msg2 = (error as Record<string, unknown>).msg;
    if (typeof msg2 === 'string') return msg2;
  }
  return fallback;
}
