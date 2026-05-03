# Agentic RAG 多知识库对话实施方案（含四阶段优化设计）

## 1. 文档说明

- 本文档用于承接当前项目已经完成的“文档上传 + 文档解析 + 文档分片 + 文档向量化”能力，规划下一阶段的 `Agentic RAG` 多知识库对话模块建设。
- 本文档整合了上一轮方案讨论中确定的总体方向：采用 `方案 D`，即“受控多 Agent 协作”的问答架构，并补充“多知识库选择检索 + 前端流式返回 + Vercel AI SDK UI 状态联动”的完整落地思路。
- 本轮修订进一步明确一个关键交互原则：项目本身具备类似 `ChatGPT` 的普通对话能力；`会话` 是承载上下文的主体；当用户以普通对话模式发送消息时，系统走常规对话链路；当用户以 `RAG` 模式发送消息时，才进入 `Agentic RAG + Graph` 编排流程，并且可在发送时选择 `1` 个或多个知识库作为本轮检索范围。
- 与上一轮口头方案不同，本文档额外对以下四个关键阶段进行专项审视与优化补充：
  1. 多维输入处理（Pre-processing）
  2. 混合检索召回（Hybrid Retrieval）
  3. 精排与过滤（Reranking & Filtering）
  4. Agent 自我反思循环（Self-Correction Loop）
- 本文档目标是提供一份既能指导架构设计、也能直接指导后续编码拆分与任务排期的实施方案。

相关文档：

