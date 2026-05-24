# 阶段二实施记录：Agentic RAG 自校正闭环

> 日期：2026-05-08 | 分支：`feat/rag-pipeline-optimization`
>
> 实施内容：在 LangGraph 编排中引入检索质量校验和自校正闭环，实现从"一次性流水线"到"Agentic RAG"的跃迁。

---

## 一、实施概览

### 1.1 新增 7 个 LangGraph 节点

| 节点 | 阶段 | 功能 | 触发条件 |
|------|------|------|---------|
| `relevance_check` | 检索后 | 评估检索结果与问题的相关性 | tools 之后始终执行 |
| `rewrite_fallback` | 检索重试 | 更激进的查询改写（换词、去限制、更宽泛角度） | audit=insufficient + retryCount<2 |
| `fact_check` | 生成后 | 逐条校验回答事实是否有检索证据支撑 | writer 之后始终执行 |
| `writer_correct` | 回答修正 | 基于事实校验反馈修正回答 | fact_check=high/medium risk + needRevise |
| `completeness_check` | 校验后 | 检查回答是否覆盖原始问题的所有维度 | fact_check 通过后 |
| `supplement_retrieve` | 补充检索 | 用缺失维度构造补充查询并检索 | completeness<0.8 + 有可检索维度 |
| `writer_supplement` | 补充生成 | 基于补充检索结果生成补充回答 | supplement_retrieve 之后 |

### 1.2 新增 3 个状态字段

```typescript
relevanceVerdict: Annotation<string | null>()    // 'relevant' | 'partial' | 'not_relevant'
retrievalRetryCount: Annotation<number>()         // 默认 0，最大 2
factCheckResult: Annotation<FactCheckResult | null>()
completenessResult: Annotation<CompletenessCheckResult | null>()
supplementAnswer: Annotation<string>()            // 补充回答文本
```

### 1.3 新增 4 条条件边

| 条件边 | 逻辑 |
|--------|------|
| `relevanceEdge` | relevant/partial → audit；not_relevant → rewrite |
| `auditEdge` | sufficient → writer；insufficient+web+首次 → web_search；insufficient+retry<2 → rewrite_fallback；retry>=2 → writer |
| `factCheckEdge` | low risk / medium+!needRevise → completeness_check；high/medium+needRevise → writer_correct |
| `completenessEdge` | coverage>=0.8 → \_\_end\_\_；<0.8+有可检索维度 → supplement_retrieve |

---

## 二、完整图结构

```
__start__
    │
    ▼
  route ──greeting──→ writer ──────────────────────────────────────────────┐
    │                    ↑                                                  │
    │ needDecomposition  │                                                  │
    ├──→ decompose ──→ rewrite                                             │
    │       │            ↑                                                  │
    │       └────────────┘                                                  │
    │ fact_lookup                                                           │
    └──→ rewrite ──→ retrieve_prep ──→ tools                                │
                                           │                                │
                                           ▼                                │
                                     relevance_check                       │
                                      /           \                         │
                                 relevant     not_relevant                  │
                                    │              │                        │
                                    ▼              └──→ rewrite             │
                                   audit                                   │
                                  /  |  \                                   │
                          sufficient |  insufficient                        │
                              │      |    /        \                        │
                              │   web_search  rewrite_fallback              │
                              │      │          ↓                           │
                              │      │    tools → audit                     │
                              │      │                                      │
                              └──────┴──────────────────────────────────────┤
                                     │                                       │
                                     ▼                                       │
                                   writer ←──────────────────────────────────┘
                                     │
                                     ▼
                                 fact_check
                                 /        \
                        low_risk          high_risk / medium+needRevise
                            │                  │
                            ▼                  ▼
                    completeness_check    writer_correct
                       /        \              │
                ≥0.8          <0.8            ▼
                  │              │        fact_check (re-check)
                  ▼              ▼              
                __end__   supplement_retrieve
                                │
                                ▼
                          writer_supplement
                                │
                                ▼
                              __end__
```

---

## 三、关键实现细节

### 3.1 检索重试环

- 状态字段 `retrievalRetryCount` 在每次 rewrite_fallback 或 web_search 时递增
- rewrite_fallback 使用更激进的策略：temperature 从 0.3 提高到 0.5，prompt 指示"换用同义术语、去掉限制词、从更宽泛角度切入"
- 重试上限为 2 次，超出后直接进入 writer（告知用户检索不充分）

### 3.2 Fact Check 闭环

