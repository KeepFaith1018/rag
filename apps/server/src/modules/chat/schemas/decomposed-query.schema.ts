import { z } from 'zod';

/** 单个拆解后的子问题 */
export const DecomposedSubQuerySchema = z.object({
  question: z.string().describe('拆解后的独立子问题，可独立检索和回答'),
  keywords: z
    .array(z.string())
    .min(3)
    .max(5)
    .describe('用于检索的关键词列表，3~5 个'),
});

export type DecomposedSubQuery = z.infer<typeof DecomposedSubQuerySchema>;

/** Decompose 节点输出的拆解结果 */
export const DecomposeOutputSchema = z.object({
  subQueries: z
    .array(DecomposedSubQuerySchema)
    .min(1)
    .max(5)
    .describe('拆解后的子问题列表，最多 5 个'),
});

export type DecomposeOutput = z.infer<typeof DecomposeOutputSchema>;
