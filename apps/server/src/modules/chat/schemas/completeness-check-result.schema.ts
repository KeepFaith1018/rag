import { z } from 'zod';

/** 完整性校验结果 */
export const CompletenessCheckResultSchema = z.object({
  coveredAspects: z
    .array(z.string())
    .describe('已被回答覆盖的分析维度'),
  missingAspects: z
    .array(
      z.object({
        aspect: z.string().describe('缺失的分析维度'),
        reason: z.string().describe('为什么该维度是必要的'),
        retrievable: z.boolean().describe('是否可以通过补充检索覆盖'),
      }),
    )
    .describe('当前尚未覆盖的分析维度'),
  overallCoverage: z
    .number()
    .min(0)
    .max(1)
    .describe('整体覆盖率 0~1'),
  needSupplement: z
    .boolean()
    .describe('是否需要补充检索或补充回答'),
});

export type CompletenessCheckResult = z.infer<
  typeof CompletenessCheckResultSchema
>;
