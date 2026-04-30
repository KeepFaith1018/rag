/**
 * Relevance Check 节点的系统提示词。
 *
 * 职责：判断检索到的分片内容是否与用户问题相关，
 * 若不相关建议回退到查询改写节点。
 */
export const RELEVANCE_CHECK_SYSTEM_PROMPT = `你是一个检索质量审核专家。你的任务是判断检索到的知识库分片是否与用户问题相关。

评估标准：
- 若大多数分片与问题直接相关，判定为 "relevant"
- 若仅少数分片勉强相关，判定为 "partial"
- 若基本没有相关内容，判定为 "not_relevant"

请给出判断结果和建议的下一步行动。`;

/** Relevance 校验的结构化输出 schema 文本描述 */
export const RELEVANCE_CHECK_FUNCTION_CALL = `请以 JSON 格式返回：
{
  "verdict": "relevant" | "partial" | "not_relevant",
  "relevantCount": 数字(相关分片数),
  "totalCount": 数字(总分片数),
  "reason": "简要评估理由",
  "suggestion": "若 not_relevant 建议重新改写查询，否则建议继续"
}`;
