/**
 * 将 Controller 返回值递归转换为 JSON 可安全序列化的值。
 *
 * 转换仅发生在 API 输出边界，不修改 BigInt.prototype 等全局对象，避免影响 Prisma、
 * 队列任务或同一进程内的其他序列化逻辑。
 */
export function toJsonValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(toJsonValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toJsonValue(item)]),
    );
  }
  return value;
}
