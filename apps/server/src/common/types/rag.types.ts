/** RAG 检索全链路共享类型 */

/** 问题类型 */
export type QuestionType =
  | 'fact_lookup'
  | 'compare_analysis'
  | 'research_or_open_world';

export const QUESTION_TYPES = [
  'fact_lookup',
  'compare_analysis',
  'research_or_open_world',
] as const;
