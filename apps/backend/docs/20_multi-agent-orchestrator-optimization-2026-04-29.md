# 多智能体编排优化总结

**日期**: 2026-04-29

## 优化背景

用户反馈流式多智能体编排存在两个核心问题：
1. 决策节点频繁超时（`Request timed out`），复杂查询需要 130s+
2. 前端与控制台日志不同步

## 优化内容

### P0: `withStructuredOutput` 切换到 `json_mode`

**根因**：LangChain `withStructuredOutput(Schema)` 默认发送 `response_format: json_schema` + `strict: true`，百炼平台对此支持不稳定，导致模型在嵌套 schema（如 Rewrite）时卡死或超时。

**修复**：5 个决策节点的 `withStructuredOutput` 全部加上 `{ method: 'json_mode' }` 参数，改为发送百炼原生支持的 `response_format: json_object`。

```typescript
// 修改前
model.withStructuredOutput(RoutedQueryPlanSchema)
// 修改后
model.withStructuredOutput(RoutedQueryPlanSchema, { method: 'json_mode' })
```

### P1.1: 决策节点使用快模型

6 个决策节点（route/rewrite/decompose/fact_check/completeness_check/relevance_check）从 `qwen3.6-plus` 切换为 `qwen-turbo`，决策任务无需强模型。生成回答的节点保留 `qwen3.6-plus`。

### P1.2: fact_check 与 completeness_check 并行

两个校验节点仅读取 state（`draftAnswer`、`rerankedHits`），互不依赖对方的输出。改用 `Promise.all` 并行执行，校验阶段耗时从 15s×2 → max(15s, 15s)。

### P2: 删除 LangGraph 死代码

`streamRun()` 实现后不再使用 LangGraph，移除了：
- `StateGraph`/`Annotation` 导入
- `AgentStateAnnotation` → 改为纯 TypeScript `interface AgentState`
- `run()` 方法（~200 行）
- `draftAnswerNode` 函数（已被 `model.stream()` 替代）
- `shouldRetryOrContinue`/`shouldReviseOrContinue`/`shouldSupplementOrFinalize`（LangGraph 边缘条件函数）
- `MAX_FALLBACK` 常量

**文件变化**: 1203 行 → 870 行

## 效果对比

| 场景 | 优化前 | 优化后 |
|------|--------|--------|
| 简单查询 (fact_lookup) | 3 LLM 调用, ~10s | 2 LLM 调用, ~3-5s (route + generate) |
| 复杂查询 (compare_analysis) | 7 LLM 调用串行, 130s+ | 4-6 LLM 调用部分并行, ~30-40s |
| 决策超时概率 | 高（json_schema 不兼容） | 低（json_mode 原生支持） |

## 修改文件

- `apps/backend/src/modules/agent/services/multi-agent-orchestrator.service.ts` — 主要修改
- `apps/backend/src/modules/chat/services/chat-stream.service.ts` — streamRagMode 改用 streamRun
- `apps/backend/src/modules/document-processing/services/document-processing.service.ts` — Qdrant payload 加 content 字段
- `apps/backend/src/modules/ai/chat-model.service.ts` — createModel 加 timeout 默认值

## 保留的架构

`streamRun()` 使用 **LangGraph 管编排 + 独立流式生成** 的混合架构：

```
┌─── LangGraph 预生成图 ──────────────────────────────┐
│  route → rewrite → decompose → retrieve → relevance │
│     ↑                                    │          │
│     └───── retry loop ──────────────────┘          │
│  graph.stream() → 逐节点推送 8: 状态事件             │
└────────────────────────────────────────────────────┘
                        ↓
┌─── 流式生成（独立于 graph）───┐
│  model.stream() → 逐 token 推送 0: 文本事件          │
└──────────────────────────────┘
                        ↓
┌─── 质量校验（仅复杂查询）───┐
│  Promise.all(fact_check, completeness_check)        │
│  逐校验结果推送 8: 状态事件                          │
└──────────────────────────┘
```

LangGraph 负责 branch/loop 逻辑（route→rewrite, relevance→retry），流式生成脱离 graph 实现 token 级实时输出。
