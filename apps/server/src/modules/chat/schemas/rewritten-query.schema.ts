import { z } from 'zod';

/** 单条改写后的查询 */
export const RewrittenQuerySchema = z.object({
  rewritten: z
    .string()
    .describe('改写后的查询文本，补充了上下文和关键术语'),
  focus: z
    .string()
    .describe('本次检索应关注的关键信息维度'),
});

export type RewrittenQuery = z.infer<typeof RewrittenQuerySchema>;

/** Rewrite 节点输出的多条改写查询 */
export const RewriteOutputSchema = z.object({
  queries: z
    .array(RewrittenQuerySchema)
    .min(1)
    .max(3)
    .describe('改写后的查询列表，最多 3 条，按优先级排列'),
});

export type RewriteOutput = z.infer<typeof RewriteOutputSchema>;
