import type { AguiStepRecord, AguiToolCallRecord } from '@/modules/chat/types/stream';

/** 步骤名 → 图标 + 中文标签 */
export const STEP_META: Record<string, { icon: string; label: string }> = {
  route: { icon: 'psychology', label: '路由分析' },
  decompose: { icon: 'account_tree', label: '问题拆解' },
  rewrite: { icon: 'edit', label: '查询改写' },
  rewrite_fallback: { icon: 'replay', label: '改写回退' },
  relevance_check: { icon: 'preview', label: '相关性校验' },
  audit: { icon: 'grading', label: '检索审计' },
  writer: { icon: 'edit_note', label: '生成回答' },
};

export const DEFAULT_STEP_META = { icon: 'circle', label: '' };

/** 步骤名 → 中文标签 */
export function stepLabel(stepName: string): string {
  return STEP_META[stepName]?.label ?? stepName;
}

/** 步骤名 → 图标 + 标签 */
export function stepMeta(stepName: string): { icon: string; label: string } {
  return STEP_META[stepName] ?? { ...DEFAULT_STEP_META, label: stepName };
}

/** 步骤输出摘要 */
export function stepOutputSummary(step: { stepName: string; output?: Record<string, unknown> }): string {
  if (!step.output) return '';
  switch (step.stepName) {
    case 'route':
      return `意图: ${(step.output as Record<string, unknown>).intent ?? 'unknown'}`;
    case 'rewrite': {
      const queries = (step.output as Record<string, unknown>).queries as string[] | undefined;
      return `改写完成 → ${queries?.length ?? 0} 条查询`;
    }
    case 'audit': {
      const verdict = (step.output as Record<string, unknown>).verdict as string | undefined;
      const label = verdict === 'sufficient' ? '检索充分' : verdict === 'insufficient' ? '检索不足' : (verdict ?? 'unknown');
      return `评估: ${label}`;
    }
    case 'writer':
      return `回答生成完成 → ${(step.output as Record<string, unknown>).answerLength ?? 0} 字`;
    case 'fact_check': {
      const out = step.output as Record<string, unknown>;
      if (out.skipped) return '已跳过';
      const risk = out.overallRisk as string | undefined;
      if (risk === 'low') return '风险: 低';
      if (risk === 'medium') return '风险: 中';
      if (risk === 'high') return '风险: 高';
      return out.itemCount != null ? `审核 ${out.itemCount} 条` : '';
    }
    case 'completeness_check': {
      const out = step.output as Record<string, unknown>;
      if (out.skipped) return '已跳过';
      const cov = out.coverage as number | undefined;
      return cov != null ? `覆盖率: ${Math.round(cov * 100)}%` : '';
    }
    case 'relevance_check': {
      const v = (step.output as Record<string, unknown>).verdict as string | undefined;
      if (v === 'relevant') return '相关';
      if (v === 'not_relevant') return '不相关';
      if (v === 'partial') return '部分相关';
      return '';
    }
    default:
      return '';
  }
}

/** 工具图标和标签映射 */
export const TOOL_META: Record<string, { icon: string; label: string }> = {
  search_knowledge_base: { icon: 'search', label: '知识库检索' },
  web_search: { icon: 'language', label: '联网搜索' },
};

/** 工具名 → 图标 + 标签 */
export function toolMeta(toolName: string): { icon: string; label: string } {
  return TOOL_META[toolName] ?? { icon: 'build', label: toolName };
}

/** 工具输出摘要 */
export function toolOutputSummary(tc: AguiToolCallRecord): string {
  if (!tc.output) return '';
  if (tc.toolCallName === 'search_knowledge_base') {
    const out = tc.output as Record<string, unknown>;
    return `检索到 ${out.hitCount ?? 0} 条结果${tc.durationMs ? ` (${tc.durationMs}ms)` : ''}`;
  }
  if (tc.toolCallName === 'web_search') {
    const out = tc.output as Record<string, unknown>;
    return `${out.resultCount ?? 0} 条结果${tc.durationMs ? ` (${tc.durationMs}ms)` : ''}`;
  }
  return '';
}

/** 审计是否判定为不足 */
export function isAuditInsufficient(step: AguiStepRecord): boolean {
  if (step.stepName !== 'audit') return false;
  if (step.status !== 'completed') return false;
  if (!step.output) return false;
  return (step.output as Record<string, unknown>).verdict === 'insufficient';
}
