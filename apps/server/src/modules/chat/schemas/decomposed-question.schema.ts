import { z } from 'zod';

/** 单条拆解后的子问题 */
export const DecomposedQuestionSchema = z.object({
  subQuestion: z
    .string()
    .describe('子问题文本，应可独立检索与回答'),
  aspect: z
    .string()
    .describe('该子问题关注的分析维度或信息面'),
  keywords: z
    .array(z.string())
    .describe('用于检索的关键词列表'),
});

export type DecomposedQuestion = z.infer<typeof DecomposedQuestionSchema>;

/** Decompose 节点输出 */
export const DecomposeOutputSchema = z.object({
  questions: z
    .array(DecomposedQuestionSchema)
    .min(1)
    .max(5)
    .describe('拆解后的子问题列表'),
  dependency: z
    .enum(['independent', 'sequential'])
    .describe('子问题之间的依赖关系：independent 表示可并行检索，sequential 表示需按序处理'),
});

export type DecomposeOutput = z.infer<typeof DecomposeOutputSchema>;
