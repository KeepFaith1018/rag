# RAGAS 评估与质量监控方案

> 日期：2026-05-09 | 依赖：capture-sse.mjs + BullMQ

---

## 一、目标

建立可量化的 RAG 质量评估体系，覆盖：
1. **检索质量**：查准率（Context Precision）、查全率（Context Recall）
2. **生成质量**：忠实度（Faithfulness）、切题度（Answer Relevancy）
3. **持续监控**：每次变更前后的质量对比（A/B）

---

## 二、Phase 1：基于现有数据的快速评估（即日可做）

### 思路
不引入新依赖，利用现有的 fact_check + completeness_check + relevance_check 输出，批量跑预设问题，汇总质量基线。

### 2.1 创建测试问题集

**文件**：`docs/04-changes/测试数据/test-questions.json`

```json
[
  { "id": "Q01", "question": "Vue 3 Composition API 的 setup 函数有什么作用？", "category": "fact_lookup", "kbIds": ["7"] },
  { "id": "Q02", "question": "Vue 3 和 React Hooks 在设计理念上有什么区别？", "category": "compare_analysis", "kbIds": ["7"] },
  { "id": "Q03", "question": "Node.js 事件循环中微任务和宏任务的执行顺序？", "category": "fact_lookup", "kbIds": ["7"] },
  { "id": "Q04", "question": "Apache Doris 的列式存储引擎如何实现数据压缩？", "category": "fact_lookup", "kbIds": ["7"] },
  { "id": "Q05", "question": "量子计算中的量子纠缠原理是什么？", "category": "research", "kbIds": ["7"] },
  { "id": "Q06", "question": "请全面介绍 Vue 3 的核心特性", "category": "research", "kbIds": ["7"] },
  { "id": "Q07", "question": "React Hooks 中 useState 和 useEffect 的使用注意事项？", "category": "fact_lookup", "kbIds": ["7"] },
  { "id": "Q08", "question": "Vue Options API 和 Composition API 的对比", "category": "compare_analysis", "kbIds": ["7"] },
  { "id": "Q09", "question": "前端性能监控的核心指标有哪些？", "category": "fact_lookup", "kbIds": ["7"] },
  { "id": "Q10", "question": "现代前端工程化体系的演进过程", "category": "research", "kbIds": ["7"] }
]
```

### 2.2 批量评估脚本

**文件**：`scripts/evaluate.mjs`

```javascript
// 批量跑测试问题，收集 fact_check / completeness_check 评估结果
// 输出：evaluation-report-YYYYMMDD.json

const EVAL_CREDENTIALS = { email: process.env.EVAL_EMAIL, password: process.env.EVAL_PASSWORD }

async function evaluateQuestions(questions) {
  const results = []
  for (const q of questions) {
    const sse = await runCapture(q.question, q.kbIds)
    const metrics = extractMetrics(sse.events)
    results.push({
      id: q.id,
      question: q.question,
      category: q.category,
      factCheckRisk: metrics.factCheckRisk,
      factCheckItemCount: metrics.factCheckItemCount,
      completenessCoverage: metrics.completenessCoverage,
      relevanceVerdicts: metrics.relevanceVerdicts,
      auditVerdicts: metrics.auditVerdicts,
      retryCount: metrics.retryCount,
      totalDurationMs: metrics.totalDurationMs,
      answerLength: metrics.answerLength,
    })
  }
  return results
}
```

### 2.3 质量基线指标

| 指标 | 来源 | 计算方式 |
|------|------|---------|
| 检索相关性 | relevance_check verdict | relevant 比例 = relevant 次数 / 总轮次 |
| 检索充分性 | audit verdict | sufficient 比例 = sufficient 次数 / 总轮次 |
| 事实忠实度 | fact_check overallRisk | low 比例 = low 次数 / 总测试数 |
| 回答完整性 | completeness_check coverage | 平均 coverage |
| 补充触发率 | supplement 是否触发 | supplement 次数 / 总测试数 |
| 端到端耗时 | RUN_STARTED→RUN_FINISHED | 平均 ms |

