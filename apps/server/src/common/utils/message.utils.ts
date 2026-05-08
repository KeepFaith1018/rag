/**
 * LangChain / SSE 消息处理共享工具函数。
 */

/**
 * 从 LangChain 消息块中提取纯文本内容。
 *
 * 兼容 string content 和 ContentBlock[] 两种格式。
 */
export function extractMessageContent(msg: {
  content?: unknown;
}): string {
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .filter(
        (x): x is { type: string; text: string } =>
          typeof x === 'object' && x !== null && 'type' in x,
      )
      .filter((x) => x.type === 'text' && typeof x.text === 'string')
      .map((x) => x.text)
      .join('');
  }
  return '';
}

/**
 * 从任意错误对象中提取错误消息字符串。
 */
export function getErrorMessage(
  error: unknown,
  fallback: string = '未知错误',
): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  if (error === null || error === undefined) return fallback;
  try {
    return JSON.stringify(error);
  } catch {
    return fallback;
  }
}
