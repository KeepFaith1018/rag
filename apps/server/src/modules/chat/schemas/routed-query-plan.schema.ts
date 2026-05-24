import { z } from 'zod';

/** Router 输出的查询规划结构 */
export const RoutedQueryPlanSchema = z.object({
  intent: z
    .enum(['greeting', 'fact_lookup', 'compare_analysis', 'research_or_open_world'])
    .describe('用户问题的意图分类，决定了后续所有字段的处理方式'),
  needDecomposition: z
    .boolean()
    .describe('问题是否复杂到需要拆解为多个子问题，greeting 意图时固定为 false'),
  needWebSearch: z
    .boolean()
    .describe('知识库内容是否不足以回答，建议启动联网搜索，greeting 意图时固定为 false'),
  questionType: z
    .enum(['fact_lookup', 'compare_analysis', 'research_or_open_world'])
    .describe('问题类型，仅非 greeting 意图时有效；greeting 意图时请设置为 "fact_lookup"')
    .default('fact_lookup'),
});

export type RoutedQueryPlan = z.infer<typeof RoutedQueryPlanSchema>;
