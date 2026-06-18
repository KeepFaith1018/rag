import { z } from 'zod';

/** 单条事实校验结果 */
export const FactCheckItemSchema = z.object({
  statement: z
    .string()
    .describe('回答中被校验的陈述句'),
  verdict: z
    .enum(['supported', 'contradicted', 'not_verified'])
    .describe('校验结论：supported=有证据支持 contradict=与证据矛盾 not_verified=证据不足无法判断'),
  evidence: z
    .string()
    .describe('支撑该结论的原文证据摘要'),
  sourceIndex: z
    .number()
    .int()
    .optional()
    .describe('对应检索上下文中来源编号'),
});

export type FactCheckItem = z.infer<typeof FactCheckItemSchema>;

/** Fact Check 节点输出 */
export const FactCheckResultSchema = z.object({
  items: z
    .array(FactCheckItemSchema)
    .describe('逐条事实校验结果'),
  overallRisk: z
    .enum(['low', 'medium', 'high'])
    .describe('整体事实风险等级'),
  needRevise: z
    .boolean()
    .describe('是否需要修正回答'),
});

export type FactCheckResult = z.infer<typeof FactCheckResultSchema>;
