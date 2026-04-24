# 百炼 Embedding 配置与联调记录

## 1. 文档说明

- 本文档用于记录后端百炼 Embedding 配置补齐与联调辅助改造过程。
- 本轮承接：
  - [document-processing-phase3-implementation-record-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/apps/backend/docs/document-processing-phase3-implementation-record-2026-04-25.md)
- 本轮继续遵循执行顺序：
  - 计划
  - 编码
  - 回写文档
  - 检查
  - 下一轮计划

## 2. 本轮目标

本轮目标如下：

1. 补齐百炼标准环境变量
2. 同时保留文本向量模型和视觉向量模型配置位
3. 明确当前文档 RAG 默认使用的模型
4. 提供本地联调 smoke 脚本
5. 保证修改后项目可正常构建

## 3. 当前确认结论

本轮已确认以下关键决策：

1. 当前文档文本分片向量化默认使用 `text-embedding-v4`
2. 同时保留 `tongyi-embedding-vision-flash-2026-03-06` 配置位，供后续多模态扩展
3. 百炼标准环境变量直接写入 `apps/backend/.env`

## 4. 当前状态

- 状态：已完成配置补齐与 dry-run 联调检查
- 日期：`2026-04-25`
- 当前阶段：已完成计划 -> 编码 -> 回写文档 -> 检查

## 5. 本轮实际完成内容

### 5.1 环境变量补齐

已直接写入：

- `apps/backend/.env`

本轮新增百炼标准变量如下：

- `BAILIAN_API_KEY`
- `BAILIAN_BASE_URL`
- `BAILIAN_DOCUMENT_EMBEDDING_TYPE`
- `BAILIAN_TEXT_EMBEDDING_MODEL`
- `BAILIAN_VISION_EMBEDDING_MODEL`
- `BAILIAN_EMBEDDING_MODEL`
- `BAILIAN_EMBEDDING_DIMENSIONS`
- `BAILIAN_EMBED_BATCH_SIZE`
- `BAILIAN_EMBED_RETRY_COUNT`
- `BAILIAN_EMBED_REQUEST_INTERVAL_MS`

当前默认值如下：

- `BAILIAN_DOCUMENT_EMBEDDING_TYPE="text"`
- `BAILIAN_TEXT_EMBEDDING_MODEL="text-embedding-v4"`
- `BAILIAN_VISION_EMBEDDING_MODEL="tongyi-embedding-vision-flash-2026-03-06"`
- `BAILIAN_EMBEDDING_MODEL="text-embedding-v4"`
- `BAILIAN_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"`

说明：

- 当前文档 RAG 文本分片默认走 `text-embedding-v4`
- 同时保留 `vision-flash` 配置位，供后续多模态扩展
- `BAILIAN_API_KEY` 当前写入的是占位值，需要用户自行替换

### 5.2 环境校验增强

已修改：

- `apps/backend/src/common/config/env.validation.ts`

新增了以下校验项：

- `BAILIAN_DOCUMENT_EMBEDDING_TYPE`
- `BAILIAN_TEXT_EMBEDDING_MODEL`
- `BAILIAN_VISION_EMBEDDING_MODEL`

说明：

- 当前允许 `text / vision` 两种类型
- 仍然保持百炼变量为可选，避免没有真实 Key 时应用直接无法启动

### 5.3 Embedding 服务双模型兼容

已修改：

- `apps/backend/src/modules/ai/embedding.service.ts`

本轮改造点如下：

- 运行时增加 `modelType`
- 当 `BAILIAN_DOCUMENT_EMBEDDING_TYPE=text` 时：
  - 优先读取 `BAILIAN_TEXT_EMBEDDING_MODEL`
  - 回退读取 `BAILIAN_EMBEDDING_MODEL`
- 当 `BAILIAN_DOCUMENT_EMBEDDING_TYPE=vision` 时：
  - 优先读取 `BAILIAN_VISION_EMBEDDING_MODEL`
  - 回退读取 `BAILIAN_EMBEDDING_MODEL`
- 新增 `getDebugSummary()` 用于联调输出
- 数值型环境变量统一做显式 `number` 转换

说明：

- 当前真正用于文档文本向量化的仍是文本模型
- `vision` 只是保留配置位，不代表当前文档处理链路已经切换到多模态请求格式

