/**
 * 需要整字段隐藏的敏感键名。匹配不区分大小写，并兼容常见的下划线、连字符或驼峰命名。
 */
const sensitiveKey =
  /password|passwd|secret|token|authorization|cookie|api.?key|code.?hash|invite.?code|verification.?code|database.?url|redis.?url|email.?pass/i;

export interface RedactOptions {
  /** 开发阶段允许保留 Error 的消息、堆栈和 cause，生产环境保持关闭。 */
  includeStack?: boolean;
}

/**
 * 递归生成适合写入日志的脱敏副本，不修改调用方传入的原始对象。
 *
 * 除按字段名隐藏敏感值外，还会处理连接 URI、Bearer Token、BigInt、Date 和循环引用。
 * 默认对 Error 只保留类型名称；开发模式可选保留已处理的消息、堆栈和 cause。
 */
export function redact(
  value: unknown,
  seen = new WeakSet<object>(),
  options: RedactOptions = {},
): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    if (!options.includeStack) return { name: value.name };
    return {
      name: value.name,
      message: redact(value.message, seen, options),
      stack: redact(value.stack, seen, options),
      cause: redact(value.cause, seen, options),
    };
  }
  if (typeof value === 'string') {
    return value
      .replace(/\b(?:mysql|redis|rediss):\/\/[^\s]+/gi, '[REDACTED_URL]')
      .replace(/\bBearer\s+\S+/gi, 'Bearer [REDACTED]');
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map((item) => redact(item, seen, options));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      sensitiveKey.test(key) ? '[REDACTED]' : redact(item, seen, options),
    ]),
  );
}
