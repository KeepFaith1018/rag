# 文档分片方案升级实现记录

## 1. 文档说明

- 本文档用于记录后端文档分片方案从“全文字符级递归切分”升级到“结构感知 + 近似 token 二次切分”的实现过程。
- 本轮承接以下文档：
  - [document-chunking-strategy-upgrade-plan-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/apps/backend/docs/document-chunking-strategy-upgrade-plan-2026-04-25.md)
  - [09-rag-document-processing-architecture-plan-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/docs/09-rag-document-processing-architecture-plan-2026-04-25.md)
  - [10-rag-document-processing-detailed-design-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/docs/10-rag-document-processing-detailed-design-2026-04-25.md)

## 2. 本轮目标

本轮目标如下：

1. 升级 `DocumentChunkService` 的分片主策略
2. 优先基于 `ParsedDocument.sections` 做结构感知切分
3. 对超长 section 使用近似 token 窗口做二次切分
4. 保留全文递归切分兜底路径
5. 补齐 `titlePath`、`sectionLevel`、`chunkStrategy` 等 metadata

## 3. 当前状态

- 状态：已完成编码与检查
- 日期：`2026-04-25`
- 当前阶段：已完成计划 -> 编码 -> 回写文档 -> 检查

## 4. 本轮实际完成内容

### 4.1 升级 `ParsedSection` 结构

已修改：

- `apps/backend/src/modules/document-processing/interfaces/parsed-section.interface.ts`

本轮新增字段：

- `titlePath?: string[]`

用途：

- 保留结构化标题路径
- 为后续 chunk metadata、问答引用溯源和管理端展示提供基础

### 4.2 升级 Markdown 结构提取

已修改：

- `apps/backend/src/modules/document-processing/services/document-parser.service.ts`

本轮增强如下：

- `pdf` 解析得到的页级 section 现在会补 `titlePath`
- `txt / docx` 的普通段落 section 显式补空 `titlePath`
- `md` 标题解析现在会维护标题栈，并生成层级化 `titlePath`

当前结果：

- Markdown 文档不再只有单层标题名
- 可以把 `# / ## / ###` 的层级路径稳定传给分片阶段

### 4.3 升级 `DocumentChunkService` 主分片策略

已修改：

- `apps/backend/src/modules/document-processing/services/document-chunk.service.ts`

当前分片流程已从：

- `plainText + RecursiveCharacterTextSplitter + 字符级全文切分`

升级为：

1. 优先基于 `parsed.sections` 做结构粗切
2. 对超长 section 再做二次切分
3. 二次切分继续使用 LangChain `RecursiveCharacterTextSplitter`
4. 但通过 `lengthFunction` 按近似 token 长度控制窗口
5. 当结构信息不可用时，回退到全文递归切分

### 4.4 新增分片策略标识

当前 chunk 元数据已新增以下信息：

- `titlePath`
- `sectionLevel`
- `chunkStrategy`

当前 `chunkStrategy` 取值如下：

- `structured-token-aware`
- `plainText-recursive`

用途：

- 区分当前 chunk 是结构感知分片还是全文兜底分片
- 便于后续回放、评估和重解析策略切换

### 4.5 调整默认分片参数

已修改：

- `apps/backend/src/modules/document-processing/constants/document-processing.constants.ts`

当前默认参数如下：

- `DOCUMENT_CHUNK_SIZE = 700`
- `DOCUMENT_CHUNK_OVERLAP = 100`

说明：

- 当前参数不再按“纯字符窗口”理解
- 而是配合 `lengthFunction`，按近似 token 长度控制分片
- 当前仍未接入模型 tokenizer，因此属于“近似 token 窗口”

## 5. 当前状态流转说明

本轮没有改变文档主状态流转。

当前仍保持：

1. `uploaded`
2. `queued`
3. `parsing`
4. `chunking`
5. `embedding`
6. `ready`

本轮升级的是 `chunking` 阶段内部实现，而不是新增外部状态。

## 6. 本轮异常场景处理

本轮未忽略异常场景，已明确保留以下兜底能力：

### 6.1 结构信息缺失

处理方式：

- 当 `parsed.sections` 为空或结构块无法生成有效 chunk 时
- 自动回退到全文递归切分

意义：

- 避免因为解析结构质量不稳定导致整个分片阶段失败

### 6.2 超长结构块

处理方式：

- 不直接整段入库
- 使用近似 token 窗口做二次切分

意义：

- 保证单个 chunk 不会过大
- 更贴近后续 embedding 和检索模型的上下文预算

## 7. 本轮实际变更文件

### 7.1 新增文件

- `apps/backend/docs/document-chunking-strategy-implementation-record-2026-04-25.md`

### 7.2 修改文件

- `apps/backend/src/modules/document-processing/interfaces/parsed-section.interface.ts`
- `apps/backend/src/modules/document-processing/services/document-parser.service.ts`
- `apps/backend/src/modules/document-processing/services/document-chunk.service.ts`
- `apps/backend/src/modules/document-processing/constants/document-processing.constants.ts`

## 8. 本轮检查结果

已执行：

- [x] `pnpm --filter backend run build`
- [x] 最近修改文件诊断检查

检查结果：

- 后端构建通过
- 本轮分片升级相关代码无诊断错误

## 9. 当前边界说明

本轮已完成“结构感知 + 近似 token 二次切分”的第一版升级，但仍有明确边界：

- 当前尚未接入真实 tokenizer
- 当前 `md` 结构提取仍是轻量规则，不是 `MarkdownHeaderTextSplitter`
- 当前 `pdf / docx / txt` 仍依赖解析阶段产出的 `sections` 质量
- 当前尚未实现 parent-child chunk
- 当前尚未实现语义切分

## 10. 下一轮建议计划

下一轮建议优先顺序如下：

1. 做真实文档端到端联调，验证升级后的分片质量
2. 检查 `metadata_json.titlePath`、`chunkStrategy` 和页码映射是否符合预期
3. 若效果稳定，再考虑引入真实 tokenizer
4. 再评估是否需要把 Markdown 升级为专门的标题切分器

原因：

- 当前代码已经完成从“全文字符级切分”到“结构感知切分”的核心迁移
- 下一步最关键的是验证真实文档效果，而不是继续叠加更复杂的分片能力
