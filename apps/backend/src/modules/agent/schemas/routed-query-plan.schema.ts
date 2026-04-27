import { z } from 'zod';

/** Router 输出的查询规划结构 */
export const RoutedQueryPlanSchema = z.object({
  intent: z
    .enum(['greeting', 'fact_lookup', 'compare_analysis', 'research_or_open_world'])
    .describe('用户问题的意图分类'),
  needDecomposition: z
    .boolean()
    .describe('问题是否复杂到需要拆解为多个子问题'),
  needWebSearch: z
    .boolean()
    .describe('知识库内容是否不足以回答，建议启动联网搜索'),
  reasoning: z
    .string()
    .describe('路由决策的简要推理过程'),
  questionType: z
    .enum(['fact_lookup', 'compare_analysis', 'research_or_open_world'])
    .describe('问题类型，用于后续检索策略选择'),
});

export type RoutedQueryPlan = z.infer<typeof RoutedQueryPlanSchema>;
