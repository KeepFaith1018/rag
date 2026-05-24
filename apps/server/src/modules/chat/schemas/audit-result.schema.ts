import { z } from 'zod';

/**
 * 检索审计（Audit）节点的结构化输出 Schema。
 *
 * verdict: 检索结果是否充分
 */
export const AuditResultSchema = z.object({
  verdict: z.enum(['sufficient', 'insufficient']).describe('检索结果是否足够回答问题'),
});

export type AuditResult = z.infer<typeof AuditResultSchema>;
