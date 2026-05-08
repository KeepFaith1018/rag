/**
 * 检索模块共享工具函数。
 */

/**
 * 多路检索结果按 chunkId 去重，保留每路最高分，
 * 返回按 score 降序排列的结果。
 */
export function dedupByHighestScore<
  T extends { chunkId: string; score: number },
>(groups: T[][], topK?: number): T[] {
  const seen = new Map<string, T>();
  for (const group of groups) {
    for (const hit of group) {
      const existing = seen.get(hit.chunkId);
      if (!existing || hit.score > existing.score) {
        seen.set(hit.chunkId, hit);
      }
    }
  }
  const sorted = Array.from(seen.values()).sort(
    (a, b) => b.score - a.score,
  );
  return topK ? sorted.slice(0, topK) : sorted;
}

/**
 * 简单分词，供文本匹配/关键词提取使用。
 *
 * 按中英文标点及空白字符分割，默认过滤长度 ≤1 的 token。
 */
export function tokenize(
  text: string,
  options?: { minLength?: number },
): string[] {
  const minLen = options?.minLength ?? 2;
  return text
    .split(/[\s,，。！？、；：""''（）()［］【】{}<>/\\|@#$%^&*+=~`]+/)
    .filter((t) => t.length >= minLen);
}

/**
 * 四舍五入到指定小数位数。
 */
export function roundTo(n: number, decimals: number = 3): number {
  const factor = Math.pow(10, decimals);
  return Math.round(n * factor) / factor;
}
