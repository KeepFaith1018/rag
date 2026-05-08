# 提示词优化 — 详细实施计划

> 日期：2026-05-09 | 约束：JSON 字段描述保留（三方模型要求）

---

## 一、Phase 1：检索命中率（P0）

### 1.1 rewrite.prompt.ts — 增加关键词 + 长度约束 + Few-Shot

**文件**：`apps/server/src/modules/chat/prompts/rewrite.prompt.ts`

**改动**：

1. 通用改写策略新增第 6 条：
```
6. 每条查询必须附带 3~5 个关键词，使用空格分隔的专业术语组合
7. 查询长度 ≤15 字，优先使用"实体 + 属性/动作"的关键词形式
```

2. 输出格式新增 `keywords` 字段：
```json
{
  "queries": [
    {
      "rewritten": "简短的查询语句",
      "focus": "聚焦的信息维度",
      "keywords": "关键词1 关键词2 关键词3"
    }
  ]
}
```

3. Few-Shot 示例（插入到输出格式之前）：
```
【示例】
用户问题："Vue 3 的 setup 函数有什么作用？"
正确输出：
{
  "queries": [
    {
      "rewritten": "Vue3 setup 函数 作用",
      "focus": "setup 函数的核心功能",
      "keywords": "Vue3 setup 函数 Composition API"
    },
    {
      "rewritten": "setup 函数 使用方式 返回值",
      "focus": "setup 函数的用法和返回值",
      "keywords": "setup 返回值 ref reactive"
    }
  ]
}

用户问题："现代前端工程化体系构建工具链"
正确输出：
{
  "queries": [
    {
      "rewritten": "前端构建工具 Webpack Vite",
      "focus": "构建工具链的核心工具",
      "keywords": "Webpack Vite Rollup 构建工具"
    },
    {
      "rewritten": "CI/CD 前端自动化流程",
      "focus": "持续集成与部署",
      "keywords": "CI/CD GitHub Actions 自动化部署"
    }
  ]
}
```

### 1.2 ⚠️ multi-agent-orchestrator.service.ts — buildRetrieveQueries 收集 keywords

**文件**：`apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts`

**改动位置**：`buildRetrieveQueries` 函数（L483-489）

**现有代码**：
```typescript
function buildRetrieveQueries(state: AgentState): string[] {
  const queries: string[] = [state.originalQuery];
  if (state.decomposedQueries.length > 0)
    queries.push(...state.decomposedQueries);
  if (state.rewrittenQueries.length > 0)
    queries.push(...state.rewrittenQueries);
  return [...new Set(queries)].slice(0, 8);
}
```

**改为**：
```typescript
function buildRetrieveQueries(state: AgentState): string[] {
  const queries: string[] = [state.originalQuery];
  // decompose 的关键词（如有）比查询语句更适合稀疏检索
  if (state.decomposedKeywords && state.decomposedKeywords.length > 0)
    queries.push(...state.decomposedKeywords);
  if (state.decomposedQueries.length > 0)
    queries.push(...state.decomposedQueries);
  if (state.rewrittenQueries.length > 0)
    queries.push(...state.rewrittenQueries);
  // rewrite 的关键词（如有）
  if (state.rewrittenKeywords && state.rewrittenKeywords.length > 0)
    queries.push(...state.rewrittenKeywords);
  return [...new Set(queries)].slice(0, 10);  // 上限从 8 → 10（关键词短，可多送几条）
}
```

### 1.3 ⚠️ AgentStateAnnotation — 新增 keywords 状态字段

**文件**：`apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts`

**改动位置**：`AgentStateAnnotation`（L43-68）

新增两个字段：
```typescript
/** decompose 节点提取的关键词（用于稀疏检索） */
decomposedKeywords: Annotation<string[]>(),
/** rewrite 节点提取的关键词（用于稀疏检索） */
rewrittenKeywords: Annotation<string[]>(),
```

### 1.4 ⚠️ decompose / rewrite 节点 — 写入 keywords 到 state

**改动位置**：`decomposeQueryNode` 返回值（L331）和 `rewriteQueryNode` 返回值（L227）

**decompose 节点**（L331 附近）：
```typescript
return {
  decomposedQueries: queries,
  decomposedKeywords: output.subQueries.flatMap(sq => sq.keywords || []),
  currentPhase: 'planning',
};
```

**rewrite 节点**（L227 附近）：
```typescript
return {
  rewrittenQueries: queries,
  rewrittenKeywords: output.queries.flatMap(q => (q as any).keywords?.split(/[\s,，]+/) || []),
  currentPhase: 'planning',
};
```

### 1.5 ⚠️ graph.invoke 初始 state — 新增字段初始值

**改动位置**：`graph.invoke` 调用（L1236+）

新增：
```typescript
decomposedKeywords: [],
rewrittenKeywords: [],
```

---

## 二、Phase 2：校验准确性（P1）

### 2.1 fact-check.prompt.ts — Few-Shot 示例

