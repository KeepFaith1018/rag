# 阶段三实施记录：代码质量提升

> 日期：2026-05-08 | 分支：`feat/rag-pipeline-optimization`
>
> 实施内容：提取共享工具函数、统一类型定义、清理重复/废弃代码、补充健壮性。

---

## 一、新建共享模块

### 1.1 共享类型定义

**文件**: `apps/server/src/common/types/rag.types.ts`

```typescript
export type QuestionType =
  | 'fact_lookup'
  | 'compare_analysis'
  | 'research_or_open_world';

export const QUESTION_TYPES = [...] as const;
```

消除 4 个文件中重复的字符串字面量联合类型。

### 1.2 检索工具函数

**文件**: `apps/server/src/common/utils/retrieval.utils.ts`

| 函数 | 消除重复 | 来源 |
|------|---------|------|
| `dedupByHighestScore<T>(groups, topK?)` | 3 处 | dense-retrieval, elasticsearch-sparse-retrieval, sparse-retrieval |
| `tokenize(text, options?)` | 2 处 | rerank.service, sparse-retrieval.service（正则完全相同） |
| `roundTo(n, decimals?)` | 9 处 | fusion.service, rerank.service |

### 1.3 消息工具函数

**文件**: `apps/server/src/common/utils/message.utils.ts`

| 函数 | 消除重复 | 来源 |
|------|---------|------|
| `extractMessageContent(msg)` | 2 处 | orchestrator(`extractContent`), chat-stream(`extractChunkText`) |
| `getErrorMessage(error, fallback?)` | ~10 处 | 各服务的 `error instanceof Error ? error.message : String(error)` |

### 1.4 BigInt 安全转换

**文件**: `apps/server/src/common/utils/bigint.utils.ts`

```typescript
export function parseBigInt(value: string): bigint
```

统一 `BigInt()` 调用，非法输入抛出 `BusinessException(PARAM_ERROR)` 而非原生 `TypeError`。

---

## 二、重构清单

### 2.1 检索服务层

| 文件 | 改动前 | 改动后 |
|------|--------|--------|
| `dense-retrieval.service.ts` | 手写 `seen Map → for → sort` 去重 | `dedupByHighestScore(resultGroups, topK)` |
| `elasticsearch-sparse-retrieval.service.ts` | 手写 `seen Map → for → sort → slice` 去重 | `dedupByHighestScore(resultGroups, topK)` |
| `fusion.service.ts` | `Math.round(x * 1_000_000) / 1_000_000` ×3 | `roundTo(x, 6)` / `roundTo(x)` |
| `rerank.service.ts` | `this.tokenize()` 私有方法<br>`Math.round(x * 1000) / 1000` ×5<br>`error instanceof Error ? error.message : String(error)` ×N<br>`questionType: string` 类型 | `tokenize()` 导入<br>`roundTo(x)`<br>`getErrorMessage(error)`<br>`QuestionType` 类型 |
| `rerank-model.service.ts` | `fetch(url, {...})` 无超时 | `fetch(url, {..., signal: AbortSignal.timeout(15000)})` |

### 2.2 编排服务层

| 文件 | 改动前 | 改动后 |
|------|--------|--------|
| `multi-agent-orchestrator.service.ts` | `extractContent()` 私有函数<br>`error instanceof Error ? error.message : String(error)` ×N | `extractMessageContent()` 导入<br>`getErrorMessage(error)` 导入 |
| `chat-stream.service.ts` | `extractChunkText(chunk)` 私有函数 | `extractMessageContent(chunk)` 导入 |
| `retrieval.service.ts` | 内联 `'fact_lookup' \| 'compare_analysis' \| 'research_or_open_world'` | `QuestionType` 导入 |

### 2.3 数据访问层

| 文件 | 改动前 | 改动后 |
|------|--------|--------|
| `citation.service.ts` | `this.toBigInt(value)` 私有方法（唯一有 try-catch 的） | `parseBigInt(value)` 导入 |
| `get-chunk-detail.tool.ts` | `BigInt(chunkId)` 无 try-catch | `parseBigInt(chunkId)` 带 BusinessException |

---

## 三、废弃与清理

### 3.1 SearchKnowledgeBaseTool

- **原因**: 与 orchestrator 内联 `createSearchTool()` 功能重叠，且参数行为不一致（硬编码 `topK=20` vs questionType 自适应）
- **文件**: `apps/server/src/modules/chat/services/tools/search-knowledge-base.tool.ts` — 删除
- **模块**: `chat.module.ts` — 移除 `providers` 和 `exports` 中的引用（2 处）
- **无其他引用**: `grep -r SearchKnowledgeBaseTool src/` 结果为空

### 3.2 titlePath JSON.parse 回退

`rerank.service.ts` 的 `computeTitlePathBoost()` 中原有：
```typescript
const tpArr: string[] = Array.isArray(tpVal)
  ? tpVal.map(String)
  : typeof tpVal === 'string'
    ? (() => { try { return JSON.parse(tpVal) as string[]; } catch { return []; } })()
    : [];
```
改为：
```typescript
const tpArr: string[] = Array.isArray(tpVal)
  ? tpVal.map(String)
  : [];
```

titlePath 在文档处理阶段始终为 `string[]`，去除无用的 JSON.parse 回退。

### 3.3 轻量回退性能优化

`rerank.service.ts` 的 `lightweightRerank()` 中 `c.content.toLowerCase()` 从内层（queries 循环内）提至外层（candidates 循环），消除 candidates × queries 次重复计算。

---

## 四、文件改动汇总

### 新建（4）

```
apps/server/src/common/types/rag.types.ts
apps/server/src/common/utils/retrieval.utils.ts
apps/server/src/common/utils/message.utils.ts
apps/server/src/common/utils/bigint.utils.ts
```

### 修改（10）

```
apps/server/src/modules/rag/retrieval/dense-retrieval.service.ts
apps/server/src/modules/rag/retrieval/elasticsearch-sparse-retrieval.service.ts
apps/server/src/modules/rag/retrieval/fusion.service.ts
apps/server/src/modules/rag/retrieval/rerank.service.ts
apps/server/src/modules/rag/retrieval/rerank-model.service.ts
apps/server/src/modules/rag/retrieval/retrieval.service.ts
apps/server/src/modules/rag/retrieval/citation.service.ts
apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts
apps/server/src/modules/chat/services/chat-stream.service.ts
apps/server/src/modules/chat/services/tools/get-chunk-detail.tool.ts
```

### 删除（1）

```
apps/server/src/modules/chat/services/tools/search-knowledge-base.tool.ts
```

### 模块配置（1）

```
apps/server/src/modules/chat/chat.module.ts
```

---

## 五、验证

```bash
# 后端
pnpm --filter server build   # ✅ 0 errors
pnpm --filter server test    # ✅ 5 suites / 54 tests PASS

# 前端
pnpm --filter web build      # ✅ 0 errors (vue-tsc + vite)
```

---

## 六、三阶段总览

| 阶段 | 主题 | 新建 | 修改 | 删除 | 核心成果 |
|------|------|:--:|:--:|:--:|---------|
| 一 | 修复 + 性能 | 0 | 4 | 1 | 检索延迟 -40%、内存泄漏修复、Context 截断 |
| 二 | Agentic RAG 闭环 | 0 | 5 | 0 | 15 节点 LangGraph + 3 大自校正闭环 |
| 三 | 代码质量提升 | 4 | 10 | 1 | 6 项重复消除、2 项健壮性补充 |

**综合验证**: 后端 0 errors + 前端 0 errors + 54 tests PASS
