# 文档分片方案升级说明

## 1. 文档说明

- 本文档用于说明当前后端文档分片实际方案、存在的问题，以及下一步升级方向。
- 本文档承接以下设计与实现文档：
  - [09-rag-document-processing-architecture-plan-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/docs/09-rag-document-processing-architecture-plan-2026-04-25.md)
  - [10-rag-document-processing-detailed-design-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/docs/10-rag-document-processing-detailed-design-2026-04-25.md)
  - [document-processing-phase2-implementation-record-2026-04-25.md](file:///d:/Faith/Project/rag-knowledge-base/apps/backend/docs/document-processing-phase2-implementation-record-2026-04-25.md)

## 2. 当前实际方案

### 2.1 当前实现是什么

当前后端实际落地的分片方案是：

1. 文档解析阶段统一产出 `ParsedDocument`
2. 分片阶段直接读取 `parsed.plainText`
3. 使用 LangChain 的 `RecursiveCharacterTextSplitter`
4. 按字符级 `chunkSize / chunkOverlap` 对全文做递归切分
5. 再通过字符区间反推页码和 section
6. 最终写入 `b_document_chunks`

当前代码落点：

- [document-chunk.service.ts](file:///d:/Faith/Project/rag-knowledge-base/apps/backend/src/modules/document-processing/services/document-chunk.service.ts)

### 2.2 当前方案的技术特征

当前方案可以概括为：

- 全文级切分
- 字符级递归分片
- 基于 `RecursiveCharacterTextSplitter`
- 元数据后置补偿

### 2.3 当前方案的优点

- 实现简单，首版容易快速跑通
- 对 `txt / md / docx / pdf` 解析后的纯文本都能工作
- 与当前 LangChain 技术栈契合度高
- 对后续接入向量化和 Qdrant 没有阻塞

## 3. 当前方案存在的问题

当前方案虽然可用，但和业内主流的生产方案相比，仍有以下不足：

### 3.1 结构利用不足

- 当前是直接对 `plainText` 切分
- 标题、段落、列表、代码块、表格块的结构边界没有被优先利用
- 会出现标题和正文被拆散、不同语义段被硬拼到同一个 chunk 的情况

### 3.2 维度控制不够贴近模型

- 当前按字符长度切分，而不是按 token 长度切分
- 实际 embedding 和后续问答模型关注的是 token，不是字符
- 同样字符数的中英文、代码、表格文本在 token 数上差异很大

### 3.3 元数据映射较脆弱

- 当前 `page_no` 和 `section` 是切完后再通过字符区间回推
- 一旦解析文本在归一化过程中发生变化，页码、section 对齐可能不够稳定

### 3.4 检索质量存在上限

- 当前方案更像“可运行首版”
- 对问答引用、知识点召回、章节级溯源来说还不够强

## 4. 业内主流方案

当前业内更主流、也更适合 RAG 知识库的分片方案是：

```text
结构感知切分 -> token 控制二次切分 -> metadata 保留
```

如果基于 LangChain，常见实现组合为：

1. 先做结构切分
2. 再做递归或 token 切分
3. 保留标题路径、页码、字符区间等 metadata

典型组合如下：

- `MarkdownHeaderTextSplitter + RecursiveCharacterTextSplitter`
- 自定义 section 切分 + `RecursiveCharacterTextSplitter`
- 自定义 section 切分 + `TokenTextSplitter`

## 5. 建议升级方案

### 5.1 升级目标

建议把当前方案升级为：

- 第一层：结构感知切分
- 第二层：token 窗口二次切分
- 第三层：稳定 metadata 落库

### 5.2 升级后的整体流程

建议流程如下：

1. 解析器输出 `ParsedDocument`
2. 优先按 `sections` 做结构粗切
3. 若 section 过长，再做 token 窗口细切
4. 对每个 chunk 记录：
   - `pageNo`
   - `charStart`
   - `charEnd`
   - `titlePath`
   - `sourceFileName`
   - `processingVersion`
5. 最终落库到 `b_document_chunks`

### 5.3 基于 LangChain 的具体建议

#### `md`

建议方案：

- 优先使用 `MarkdownHeaderTextSplitter`
- 再用 `RecursiveCharacterTextSplitter` 或 token splitter 做二次切分

原因：

- Markdown 天然有标题层级
- 最适合做结构感知切分

#### `pdf / docx / txt`

建议方案：

- 先基于 `ParsedDocument.sections` 做结构粗切
- 再对过长 section 做 token 控制切分

原因：

- 当前项目解析层已经输出 `sections`
- 可以直接利用现有解析结果，不需要推倒重来

### 5.4 推荐参数

建议首版升级参数如下：

- 目标 chunk 大小：`500 - 800 tokens`
- overlap：`80 - 120 tokens`

说明：

- 该参数更适合当前百炼文本向量模型接入方案
- 后续可根据召回效果继续调优

## 6. 升级后的数据结构要求

升级后每个 chunk 建议稳定保留以下字段：

- `chunk_index`
- `content`
- `token_count`
- `page_no`
- `char_start`
- `char_end`
- `vector_id`
- `metadata_json`
- `embedding_status`

其中 `metadata_json` 至少应包含：

- `processingVersion`
- `title`
- `sourceFileName`
- `titlePath`
- `sectionLevel`
- `chunkStrategy`

## 7. 升级后的实现建议

### 7.1 `DocumentChunkService` 调整方向

建议将当前实现从：

- 直接切 `parsed.plainText`

升级为：

1. 先遍历 `parsed.sections`
2. 先构造结构块
3. 再对超长块调用 LangChain splitter
4. 最后统一写库

### 7.2 建议新增的方法边界

建议后续在 `DocumentChunkService` 中明确拆分以下方法：

- `createStructuredChunks()`
- `splitOversizedSection()`
- `buildChunkMetadata()`
- `estimateOrCountTokens()`

### 7.3 建议保留当前方案作为兜底

不建议完全删除当前的字符级递归切分方案。

建议做法：

- 结构信息完整时，走“结构感知 + token 二次切分”
- 结构信息缺失时，回退到 `RecursiveCharacterTextSplitter`

这样可以兼顾：

- 稳定性
- 文档兼容性
- 工程复杂度

## 8. 升级优先级建议

建议优先级如下：

1. 先升级 `md` 的标题感知切分
2. 再升级 `pdf / docx / txt` 的 section 感知切分
3. 再把字符级参数改为 token 级参数
4. 最后再考虑 parent-child chunk 或语义切分

## 9. 结论

当前项目实际分片方案是：

- 基于 LangChain `RecursiveCharacterTextSplitter`
- 对全文 `plainText` 做字符级递归切分

该方案适合作为首版实现，但不是当前业内更主流的生产方案。

建议升级为：

- 结构感知切分
- token 控制二次切分
- metadata 稳定保留

这套方案更符合：

- RAG 检索质量
- 答案引用溯源
- 后续问答链路扩展
- 当前项目的工程演进方向
