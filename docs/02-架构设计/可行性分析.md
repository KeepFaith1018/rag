# 基于信息检索增强的私有知识库问答系统 - 可行性分析报告

## 1. 技术选型概览（快速开发优先）

基于项目需求与“快速开发、平稳落地”的优先级原则，本系统回归采用开发者最熟悉的全栈 TypeScript 架构。利用 Node.js 生态中优秀的 AI 库，同样能高质量地实现包含 Tool Calling 和 Agentic RAG 在内的所有高级需求。

核心技术栈如下：
- **前端（Frontend）**：**Vue3 + TypeScript + Vite**
  - **UI 框架推荐**：**Element Plus** 或 **Naive UI**（后者对“暗黑模式”和“系统换肤”支持极佳）。
  - **状态管理**：Pinia
  - **网络请求**：Axios + **@microsoft/fetch-event-source**（处理大模型 SSE 流式输出的最佳方案）。
- **后端（Backend）**：**NestJS + TypeScript**
  - **ORM 框架**：**Prisma**（提供极其优秀的类型推断，与 NestJS 完美契合，大幅提升开发速度）。
  - **AI 与 RAG 编排**：**LangChain.js** 结合 **Vercel AI SDK**。
    - *理由*：LangChain.js 提供了完善的 Tool Calling 和文档加载器支持；Vercel AI SDK 的 `streamText` 在处理大模型流式响应方面体验极佳。
  - **异步任务队列**：**BullMQ** (基于 Redis)。
- **数据存储（Database & Storage）**：
  - **关系型数据库**：**PostgreSQL**（相较于 MySQL，对复杂权限查询和 JSON 数据支持更好，更适合 AI 知识库系统）。
  - **向量数据库**：**Qdrant**（用于存储文档的 Embedding 向量，支持基于 Payload 的 Metadata 过滤，极大地简化了基于角色的权限隔离检索）。
  - **缓存与中间件**：**Redis**（用于 BullMQ 消息队列、验证码缓存）。

---

## 2. 核心需求的可行性论证 (Technical Feasibility)

### 2.1 独立 RBAC 与权限隔离机制
- **可行性：极高**。
- **实现方案**：
  - 利用 **Prisma** 在 PostgreSQL 中设计独立的两套 Schema：一套是针对后台的 `AdminUser` / `AdminRole`，另一套是前台的 `User` / `KnowledgeBase` / `KbMember`。
  - **向量层面的数据隔离**：在利用 LangChain.js 将文档切片存入 Qdrant 时，在向量元数据（Metadata）中打上标记（例如：`{ kbId: "123", isShared: true }`）。在执行 RAG 检索时，直接通过 Qdrant 的 Filter 条件过滤掉用户无权访问的 `kbId`，从物理底层杜绝越权访问。

### 2.2 Agentic RAG（Tool Calling 与 联网搜索）
- **可行性：极高**。
- **实现方案**：
  - **LangChain.js** 已经全面支持了 OpenAI 等大模型的 `bind_tools` API。
  - 在 NestJS 中定义两个自定义 Tool 类：
    1. `LocalKnowledgeTool`：封装对 Qdrant 的相似度检索逻辑。
    2. `WebSearchTool`：接入 **Tavily API** 或 **DuckDuckGo API** 实现联网搜索。
  - 实例化一个 Agent Executor，当用户提问时，大模型会自主判断是去本地向量库找答案，还是去互联网搜索最新资讯。

### 2.3 大文件异步解析与溯源引用
- **可行性：极高**。
- **实现方案**：
  - Node.js 的单线程特性处理大文件容易阻塞主事件循环，必须采用异步队列。
  - **流程**：用户上传 PDF -> NestJS 接收文件并暂存本地/OSS -> 向 **BullMQ (Redis)** 提交一个 `parse-document` 任务 -> 立即返回“解析中”状态给前端。
  - **后台 Worker**：NestJS 中启动一个独立的 Worker 进程（或使用 `bullmq` 的 processor）利用 `pdf-parse` 等库进行文本提取、切分，调用 Embedding API，存入 Qdrant。
  - **溯源**：在切分文档（Chunking）时，保留原文件名、页码作为 Metadata。大模型生成答案时，将检索到的 Chunk Metadata 一并返回给 Vue3 前端展示。

### 2.4 私有化部署 (Docker 编排)
- **可行性：极高**。
- **实现方案**：NestJS 和 Vue3 都有非常成熟的 Docker 化方案。提供一个 `docker-compose.yml`，包含 `nest-backend`, `vue-frontend(Nginx)`, `postgres`, `qdrant`, `redis` 五个容器。只需一行命令即可在目标服务器上拉起整套环境。

---

## 3. 潜在风险与应对策略 (Risks & Mitigations)

1. **Node.js 处理复杂文档的能力受限**
   - *风险*：Node.js 生态中缺乏能完美解析复杂双栏排版或包含大量表格的 PDF 的开源库。
   - *应对*：在毕设范围内，重点保证纯文本 PDF、Word 和 Markdown 的解析质量。如果遇到极难解析的文档，可以考虑在 NestJS 中通过 `child_process` 或 HTTP 请求调用一个轻量级的 Python 脚本（如引入轻量化的 `unstructured` 服务）来专门处理解析，实现多语言协作。
2. **大模型 API 调用超时**
   - *风险*：Agent 思考和调用工具的过程（例如先联网搜索，再本地检索，再总结）会导致响应时间长达十几秒，前端极易触发 HTTP 超时。
   - *应对*：全面采用 **SSE (Server-Sent Events)**。在 NestJS 中使用 `@Sse()` 装饰器，在 Agent 思考的每一步（如“正在搜索网页...”、“正在阅读本地文档...”）都通过流式推送到 Vue3 前端，极大地缓解用户的等待焦虑。

## 4. 结论

回归到 **Vue3 + NestJS + PostgreSQL + Qdrant** 的技术栈是完全可行且明智的。这套方案既能保证你利用最熟悉的语言（TypeScript）**快速开发、高效落地**，又能通过 BullMQ（解决阻塞）、LangChain.js（实现 Agentic RAG）和 SSE（优化体验）来完美支撑系统的所有高级需求。这是一套兼顾了**开发效率与工程质量**的优秀毕设架构方案。