**文件**：`apps/server/src/modules/chat/prompts/fact-check.prompt.ts`

**改动**：在"审核规则"之后、"输出格式"之前插入示例：

```
【Few-Shot 示例】

示例 1：supported（有充分证据）
检索证据：[来源1] Vue 3 的 setup 函数在 beforeCreate 和 created 之间执行，是整个组件中最早执行的生命周期钩子。
回答陈述："setup 函数在 beforeCreate 之前执行"
判定：contradicted — 证据明确说在 beforeCreate 和 created "之间"，非"之前"
{
  "statement": "setup 函数在 beforeCreate 之前执行",
  "verdict": "contradicted",
  "evidence": "setup 函数在 beforeCreate 和 created 之间执行",
  "sourceIndex": 1
}

示例 2：not_verified（证据不足）
检索证据：[来源1] React 使用 Virtual DOM 进行高效的 UI 更新。
回答陈述："React 的 Virtual DOM diff 算法时间复杂度是 O(n)"
判定：not_verified — 证据只说了 Virtual DOM 的存在，未提及算法复杂度
{
  "statement": "React 的 Virtual DOM diff 算法时间复杂度是 O(n)",
  "verdict": "not_verified",
  "evidence": "证据仅提及 Virtual DOM，未提供复杂度信息",
  "sourceIndex": null
}

示例 3：supported（有充分证据）
检索证据：[来源1] Node.js 事件循环中，process.nextTick 优先于 Promise.then 执行。
回答陈述："process.nextTick 的回调比 Promise.then 更早执行"
判定：supported
{
  "statement": "process.nextTick 的回调比 Promise.then 更早执行",
  "verdict": "supported",
  "evidence": "process.nextTick 优先于 Promise.then 执行",
  "sourceIndex": 1
}
```

### 2.2 completeness-check.prompt.ts — 回扣 decompose 子问题

**文件**：`apps/server/src/modules/chat/prompts/completeness-check.prompt.ts`

**改动**：审核维度新增第 4 条：

```
4. 子问题对照：如果提供了拆解出的子问题列表，逐条检查每个子问题是否在回答中有对应内容
```

在"输出格式"之前增加：
```
【子问题对照检查方法】
- 系统会提供原始问题拆解出的子问题列表（如有）
- 逐条判断每个子问题在回答中是否被覆盖
- 如果某个子问题完全没有被回答涉及，必须将该维度加入 missingAspects
- 如果所有子问题都已覆盖，coveredAspects 应包含全部子问题
```

### 2.3 ⚠️ orchestrator — completeness_check 节点传入子问题

**文件**：`apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts`

**改动位置**：`completeness_check` 节点的 HumanMessage（L1040+）

**现有代码**：
```typescript
new HumanMessage(
  `用户问题: ${s.originalQuery}\n子问题列表: ${(s.decomposedQueries ?? []).join('; ') || '（未拆解）'}\n当前回答: ${s.draftAnswer}`,
)
```

已传入 `decomposedQueries`，无需额外改动。prompt 中增加"逐条对照子问题"的指令即可生效。

### 2.4 relevance-check.prompt.ts — 量化阈值

**文件**：`apps/server/src/modules/chat/prompts/relevance-check.prompt.ts`

**改动**：评估标准改为量化版本：

```
评估标准：
- relevant: ≥2 条结果与问题直接相关，包含回答所需的关键信息
- partial: 仅 1 条结果勉强相关，或相关但信息量明显不足
- not_relevant: 0 条相关结果，或全部结果与问题无关
```

---

## 三、改动汇总

| # | 文件 | 类型 | 改动内容 |
|---|------|:--:|------|
| 1 | `rewrite.prompt.ts` | **Prompt** | 增加 keywords 字段 + ≤15字约束 + Few-Shot 示例 |
| 2 | `fact-check.prompt.ts` | **Prompt** | 3 个 Few-Shot 示例 |
| 3 | `completeness-check.prompt.ts` | **Prompt** | 子问题对照检查方法 |
| 4 | `relevance-check.prompt.ts` | **Prompt** | 量化阈值 |
| 5 | `multi-agent-orchestrator.service.ts` | ⚠️ **代码** | buildRetrieveQueries 收集 keywords |
| 6 | `multi-agent-orchestrator.service.ts` | ⚠️ **代码** | AgentState 新增 decomposedKeywords/rewrittenKeywords |
| 7 | `multi-agent-orchestrator.service.ts` | ⚠️ **代码** | decompose/rewrite 节点写入 keywords + graph 初始 state |

**Prompt 文件**: 4 个（rewrite/fact-check/completeness/relevance）
**代码文件**: 1 个（orchestrator，3 处改动点）
**不改动**: router / audit / writer / decompose 的 prompt（当前阶段无优化点）

---

## 四、验收方式

1. `pnpm --filter server build` 编译通过
2. SSE 抓包验证：同问题下检索 hitCount 应有提升（关键词补入后）
3. fact_check 输出中可以观察到 Few-Shot 引导的判定分布变化