- 使用已定义的 `fact-check.prompt.ts` + `fact-check-result.schema.ts`
- 逐条校验回答陈述：supported / contradicted / not_verified
- 综合风险等级 low / medium / high
- 高风险（contradicted + not_verified 多）→ 触发 writer_correct
- writer_correct 用矛盾内容 + 无据内容构造修正指示，重新生成回答
- 修正后再次 fact_check（防止过度修正引入新问题，最多循环 1 次）

### 3.3 Completeness Check 补充检索

- 使用已定义的 `completeness-check.prompt.ts` + `completeness-check-result.schema.ts`
- 评估回答覆盖原始问题的程度（0~1）
- 输出已覆盖维度 + 缺失维度列表（标注是否可检索）
- 可检索的缺失维度 → 构造查询 → 补充检索 → 合并到已有结果
- 合并时去重（existingIds Set），避免重复 chunk

### 3.4 检索不充分时的 LLM 提示

- 当 `auditVerdict === 'insufficient' && retrievalRetryCount >= 2` 时
- writer 的 system prompt 尾部追加："⚠️ 当前知识库检索结果可能不足以完整回答该问题，请诚实告知用户当前资料的局限性"

### 3.5 回答合并

- onFinish 回调中将 `draftAnswer` 和 `supplementAnswer` 合并
- 补充内容以 `---\n**补充说明：**\n` 分隔，前端可用 Markdown 渲染

---

## 四、前端同步更新

### 4.1 StepName 类型扩展

```typescript
// apps/web/src/modules/chat/types/stream.ts
export type StepName =
  | 'route' | 'decompose' | 'rewrite' | 'rewrite_fallback'
  | 'relevance_check' | 'audit'
  | 'writer' | 'writer_correct' | 'writer_supplement'
  | 'fact_check' | 'completeness_check' | 'supplement_retrieve';
```

### 4.2 中文标签和图标

| stepName | 中文标签 | 图标 |
|----------|---------|------|
| `decompose` | 问题拆解 | account_tree |
| `rewrite_fallback` | 改写回退 | replay |
| `relevance_check` | 相关性校验 | preview |
| `writer_correct` | 修正回答 | edit_note |
| `writer_supplement` | 补充回答 | note_add |
| `fact_check` | 事实审核 | fact_check |
| `completeness_check` | 完整性校验 | checklist |
| `supplement_retrieve` | 补充检索 | search |

---

## 五、改动文件清单

### 后端

| 文件 | 改动 |
|------|------|
| `apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts` | 核心：新增 7 节点 + 4 条件边 + 3 状态字段 |
| `apps/server/src/modules/chat/types/agui-events.ts` | StepName 类型扩展 |

### 前端

| 文件 | 改动 |
|------|------|
| `apps/web/src/modules/chat/types/stream.ts` | StepName 类型同步 |
| `apps/web/src/components/chat/AIMessageItem.vue` | stepMeta 新增 8 条映射 |
| `apps/web/src/stores/chat.ts` | stepLabel 新增 8 条映射 |

---

## 六、验证结果

```bash
# 后端
pnpm --filter server build   # ✅ 0 errors
pnpm --filter server test    # ✅ 5 suites / 54 tests PASS

# 前端
pnpm --filter web build      # ✅ 0 errors (vue-tsc + vite)
```

### 端到端流程验证要点

1. **正常流程**：简单问题 → route → rewrite → tools → relevance_check → audit(sufficient) → writer → fact_check → completeness_check → \_\_end\_\_
2. **检索不充分 + web 兜底**：问题超出 KB 范围 → audit(insufficient) → web_search → writer → ...
3. **检索重试**：ES 故障 + web disabled → audit(insufficient) → rewrite_fallback → tools → audit → ...
4. **事实修正**：writer 生成不准确内容 → fact_check(high_risk) → writer_correct → fact_check → ...
5. **补充检索**：回答缺失维度 → completeness_check(<0.8) → supplement_retrieve → writer_supplement → \_\_end\_\_
6. **前端面板**：Agent 步骤面板正确展示全部新增步骤的中文标签和图标

---

## 七、后续计划

阶段三（代码质量提升）待实施项目：
- 提取共享工具函数（retrieval.utils.ts、message.utils.ts、bigint.utils.ts）
- 统一 QuestionType 类型定义
- 废弃 SearchKnowledgeBaseTool 重复类
- 补充 rerank fetch 超时、日志 requestId 等健壮性
