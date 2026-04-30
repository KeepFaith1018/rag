# Chat 模块阶段五实施记录

## 概述

按照《[12-agentic-rag-detailed-design-2026-04-27.md](../../../docs/12-agentic-rag-detailed-design-2026-04-27.md)》中阶段五的规划，完成治理与优化模块的搭建。实现了 Trace 查询 API、限流 Guard、流式请求专用限流策略。

## 完成清单

### 1. AgentTraceController（1 个文件）

| 接口 | 方法 | 路径 | 用途 |
|------|------|------|------|
| `getSessionRuns` | GET | `/agent/sessions/:sessionId/runs` | 查询会话的所有 Agent Run 记录 |
| `getRunDetail` | GET | `/agent/runs/:runId` | 查询单个 Run 的完整轨迹（含 steps）|
| `getMetricsSummary` | GET | `/agent/metrics/summary` | 获取用户的使用统计摘要 |

**涉及文件**：
- `src/modules/agent/agent-trace.controller.ts` — 新建

### 2. 限流 Guard（1 个文件）

| Guard | 算法 | 限制策略 |
|-------|------|----------|
| `RateLimitGuard` | 滑动窗口 | 每用户每分钟 30 次普通请求 |
| `StreamRateLimitGuard` | 滑动窗口 | 每用户每分钟 10 次流式请求 |

**已应用**：`POST /chat/stream` 接口应用了 `StreamRateLimitGuard`。

**涉及文件**：
- `src/common/guards/rate-limit.guard.ts` — 新建

### 3. AgentModule 更新

新增 `AgentTraceController` 到 `AgentModule.controllers`，并导出 `AgentTraceService`。

**涉及文件**：
- `src/modules/agent/agent.module.ts` — 修改

## Trace 数据结构

### b_agent_runs

| 字段 | 类型 | 说明 |
|------|------|------|
| id | Char(36) | UUID，主键 |
| session_id | Char(36) | 关联会话 |
| user_id | BigInt | 用户 ID |
| user_message_id | BigInt | 用户消息 ID |
| assistant_message_id | BigInt? | 助手消息 ID |
| status | VarChar(30) | running/completed/failed |
| total_tokens | Int? | Token 消耗 |
| duration_ms | Int? | 总耗时（毫秒）|
| chat_mode | VarChar(20) | chat / rag |
| selected_kb_ids_json | Json? | 用户选择的知识库 |
| resolved_kb_ids_json | Json? | 实际解析到的知识库 |
| created_at | DateTime | 创建时间 |
| finished_at | DateTime? | 完成时间 |

### b_agent_steps

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BigInt | 自增主键 |
| run_id | Char(36) | 关联 Run ID |
| agent_name | VarChar(50) | Agent 名称（router/rewrite/retriever/writer/verifier）|
| step_type | VarChar(50) | 步骤类型（route_query/draft_answer/fact_check 等）|
| status | VarChar(30) | running/completed/failed |
| input_json | Json? | 输入参数 |
| output_json | Json? | 输出结果 |
| duration_ms | Int? | 该步骤耗时 |
| started_at | DateTime | 开始时间 |
| finished_at | DateTime? | 结束时间 |

## 限流策略说明

### 普通请求限流（RateLimitGuard）

- 滑动窗口：60 秒
- 阈值：每用户每分钟 30 次
- 超出返回 HTTP 429，错误码 `42900`

### 流式请求限流（StreamRateLimitGuard）

- 滑动窗口：60 秒
- 阈值：每用户每分钟 10 次
- 原因：流式请求持续时间长，占用连接多，需要更严格的限制
- 超出返回 HTTP 429，错误码 `42901`

### 生产环境建议

建议后续将内存存储替换为 Redis + Lua 脚本，实现：
- 分布式限流（多实例共享计数）
- 持久化存储（重启不丢失）
- 更精确的滑动窗口算法

## 涉及文件汇总

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/modules/agent/agent-trace.controller.ts` | 新建 | Trace 查询 API |
| `src/modules/agent/dto/agent-trace.dto.ts` | 新建 | DTO 定义 |
| `src/common/guards/rate-limit.guard.ts` | 新建 | 限流 Guard |
| `src/modules/chat/chat.controller.ts` | 修改 | 流式接口应用 `StreamRateLimitGuard` |
| `src/modules/agent/agent.module.ts` | 修改 | 注册 `AgentTraceController` |