- [README.md](file:///d:/Faith/Project/rag-knowledge-base/README.md)
- [03-database-design.md](file:///d:/Faith/Project/rag-knowledge-base/docs/03-database-design.md)
- [04-ui-implementation-plan.md](file:///d:/Faith/Project/rag-knowledge-base/docs/04-ui-implementation-plan.md)
- [05-backend_infra_implementation.md](file:///d:/Faith/Project/rag-knowledge-base/docs/05-backend_infra_implementation.md)
- [09-rag-document-processing-architecture-plan-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/docs/09-rag-document-processing-architecture-plan-2026-04-25.md)
- [10-rag-document-processing-detailed-design-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/docs/10-rag-document-processing-detailed-design-2026-04-25.md)

## 2. 当前系统现状

### 2.1 已具备能力

基于当前仓库现状，项目已经具备以下对话模块可直接复用的基础设施：

- 前后端采用 `pnpm monorepo`
- 前端采用 `Vue 3 + TypeScript + Vite + Pinia + Tailwind CSS`
- 后端采用 `NestJS + Prisma + MySQL`
- 向量库已经接入 `Qdrant`
- 文档处理链路已经完成：
  - 上传
  - 解析
  - 分片
  - 向量化
  - Qdrant 写入
- 知识库权限体系已经落地：
  - `owner / manager / collaborator / member / publicVisitor`
  - 已支持 `canAsk` 等问答相关权限
- 前端已经有聊天页雏形，但仍为静态样板
- 数据库已经预留基础聊天表：
  - `b_chat_sessions`
  - `b_chat_messages`

### 2.2 当前不足

当前系统仍缺少以下关键能力，因此还不具备真正的 Agentic RAG 对话闭环：

- 缺少正式的对话模块 `chat`
- 缺少多轮会话编排与上下文压缩
- 缺少真正的检索接口，`QdrantService` 当前以写入为主
- 缺少混合检索能力，当前只有 Dense 向量基础，没有 Sparse 关键词检索链路
- 缺少重排模型接入
- 缺少多知识库选择与批量权限校验
- 缺少 Agent 工具定义、运行轨迹、步骤日志
- 缺少面向前端流式消息的数据协议
- 缺少 `Vercel AI SDK` 所需的流式接口适配
- 当前全局响应拦截器会包裹普通 JSON 响应，不适合直接用于 `SSE / AI SDK data stream`

### 2.3 当前最合理的推进方式

基于现有项目成熟度，最合理的推进方式不是直接做完全自由的 Autonomous Agent，而是采用“受控多 Agent 工作流”：

1. 先补齐对话底座
2. 再补齐检索底座
3. 再引入 Router、Rewrite、Hybrid Retrieval、Rerank、Self-Correction
4. 最后再扩展多 Agent 协作与联网搜索

## 3. 方案目标

本次实施方案的总体目标如下：

1. 实现以会话为主体、同时支持普通对话与 `RAG` 问答两种消息模式
2. 实现前端流式返回与 UI 状态变化
3. 实现受控多 Agent 协作问答流程
4. 实现“Dense + Sparse + RRF + Reranker”的混合检索链路
5. 实现问题分类、问题改写、子问题拆解
6. 实现基础自我反思循环，提升回答相关性与事实可靠性
7. 为后续联网搜索、复杂研究型问答保留扩展空间

## 4. 总体架构设计

### 4.1 架构原则

本期建议遵循以下原则：

1. 以“受控 Agent”替代“自由 Agent”
2. 以“可观测”替代“黑盒”
3. 以“多知识库权限边界”替代“全局自由检索”
4. 以“先检索后回答”替代“先生成后找依据”
5. 以“流式状态反馈”替代“长时间无响应”

### 4.2 核心角色划分

建议采用以下多 Agent 角色：

- `Coordinator Agent`
  - 负责识别任务类型
  - 负责判断是否需要 Query Rewrite、Decomposition、联网搜索
  - 负责控制整体工作流
- `Retriever Agent`
  - 针对每个知识库执行检索任务
  - 支持 Dense 与 Sparse 并行检索
  - 负责返回证据片段与局部摘要
- `Verifier Agent`
  - 负责判断检索结果是否相关
  - 负责判断是否需要重写 Query 或补检索
  - 负责回答后的事实对齐检查
- `Writer Agent`
  - 基于最终证据生成回答
  - 输出引用与结构化答案

### 4.3 四层分层

建议整体拆为四层：

1. 会话与交互层
2. Agent 编排层
3. 检索与重排层
4. 存储与基础设施层

对应职责如下：

- `chat` 模块
  - 负责会话、消息、流式对话接口
- `agent` 模块
  - 负责 Router、Rewrite、Decomposition、Self-Correction、Writer
- `retrieval` 模块
  - 负责 Dense、Sparse、RRF、Rerank、过滤、引用组装
- `knowledge-base` 模块
  - 负责多知识库权限校验
- `vector` 模块
  - 负责 Qdrant Dense 检索
- `search` 或 `sparse-index` 模块
  - 负责关键词检索
- `llm` 模块
  - 负责模型适配与流式能力

## 5. 第一阶段：多维输入处理（Pre-processing）

这一阶段的目标不是直接查库，而是先把用户输入“处理成适合检索和推理的中间表达”。

### 5.1 目标

1. 减少无效检索
2. 识别是否需要拆解问题
3. 识别是否需要联网搜索
4. 将口语化问题转换为稳定检索 Query

### 5.2 推荐流程

1. 接收用户输入
2. 结合最近若干轮会话做轻量上下文拼接
3. 进入 `Query Router`
4. 若命中“简单问候”，直接回复
5. 若命中“事实查询”，进入 Query Rewrite
6. 若命中“对比分析”，先做 Decomposition，再对每个子问题做 Rewrite
7. 输出结构化检索计划，供后续 Hybrid Retrieval 使用

### 5.3 Query 分类器（Router）

建议将用户问题分成至少以下四类：

- `greeting`
  - 示例：你好、你是谁、早上好
  - 处理：直接由小模型或模板回复
- `fact_lookup`
  - 示例：A 模块支持什么格式、某接口是否已实现
  - 处理：进入检索链路
- `compare_analysis`
  - 示例：对比 A 和 B、方案 X 和 Y 的差异
  - 处理：做子问题拆解
- `research_or_open_world`
  - 示例：结合外部资料分析、最新趋势是什么
  - 处理：优先本地检索，证据不足时触发联网搜索候选

### 5.4 Router 优化点

针对这一阶段，建议补充以下优化：

1. 不要只做单标签分类，建议输出：
   - `intent`
   - `confidence`
   - `needRewrite`
   - `needDecomposition`
   - `mayNeedWebSearch`
2. 增加“多标签兼容”能力
   - 例如“先对比 A/B，再总结风险”应同时包含 `compare_analysis + synthesis`
3. Router 应尽量使用较小模型
   - 避免把高成本主模型浪费在前置分类上
4. 增加基于规则的低成本兜底
   - 对明显问候、感谢、寒暄直接走规则
5. 输出结构化 JSON
   - 避免路由结果难以进入后续自动编排

建议 Router 输出结构：

```ts
interface RoutedQueryPlan {
  intent:
    | "greeting"
    | "fact_lookup"
    | "compare_analysis"
    | "research_or_open_world";
  confidence: number;
  needRewrite: boolean;
  needDecomposition: boolean;
  mayNeedWebSearch: boolean;
  reason: string;
}
```

### 5.5 子问题拆解（Decomposition）

对于“对比分析”类问题，不建议直接用原始 Query 检索全部知识库。

推荐做法：

1. 抽取对比对象
2. 将每个对象转成一个独立子问题
3. 追加一个“综合差异总结”子问题

示例：

```text
原问题：
对比 A 和 B 在权限设计和扩展性方面的差异

拆解后：
1. A 在权限设计和扩展性方面的实现与特征
2. B 在权限设计和扩展性方面的实现与特征
3. A 与 B 在权限设计和扩展性方面的主要差异总结
```

### 5.6 Decomposition 优化点

1. 不建议无条件拆解所有复杂问题
   - 只有当 Query 中存在明显多实体、多维度、多约束时才拆
2. 拆解后要保留父问题 ID
   - 便于后续完整性检查
3. 拆解数要设上限
   - 首版建议 `2~4` 个子问题
4. 子问题要避免语义重叠
   - 否则会导致检索浪费

### 5.7 Query 改写（Rewriting）

Rewrite 目标是把用户的自然表达转换成更适合检索系统消费的 Query。

建议每个 Query 同时输出两类信息：

1. `searchKeywords`
   - 更适合 Sparse / BM25
2. `semanticDescription`
   - 更适合 Dense 检索

建议输出结构：

```ts
interface RewrittenQuery {
  originalQuery: string;
  searchKeywords: string[];
  semanticDescription: string;
  synonyms: string[];
  constraints: string[];
}
```

### 5.8 Rewrite 优化点

1. 改写不能偏离原问题
   - 需保留原 Query 作为最终重排输入之一
2. 要显式提取约束
   - 如时间、模块名、知识库范围、角色名
3. 增加同义词扩展
   - 例如“权限控制 / RBAC / 角色权限”
4. 为 Sparse 检索生成更短关键词串
5. 为 Dense 检索生成更自然的语义描述
6. 对知识库内部专有名词保留原样
   - 避免被模型错误改写

## 6. 第二阶段：混合检索召回（Hybrid Retrieval）

这一阶段负责扩大召回覆盖率，同时尽量减少单一检索方式的盲区。

### 6.1 目标

1. Dense 检索解决语义召回
2. Sparse 检索解决关键词、术语、精确匹配
3. 使用融合算法弥补两者各自短板

### 6.2 推荐流程

1. 针对每个子问题并行触发：
   - Dense Search
   - Sparse Search
2. 使用 `RRF` 做初级融合
3. 保留 Top 50 候选
4. 交给下一阶段做精排

### 6.3 Dense 检索设计

建议基于现有 Qdrant 单集合设计，继续使用 `payload filter` 进行多知识库过滤：

- `kbId`
- `docId`
- `chunkId`
- `processingVersion`

Dense 检索输入建议使用：

- `semanticDescription`
- 原始 Query
- 子问题 Query

### 6.4 Sparse 检索设计

当前项目尚未落地 Sparse 检索，需要新增一条关键词检索链路。

推荐首版选型：

1. 优先使用 MySQL FullText 或应用侧倒排索引做最小闭环
2. 第二阶段再升级为独立检索引擎或更完整的 BM25 方案

首版建议新增 `document_chunk_search_index` 概念层，索引以下内容：

- `chunk content`
- `title`
- `titlePath`
- `keywords`
- `entity aliases`

### 6.5 Hybrid Retrieval 优化点

1. Dense 与 Sparse 必须并行
   - 避免链路延迟翻倍
2. 检索前先做知识库权限过滤
   - 不能让 Agent 决定任意检索范围
3. 每个已选知识库建议单独召回
   - 便于后续溯源与冲突检查
4. 可为 Dense / Sparse 设置不同召回量
   - 例如 Dense Top 20，Sparse Top 30
5. 对完全重复 chunk 做去重
6. 对来自同一文档相邻 chunk 做轻量聚合
   - 避免候选列表被同一文档刷屏

### 6.6 RRF 融合设计

建议采用标准 `Reciprocal Rank Fusion`：

```text
RRF(d) = Σ 1 / (k + rank_i(d))
```

其中：

- `d` 为候选文档
- `rank_i(d)` 为文档在第 i 个检索列表中的名次
- `k` 建议首版取 `60`

### 6.7 RRF 优化点

1. RRF 适合作为首版融合方法
   - 不依赖训练数据
   - 容易实现
2. 建议保留融合来源标记
   - 标记结果来自 Dense、Sparse，还是两者共同命中
3. 可对“双命中”结果增加轻量加权
4. 对同一文档多 chunk 可在融合后做多样性约束
   - 避免前 50 全是同一篇文档的邻近片段

## 7. 第三阶段：精排与过滤（Reranking & Filtering）

这一阶段负责把“能召回”进一步收敛为“最值得拿给生成模型看的证据”。

### 7.1 目标

1. 提升证据相关性
2. 压缩上下文长度
3. 降低幻觉风险

### 7.2 推荐流程

1. 输入 RRF 后的 Top 50 候选
2. 将候选 chunk 与原始 Query、子问题 Query 送入 Reranker
3. 生成重排得分
4. 过滤低分候选
5. 最终保留前 `3~5` 条高质量证据

### 7.3 Reranker 设计

Reranker 输入建议包含：

- 原始 Query
- Rewrite 后语义描述
- 当前子问题
- chunk 内容
- chunk 标题
- chunk 所属文档标题

输出建议至少包含：

- `score`
- `reason`
- `matchedAspects`

### 7.4 精排与过滤优化点

1. Reranker 应使用“原始 Query + 改写 Query”双输入
   - 避免只对改写结果过拟合
2. 阈值不要写死为单一常量
   - 可按问题类型动态调整
   - 示例：
     - 事实查询阈值更高
     - 对比分析阈值可略低但保留多样性
3. 不只看分数，还要看覆盖面
   - 对比问题要确保 A/B 两边证据都存在
4. 对连续 chunk 可合并成一个展示单元
5. 保留“候补证据”
   - 以便完整性检查失败时补充上下文

### 7.5 动态截断设计

建议按如下策略：

1. 先按得分排序
2. 丢弃 `< 0.5` 的明显无效结果
3. 优先保留 `>= 0.7` 的高置信结果
4. 最终上下文控制在 `3~5` 条核心证据
5. 对复杂问题可额外保留 `1~2` 条候补证据

### 7.6 空结果处理

建议分两档：

1. `全部 < 0.5`
   - 视为本地证据严重不足
   - 允许触发联网搜索候选，或提示用户补充上下文
2. `0.5 ~ 0.7`
   - 视为证据模糊
   - 优先触发 Rewrite 或补检索，而不是立即联网

### 7.7 空结果处理优化点

1. 不建议一检索不到就直接联网
   - 优先重写 Query
   - 再考虑联网
2. 联网搜索应被严格视为工具，不是默认通道
3. 若用户明确只允许使用本地知识库，则不能自动联网
4. 对空结果要保留失败原因
   - 便于后续分析是 Query 问题、索引问题还是知识库缺内容

## 8. 第四阶段：Agent 自我反思循环（Self-Correction Loop）

这是整个方案的核心，用于提升回答稳定性、完整性与可解释性。

### 8.1 目标

1. 避免检索到“看起来像相关，实际上答非所问”的内容
2. 避免回答中出现无出处事实
3. 避免复杂问题只回答一半

### 8.2 推荐工作流

建议在 `LangGraph` 中显式建模以下节点：

1. `router`
2. `rewrite`
3. `decompose`
4. `hybrid_retrieve`
5. `rrf_fuse`
6. `rerank_filter`
7. `relevance_check`
8. `draft_answer`
9. `hallucination_check`
10. `completeness_check`
11. `final_answer`

### 8.3 检查 1：相关性评分

目的：

- 判断当前证据是否真的回答了当前问题

若发现以下问题，应跳回 `rewrite`：

- 语义接近但问题不一致
- 找到的是背景介绍，而不是答案本身
- 只命中一个关键词，没有命中核心意图

#### 优化点

1. 不要只看 Reranker 分数
   - 可再增加一个轻量 Relevance Judge
2. 对“模块介绍类内容”与“直接回答类内容”做区分
3. 最多回退 `1~2` 次
   - 防止无限循环

### 8.4 检查 2：幻觉检测

目的：

- 生成答案后，检查答案中的事实是否能在证据中定位到出处

建议做法：

1. 先把答案拆成若干事实声明
2. 用较小模型逐条判断：
   - 是否可证实
   - 对应哪条引用
   - 是否存在过度归纳
3. 若发现不可证实内容：
   - 删除该事实
   - 或重新生成对应段落

#### 优化点

1. 事实检查模型不需要和主回答模型同级
   - 可使用更小、更便宜的模型
2. 检查结果要结构化
3. Writer 只能引用已存在 citation
   - 不能自由编造来源
4. 幻觉检查建议只覆盖“事实段落”，不必覆盖寒暄语句

建议输出结构：

```ts
interface FactCheckResult {
  claim: string;
  supported: boolean;
  citationIds: string[];
  riskLevel: "low" | "medium" | "high";
  reason: string;
}
```

### 8.5 检查 3：完整性检查

目的：

- 对拆解后的子问题，确认是否每个维度都已被覆盖

示例：

```text
原问题：
对比 A 和 B 在权限设计和扩展性方面的差异

完整性检查项：
1. A 是否已回答
2. B 是否已回答
3. 权限设计是否已覆盖
4. 扩展性是否已覆盖
5. 差异总结是否已输出
```

若有缺项：

- 从候补证据中补足
- 若仍不足，则触发补检索
- 若还不足，则明确告诉用户“某些维度暂无足够证据”

#### 优化点

1. 不只检查“有没有提到”
   - 要检查“是否真实回答”
2. 对比问题要避免只讲共同点、不讲差异
3. 对多维问题建议输出完整性 checklist
4. 首版可只支持对 `compare_analysis` 场景启用完整性检查

## 9. 多知识库检索设计

### 9.1 设计目标

1. 会话负责承载上下文与历史，同一个会话中允许普通对话消息与 `RAG` 消息共存
2. 普通对话消息不走知识库检索，只走常规 LLM 对话链路
3. 每条消息在发送时都可以显式选择本轮使用的模型
4. `RAG` 消息在发送时必须显式选择 `1` 个或多个知识库
5. Agent 只能在当前轮显式选择且有权限的知识库中检索
6. 回答中能区分不同知识库来源

### 9.2 推荐策略

1. 每轮请求必须显式携带 `chatMode`
2. 每轮请求必须显式携带模型选择参数
   - 建议为 `modelSource + modelConfigId`
3. 当 `chatMode = "chat"` 时：
   - 不进入 RAG 检索链路
   - 直接走普通对话生成
4. 当 `chatMode = "rag"` 时：
   - 请求必须附带 `selectedKbIds`
   - `selectedKbIds` 至少包含 `1` 个知识库
5. 后端先解析并校验模型选择是否属于当前用户可用范围
6. 后端再对 `selectedKbIds` 做批量权限校验
7. 权限通过后，对每个命中的知识库独立执行检索
8. 检索结果在全局做融合和重排
9. 最终回答按引用保留知识库来源信息

### 9.3 优化点

1. 不允许 Agent 任意扩大检索范围
2. 当用户本轮选择知识库后，系统不得越权扩展到未选择知识库
3. 普通对话模式不得误入 RAG 检索链路
4. 模型选择同样不得从会话默认值隐式继承
5. 前端只维护当前输入框的模型选择，不需要回显上一轮消息使用的模型
6. 每个知识库独立保留中间结果
7. 若多个知识库结论冲突，应在答案中显式提示
8. 对大型知识库可做限流与分批检索

## 10. 前端流式返回与 Vercel AI SDK 设计

### 10.1 目标

1. 实时反馈 Agent 工作阶段
2. 实时输出回答文本
3. 在 UI 上展示“规划中 / 检索中 / 校验中 / 生成中”

### 10.2 推荐接入方式

前端建议使用：

- `ai`
- `@ai-sdk/vue`

后端建议使用：

- `ai`
- `@ai-sdk/openai`

### 10.3 前端 UI 状态设计

建议最少支持以下状态：

- `submitted`
- `planning`
- `retrieving`
- `reranking`
- `verifying`
- `writing`
- `ready`
- `error`

### 10.4 流式数据片段建议

建议后端在流中发送结构化状态片段：

```ts
type AgentStatusPart = {
  type: "agent-status";
  phase:
    | "planning"
    | "retrieving"
    | "reranking"
    | "verifying"
    | "writing"
    | "done";
  label: string;
};

type RetrievalProgressPart = {
  type: "retrieval-progress";
  kbId: string;
  kbName: string;
  hitCount: number;
  channel: "dense" | "sparse" | "hybrid";
};

type CitationReadyPart = {
  type: "citations-ready";
  citationIds: string[];
};
```

### 10.5 优化点

1. 首 token 出来前先输出状态片段
2. 检索阶段显示多知识库进度
3. 回答流和引用流分离
4. 允许用户手动停止生成

## 11. 推荐三方依赖

### 11.1 后端

建议新增：

- `ai` — Vercel AI SDK 核心包，提供 `pipeUIMessageStreamToResponse` 等流式响应工具
- `@ai-sdk/langchain` — AI SDK 官方 LangChain 适配器，提供 `toUIMessageStream()` 将 LangChain 流转换为 AI SDK data stream 协议
- `zod`
- `uuid`
- `p-limit`

> 已落地：`ai@^6.0.168` + `@ai-sdk/langchain@^2.0.174`，替代原设计中手写的 `0:` / `8:` / `d:` 协议拼装与 `common/ai-sdk/` 工具层。

### 11.2 前端

建议新增：

- `ai`
- `@ai-sdk/vue`
- `zod`

## 12. 模块与文件结构建议

```text
apps/
  backend/
    src/
      common/
        decorators/
          skip-response-transform.decorator.ts
      modules/
        chat/
          chat.module.ts
          chat.controller.ts
          services/
            chat-session.service.ts
            chat-message.service.ts
            chat-stream.service.ts  # 注入 ChatOpenAI，使用 @ai-sdk/langchain 做流式转换
        agent/
          agent.module.ts
          agents/
            coordinator.agent.ts
            retriever.agent.ts
            verifier.agent.ts
            writer.agent.ts
          prompts/
          tools/
          services/
            multi-agent-orchestrator.service.ts
        retrieval/
          retrieval.module.ts
          services/
            dense-retrieval.service.ts
            sparse-retrieval.service.ts
            fusion.service.ts
            rerank.service.ts
            citation.service.ts
        llm/
          llm.module.ts
          services/
            model-runtime.service.ts
  frontend/
    src/
      modules/
        chat/
          composables/
            useAgentChat.ts
          components/
            ChatKbSelector.vue
            ChatModelSelector.vue
            ChatAgentTimeline.vue
            ChatCitationPanel.vue
          stores/
            chat.ts
          types/
            chat.ts
      views/
        chat/
          ChatView.vue
```

## 13. 数据模型调整建议

建议在现有聊天表基础上补充以下结构：

1. `b_chat_message_citations`
   - 记录消息引用来源
2. `b_agent_runs`
   - 记录一次 Agent 执行
3. `b_agent_steps`
   - 记录每一步状态
4. `b_agent_tool_calls`
   - 记录工具调用日志

同时建议增强以下字段：

- `b_chat_sessions.summary_text`
- `b_chat_sessions.last_selected_kb_ids_json`
- `b_chat_sessions.last_chat_mode`
- `b_chat_messages.metadata_json`
- `b_chat_messages.message_status`
- `b_chat_messages.model_source`
- `b_chat_messages.model_config_id`
- `b_chat_messages.model_name`
- `b_chat_messages.model_provider`
- `b_chat_messages.finish_reason`
- `b_chat_messages.chat_mode`
- `b_chat_messages.selected_kb_ids_json`
- `b_chat_messages.resolved_kb_ids_json`

补充说明：

- 模型选择应当是消息级能力，而不是会话级默认值。
- 本期不建议为前端增加“回显上一轮模型”的持久化字段。

## 14. 实施步骤规划

### 14.1 第一阶段：底座改造

1. 设计聊天与 Agent 相关表
2. 增加流式响应绕过全局拦截器能力
3. 补齐 `Qdrant` 查询接口
4. 设计会话与“消息级知识库范围选择”接口

### 14.2 第二阶段：检索链路落地

1. 实现 Router
2. 实现 Rewrite
3. 实现 Decomposition
4. 实现 Dense 检索
5. 实现 Sparse 检索
6. 实现 RRF 融合
7. 实现 Reranker

### 14.3 第三阶段：Agent 编排落地

1. 实现 `Coordinator Agent`
2. 实现 `Retriever Agent`
3. 实现 `Verifier Agent`
4. 实现 `Writer Agent`
5. 接入 LangGraph 工作流

### 14.4 第四阶段：前端联调

1. 接入 `useChat`
2. 接入输入框级知识库选择器
3. 接入流式状态面板
4. 接入引用展示

### 14.5 第五阶段：质量治理

1. 加入限流
2. 加入日志追踪
3. 加入 Agent trace 查询
4. 加入失败回放与排障能力

## 15. 实现难点与解决建议

### 15.1 流式接口与全局响应包装冲突

问题：

- 当前全局响应拦截器会统一包装 JSON，无法直接承载 `SSE`

建议：

- 增加 `@SkipResponseTransform()` 装饰器
- 对聊天流式接口直接输出 `text/event-stream`

### 15.2 只有 Dense，没有 Sparse

问题：

- 当前系统只具备向量检索基础，关键词召回缺失

建议：

- 首版先做最小可用关键词索引
- 第二阶段再升级完整 BM25 或检索引擎

### 15.3 多 Agent 成本高

问题：

- Query 拆解、多知识库并行、反思循环会显著增加 token 消耗

建议：

- Router、Judge、Fact Check 使用小模型
- 最大子问题数、最大重试次数、最大知识库数都设上限

### 15.4 自我反思循环容易死循环

问题：

- Rewrite、补检索、再检查可能无限往返

建议：

- 每轮最多允许回退 `1~2` 次
- 超限后直接返回“当前证据不足”

### 15.5 对比分析容易回答不完整

问题：

- 即使检索命中，Writer 也可能只回答一侧

建议：

- 在 Completeness Check 中对每个维度逐项检查
- 若缺项则回补候补证据或显式说明不足

## 16. 结论与推荐实施顺序

综合来看，你提出的四阶段链路是正确的，而且非常适合作为当前项目从“可检索知识库”升级到“高质量 Agentic RAG 对话”的核心主线。

但从工程视角，建议按以下顺序落地，而不是一次性全部做满：

1. 先做会话底座、消息级知识库范围与流式接口
2. 再做 Router + Rewrite + Dense Retrieval
3. 再补 Sparse Retrieval + RRF
4. 再接 Reranker
5. 最后接入 Self-Correction Loop

原因如下：

- 这样风险更低
- 每一步都可独立验证效果
- 更容易定位问题是出在检索、重排还是生成阶段
- 也更符合当前项目已经具备的基础设施成熟度

最终建议：

- 首版先做“受控多 Agent + 四阶段链路”的最小闭环
- 不追求一步到位做成完全自治系统
- 优先保证：
  - 权限边界正确
  - 引用链路正确
  - 状态反馈清晰
  - 检索结果可追踪

当这几个核心点稳定后，再继续升级联网搜索、长期记忆、更多工具调用与更复杂的 Planner 能力。