### 2.4 执行方式

```bash
# 单次评估
EVAL_EMAIL="keepfaith1018@gmail.com" EVAL_PASSWORD="123456" node scripts/evaluate.mjs

# 输出: evaluation-report-2026-05-09.json
```

---

## 三、Phase 2：RAGAS 定量评估（1-2 周）

### 思路
引入 RAGAS 库，对检索+生成的每个环节独立打分。评估过程脱离在线流式，用离线批量方式。

### 3.1 RAGAS 四项指标

| 指标 | RAGAS 方法 | 对应的在线校验 |
|------|-----------|--------------|
| Faithfulness | 将回答拆为原子陈述，逐条检查是否被 context 支持 | ≈ fact_check（但 RAGAS 更结构化） |
| Answer Relevancy | 对回答生成反向问题，检查与原问题的语义相似度 | ≈ completeness_check（但方向不同） |
| Context Precision | 检索结果中相关的比例 | ≈ relevance_check |
| Context Recall | 检索是否覆盖了回答所需的全部信息 | **在线无对应，需补充** |

### 3.2 技术方案

```typescript
// RAGAS 评估流程
async function evaluateWithRagas(runId: string) {
  // 1. 从数据库加载完整的 run 数据
  const run = await getAgentRun(runId)
  const { originalQuery, draftAnswer, rerankedHits } = run

  // 2. RAGAS 评估
  const result = await ragas.evaluate({
    question: originalQuery,
    answer: draftAnswer,
    contexts: rerankedHits.map(h => h.content),
  })

  // 3. 存入 b_agent_runs.metadata_json
  await saveRagasMetrics(runId, {
    faithfulness: result.faithfulness,
    answerRelevancy: result.answerRelevancy,
    contextPrecision: result.contextPrecision,
    contextRecall: result.contextRecall,
  })
}
```

### 3.3 依赖

```bash
pnpm --filter server add ragas        # Python 库，需配合 Python 环境
# 或使用 LangChain 内置的 RAGAS wrapper
```

### 3.4 执行方式

利用 BullMQ 离线队列（`rag-evaluation` queue），对话完成后自动触发。

---

## 四、Phase 3：持续质量监控（1 月+）

### 架构

```
在线对话完成
    │
    ├──→ BullMQ job: rag-evaluation
    │       │
    │       ├──→ RAGAS 评估
    │       └──→ 写入 b_agent_runs.metadata_json
    │
    ├──→ Grafana / 内部看板
    │       │
    │       ├──→ Faithfulness 趋势
    │       ├──→ Coverage 趋势
    │       └──→ Bad Case 列表
    │
    └──→ CI/CD 质量门
            │
            ├──→ 每次 PR 跑评估套件
            └──→ Faithfulness 低于阈值 → 阻断合并
```

### Bad Case 自动标记

```sql
-- 标记 Bad Case（用于人工复核）
SELECT id, session_id, metadata_json
FROM b_agent_runs
WHERE JSON_EXTRACT(metadata_json, '$.faithfulness') < 0.7
   OR JSON_EXTRACT(metadata_json, '$.contextRecall') < 0.5
ORDER BY created_at DESC;
```

---

## 五、实施路线图

| 阶段 | 时间 | 产出 | 依赖 |
|------|------|------|------|
| Phase 1 | 即日 | 10 题质量基线报告 + evaluate.mjs | 无新依赖 |
| Phase 2 | 1-2 周 | RAGAS 离线评估 + 4 项指标存储 | BullMQ + ragas |
| Phase 3 | 1 月+ | Grafana 看板 + CI 质量门 | Phase 2 + 监控基础设施 |

---

## 六、Phase 1 立即开始

**需创建文件**：
- `docs/04-changes/测试数据/test-questions.json` — 10 个测试问题
- `scripts/evaluate.mjs` — 批量评估脚本

**执行步骤**：
1. 创建 test-questions.json
2. 创建 evaluate.mjs（复用 capture-sse.mjs 的核心逻辑）
3. 跑一次，生成基线报告
4. 记录到 11-测验记录.md