### 5.4 新增本地联调脚本

已新增：

- `apps/backend/scripts/bailian-embedding-smoke.ts`

已修改：

- `apps/backend/package.json`

新增脚本命令：

- `pnpm --filter backend run debug:bailian-embedding`

脚本能力如下：

- 打印当前百炼运行配置摘要
- 在真实 Key 可用时，直接发起一次文本向量化联调
- 当使用占位 Key 或显式传入 `--dry-run` 时，仅做配置读取检查，不发起远程请求

## 6. 本轮联调结果

### 6.1 已完成的联调

已执行：

- `pnpm --filter backend run build`
- `pnpm --filter backend run debug:bailian-embedding -- --dry-run`
- `pnpm --filter backend run debug:bailian-embedding`

dry-run 输出结果已确认：

- `modelType = text`
- `model = text-embedding-v4`
- `baseUrl = https://dashscope.aliyuncs.com/compatible-mode/v1`
- `dimensions = 1024`
- `batchSize = 10`
- `retryCount = 3`
- `requestIntervalMs = 1000`

### 6.2 真实远程联调结果

已使用真实百炼 Key 执行真实远程联调，结果成功。

真实联调输出如下：

- `inputCount = 2`
- `vectorCount = 2`
- `firstVectorDimension = 1024`
- `totalTokens = 28`

联调结论：

- 当前百炼文本向量模型 `text-embedding-v4` 可正常调用
- 当前项目配置的 `dimensions = 1024` 已生效
- 当前批量请求可以稳定返回与输入数量一致的向量结果
- 当前 `EmbeddingService` 的基础调用、配置读取、批量处理逻辑可用

### 6.3 当前未完成项

- 当前尚未对完整文档处理链路执行端到端联调
- 当前尚未验证 `DocumentProcessingService -> EmbeddingService -> QdrantService -> ready` 的整链路运行结果
- 当前尚未验证真实文档上传后的自动入队和向量入库效果

## 7. 当前建议的真实联调步骤

1. 如需调整模型，可修改：
   - `BAILIAN_DOCUMENT_EMBEDDING_TYPE`
   - `BAILIAN_TEXT_EMBEDDING_MODEL`
   - `BAILIAN_VISION_EMBEDDING_MODEL`
2. 执行：

```bash
pnpm --filter backend run debug:bailian-embedding
```

3. 若返回：
   - `vectorCount`
   - `firstVectorDimension`
   - `totalTokens`
   则说明百炼文本向量化链路已真实联通

4. 下一步建议直接执行真实文档上传与处理链路联调，验证：
   - `queued -> parsing -> chunking -> embedding -> ready`
   - `b_document_chunks.embedding_status`
   - Qdrant collection 创建与向量写入

## 8. 本轮实际变更文件

### 8.1 新增文件

- `apps/backend/docs/bailian-embedding-config-and-debug-record-2026-04-25.md`
- `apps/backend/scripts/bailian-embedding-smoke.ts`

### 8.2 修改文件

- `apps/backend/.env`
- `apps/backend/package.json`
- `apps/backend/src/common/config/env.validation.ts`
- `apps/backend/src/modules/ai/embedding.service.ts`

## 9. 本轮检查结果

已执行：

- [x] `pnpm --filter backend run build`
- [x] `pnpm --filter backend run debug:bailian-embedding -- --dry-run`
- [x] 最近修改文件诊断检查

检查结果：

- 项目构建通过
- 百炼 dry-run 联调脚本可正常执行
- 最新修改文件无诊断错误

## 10. 当前边界说明

- 当前只完成了“配置补齐 + dry-run 联调入口”
- 已执行真实远程 Embedding 调用，结果成功
- 当前多模态 `vision-flash` 只保留了配置位，文档文本 RAG 主链路默认仍使用文本 Embedding

## 11. 下一步建议

下一步建议如下：

1. 执行真实文档上传测试
2. 验证自动入队、解析、切块、向量化、入 Qdrant 是否完整成功
3. 检查文档最终是否推进到 `ready`
4. 若你愿意，我可以继续帮你：
   - 做端到端链路联调
   - 继续进入第四阶段治理能力开发
