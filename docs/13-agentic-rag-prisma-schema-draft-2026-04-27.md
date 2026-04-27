# Agentic RAG Prisma Schema 变更草案

## 1. 文档说明

- 本文档基于当前文件 [schema.prisma](file:///d:/Faith/Project/rag-knowledge-base/apps/backend/prisma/schema.prisma) 的现状，给出面向 `Agentic RAG` 多知识库对话模块的 Prisma 变更草案。
- 本文档目标不是立即替换现有 `schema.prisma`，而是先明确“要改哪些表、为什么改、建议改成什么样”。
- 草案重点覆盖：
  - 会话主体与“普通对话 / RAG”双模式消息
  - 按天配额与用量控制
  - 消息状态与流式生成元数据
  - 引用溯源
  - Agent 运行轨迹
  - Sparse 检索索引

## 2. 当前 Schema 现状

当前与聊天模块直接相关的两个模型如下：

- `b_chat_sessions`
  - 当前仍保留 `kb_id` 单知识库字段
  - 但新的交互目标是不再让会话固定绑定知识库范围，而是让会话承载普通对话消息与 `RAG` 消息
- `b_chat_messages`
  - 当前已有 `references`、`tool_calls`、`tokens_used`
  - 尚不支持普通对话 / `RAG` 模式区分、流式状态、完成原因、trace 关联、结构化元数据，以及消息级知识库范围记录
- `b_users`
  - 当前仍直接承载 `daily_chat_limit / token_quota / used_tokens`
  - 但如果后续要做按天重置、按日统计、额度审计，这些字段更适合独立拆到“用户日配额表”

因此，如果要支持：

1. 以会话为主体，支持普通对话与 `RAG` 消息共存
2. 流式消息生成
3. 引用面板
4. Agent 过程追踪
5. Hybrid Retrieval 的 Sparse 检索

则需要对现有 Schema 做增量扩展。

## 3. 设计原则

本次 Prisma 变更建议遵循以下原则：

1. 优先增量兼容，不直接破坏现有聊天表
2. 保留 `b_chat_sessions.kb_id` 作为兼容字段
3. `RAG` 消息的知识库选择真值记录在消息表或运行表，而不是会话关系表
4. 结构化引用、Agent trace 独立建表
5. 配额信息与用户主表解耦，按天建模，便于重置与审计
6. 能放在 `Json` 的运行时元数据先放 `Json`，避免首版过度建模

## 4. 建议变更总览

### 4.1 修改现有模型

1. `b_chat_sessions`
2. `b_chat_messages`
3. `b_users`
4. `b_knowledge_bases`
5. `b_document_chunks`
6. `b_documents`

### 4.2 新增模型

1. `b_user_daily_quotas`
2. `b_chat_message_citations`
3. `b_agent_runs`
4. `b_agent_steps`
5. `b_agent_tool_calls`
6. `b_document_chunk_search_index`

## 5. 建议修改片段

### 5.1 `b_users`

建议补充关系字段：

```prisma
model b_users {
  id            BigInt  @id @default(autoincrement())
  email         String  @unique(map: "uk_email") @db.VarChar(255)
  password_hash String  @db.VarChar(255)
  full_name     String? @db.VarChar(100)
  avatar_url    String? @db.VarChar(500)
  is_active     Boolean @default(true)

  created_at DateTime @default(now()) @db.DateTime(0)
  updated_at DateTime @default(now()) @db.DateTime(0)

  // 关联
  chat_sessions      b_chat_sessions[]
  kb_members         b_kb_members[]
  knowledge_bases    b_knowledge_bases[]
  uploaded_documents b_documents[]          @relation("document_uploader")
  upload_sessions    b_upload_sessions[]    @relation("upload_session_user")
  model_configs      b_user_model_configs[]
  kb_invitations     b_kb_invitations[]
  user_sessions      b_user_sessions[]
  daily_quotas       b_user_daily_quotas[]

  // Agentic RAG
  agent_runs         b_agent_runs[]
}
```

说明：

- 用户主表不再直接承载按天配额字段。
- 新增 `daily_quotas` 关系，用于关联用户每日额度与用量记录。

### 5.2 `b_knowledge_bases`

建议补充关系字段：

```prisma
model b_knowledge_bases {
  id          BigInt  @id @default(autoincrement())
  name        String  @db.VarChar(100)
  description String? @db.Text

  visibility            String  @default("private") @db.VarChar(50)
  status                String  @default("normal") @db.VarChar(50)
  is_public             Boolean @default(false)
  allow_public_download Boolean @default(false)

  owner_id   BigInt
  created_at DateTime @default(now()) @db.DateTime(0)
  updated_at DateTime @default(now()) @db.DateTime(0)

  documents           b_documents[]
  upload_sessions     b_upload_sessions[]
  kb_members          b_kb_members[]
  kb_invitations      b_kb_invitations[]

  // Agentic RAG
  message_citations   b_chat_message_citations[]
  chunk_search_index  b_document_chunk_search_index[]

  b_users b_users @relation(fields: [owner_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "fk_kb_owner")

  @@index([owner_id], map: "idx_owner")
  @@index([visibility, status], map: "idx_kb_visibility_status")
  @@index([visibility, is_public], map: "idx_kb_visibility_public")
}
```

说明：

- 为新增关系表补关系数组，便于 Prisma 查询。

### 5.3 `b_documents`

建议补充关系字段：

```prisma
model b_documents {
  id                 BigInt    @id @default(autoincrement())
  kb_id              BigInt
  uploader_id        BigInt?
  title              String    @db.VarChar(255)
  original_filename  String?   @db.VarChar(255)
  file_path          String    @db.VarChar(500)
  file_hash          String?   @db.VarChar(64)
  file_size          BigInt?   @default(0)
  file_type          String?   @db.VarChar(20)
  mime_type          String?   @db.VarChar(100)
  status             String    @default("pending") @db.VarChar(50)
  processing_version Int       @default(1)
  current_stage      String    @default("uploaded") @db.VarChar(50)
  last_error_stage   String?   @db.VarChar(50)
  retry_count        Int       @default(0)
  last_error_code    String?   @db.VarChar(100)
  error_msg          String?   @db.Text
  token_count        Int?      @default(0)
  parse_started_at   DateTime?
  parse_finished_at  DateTime?
  last_reparse_at    DateTime?
  created_at         DateTime  @default(now()) @db.DateTime(0)
  updated_at         DateTime  @default(now()) @db.DateTime(0)

  document_chunks   b_document_chunks[]
  processing_tasks  b_document_processing_tasks[]
  upload_sessions   b_upload_sessions[]

  // Agentic RAG
  message_citations b_chat_message_citations[]

  b_knowledge_bases b_knowledge_bases @relation(fields: [kb_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "fk_doc_kb")
  b_users           b_users?          @relation("document_uploader", fields: [uploader_id], references: [id], onDelete: SetNull, onUpdate: NoAction, map: "fk_doc_uploader")

  @@index([kb_id], map: "idx_kb_id")
  @@index([uploader_id], map: "idx_doc_uploader_id")
  @@index([kb_id, uploader_id], map: "idx_doc_kb_uploader")
}
```

### 5.4 `b_document_chunks`

建议补充关系字段与可选检索字段：

```prisma
model b_document_chunks {
  id            BigInt  @id @default(autoincrement())
  doc_id        BigInt
  chunk_index   Int
  content       String  @db.LongText
  token_count   Int?    @default(0)
  page_no       Int?
  char_start    Int?
  char_end      Int?
  vector_id     String? @db.VarChar(100)
  metadata_json Json?

  embedding_status String   @default("pending") @db.VarChar(20)
  created_at       DateTime @default(now()) @db.DateTime(0)

  // Agentic RAG
  search_text      String?  @db.LongText
  keyword_text     String?  @db.Text
  title_path       String?  @db.VarChar(500)

  message_citations b_chat_message_citations[]
  search_index      b_document_chunk_search_index?

  b_documents b_documents @relation(fields: [doc_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "fk_chunk_doc")

  @@index([doc_id, chunk_index], map: "idx_doc_chunk")
  @@index([vector_id], map: "idx_chunk_vector_id")
}
```

说明：

- `search_text / keyword_text / title_path` 不是必须直接加到主表。
- 如果你希望主表保持纯净，可以不加这三个字段，只保留独立的 `b_document_chunk_search_index`。
- 我个人建议首版只建独立检索索引表，先不污染 `b_document_chunks`。

### 5.5 `b_chat_sessions`

建议将当前模型扩展为：

```prisma
model b_chat_sessions {
  id         String   @id @db.Char(36)
  user_id    BigInt
  kb_id      BigInt?
  title      String   @default("新会话") @db.VarChar(100)

  // Agentic RAG
  summary_text              String?  @db.Text
  last_selected_kb_ids_json Json?
  last_chat_mode            String?  @db.VarChar(20)
  last_message_at           DateTime? @db.DateTime(0)

  created_at DateTime @default(now()) @db.DateTime(0)
  updated_at DateTime @default(now()) @db.DateTime(0)

  chat_messages     b_chat_messages[]
  agent_runs        b_agent_runs[]
  b_users           b_users @relation(fields: [user_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "fk_chat_user")

  @@index([user_id], map: "idx_user_chat")
  @@index([user_id, updated_at], map: "idx_chat_user_updated")
}
```

说明：

- `kb_id` 先保留，兼容旧逻辑，但不再作为新交互的主设计。
- `last_selected_kb_ids_json` 仅用于前端回显上一次 `RAG` 消息的知识库选择。
- `last_chat_mode` 用于前端回显上一轮发送的是普通对话还是 `RAG`。
- 会话层不建议增加“上轮所选模型”回显字段，模型选择应当是消息级输入行为。

### 5.6 `b_chat_messages`

建议扩展为：

```prisma
model b_chat_messages {
  id         BigInt @id @default(autoincrement())
  session_id String @db.Char(36)
  role       String @db.VarChar(50)
  content    String @db.Text

  references  Json?
  tool_calls  Json?
  tokens_used Int?  @default(0)

  // Agentic RAG
  message_status       String   @default("completed") @db.VarChar(30)
  metadata_json        Json?
  model_source         String?  @db.VarChar(20)
  model_config_id      BigInt?
  model_name           String?  @db.VarChar(100)
  model_provider       String?  @db.VarChar(50)
  finish_reason        String?  @db.VarChar(30)
  trace_id             String?  @db.Char(36)
  chat_mode            String?  @db.VarChar(20)
  selected_kb_ids_json Json?
  resolved_kb_ids_json Json?
  stream_started_at    DateTime? @db.DateTime(0)
  stream_finished_at   DateTime? @db.DateTime(0)

  feedback_type   String? @db.VarChar(20)
  feedback_reason String? @db.Text

  created_at      DateTime @default(now()) @db.DateTime(0)

  b_chat_sessions        b_chat_sessions @relation(fields: [session_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "fk_msg_session")
  message_citations      b_chat_message_citations[]

  @@index([session_id], map: "idx_session_msg")
  @@index([session_id, created_at], map: "idx_session_msg_created")
  @@index([trace_id], map: "idx_msg_trace")
  @@index([message_status], map: "idx_msg_status")
}
```

说明：

- `message_status` 建议枚举语义：
  - `streaming`
  - `completed`
  - `aborted`
  - `failed`
- `chat_mode` 建议取值：
  - `chat`
  - `rag`
- 普通对话消息不需要写入知识库字段。
- 模型选择应当跟随每次消息请求传入，而不是从会话默认值推导。
- `model_source` 建议取值为 `system / user`，分别对应 `sys_model_configs` 与 `b_user_model_configs`。
- `model_config_id` 用于记录本轮消息实际选中的模型配置主键。
- `selected_kb_ids_json` 用于记录该条消息发送时，用户显式选择的知识库。
- `resolved_kb_ids_json` 用于记录后端最终实际参与检索的知识库。
- `trace_id` 用于将消息和 `b_agent_runs` 关联起来。

## 6. 建议新增模型

### 6.1 `b_user_daily_quotas`

用途：

- 将聊天额度从 `b_users` 主表抽离
- 以“用户 + 日期”为粒度记录每日额度与当日已用量
- 支持日切重置、限额检查、后台审计

```prisma
model b_user_daily_quotas {
  id               BigInt   @id @default(autoincrement())
  user_id          BigInt
  quota_date       DateTime @db.Date
  daily_chat_limit Int      @default(50)
  daily_token_quota BigInt  @default(1000000)
  used_chat_count  Int      @default(0)
  used_token_count BigInt   @default(0)
  created_at       DateTime @default(now()) @db.DateTime(0)
  updated_at       DateTime @default(now()) @db.DateTime(0)

  b_users b_users @relation(fields: [user_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "fk_user_daily_quota_user")

  @@unique([user_id, quota_date], map: "uk_user_daily_quota")
  @@index([quota_date], map: "idx_daily_quota_date")
}
```

说明：

- `quota_date` 表示额度所属自然日，建议按系统统一时区落库。
- `daily_chat_limit` 与 `daily_token_quota` 表示当天额度上限。
- `used_chat_count` 与 `used_token_count` 表示当天累计消耗。
- 如果后续要支持会员套餐、临时加配额，可以在每日初始化任务中写入当天快照值。

### 6.2 `b_chat_message_citations`

用途：

- 记录回答中真正使用到的引用证据

```prisma
model b_chat_message_citations {
  id         BigInt   @id @default(autoincrement())
  message_id BigInt
  kb_id      BigInt
  doc_id     BigInt
  chunk_id   BigInt
  score      Float?
  quote      String?  @db.Text
  order_no   Int      @default(0)
  created_at DateTime @default(now()) @db.DateTime(0)

  b_chat_messages   b_chat_messages   @relation(fields: [message_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "fk_chat_citation_message")
  b_knowledge_bases b_knowledge_bases @relation(fields: [kb_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "fk_chat_citation_kb")
  b_documents       b_documents       @relation(fields: [doc_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "fk_chat_citation_doc")
  b_document_chunks b_document_chunks @relation(fields: [chunk_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "fk_chat_citation_chunk")

  @@index([message_id], map: "idx_chat_citation_message")
  @@index([doc_id], map: "idx_chat_citation_doc")
  @@index([chunk_id], map: "idx_chat_citation_chunk")
  @@index([kb_id], map: "idx_chat_citation_kb")
}
```

### 6.3 `b_agent_runs`

用途：

- 记录一次完整 Agent 执行的总体信息

```prisma
model b_agent_runs {
  id                   String    @id @db.Char(36)
  session_id           String    @db.Char(36)
  user_id              BigInt
  user_message_id      BigInt
  assistant_message_id BigInt?
  status               String    @db.VarChar(30)
  total_tokens         Int?      @default(0)
  duration_ms          Int?
  model_source         String?   @db.VarChar(20)
  model_config_id      BigInt?
  chat_mode            String?   @db.VarChar(20)
  model_provider       String?   @db.VarChar(50)
  model_name           String?   @db.VarChar(100)
  selected_kb_ids_json Json?
  resolved_kb_ids_json Json?
  routed_query_json    Json?
  metadata_json        Json?
  created_at           DateTime  @default(now()) @db.DateTime(0)
  finished_at          DateTime? @db.DateTime(0)

  b_chat_sessions b_chat_sessions @relation(fields: [session_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "fk_agent_run_session")
  b_users         b_users         @relation(fields: [user_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "fk_agent_run_user")

  @@index([session_id], map: "idx_agent_run_session")
  @@index([user_id], map: "idx_agent_run_user")
  @@index([status], map: "idx_agent_run_status")
}
```

说明：

- 首版这里不强绑 `user_message_id / assistant_message_id` 外键关系，避免 Prisma 上新增多重 relation 时复杂度过高。
- 如果后面你希望完整关联，也可以再补 relation name。
- `b_agent_runs` 同样建议记录一次执行实际使用的模型配置，便于排障和统计。

### 6.4 `b_agent_steps`

用途：

- 记录 Graph 中的节点执行情况

```prisma
model b_agent_steps {
  id          BigInt    @id @default(autoincrement())
  run_id       String    @db.Char(36)
  agent_name   String    @db.VarChar(50)
  step_type    String    @db.VarChar(50)
  status       String    @db.VarChar(30)
  input_json   Json?
  output_json  Json?
  duration_ms  Int?
  started_at   DateTime  @default(now()) @db.DateTime(0)
  finished_at  DateTime? @db.DateTime(0)

  b_agent_runs b_agent_runs @relation(fields: [run_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "fk_agent_step_run")

  @@index([run_id], map: "idx_agent_step_run")
  @@index([agent_name], map: "idx_agent_step_agent")
  @@index([step_type], map: "idx_agent_step_type")
}
```

### 6.5 `b_agent_tool_calls`

用途：

- 记录工具调用的入参与结果

```prisma
model b_agent_tool_calls {
  id          BigInt   @id @default(autoincrement())
  step_id      BigInt
  tool_name    String   @db.VarChar(100)
  status       String   @db.VarChar(30)
  args_json    Json?
  result_json  Json?
  duration_ms  Int?
  created_at   DateTime @default(now()) @db.DateTime(0)

  b_agent_steps b_agent_steps @relation(fields: [step_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "fk_agent_tool_step")

  @@index([step_id], map: "idx_agent_tool_step")
  @@index([tool_name], map: "idx_agent_tool_name")
}
```

### 6.6 `b_document_chunk_search_index`

用途：

- 作为 Sparse 检索的独立索引表

```prisma
model b_document_chunk_search_index {
  chunk_id      BigInt   @id
  doc_id        BigInt
  kb_id         BigInt
  title         String?  @db.VarChar(255)
  title_path    String?  @db.VarChar(500)
  content_plain String   @db.LongText
  keyword_text  String?  @db.Text
  created_at    DateTime @default(now()) @db.DateTime(0)
  updated_at    DateTime @default(now()) @db.DateTime(0)

  b_document_chunks b_document_chunks @relation(fields: [chunk_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "fk_chunk_search_chunk")
  b_documents       b_documents       @relation(fields: [doc_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "fk_chunk_search_doc")
  b_knowledge_bases b_knowledge_bases @relation(fields: [kb_id], references: [id], onDelete: Cascade, onUpdate: NoAction, map: "fk_chunk_search_kb")

  @@index([doc_id], map: "idx_chunk_search_doc")
  @@index([kb_id], map: "idx_chunk_search_kb")
}
```

说明：

- 如果后续你决定使用 MySQL FullText，可以在 SQL migration 中单独补全文索引。
- Prisma 本身不适合优雅表达 MySQL FullText 细节，因此建议通过原生 SQL migration 处理。

## 7. 推荐的最小可落地版本

如果你想先快速上线第一版，而不是一次性把所有表都加满，建议只先落以下变更：

### 必改

1. `b_user_daily_quotas`
2. `b_chat_sessions`
3. `b_chat_messages`
4. `b_chat_message_citations`
5. `b_agent_runs`

### 建议首版就加

1. `b_agent_steps`

### 可第二阶段再加

1. `b_agent_tool_calls`
2. `b_document_chunk_search_index`

说明：

- 如果 Sparse 首版先走“应用层简单关键词匹配”，那 `b_document_chunk_search_index` 可以延后。
- 如果当前就要做按天限额控制，`b_user_daily_quotas` 不建议延后。

## 8. 推荐迁移顺序

建议按以下顺序执行 migration：

1. 先从 `b_users` 去掉配额字段，并新增 `b_user_daily_quotas`
2. 再改 `b_chat_sessions`
3. 再改 `b_chat_messages`
4. 新增 `b_chat_message_citations`
5. 新增 `b_agent_runs`
6. 新增 `b_agent_steps`
7. 最后新增 `b_agent_tool_calls` 与 `b_document_chunk_search_index`

原因：

- 这样可以优先保证“会话可用、消息可用、引用可用”
- 即使 Agent trace 未全部落地，也不会阻塞基础聊天链路
- 配额先独立后，后续按天限流逻辑会更清晰

## 9. 落地注意事项

### 9.1 关于 `kb_id`

- 不建议马上删除 `b_chat_sessions.kb_id`
- 建议保留作为兼容字段，但不要再把它当成当前会话的固定检索范围
- 真正范围控制以 `b_chat_messages.selected_kb_ids_json / resolved_kb_ids_json` 为准

### 9.2 关于 `references`

- 不建议立即删除 `b_chat_messages.references`
- 建议保留一段时间作为兼容输出
- 新逻辑以 `b_chat_message_citations` 为主

### 9.3 关于 `trace_id`

- 建议 `b_chat_messages.trace_id = b_agent_runs.id`
- 这样前端或后台都能通过消息直接查到 Agent 执行轨迹

### 9.4 关于 FullText

- 如果你最终用 MySQL FullText，请不要完全依赖 Prisma 描述索引
- 建议用 SQL migration 明确写：

```sql
ALTER TABLE b_document_chunk_search_index
ADD FULLTEXT INDEX ft_chunk_search_content (title, title_path, content_plain, keyword_text);
```

### 9.5 关于模型选择

- 前端应支持用户在每次发送消息时显式选择模型。
- 不建议在 `b_chat_sessions` 上增加 `last_model_*` 之类的回显字段。
- 如果需要审计本轮消息实际用的模型，建议写入 `b_chat_messages.model_source / model_config_id / model_provider / model_name`。
- 如果需要审计一次 Agent 运行实际用的模型，建议同步写入 `b_agent_runs` 对应字段。

## 10. 建议下一步

基于这份草案，下一步最合适的是二选一：

1. 我直接把这份草案转换成对 `apps/backend/prisma/schema.prisma` 的正式修改稿
2. 我先继续补一份 `Prisma migration SQL` 草案，包含 `ALTER TABLE` 和 `CREATE TABLE`

如果你要我继续，我建议先做第 `1` 步，把 `schema.prisma` 真正改出来，再检查 Prisma 语法和关联是否有冲突。
