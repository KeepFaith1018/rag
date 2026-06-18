# LangChain withStructuredOutput 与第三方 API 兼容性问题

**日期**: 2026-04-29
**问题类型**: API 兼容性错误
**影响范围**: Agentic RAG 工作流中的结构化输出节点

---

## 问题描述

### 错误日志

```
400 InternalError.Algo.InvalidParameter:
'messages' must contain the word 'json' in some form,
to use 'response_format' of type 'json_object'.
```

### 错误位置

请求路径：`POST /api/chat/stream`
影响模块：`MultiAgentOrchestratorService`

### 受影响的节点函数

| 节点 | 函数名 | 使用的 Schema |
|------|--------|--------------|
| Router | `routeQueryNode` | `RoutedQueryPlanSchema` |
| Rewriter | `rewriteQueryNode` | `RewriteOutputSchema` |
| Decomposer | `decomposeNode` | `DecomposeOutputSchema` |
| Fact Checker | `factCheckNode` | `FactCheckResultSchema` |
| Completeness | `completenessCheckNode` | `CompletenessCheckResultSchema` |

---

## 问题原因

### 技术原理

当使用 LangChain 的 `withStructuredOutput(Schema)` 方法时：

```typescript
const structured = model.withStructuredOutput(RoutedQueryPlanSchema);
const result = await structured.invoke([...]);
```

LangChain 会在 API 请求中添加 `response_format: { type: 'json_object' }`，这要求 LLM 必须输出 JSON 格式。

### 兼容性问题

部分第三方 OpenAI 兼容 API（如硅基流动、火山引擎、通义千问等）对 `json_object` 格式有额外校验：

```
messages 中必须包含 "json" 关键词，才能使用 response_format: json_object
```

这是 API 提供商的额外限制，不是标准 OpenAI API 的要求。

### 根本原因

1. 项目使用第三方兼容 API（非官方 OpenAI API）
2. API 提供商对 `json_object` 格式有更严格的校验
3. SystemMessage 中未包含 "json" 关键词

---

## 解决方案

### 方案一：SystemMessage 添加 JSON 提示（已采用）

**原理**：在 SystemMessage 中添加 `请以 JSON 格式回复` 提示，满足 API 的关键词校验要求。

**实现方式**：

```typescript
// 修改前
const result = await structured.invoke([
  new SystemMessage(ROUTER_SYSTEM_PROMPT),
  new HumanMessage(state.originalQuery),
]);

// 修改后
const result = await structured.invoke([
  new SystemMessage(`${ROUTER_SYSTEM_PROMPT}\n\n请以 JSON 格式回复，输出完整的结构化数据。`),
  new HumanMessage(state.originalQuery),
]);
```

**优点**：
- 改动最小，只需修改提示词
- 兼容性好，不依赖 API 功能

**缺点**：
- 提示词可能影响原 Prompt 效果
- 依赖模型遵循指令

**适用场景**：快速修复，兼容性优先

---

### 方案二：JsonOutputParser 替代（推荐长期方案）

**原理**：使用 LangChain 的 `JsonOutputParser` 替代 `withStructuredOutput`，它通过 Prompt + 后处理解析实现结构化输出，不依赖 API 的 `json_object` 格式支持。

**实现方式**：

```typescript
import { JsonOutputParser } from '@langchain/core/output_parsers';

const parser = new JsonOutputParser({ schema: RoutedQueryPlanSchema });

const result = await model.pipe(parser).invoke([
  new SystemMessage(`${ROUTER_SYSTEM_PROMPT}\n\n请按以下格式输出JSON：...`),
  new HumanMessage(state.originalQuery),
]);
```

**优点**：
- 不依赖 API 的 json_object 支持
- 对第三方 API 兼容性更好
- 模型可以用 markdown 包裹 JSON，Parser 仍能解析

**缺点**：
- 需要额外安装/导入 JsonOutputParser
- 解析逻辑在应用层，理论上不如 API 原生支持可靠

**适用场景**：长期方案，API 功能受限

---

### 方案三：切换 API 提供商

**原理**：使用官方 OpenAI API 或对 `json_object` 支持更好的第三方 API。

**实现方式**：
```bash
# .env 配置
OPENAI_BASE_URL=https://api.openai.com/v1
```

**优点**：
- 根本解决问题

**缺点**：
- 可能需要付费
- 需要迁移 API 密钥

---

## 项目选择的方案

**选择**：方案一（SystemMessage 添加 JSON 提示）

**原因**：
1. 改动最小，风险可控
2. 不影响现有代码结构
3. 兼容现有 API 配置
4. 可作为快速验证，后续再考虑方案二

**实施日期**：2026-04-29

**修改文件**：
- `apps/backend/src/modules/agent/services/multi-agent-orchestrator.service.ts`

**修改位置**：
- `routeQueryNode` 函数（约第 148 行）
- `rewriteQueryNode` 函数（约第 205 行）
- `decomposeNode` 函数（约第 245 行）
- `factCheckNode` 函数（约第 325 行）
- `completenessCheckNode` 函数（约第 380 行）

**修改内容**：在所有使用 `withStructuredOutput` 的节点中，为 SystemMessage 添加 JSON 输出提示：

```typescript
new SystemMessage(`${XXX_SYSTEM_PROMPT}\n\n请以 JSON 格式回复，输出完整的结构化数据。`)
```

---

## 验证方式

1. 重启后端服务
2. 发起 RAG 模式对话请求
3. 检查日志中是否仍有 `json_object` 相关错误
4. 验证 Agent 工作流各节点是否正常执行

---

## 后续建议

1. **监控**：观察此方案是否稳定，如有问题考虑切换到方案二
2. **测试**：在 CI/CD 中增加对各 Agent 节点的结构化输出测试
3. **文档**：记录项目中使用的 API 提供商及其兼容性限制

---

## 相关文档

- [Agentic RAG 详细设计](../docs/12-agentic-rag-detailed-design-2026-04-27.md)
- [Agentic RAG 实现总结](../docs/14-agentic-rag-implementation-summary-2026-04-28.md)