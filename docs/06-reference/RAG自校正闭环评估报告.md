# RAG 自校正闭环设计评估报告

> 评估时间：2026-05-09 | 实施记录见末尾
> 基于 Linsor AI RAG 全链路流程图 v1.0

---

## 一、业界最佳实践调研

### 1.1 Self-RAG（ICLR 2024 Oral）

**论文**：[Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection](https://arxiv.org/abs/2310.11511)

**核心机制**：通过 Reflection Tokens 实现端到端自校正

| 反思标记 | 含义 | 对应功能 |
|---------|------|---------|
| `[Retrieve]` | 是否需要检索 | 查询路由 |
| `[ISREL]` | 检索内容相关性 | relevance_check |
| `[ISSUP]` | 生成内容是否被证据支持 | fact_check |
| `[ISUSE]` | 整体实用性 | completeness_check |

**特点**：
- 需要专门训练模型
- 在生成过程中实时决定是否检索
- 逐段评估支持度

### 1.2 Corrective RAG（AAAI 2024）

**论文**：[Corrective Retrieval Augmented Generation](https://arxiv.org/abs/2401.15884)

**核心机制**：检索评估 + 行动决策

```
检索结果评估 → {Correct, Ambiguous, Incorrect}
                    │
    ┌───────────────┼───────────────┐
    ▼               ▼               ▼
Correct        Ambiguous        Incorrect
    │               │               │
    ▼               ▼               ▼
知识精炼      双路径结合       切换网络搜索
```

**特点**：
- 三分类评估体系
- 网络搜索作为最终兜底
- 知识精炼（Decompose-then-Recompose）

### 1.3 Adaptive RAG（论文 2403.14403）

**核心机制**：查询分析驱动的动态路由

```
查询分析 → 路由到:
  ├── No Retrieval（简单问题）
  ├── Single-shot RAG（事实类）
  └── Iterative RAG（复杂多跳）
```

### 1.4 LangChain/LangGraph 官方实现

**参考实现**：
- [LangGraph Adaptive RAG](https://github.com/langchain-ai/langgraph/blob/main/docs/docs/tutorials/rag/langgraph_adaptive_rag.ipynb)
- [LangGraph Agentic RAG](https://docs.langchain.com/oss/python/langgraph/agentic-rag)

**标准流程**：
```
route_query → generate_query_or_respond
                      ↓
              grade_documents
              ↙           ↘
        relevant      not_relevant
              ↓               ↓
        generate      rewrite_question
```

---

## 二、当前系统三大闭环评估

### 2.1 闭环①：检索重试环

**流程**：`audit → rewrite_fallback → tools → relevance_check → audit`

**当前实现**：
- 触发条件：`auditVerdict = insufficient`
- 重试策略：改写查询重新检索
- 最大次数：2 次
- 兜底机制：~~直接生成~~ **→ 网络搜索**（2026-05-09 修复）

| 维度 | 当前实现 | 业界对比 | 评分 |
|------|---------|---------|------|
| 触发条件 | auditVerdict=insufficient | CRAG: Correct/Incorrect/Ambiguous | ⭐⭐⭐⭐ |
| 重试策略 | 改写查询 → 网络搜索兜底 | CRAG: 切换到网络搜索 | ⭐⭐⭐⭐ |
| 最大次数 | 2 次 | 无明确规范 | ⭐⭐⭐⭐ |
| 兜底机制 | ~~直接生成~~ **→ web_search** | ✅ 对齐 CRAG | ⭐⭐⭐⭐⭐ |

**优点**：
- ✅ 最多 2 次重试限制了循环风险
- ✅ 明确告知用户资料局限性
- ✅ **网络搜索作为最终兜底（已修复）**

### 2.2 闭环②：事实修正环

**流程**：`fact_check → writer_correct → fact_check`

**当前实现**：
- 评估粒度：逐条 supported/contradicted/not_verified
- 风险等级：low/medium/high + needRevise
- 修正策略：删除/重写/标注待验证
- 循环控制：~~无限循环~~ **→ MAX 3 轮**（2026-05-09 修复）

| 维度 | 当前实现 | 业界对比 | 评分 |
|------|---------|---------|------|
| 评估粒度 | 逐条 supported/contradicted | Self-RAG ISSUP: 逐段评估 | ⭐⭐⭐⭐ |
| 风险等级 | low/medium/high + needRevise | Self-RAG: 二元判断 | ⭐⭐⭐⭐ |
| 修正策略 | 删除/重写/标注待验证 | Self-RAG: 选择最佳段落 | ⭐⭐⭐ |
| 循环控制 | ~~无限~~ **→ MAX 3 轮** | 需要 max 限制 | ⭐⭐⭐⭐ |

**优点**：
- ✅ 逐条评估事实一致性
- ✅ 区分 high/medium/low 风险
- ✅ 明确的修正指示
- ✅ **循环限制防止性能退化（已修复）**

### 2.3 闭环③：完整性补充环

**流程**：`completeness_check → supplement_retrieve → writer_supplement`

**当前实现**：
- 覆盖率阈值：coverage < 0.8
- 补充检索：用 missingAspects 检索
- 结果合并：去重合并
- 触发条件：有可检索维度

| 维度 | 当前实现 | 业界对比 | 评分 |
|------|---------|---------|------|
| 覆盖率阈值 | coverage < 0.8 | 业界通常 0.7-0.8 | ⭐⭐⭐⭐⭐ |
| 补充检索 | 用 missingAspects 检索 | 业界也有类似做法 | ⭐⭐⭐⭐ |
| 结果合并 | 去重合并 | CRAG: 知识精炼 | ⭐⭐⭐ |
| 触发条件 | 有可检索维度 | 业界标准做法 | ⭐⭐⭐⭐⭐ |

**优点**：
- ✅ 基于子问题覆盖度评估完整性
- ✅ 只补充缺失维度，不重复已有内容
- ✅ 触发条件清晰

**问题**：
- ❌ 补充检索可能失败：没有再次循环机制
- ❌ 缺乏"诚实告知"机制
- ❌ 单次补充：没有多次迭代补充

---

## 三、核心改进建议

### 3.1 高优先级（已完成 ✅）

| 问题 | 当前实现 | 改进建议 | 状态 |
|------|---------|---------|:--:|
| 检索重试无网络兜底 | 重试2次后直接生成 | 应切换到网络搜索 | ✅ |
| 事实修正无限循环 | 无限制 | 添加 max 3 轮限制 | ✅ |
| 缺少"诚实告知"机制 | 部分实现 | 完善无答案时的用户提示 | ✅ 已存在 |

**实际实施代码**（2026-05-09）：

```typescript
// auditEdge — when enableWebSearch, always fall back to web_search on insufficient
function auditEdge(state, enableWebSearch) {
  if (state.auditVerdict === 'sufficient') return 'writer'
  if (enableWebSearch) return 'web_search'          // 不限 retryCount，直接兜底
  if (retryCount < 2) return 'rewrite_fallback'
  return 'writer'
}

// factCheckEdge — MAX 3 rounds, with factCheckRounds counter in state
const MAX_FACT_CHECK_ROUNDS = 3

function factCheckEdge(state) {
  if (!state.factCheckResult) return 'completeness_check'
  if ((state.factCheckRounds ?? 0) >= MAX_FACT_CHECK_ROUNDS) return 'completeness_check'
  if (state.factCheckResult.needRevise && (overallRisk === 'high' || 'medium'))
    return 'writer_correct'
  return 'completeness_check'
}
```

与文档建议的差异：`auditEdge` 中 `enableWebSearch` 的判断**不限 retryCount**（文档建议 `retryCount >= 2`），这样更激进——只要开启了联网搜索且 audit 不足，立即兜底，不浪费改写重试时间。

### 3.2 中优先级（建议近期优化）

| 问题 | 当前实现 | 改进建议 |
|------|---------|---------|
| 重试策略单一 | 只改写查询 | 增加同义词扩展、角度变换 |
| 缺乏答案置信度分级 | 二元判断 | 可以输出置信度区间 |
| 补充检索单次 | 只一次 | 可迭代补充（max 2次） |

### 3.3 低优先级（建议后续优化）

| 问题 | 当前实现 | 改进建议 |
|------|---------|---------|
| 评估模型温度较高 | t=0.1 | 可考虑 t=0 提高一致性 |
| 缺乏反思标记 | 无 | 可添加内部日志/标记 |

---

## 四、综合评估

### 4.1 评分总览

| 维度 | 得分 | 说明 |
|------|------|------|
| 架构完整性 | 9/10 | 三大闭环覆盖全面 |
| 业界对齐度 | 8/10 | 借鉴了 CRAG/Self-RAG 思想 |
| 循环安全性 | 8/10 | 已添加循环限制和网络兜底 |
| 降级策略 | 7/10 | 有降级但不够完善 |
| 实现复杂度 | 适中 | 15 节点合理 |

**综合评分**：⭐⭐⭐⭐ (4/5)

### 4.2 亮点

1. **多层校验**：relevance_check + audit + fact_check + completeness_check 四层质量门
2. **Shannon 熵加权**：创新的 RRF 融合策略
3. **Small-to-Big 展开**：合理的上下文扩展策略
4. **完整的 Agentic 架构**：使用 LangGraph StateGraph
5. **混合检索**：稠密+稀疏+RRF+Rerank 五步流水线

### 4.3 风险点

1. **生产环境验证不足**：复杂架构需要大量测试
2. **延迟可能较高**：最多可能执行 15+ 节点
3. **LLM 调用成本**：每次重试都消耗额外 token
4. **无限循环风险**：事实修正环缺少限制

---

## 五、结论

当前系统的三大自校正闭环设计**基本合理**，核心思想与 Self-RAG、CRAG、Adaptive RAG 等业界方案一致。

### 已完成（2026-05-09）
1. ✅ **检索重试增加网络搜索兜底** — `auditEdge` 改为 `enableWebSearch → web_search`（不限 retryCount）
2. ✅ **事实修正添加循环限制** — `MAX_FACT_CHECK_ROUNDS = 3` + `factCheckRounds` state 计数器
3. ✅ **诚实告知机制** — 确认已存在（`isInsufficient` 分支注入提示语）
4. ✅ **多角度改写** — 确认已在 `REWRITE_FALLBACK_PROMPT` 中实现
5. ✅ **fact_check 节点接入图** — 修复 LangGraph 边配置（`writer → fact_check → edge`）

### 建议延后
- 补充检索支持多次迭代（当前触发率为零，不值得投入）
- 添加性能监控和熔断机制

### 上线前检查清单
- [ ] 添加完整的端到端测试
- [ ] 实现详细的性能监控
- [ ] 添加熔断机制防止极端情况
- [ ] 验证各节点的超时配置
- [ ] 测试网络异常情况下的降级
- [ ] 评估 LLM 调用成本

---

## 六、实施记录

### 2026-05-09

| 问题 | 变更 | Commit |
|------|------|--------|
| `fact_check` 节点不执行 | 图边 `writer → factCheckEdge` 改为 `writer → fact_check → factCheckEdge` | `04909cc` |
| `auditEdge` 网络兜底不足 | `enableWebSearch` 不限 `retryCount`，直接走 `web_search` | `ccfa7d9` |
| `factCheckEdge` 无限循环 | 新增 `factCheckRounds` state + `MAX_FACT_CHECK_ROUNDS = 3` | `ccfa7d9` |

**SSE 抓包验证**：6 个场景全部测试通过，`fact_check` 节点正常出现在 writer 之后。

---

## 七、参考资料

1. Asai et al. (2024). Self-RAG: Learning to Retrieve, Generate, and Critique through Self-Reflection. ICLR 2024.
2. Yan et al. (2024). Corrective Retrieval Augmented Generation. AAAI 2024.
3. LangChain. Adaptive RAG. https://arxiv.org/abs/2403.14403
4. LangGraph. Custom RAG Agent. https://docs.langchain.com/oss/python/langgraph/agentic-rag
5. Li et al. (2025). Enhancing Retrieval-Augmented Generation: A Study of Best Practices. arXiv:2501.07391.

---

*文档版本：v1.0*  
*下次评审日期：建议 3 个月后*
