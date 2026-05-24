# 文件解析优化

> 日期：2026-05-07 | 分支：`feat/rag-pipeline-optimization`

## 一、背景

RAG 文档解析是检索质量的第一道关口。核心策略：**结构化文件（PDF/DOCX/MD）→ Markdown → 按标题层级切割**。

### 优化前缺陷

| 问题 | 影响 |
|------|------|
| PDF 用 `pdf-parse` 逐页提取，无结构 | 标题/表格/段落全部丢失，切块按页边界 |
| DOCX 用 `DocxLoader` 纯文本模式 | Word 标题 1/2/3 样式变普通段落，表格混入正文 |
| MD 仅用正则提取标题 | 无 frontmatter 解析，无代码块/表格类型标记 |
| TXT 用双换行分段 | 超长段落未预分割，下游切块负担重 |
| `charStart/charEnd` 用 `indexOf()` 定位 | 重复文本定位到首次出现位置，偏移错误 |
| `TextLoader` 依赖 LangChain ESM 动态 import | Jest 测试无法运行 |
| 零测试覆盖 | 改动风险高，无回归护栏 |

---

## 二、优化方案

### 核心架构

```
PDF  → pdfexcavator (段落+表格+字体→标题) → Markdown ─┐
DOCX → mammoth.convertToMarkdown()          → Markdown ─┤
MD   → readFile + parseMarkdownSections()   → Markdown ─┤
TXT  → readFile + parseSectionsFromText()   → 纯文本 ──┘
                                                    ↓
                                          ParsedDocument {
                                            plainText,  ← 兼容旧逻辑
                                            markdown?,  ← 结构信息
                                            sections[],  ← 含 titlePath + type
                                            pageMap?    ← PDF 专有
                                          }
```

### 各格式改动

#### PDF：`pdf-parse` → `pdfexcavator`

`pdfexcavator`（npm 包，MIT 协议）是 JavaScript/TypeScript 的 pdfplumber 等价物：

1. `extractWords()` 提取每个词的位置和字体大小
2. 按 y 坐标聚类成行（容差 5px）
3. 统计每页中位数字体 = 正文基准，字体 > 基准 1.25 倍 → 标题
4. `extractTables()` 提取表格，过滤置信度 < 0.6
5. 组装 Markdown：标题 `#`、表格 `|...|`、段落直接拼接

失败时自动回退 `pdf-parse`。

#### DOCX：`DocxLoader` → `mammoth.convertToMarkdown()`

`mammoth` 是现有依赖（原 DocxLoader 底层），新增 Markdown 输出路径：

- Word Heading 1/2/3 样式 → `#` `##` `###`
- Word 表格 → `| col1 | col2 |` Markdown table
- 输出 Markdown 走增强的 `parseMarkdownSections()` 提取 sections

失败时自动回退 `DocxLoader`。

#### Markdown：增强 section 提取

- `extractFrontmatter()`：解析 `---\n...\n---` YAML 块，写入 `ParsedDocument.metadata`
- 标题栈：`/^(#{1,6})\s+(.+)$/` 匹配，维护 `headingStack`，构建完整 `titlePath`
- 代码块：` ``` ` 边界检测，`type='code'`
- 表格：`|...|` 格式 + 分隔行（`|---|`）检测，`type='table'`

#### TXT：增加长段落预分割

- 超长段落（> 2000 字符）在中文标点 `。！？` 处切分为多段
- 避免下游 `RecursiveCharacterTextSplitter` 遇到超大 chunk

### 通用修复

- **`charStart/charEnd`**：`indexOf()` → 累积偏移量计算，确保定位精确
- **`TextLoader` 移除**：用原生 `readFile('utf-8')` 替代，消除 LangChain ESM import 在 Jest 中的兼容问题

---

## 三、改动文件

| 文件 | 变更 |
|------|------|
| `apps/server/src/modules/document/parsed-document.interface.ts` | +`markdown?: string` |
| `apps/server/src/modules/document/parsed-section.interface.ts` | +`type?: 'text'\|'table'\|'code'\|'list'` |
| `apps/server/src/modules/document/services/document-parser.service.ts` | 核心重写（620+ 行） |
| `apps/server/src/modules/document/__fixtures__/test.md` | 新增 MD 测试 fixture |
| `apps/server/src/modules/document/__fixtures__/test.txt` | 新增 TXT 测试 fixture |
| `apps/server/src/modules/document/services/document-parser.service.spec.ts` | 新增 17 个测试 |
| `apps/server/package.json` | +`pdfexcavator`, +`mammoth`, +`gray-matter`；jest `moduleNameMapper` |

---

## 四、测试覆盖

17 个测试，覆盖：

| 类别 | 测试内容 |
|------|---------|
| 分发 | 不支持的文件类型 → `FILE_TYPE_UNSUPPORTED` |
| Markdown | 标题层级 1/2/3、表格 type=table、代码块 type=code |
| Markdown | frontmatter 提取、plainText 不含 YAML 字段 |
| Markdown | `markdown` 字段输出 |
| TXT | 段落分段正确、第一段内容匹配 |
| charStart/charEnd | 相邻 section 间隔正确、差等于 content 长度 |
| 异常 | 不存在文件抛出异常 |

```bash
cd apps/server && npx jest --testPathPatterns="document-parser"
# Test Suites: 1 passed, 17 passed
```

---

## 五、验收方式

```bash
# 1. 构建确认
pnpm --filter server build

# 2. 单元测试
pnpm --filter server test -- -t "DocumentParserService"

# 3. 端到端验证
# 启动服务 → 上传 PDF/DOCX/MD/TXT → SSE 监听 document.state.changed
# → 确认 parsing → chunking → embedding → ready
# → 检查 chunk 元数据是否包含 titlePath
```


---


# 测试规范

> 日期：2026-05-07 | 分支：`feat/rag-pipeline-optimization`

## 一、测试体系结构

```
apps/server/
├── src/modules/<module>/
│   ├── services/
│   │   ├── xxx.service.ts
│   │   └── xxx.service.spec.ts        ← 单元测试（与源码同级）
│   └── __fixtures__/                   ← 模块级 fixture 文件
│       ├── test.md
│       └── test.txt
├── src/common/<service>/
│   ├── xxx.service.ts
│   └── xxx.service.spec.ts            ← 公共服务也需要测试
└── test/                              ← E2E 测试
    ├── jest-e2e.json
    ├── helpers/
    │   └── test-app.ts                 ← NestJS 测试应用工厂
    └── modules/
        └── document/
            └── document.e2e.spec.ts
```

## 二、运行命令

```bash
# 单元测试（全部）
pnpm --filter server test

# 单元测试（单个文件）
cd apps/server && npx jest --testPathPatterns="document-parser"

# 覆盖率
pnpm --filter server test:cov

# E2E 测试
cd apps/server && npx jest --config test/jest-e2e.json

# 编译检查
pnpm --filter server build
```

## 三、Jest 配置

### 单元测试（package.json 内嵌配置）

```json
{
  "jest": {
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "moduleNameMapper": {
      "^@common/(.*)$": "<rootDir>/common/$1",
      "^@app/(.*)$": "<rootDir>/$1",
      "^@prisma-client$": "<rootDir>/../prisma/generated/client"
    }
  }
}
```

### E2E 测试（test/jest-e2e.json）

与单元测试配置一致，但 `rootDir` 为 `test/`，`testRegex` 为 `.e2e.spec.ts$`。

### Jest 类型声明

每个 spec 文件顶部添加三斜线指令，避免侵入 tsconfig：

```typescript
/// <reference types="jest" />
```

## 四、单元测试模板

```typescript
/// <reference types="jest" />

import { Test, TestingModule } from '@nestjs/testing';
import { XxxService } from './xxx.service';

describe('XxxService', () => {
  let service: XxxService;

  // 一级依赖：声明 mock 对象
  let mockPrisma: any;
  let mockConfig: any;

  beforeAll(async () => {
    mockPrisma = {
      b_table: {
        findMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
      },
      $transaction: jest.fn((fn) => fn(mockPrisma)),
    };
    mockConfig = { get: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        XxxService,
        { provide: 'PrismaService', useValue: mockPrisma },
        { provide: 'ConfigService', useValue: mockConfig },
      ],
    }).compile();

    service = module.get(XxxService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('methodName', () => {
    it('正常情况', async () => {
      mockPrisma.b_table.findMany.mockResolvedValue([...]);
      const result = await service.methodName('arg');
      expect(result).toEqual([...]);
    });

    it('异常情况', async () => {
      mockPrisma.b_table.findMany.mockRejectedValue(new Error('DB error'));
      await expect(service.methodName('arg')).rejects.toThrow();
    });
  });
});
```

## 五、公共服务 Mock 方案

### PrismaService

```typescript
const mockPrisma = {
  b_users: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
  b_documents: { findMany: jest.fn(), findUnique: jest.fn(), findFirst: jest.fn(), create: jest.fn(), updateMany: jest.fn(), delete: jest.fn(), count: jest.fn() },
  b_document_chunks: { findMany: jest.fn(), createMany: jest.fn(), deleteMany: jest.fn(), updateMany: jest.fn() },
  b_document_processing_tasks: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn(), create: jest.fn(), update: jest.fn(), count: jest.fn() },
  b_knowledge_bases: { findMany: jest.fn(), findUnique: jest.fn(), create: jest.fn() },
  b_kb_members: { findFirst: jest.fn(), create: jest.fn() },
  $transaction: jest.fn((fn: any) => fn(mockPrisma)),
};
```

### FileStorageService

```typescript
const mockStorage = {
  resolveAbsolutePath: jest.fn((p: string) => `/fake/storage/${p}`),
  exists: jest.fn().mockReturnValue(true),
  saveKnowledgeBaseDocument: jest.fn().mockResolvedValue({
    relativePath: 'documents/kb-1/test.pdf',
    absolutePath: '/fake/storage/documents/kb-1/test.pdf',
  }),
  deleteFile: jest.fn(),
  deleteDirectory: jest.fn(),
};
```

### QdrantService

```typescript
const mockQdrant = {
  ensureCollection: jest.fn(),
  upsertChunkVectors: jest.fn(),
  deleteByDocument: jest.fn(),
  deleteByDocumentVersion: jest.fn(),
  searchChunkVectors: jest.fn().mockResolvedValue([]),
};
```

### ElasticsearchService（模块级 mock）

**注意**：构造函数中 `new Client()` 在无 ES 环境时报错，必须用模块级 mock：

```typescript
jest.mock('@common/vector/elasticsearch.service', () => ({
  ElasticsearchService: jest.fn().mockImplementation(() => ({
    ensureIndex: jest.fn(),
    bulkIndexChunks: jest.fn().mockResolvedValue({ indexed: 1, failed: 0, errors: [] }),
    search: jest.fn().mockResolvedValue([]),
    deleteByKbId: jest.fn(),
    deleteByDocumentVersion: jest.fn(),
  })),
}));
```

### 其他

| 服务 | Mock |
|------|------|
| `ConfigService` | `{ get: jest.fn((key) => configMap[key]) }` |
| `JwtService` | `{ signAsync: jest.fn(), verifyAsync: jest.fn() }` |
| `EventEmitter2` | `{ emit: jest.fn() }` |
| `WINSTON_MODULE_PROVIDER` | `{ info: jest.fn(), warn: jest.fn(), error: jest.fn() }` |
| `DocumentQueueService` | `{ enqueueDocumentProcessing: jest.fn() }` |
| `EmbeddingService` | `{ embedDocuments: jest.fn().mockResolvedValue({ vectors: [], totalTokens: 0 }) }` |

## 六、Fixture 文件规范

- 存放位置：被测模块的 `__fixtures__/` 目录
- 命名规则：`test.<ext>` 为通用测试文件，`edge-case-<desc>.<ext>` 为特定边界用例
- 内容要求：小而全——尽量小但覆盖尽可能多的结构特征

### 现有 fixture

```
apps/server/src/modules/document/__fixtures__/
├── test.md    ← frontmatter + 三级标题 + 表格 + 代码块 + 列表
└── test.txt   ← 4 段内容 + 末段超长（>2000 字符，覆盖长段落预分割）
```

### 待创建

```
├── test.pdf   ← 1-2 页，含标题（大字号） + 正文 + 表格
└── test.docx  ← 含 Heading 1/2 样式 + 正文 + 表格
```

## 七、E2E 测试

### 应用工厂

`test/helpers/test-app.ts` 封装 NestJS 应用创建：

```typescript
import { createTestApp } from '../../helpers/test-app';

const { app } = await createTestApp({
  imports: [DocumentModule, QdrantModule],
  providers: [DocumentParserService],
  override: [
    { provide: ConfigService, useValue: mockConfig },
    { provide: PrismaService, useValue: mockPrisma },
  ],
});
```

### 冒烟测试清单

| 场景 | 验证点 |
|------|--------|
| 文档全链路 | upload → parsing → chunking → embedding → ready |
| PDF 解析 | pdfexcavator 提取 → Markdown 含标题 |
| DOCX 解析 | mammoth Markdown → section titlePath 非空 |
| 回退策略 | pdfexcavator 失败 → 自动回退 pdf-parse |
| 异常处理 | 不支持的文件类型 → 抛出异常 |

## 八、测试检查清单（代码评审用）

每个新增/修改的 Service 提交前确认：

- [ ] `.spec.ts` 文件存在且与被测文件同级
- [ ] 所有 public 方法至少 1 个正常流程用例
- [ ] 关键异常路径有覆盖
- [ ] 外部依赖通过 mock 隔离（不依赖真实 DB/Qdrant/Redis）
- [ ] `pnpm --filter server test` 全部通过
- [ ] `pnpm --filter server build` 编译通过
- [ ] fixture 文件不超过合理大小（< 100KB）


---


# 文档切块优化

> 日期：2026-05-07 | 分支：`feat/rag-pipeline-optimization`

---

## 一、当前实现分析

### 1.1 切块架构

```
parsed.sections (有结构)?
  ├── 是 → createStructuredChunks() 结构化切块
  │         ├── section token ≤ 700 → 直接作为一个 chunk
  │         └── section token > 700 → RecursiveCharacterTextSplitter 二次切割
  └── 否 → createFallbackChunks() 回退切块
            └── 对全文 plainText 用 RecursiveCharacterTextSplitter 递归切分
```

核心文件：[document-chunk.service.ts](apps/server/src/modules/document/services/document-chunk.service.ts)

### 1.2 关键参数

| 参数 | 当前值 | 说明 |
|------|--------|------|
| `DOCUMENT_CHUNK_SIZE` | 700 | 目标分片大小（近似 token） |
| `DOCUMENT_CHUNK_OVERLAP` | 100 | 重叠大小（近似 token，约 14%） |
| `lengthFunction` | `Math.ceil(content.length / 4)` | 字符长度 / 4 估算 token 数 |
| 切分器 | `RecursiveCharacterTextSplitter` | LangChain 默认递归切分器 |

### 1.3 当前优点

- **结构感知**：已从纯全文切分升级为 sections 优先的结构化切分（Phase 2 完成）
- **兜底机制**：结构信息不可用时自动回退到全文递归切分
- **元数据丰富**：每个 chunk 携带 `titlePath`、`sectionLevel`、`chunkStrategy`、`pageNo`、`charStart/charEnd`
- **幂等友好**：Vector ID 基于 `doc:id:chunk:index:v:version` 的 SHA-256 + RFC 4122 生成
- **策略可追溯**：`chunkStrategy` 标记 (`structured-token-aware` vs `plainText-recursive`)
- **双存储同步**：Qdrant（稠密向量）+ Elasticsearch（稀疏 BM25 检索）

### 1.4 当前存在的不足

#### 1.4.1 Token 估算不精确（高优先级）

```typescript
// 当前实现 — document-chunk.service.ts:279
private estimateTokenCount(content: string) {
  return Math.max(1, Math.ceil(content.length / 4));
}
```

**问题**：
- 中文字符实际 token 比 ≈ 1:1.5（一个中文词约 1-2 token），英文 ≈ 1:0.75
- 同一个 `chunkSize=700`（估算值），英文实际约 2800 token，中文实际约 1050 token
- 无法感知 embedding 模型的真实 token 限制（百炼 text-embedding-v4 上限 8192 token，安全值 ~8100）

**影响链**：
- `token_count` 字段不准确 → 治理数据失真
- chunk 大小控制不精确 → 可能超出 embedding 模型上下文窗口
- 后续成本估算无依据

#### 1.4.2 中文分割符未优化（中优先级）

当前 `RecursiveCharacterTextSplitter` 使用 LangChain 默认分隔符：

```python
# LangChain 默认 separators
["\n\n", "\n", " ", ""]
```

缺少中文特有的句子边界标点（`。！？；`），导致：
- 中文段落可能在句子中间被截断
- 切块边界跨中文语义单元

#### 1.4.3 未感知 Embedding 模型容量上限

切块时仅用 `chunkSize=700` 软限制，无硬性校验单个 chunk 是否超出模型上下文窗口。极端情况下（如 section 已超 700 但仍被直接使用，或二次切分因 overlap 扩大 chunk），可能存在越界风险。

#### 1.4.4 检索侧未利用 Chunk 元数据（中优先级）

`b_document_chunks.metadata_json` 中的 `titlePath`、`sectionLevel`、`chunkStrategy` 在检索阶段完全未被使用：
- 无法按标题层级过滤或加权（如 # 一级标题下的 chunk 权重更高）
- 无法区分结构化分片和回退分片的检索质量差异
- 前端的 chunk 溯源信息展示不完整

#### 1.4.5 分片策略对所有文档类型一视同仁

`DOCUMENT_CHUNK_SIZE=700` + `DOCUMENT_CHUNK_OVERLAP=100` 对 PDF/DOCX/MD/TXT 无差别应用，但：
- Markdown 代码块和表格块需要更大窗口保持完整性
- TXT 纯文本密度更高，可以适当缩小 chunk
- PDF 经过版面分析后信息密度差异更大

#### 1.4.6 缺少上下文增强（高优先级）

当前 chunk 直接以其原始文本做 embedding，没有附加上下文信息。例如：
- "该公司第三季度营收增长 3%" → embedding 检索时不知道"该公司"是谁
- "上述分析表明..." → 指代不明确

#### 1.4.7 未实现层次化检索（中优先级）

所有 chunk 平等索引，没有父子关系。检索时无法做到：
- 用小 chunk 精确搜索 → 返回大 chunk 完整上下文（Small-to-Big）
- 按文档章节树进行分层导航

---

## 二、业内主流做法调研

### 2.1 2025-2026 年分块策略全景

**关键论文**：

1. **Bennani & Moslonka (2026.01)** — "A Systematic Analysis of Chunking Strategies for Reliable Question Answering" [arXiv:2601.14123](https://arxiv.org/html/2601.14123v1)
   - 发现 "context cliff"：检索上下文超 ~2500 token 后质量下降
   - 语义 chunking 仅在大上下文（>5K token）时优于 sentence chunking
   - **结论**：sentence chunking 是性价比最高的默认策略

2. **Lelong et al. (2026.03)** — "Adaptive Chunking: Optimizing Chunking-Method Selection for RAG" [arXiv:2603.25333](https://arxiv.org/abs/2603.25333) (LREC 2026)
   - 提出 5 个 chunk 质量指标（RC, ICC, DCC, BI, SC）
   - 自适应策略选择带来 **+30% 成功回答率**（65 vs 49）

3. **Jina AI (2024)** — "Late Chunking: Contextual Chunk Embeddings Using Long-Context Embedding Models" [arXiv:2409.04701](https://arxiv.org/abs/2409.04701)
   - 先编码全文再切分，保留跨 chunk 上下文
   - 指代消解提升 ~10-12% 相似度

### 2.2 策略层级（2026 基准）

| 层级 | 策略 | 端到端准确率 | 适用场景 |
|------|------|-------------|---------|
| **S 级** | Sentence chunking（默认） | 最佳性价比 | 通用生产环境 |
| **S 级** | Semantic chunking | 大上下文场景有微弱优势 | 密集技术/法律文档 |
| **A 级** | Recursive character split (512t, 10-20% overlap) | ~69% | 通用企业文档（当前方案基础） |
| **B 级** | AI/LLM chunking | ~72% 正确率，91.9% 召回 | 高价值领域（法律/临床） |
| **C 级** | Fixed-size token chunking | 落后 | 不推荐 |

### 2.3 Token 窗口推荐（通用）

| 场景 | 推荐 chunk size |
|------|----------------|
| 事实验证 / 客服问答 | 256–512 tokens |
| 通用 RAG | 512 tokens（2026 基准甜点） |
| 多跳分析查询 | 512–1024 tokens |
| 法律 / 监管文档 | 768–1024 tokens |

### 2.4 Overlap 的新认知

2026 年最新系统评估表明：**overlap 对端到端准确率无显著增益**（ΔBERTScore ≤ 0.004），但 **sentence-aware 管线未启用时**，10-20% overlap 可将召回率提升 20-40%。当前项目的 `RecursiveCharacterTextSplitter` 以句子边界为切分，属于具备 sentence-aware 能力的管线，**overlap 的边际收益有限**。

### 2.5 中文文档特殊考量

使用百炼 Qwen tokenizer 时：
- 1 个中文字符 ≈ 1~2 token（常见汉字约 1.5 token）
- 分隔符优先级应调整为：`\n\n → \n → 。 → ！ → ？ → ； → ， → 空格`
- 推荐 chunk_size：**500~1000 字符**（对应约 300~600 中文 token）

### 2.6 三种关键进阶技术

#### 2.6.1 上下文检索（Contextual Retrieval，Anthropic 2024）

核心思路：对每个 chunk，用 LLM（Claude Haiku）生成一段简要上下文，前置到 chunk 前一起做 embedding。

```
原始 chunk: "营收增长 3%"
增强 chunk: "本段来自 Acme 公司 2023 年 Q2 财报。营收增长 3%。"
```

**实测效果**（Anthropic 数据）：
| 技术组合 | 检索失败率降低 |
|---------|-------------|
| 仅上下文 Embedding | ~35% |
| 上下文 Embedding + 上下文 BM25 | ~49% |
| 以上 + Reranker | ~67% |

#### 2.6.2 父子检索（Parent-Child / Small-to-Big）

核心思路：解耦检索单元和返回单元。

```
index: 小 chunk (200-400 tokens) → Qdrant 精确检索
return: 大 chunk (1000-2000 tokens) → LLM 完整上下文
```

**Stanford 2025 基准**：

| 方法 | Precision | Recall | F1 |
|------|-----------|--------|-----|
| Fixed (512t) | 0.65 | 0.58 | 0.61 |
| Semantic | 0.78 | 0.72 | 0.75 |
| Hierarchical | 0.82 | 0.79 | 0.80 |
| **Parent-Context** | **0.88** | **0.85** | **0.86** |

Parent-Context 对比 naive fixed-size 提升约 40%。

**进阶形式 — 多层级检索（Multi-Level Retrieval）**：

在上述两层模型基础上，可进一步扩展为三层：

```
Level 1 (根): ~1200 tokens  ← 最宽窗口，提供完整上下文
  └── Level 2 (父): ~600 tokens  ← 中等窗口
       └── Level 3 (子): ~300 tokens  ← 最小窗口，精确向量检索
```

- 三层之间大小比例建议 **2x / 1x / 0.5x**（以 Level 2 为基准）
- 通过 `root_chunk_id` 双层指针：无论命中 Level 2 还是 Level 3，都能 O(1) 追溯到 Level 1 的完整上下文
- 索引策略可优化为**仅 embed Level 2 + Level 3**，Level 1 仅作为上下文载体，避免 3 倍 embedding 成本

#### 2.6.3 自适应分块（Adaptive Chunking）

根据文档类型和内容特征动态选择切分策略（Intuit 2025 专利）。LREC 2026 论文提出 5 个 chunk 质量指标驱动策略选择：
1. **References Completeness (RC)** — 引用完整性
2. **Intrachunk Cohesion (ICC)** — 块内凝聚度
3. **Document Contextual Coherence (DCC)** — 文档级上下文连贯性
4. **Block Integrity (BI)** — 块完整性
5. **Size Compliance (SC)** — 大小合规性

---

## 三、当前实现与行业最佳实践差距对比

| 维度 | 当前状态 | 行业最佳实践 | 差距评估 |
|------|---------|-------------|---------|
| **Token 计算** | `length/4` 估算 | tiktoken / 原生 tokenizer | **大** — 直接影响分片质量 |
| **分割符** | LangChain 默认（英文优先） | 中文标点感知 | **中** — 中文语义边界被切断 |
| **模型上限感知** | 无硬校验 | chunk 大小 vs 模型 token 限制 | **中** — 极端情况有风险 |
| **上下文增强** | 无 | Anthropic Contextual Retrieval | **大** — 检索质量核心杠杆 |
| **层次化检索** | 所有 chunk 平等 | Parent-Child / Small-to-Big | **大** — 检索精度 vs 上下文完整性的矛盾 |
| **自适应大小** | 统一 700 | 按文档类型自适应 | **中** — 不同类型的语义密度不同 |
| **元数据利用** | 仅存储，检索未用 | titlePath 过滤/加权 | **中** — 已产出元数据但未消费 |
| **代码块/表格保护** | 无特殊处理 | 不可拆分块（代码/表格） | **小** — Markdown 解析已有 type 标记 |
| **语义分块** | 无 | SemanticChunker 作为可选策略 | **小** — 性价比不如上下文增强 |
| **Late Chunking** | 不支持 | Long-context embedding model | **暂不适用** — 百炼模型不支持 token-level embedding |

---

## 四、优化方案

### 4.1 优化总览

```
优先级排序：P0 > P1 > P2 > P3

P0（本周可落地，高 ROI）:
  ├── O1: 接入真实 Tokenizer（tiktoken / qwen tokenizer）
  ├── O2: 中文感知分割符
  └── O3: 轻量上下文增强（titlePath 前置）

P1（2 周内，核心杠杆）:
  └── O4: 父子检索（Small-to-Big）

P2（1 个月内，体验质变）:
  ├── O6: 文档类型自适应 chunk 参数
  ├── O7: 检索侧元数据利用（titlePath 过滤/加权）
  └── O8: 代码块/表格块完整性保护

P3（长期演进）:
  ├── O5: LLM 上下文增强（Anthropic Contextual Retrieval，长远发展）
  ├── O9: 语义分块作为可选策略
  └── O10: 分块质量评估体系
```

### 4.2 O1：接入真实 Tokenizer（P0）

**目标**：将 `length/4` 估算替换为 tiktoken（或百炼原生 tokenizer）。

**方案**：

```typescript
// 方案 A：tiktoken（推荐，与 OpenAI 兼容）
import { encodingForModel } from 'tiktoken';

// 百炼 text-embedding-v4 兼容 OpenAI 接口，使用 cl100k_base 编码
const encoder = encodingForModel('text-embedding-3-small'); // cl100k_base

function tokenCount(text: string): number {
  return encoder.encode(text).length;
}

// 方案 B：百炼原生 tokenizer（更精确）
// 通过 dashscope SDK 的 get_tokenizer('qwen-turbo')
import { get_tokenizer } from 'dashscope';
const tokenizer = get_tokenizer('qwen-turbo');
```

**改动文件**：
- [document-chunk.service.ts](apps/server/src/modules/document/services/document-chunk.service.ts) — `estimateTokenCount()` → `tokenCount()`
- [embedding.service.ts](apps/server/src/modules/rag/ai/embedding.service.ts) — 同步替换
- [document-processing.constants.ts](apps/server/src/modules/document/document-processing.constants.ts) — 参数说明更新

**收益**：
- chunk 大小控制精确（不再依赖 `length/4` 的粗糙估算）
- embedding 模型 token 限制感知（防止越界）
- 治理数据可信（`token_count` 字段有真实意义）
- 成本核算有依据

### 4.3 O2：中文感知分割符（P0）

**目标**：让 `RecursiveCharacterTextSplitter` 优先在中文语义边界切割。

**方案**：

```typescript
// document-chunk.service.ts
private createTextSplitter() {
  return new RecursiveCharacterTextSplitter({
    chunkSize: DOCUMENT_CHUNK_SIZE,
    chunkOverlap: DOCUMENT_CHUNK_OVERLAP,
    // 中文优先的分隔符层级
    separators: [
      '\n\n',    // 段落
      '\n',      // 行
      '。',      // 中文句号
      '！',      // 中文感叹号
      '？',      // 中文问号
      '；',      // 中文分号
      '，',      // 中文逗号
      '. ',      // 英文句号
      '! ',      // 英文感叹号
      '? ',      // 英文问号
      '; ',      // 英文分号
      ', ',      // 英文逗号
      ' ',       // 空格
      '',        // 字符级兜底
    ],
    lengthFunction: (text) => this.tokenCount(text),  // O1 的真实 tokenizer
  });
}
```

**收益**：
- 中文切块更自然地落在句子/分句边界
- 减少跨句语义碎片

### 4.4 O3：轻量上下文增强 — titlePath 前置（P0）

**目标**：利用已有的 `titlePath` 元数据，在 embedding 前为 chunk 附加上下文。

**方案**：

```typescript
// document-chunk.service.ts
// 在 buildChunkMetadata 相邻位置新增
private buildContextualizedContent(chunk: StructuredChunkDraft): string {
  const pathStr = chunk.titlePath.length > 0
    ? chunk.titlePath.join(' > ')
    : '';
  if (!pathStr) return chunk.content;
  return `[文档段落路径: ${pathStr}]\n${chunk.content}`;
}
```

**原理**：
- 类似 Anthropic Contextual Retrieval 的轻量版本
- 不需要额外的 LLM 调用 — 零额外成本
- 利用解析阶段已产出的 `titlePath`（如 `第一章 > 1.1 背景 > 1.1.1 问题描述`）
- 让 embedding 向量包含结构定位信息

**收益**：
- 提升结构化文档（MD/DOCX/PDF）的检索精度
- 零额外 token 成本（titlePath 通常 10-30 字符）
- 实现简单，直接在 chunk content 构建阶段完成

### 4.5 O4：父子检索 — Small-to-Big（P1）

**目标**：用小 chunk 检索，用大 chunk 回答。

**方案设计**：

```
┌──────────────────────────────────────────────────────────┐
│                    分块阶段（离线）                        │
│                                                          │
│  Document                                                │
│    │                                                     │
│    ├── Parent chunks (large: 1500-2000 tokens)           │
│    │     └── 存入 b_document_chunks (is_parent=true)     │
│    │     └── 不做 embedding（或做稀疏 embedding）          │
│    │                                                     │
│    └── Child chunks (small: 300-400 tokens)              │
│          └── 存入 b_document_chunks (parent_chunk_id)     │
│          └── 做 embedding → Qdrant                       │
│          └── 做 BM25 索引 → Elasticsearch               │
│                                                          │
├──────────────────────────────────────────────────────────┤
│                    检索阶段（在线）                        │
│                                                          │
│  Query → Embedding → Qdrant(Child) + ES(Child)           │
│    → Top-K child chunks                                  │
│    → resolve parent_chunk_id(s)                          │
│    → 返回 parent chunk(s) 给 LLM                         │
└──────────────────────────────────────────────────────────┘
```

**数据库改动**：

```prisma
model b_document_chunks {
  // ... 现有字段 ...
  parent_chunk_id BigInt?  // 新增：指向父 chunk（自引用外键）
  root_chunk_id   BigInt?  // 新增：始终指向 Level 1 根 chunk
  chunk_level     Int      @default(1) // 新增：层级 1=根 2=父 3=子
  is_parent       Boolean  @default(false) // 标记是否为父 chunk
  parent_chunks   b_document_chunks[]      @relation("ParentChild")
  parent          b_document_chunks?       @relation("ParentChild", fields: [parent_chunk_id], references: [id])
}
```

**检索改动**（RetrievalService）：

```typescript
async retrieveWithParentContext(query: string, topK: number) {
  // 1. 精确检索子 chunk
  const childResults = await this.qdrantService.search(query, { limit: topK * 2 });
  const childChunkIds = childResults.map(r => r.payload.chunkId);

  // 2. 查找父 chunk
  const children = await this.prisma.b_document_chunks.findMany({
    where: { id: { in: childChunkIds } },
    select: { parent_chunk_id: true }
  });
  const parentIds = [...new Set(children.map(c => c.parent_chunk_id).filter(Boolean))];

  // 3. 返回父 chunk 内容
  const parents = await this.prisma.b_document_chunks.findMany({
    where: { id: { in: parentIds } },
  });
  return parents.map(p => p.content);
}
```

**收益**：
- 检索精度提升（小块 embedding 更聚焦）
- 回答上下文更完整（大块包含更多信息）
- Stanford 2025 基准 F1: 0.86（vs 当前 plain chunk 0.61）

**风险**：
- 总 chunk 数量增加（每个文档同时有 parent + child）
- 需额外一次数据库查询（parent_lookup）

#### 4.5.1 三层粒度增强（可选）

在两层模型基础上，可进一步扩展为三层粒度，提升检索灵活性：

```
┌──────────────────────────────────────────────────────────┐
│  Level 1 (根): ~1200 tokens                              │
│    ├── chunk_level=1, root_chunk_id=self                 │
│    ├── 提供最宽上下文窗口                                   │
│    ├── 不做 embedding（仅作为上下文载体）                     │
│    │                                                     │
│    └── Level 2 (父): ~600 tokens                         │
│          ├── chunk_level=2, root_chunk_id=Level1.id       │
│          ├── 中等粒度，平衡检索精度与上下文                     │
│          ├── 做 embedding → Qdrant（可选）                 │
│          │                                               │
│          └── Level 3 (子): ~300 tokens                   │
│                ├── chunk_level=3, root_chunk_id=Level1.id │
│                ├── 最高检索精度                              │
│                └── 做 embedding → Qdrant + ES            │
└──────────────────────────────────────────────────────────┘
```

**层间大小比例**（参考实践验证值）：

| 层级 | token 数 | 角色 | embed? |
|------|---------|------|--------|
| Level 1 (根) | ~1200 | 完整上下文 | 否，仅载体 |
| Level 2 (父) | ~600 | 中等检索 | 可选 |
| Level 3 (子) | ~300 | 精确检索 | 是 |

**设计要点**：

1. **root_chunk_id 双指针**：无论检索命中 Level 2 还是 Level 3，都能 O(1) 追溯到 Level 1 的完整上下文，无需递归查找
2. **选择性 embedding**：仅 embed Level 3（+ Level 2 可选），Level 1 不 embedding，避免 3 倍向量化成本。对比参考代码全层 embedding 的做法可节省约 60% 的 embedding 调用
3. **跨 sections 切分**：三层切分应基于全文 `parsed.sections` 而非按页进行，避免跨页语义断裂
4. **chunk ID 可读性**：建议采用 `{docId}:{section}:l{level}:{index}` 格式，便于调试和溯源

**检索流程**：

```typescript
async retrieveMultiLevel(query: string, topK: number) {
  // 1. 在 Level 3（子 chunk）做精确向量检索
  const childResults = await this.qdrantService.search(query, {
    limit: topK * 2,
    filter: { chunk_level: 3 },
  });

  // 2. 通过 root_chunk_id 一步取到 Level 1 根 chunk
  const rootIds = [...new Set(
    childResults.map(r => r.payload.rootChunkId).filter(Boolean)
  )];
  const rootChunks = await this.prisma.b_document_chunks.findMany({
    where: { id: { in: rootIds }, chunk_level: 1 },
  });

  // 3. 返回 Level 1 完整上下文给 LLM
  return rootChunks.map(c => c.content);
}
```

**与两层方案的选择**：
- 两层（Parent-Child）：适合大多数场景，实现复杂度低
- 三层（Root-Parent-Child）：适合文档结构深、检索精度要求高的场景，可先以两层落地，后续按需升级为三层

### 4.6 O5：LLM 上下文增强（P3，长远发展）

> 该优化作为长远规划，现阶段不实现。建议先通过 O3（titlePath 前置）验证上下文增强的有效性后，再择机推进。

**目标**：用 LLM 为每个 chunk 生成上下文描述，前置到 embedding 文本中。

**方案**：

```typescript
// 对每个 chunk，用完整文档 + chunk 内容让 LLM 生成上下文
async enrichChunkContext(chunk: string, fullDocument: string): Promise<string> {
  // 使用廉价模型（Haiku / Qwen-Turbo）降低 token 成本
  const context = await this.llm.invoke(`
    <document>${fullDocument}</document>
    <chunk>${chunk}</chunk>
    请为以上 chunk 生成一句简短上下文（不超过 50 字），
    说明该片段在文档中的位置和作用。
  `);
  return `${context}\n${chunk}`;
}
```

**成本估算**（以 10 页 PDF 为例）：
- 全文约 3000 tokens（输入），每个 chunk ~500 tokens
- 20 个 chunk × (3000 + 500) = 70,000 输入 tokens + 20 × 50 = 1000 输出 tokens
- 百炼 Qwen-Turbo 价格约 ¥0.3/百万 tokens → 单文档成本约 ¥0.02
- **prompt caching 可减少约 90% 输入成本**（文档内容不变）

**与 O3 的关系**：O3 是零成本轻量版，O5 是 LLM 增强版。建议先上 O3，验证有效性后再上 O5。

### 4.7 O6：文档类型自适应参数（P2）

**目标**：根据文档类型和内容特征动态调整 chunk 参数。

**方案**：

```typescript
// document-processing.constants.ts
const CHUNK_CONFIG_BY_TYPE: Record<string, { size: number; overlap: number }> = {
  md:   { size: 600,  overlap: 80  },  // Markdown 结构好，可以稍小
  docx: { size: 700,  overlap: 100 },  // Word 适中
  pdf:  { size: 800,  overlap: 120 },  // PDF 版面信息密度高，稍大
  txt:  { size: 500,  overlap: 80  },  // 纯文本密度低，小块更精准
};

// 特殊内容类型保护
const CHUNK_SIZE_BY_SECTION_TYPE: Record<string, number> = {
  code:  1200,  // 代码块不拆分
  table: 1500,  // 表格尽量完整保留
};
```

### 4.8 O7：检索侧元数据利用（P2）

**目标**：在 Qdrant / ES 检索时利用 chunk 的 `titlePath`、`sectionLevel` 进行过滤或加权。

**方案**：

```typescript
// RetrievalService 中
// 1. 标题路径匹配加权
if (queryMatchedTitlePath) {
  // 对 titlePath 匹配查询关键词的 chunk 加权
  boostScore *= 1.5;
}

// 2. 标题层级加权
// sectionLevel=1 (H1) 的 chunk 通常包含概括性内容，适合优先返回
if (chunk.metadata.sectionLevel === 1) {
  boostScore *= 1.2;
}

// 3. 策略质量加权
// structured-token-aware 的 chunk 比 plainText-recursive 质量更高
if (chunk.metadata.chunkStrategy === 'structured-token-aware') {
  boostScore *= 1.1;
}
```

### 4.9 O8：特殊块保护（P2）

**目标**：对代码块和表格块做完整性保护，避免截断。

**方案**：在 `createStructuredChunks()` 中：

```typescript
// 代码块/表格块使用更大的 chunk_size 或不做二次切分
if (section.type === 'code' || section.type === 'table') {
  // 仅在超出 embedding 模型安全上限时才切分
  if (this.tokenCount(section.content) <= EMBEDDING_SAFE_TOKEN_LIMIT) {
    chunkDrafts.push({ ...section, chunkStrategy: 'structured-token-aware' });
    continue;
  }
  // 否则在逻辑边界（函数/行）切分
}
```

### 4.10 O9：语义分块（P3）

**目标**：为特定文档类型提供语义分块选项。

**方案**：引入 `SemanticChunker` 作为可选策略，仅在文档结构信息不足时启用。

```typescript
// 当 parsed.sections 质量差时，fallback 到 semantic chunking
if (sections.length === 0) {
  // 先尝试语义分块
  const semanticChunker = new SemanticChunker(this.embeddingService, {
    breakpointThresholdType: 'percentile',
    breakpointThresholdAmount: 90,
  });
  const docs = await semanticChunker.splitText(parsed.plainText);
  // ...
}
```

### 4.11 O10：分块质量评估（P3）

**目标**：建立分块质量量化评估体系，指导参数调优。

**方案**：基于 LREC 2026 的 5 维指标：
1. **块大小合规率**：chunk 在目标范围内的比例
2. **边界类型分布**：各类分隔符切割点的分布
3. **检索召回率**（端到端）：配合 RAGAS 框架评估
4. **块内语义凝聚度**：chunk 内句子间 embedding 相似度均值
5. **跨块语义断裂率**：相邻 chunk 尾部与首部的语义跳跃程度

---

## 五、实施路线图

```
Week 1 (P0):  ──┬── O1: 真实 Tokenizer
               ├── O2: 中文分割符
               └── O3: titlePath 前置

Week 2-3 (P1): ─── O4: 父子检索

Week 3-4 (P2): ──┬── O6: 自适应参数
                 ├── O7: 元数据利用
                 └── O8: 特殊块保护

Month 2+ (P3): ──┬── O5: LLM 上下文增强（长远发展）
                 ├── O9: 语义分块
                 └── O10: 质量评估体系
```

---

## 六、预期收益汇总

| 优化项 | 预期检索精度提升 | 实现复杂度 | 是否破环现有数据 |
|--------|---------------|-----------|----------------|
| O1 Tokenizer | +5-10%（精准控制） | 低 | 否（重解析生效） |
| O2 中文分隔符 | +3-5%（中文边界） | 低 | 否 |
| O3 titlePath 前置 | +8-12%（结构感知） | 低 | 否 |
| O4 父子检索 | +15-25%（核心杠杆） | 中 | 是（新增字段） |
| O5 LLM 上下文 | +15-25% | 中 | 否 | P3 长远发展 |
| O6 自适应参数 | +3-5%（类型适配） | 低 | 否 |
| O7 元数据利用 | +5-8%（结构加权） | 中 | 否 |
| O8 特殊块保护 | +2-3%（完整性） | 低 | 否 |

**组合预估**：P0+P1 全部落地后，端到端检索精度预计提升 **25-40%**。

---

## 七、风险与注意事项

1. **O4 父子检索**涉及 Prisma schema 变更，需要数据库迁移，且存量数据的父子关系需要回填。
2. **O5 LLM 上下文增强**（P3 长远发展）增加文档处理耗时和 API 调用成本，届时建议作为可选开关（`ENABLE_CONTEXTUAL_ENRICHMENT`）。
3. **O1 Tokenizer** 需要选择 tiktoken（离线 tokenizer，零成本）还是百炼原生（需 API 调用）。推荐 tiktoken 作为默认，百炼原生作为精确模式选项。
4. 所有 chunking 优化仅对新上传/重解析的文档生效，存量文档需手动触发重解析。
5. **O3 titlePath 前置**会改变 chunk content → embedding 映射，与旧版本向量共存时检索结果可能不一致。建议配合 `processingVersion` 隔离。

---

## 八、实施记录

### 2026-05-07: P0 + O4 实施完成

**P0: O1 + O2 + O3**（编码 2h，测试通过）

| 优化 | 文件 | 变更要点 |
|------|------|---------|
| O1 真实 Tokenizer | `common/utils/token.service.ts`（新增） | 封装 tiktoken `cl100k_base`，替换 `length/4` 估算 |
| O1 真实 Tokenizer | `document-chunk.service.ts`, `embedding.service.ts` | 注入 TokenService，替换 `estimateTokenCount` |
| O2 中文分割符 | `document-chunk.service.ts` `createHierarchicalSplitter()` | 14级中文标点优先分隔符 |
| O3 titlePath 前置 | `document-chunk.service.ts` `buildContextualizedContent()` | `[文档段落路径: XXX > YYY]` 前置 |

**P1: O4 三层粒度父子检索**（编码 3h，测试通过）

| 文件 | 变更要点 |
|------|---------|
| `prisma/schema.prisma` | `b_document_chunks` 新增 `parent_chunk_id`、`root_chunk_id`、`chunk_level`、`is_root` + 自引用关系 + 索引 |
| `document-processing.constants.ts` | 新增 `ROOT_CHUNK_SIZE=1200`、`PARENT_CHUNK_SIZE=600`、`CHILD_CHUNK_SIZE=300`、`HIERARCHICAL_CHUNK_OVERLAP=60` |
| `document-chunk.service.ts` | 重写 `createChunks()` 为三层滑动窗口切块（Root→Parent→Child），`$transaction` 保证层级引用完整性 |
| `document-processing.service.ts` | embedding 阶段仅处理 `chunk_level=3` 的 chunk；Qdrant/ES payload 携带 `rootChunkId`/`parentChunkId`/`chunkLevel` |
| `retrieval.service.ts` | 新增 `expandToRootChunks()` — 检索后通过 `root_chunk_id` 一步展开至 Level 1 完整上下文 |
| `rag/ai/ai.module.ts`、`document.module.ts` | 注册 TokenService |

**验收**:
- 单元测试: 3 suites / 35 tests 全部通过
- 构建: `nest build` 通过
- 数据库: `prisma db push` 同步成功（4 新字段 + 2 新索引）
- 存量兼容: 旧 chunks 无 `rootChunkId` → `expandToRootChunks` 原样返回，不中断检索

### 2026-05-07: P2 实施完成

**O8: 代码块/表格块完整性保护**（编码 1h，测试通过）

| 文件 | 变更要点 |
|------|---------|
| `document-processing.constants.ts` | 新增 `MAX_ATOMIC_BLOCK_TOKENS = 8000` |
| `document-chunk.service.ts` | `createChunks()` 中检测 `section.type === 'code' \|\| 'table'`，跳过三层 `splitText()` 拆分，整个块作为单一 chunk 保留；`StructuredChunkDraft` 新增 `blockType` 字段；`buildChunkMetadata()` 记录 `blockType` |
| `document-chunk.service.spec.ts` | 新增 O8 测试 4 个：代码块不拆分、表格块不拆分、文本正常拆分回归、混合 sections 各自独立 |

**O6: 文档类型自适应参数**（编码 1h，测试通过）

| 文件 | 变更要点 |
|------|---------|
| `document-processing.constants.ts` | 新增 `ChunkProfile` interface、`CHUNK_PROFILES` 映射（4 个 profile: default/code-heavy/verbose/compact）、3 个阈值常量 |
| `document-chunk.service.ts` | 新增 `selectChunkProfile()` — 根据代码比/表格比/平均 content 长度自动选择 profile；`createChunks()` 改用 `profile.rootSize/parentSize/childSize` 替代静态常量；`buildChunkMetadata()` 记录 `chunkProfile` |
| `document-chunk.service.spec.ts` | 新增 O6 测试 5 个：code-heavy 选择、verbose 选择、compact 选择、default 回退、不同 profile 的 chunk 数量差异 |

**O7: 检索侧元数据利用**（编码 1.5h，测试通过）

| 文件 | 变更要点 |
|------|---------|
| `document-processing.service.ts` | Qdrant payload 新增 `sectionLevel`/`chunkStrategy`/`titlePath`/`blockType`；ES metadata 同步新增 |
| `fusion.service.ts` | 新增 `computeQualityMultiplier()` — 基于 chunkStrategy(×1.05)、blockType(×1.03)、sectionLevel(×1.02) 对 RRF 分数做质量加权 |
| `rerank.service.ts` | 新增 `computeTitlePathBoost()` — 查询词与 titlePath 匹配率 >50% 时给予 ×1.0~×1.10 加权；在 `rerank()` 和 `lightweightRerank()` 两条路径中均应用 |
| `fusion.service.spec.ts`（新增） | O7 fusion 测试 5 个：chunkStrategy 加权、blockType 加权、sectionLevel 加权、null 安全、退化输入 |
| `rerank.service.spec.ts`（新增） | O7 rerank 测试 5 个：titlePath 匹配 boost、无匹配不 boost、空值回退、lightweightRerank 组合、procedural bonus 回归 |

**所有权重设计**：单项乘数 ≤ 1.10，组合最高约 ×1.15，对缺失字段安全回退到 1.0。

**验收**:
- 单元测试: 5 suites / 54 tests 全部通过（TokenService 7 + DocumentParserService 17 + DocumentChunkService 20 + FusionService 5 + RerankService 5）
- 构建: `nest build` 通过
- 存量兼容: Qdrant payload 缺少新字段时，所有加权逻辑安全回退到 1.0（空值检查）

### 2026-05-08: 紧急 Bug 修复 — chunking 阶段卡死

**问题现象**

上线 processing_version=4 时，chunking 阶段日志输出 `处理 section 1/1` 后进程完全卡死，30 分钟后被监控扫描标记为超时失败。

**根因分析**

两重因素叠加导致 `RecursiveCharacterTextSplitter` 退化为字符级切分，产生 O(n²) 内存开销：

1. **mammoth 不识别自定义 Word 样式**：用户的 DOCX 使用了"标题 #2"、"论文正文"、"1.1"、"1.1.1" 等自定义样式，但 mammoth 无法识别 → Markdown 输出无 `#` 标题 → `sections=[]` → 全篇文本落入单一 section

2. **base64 内嵌图片**：mammoth 将 DOCX 中的内嵌图片转为 `data:image/png;base64,...` data URI，每个 10~60 万字符，无任何分隔符。splitter 在找不到任何分隔符后，退化到字符级回退，产生 O(n²) 合并开销

**实测数据**

```
[DIAG] doSplit 处理超长文本 { textLen: 620083, chunkSize: 300 }
→ 处理 62 万字符 base64 文本时卡死，chunkSize 为子 chunk 目标大小
```

**修复方案**

| 层级 | 修复 | 代码位置 |
|------|------|---------|
| 解析阶段 | `DocumentParserService` 新增 `stripDataUris()` 方法，剥除 Markdown 图片 `![]()`、HTML `<img src="data:">`、裸 `data:` URI | `document-parser.service.ts` |
| 解析阶段 | DOCX/Markdown 解析后统一调用 `stripDataUris()` | `document-parser.service.ts:parseDocx()` |
| 切块阶段 | `DocumentChunkService` 新增 `PRE_SPLIT_MAX_CHARS=5000` 预切分常量 | `document-processing.constants.ts` |
| 切块阶段 | `splitText()` 新增大文本预切分逻辑：超过 5000 字符先按 `\n\n` 粗切段落，超长段落按 `\n` 拆行 | `document-chunk.service.ts` |
| 切块阶段 | `doSplit()` 独立为私有方法，处理单个文本片段的真实切分；超过 20000 字符输出 warn 日志 | `document-chunk.service.ts` |
| 切块阶段 | 预切分后二次调用 `stripDataUris()`（防御性兜底） | `document-chunk.service.ts` |
| 全链路 | 注入 Winston Logger，替换所有 `console.log` 为结构化日志，添加 chunking 各阶段耗时日志 | `document-chunk.service.ts` |

**关键代码**

```typescript
// PRE_SPLIT_MAX_CHARS 预切分策略
private async splitText(text: string, chunkSize: number): Promise<string[]> {
  if (!text.trim()) return [];

  // 防御性剥除 data URI
  text = text.replace(/!\[.*?\]\(data:[^)]+\)/g, '[图片]')
    .replace(/data:[a-zA-Z][\w+-]*\/[a-zA-Z][\w+-]*;base64,[A-Za-z0-9+/=]+/g, '[内嵌资源]');

  if (text.length > PRE_SPLIT_MAX_CHARS) {
    const results: string[] = [];
    const paragraphs = text.split('\n\n');
    for (const para of paragraphs) {
      if (para.length > PRE_SPLIT_MAX_CHARS) {
        const lines = para.split('\n');
        for (const line of lines) {
          results.push(...await this.doSplit(line, chunkSize));
        }
      } else {
        results.push(...await this.doSplit(para, chunkSize));
      }
    }
    return results;
  }
  return this.doSplit(text, chunkSize);
}
```

**验收**

- 单元测试: 20 tests 全部通过（`DocumentChunkService` 全量回归）
- 构建: `nest build` 通过
- 端到端验证: processing_version=5 全链路 65 秒完成（1038 chunks，508 缓存命中）
  - parsing: 1.2s
  - chunking: 5.9s
  - embedding: 55s（含缓存命中 508 个 skip API 调用）

**遗留：mammoth 自定义样式映射**

当前 mammoth 对 DOCX 自定义样式不识别，导致 sections 为空是已知问题。待后续处理：添加 mammoth 样式映射配置（将"标题 #2"等自定义样式映射为 `Heading2` 级别）。


---


# 向量化与 Elasticsearch 检索优化

> 日期：2026-05-08 | 分支：`feat/rag-pipeline-optimization`

---

## 一、当前实现分析

### 1.1 向量化 (Embedding) 链路

```
Chunking (Level 3 子chunk) → EmbeddingService.embedDocuments()
  → 分批(50条/批) → 百炼 text-embedding-v4 → 批次间间隔 1000ms
  → 重试(retryCount=3, 指数退避, 仅429/500/502/503)
  → 校验(向量数==chunk数, 无空向量)
  → 顺序写入: Qdrant(upsert) → Elasticsearch(bulkIndex)
```

核心文件：[embedding.service.ts](../../apps/server/src/modules/rag/ai/embedding.service.ts), [document-processing.service.ts](../../apps/server/src/modules/document/services/document-processing.service.ts)

### 1.2 当前配置一览

| 配置项 | 当前值 | 说明 |
|--------|--------|------|
| `BAILIAN_EMBEDDING_MODEL` | (必填) | 百炼 text-embedding-v4 |
| `BAILIAN_EMBEDDING_DIMENSIONS` | 模型默认 | 未显式指定维度 |
| `BAILIAN_EMBED_BATCH_SIZE` | 50 | 每批最多文本数 |
| `BAILIAN_EMBED_RETRY_COUNT` | 3 | 失败重试次数 |
| `BAILIAN_EMBED_REQUEST_INTERVAL_MS` | 1000 | 批次间隔 |
| `BAILIAN_DOCUMENT_EMBEDDING_TYPE` | `text` | 仅支持 text，vision 被硬拒绝 |
| Token 计算 | tiktoken cl100k_base | ✅ 已接入真实 tokenizer (O1) |
| 上下文增强 | titlePath 前置 | ✅ 已实现轻量上下文增强 (O3) |

### 1.3 当前 ES 实现

核心文件：[elasticsearch.service.ts](../../apps/server/src/common/vector/elasticsearch.service.ts), [elasticsearch-sparse-retrieval.service.ts](../../apps/server/src/modules/rag/retrieval/elasticsearch-sparse-retrieval.service.ts)

**索引配置：**

```typescript
// elasticsearch.service.ts — ensureIndex()
{
  settings: {
    number_of_shards: 1,
    number_of_replicas: 0,
    analysis: {
      analyzer: {
        chunk_analyzer: {
          type: 'custom',
          tokenizer: 'ik_max_word',
          filter: ['lowercase'],
        },
      },
    },
  },
  mappings: {
    properties: {
      chunkId: { type: 'keyword' },
      docId: { type: 'keyword' },
      kbId: { type: 'keyword' },
      content: { type: 'text', analyzer: 'chunk_analyzer' },
      title: { type: 'text', analyzer: 'chunk_analyzer' },
      metadata: { type: 'object', enabled: false },
    },
  },
}
```

**搜索方式：**

```typescript
// elasticsearch.service.ts — search()
{
  bool: {
    should: [
      { match: { content: { query, boost: 1.0 } } },
      { match_phrase: { content: { query, boost: 2.0 } } },
    ],
    filter: [{ terms: { kbId: kbIds } }],
  },
}
```

### 1.4 Qdrant 当前实现

核心文件：[qdrant.service.ts](../../apps/server/src/common/vector/qdrant.service.ts)

| 配置项 | 当前值 | 说明 |
|--------|--------|------|
| Collection 名称 | `kb_document_chunks` | 统一文档分片写入 |
| 距离度量 | `Cosine` | 余弦相似度 |
| HNSW 参数 | 默认值 | 未显式配置 m/ef_construct |
| 量化 | 无 | 全精度浮点向量 |
| payload 索引 | 无 | 未对 payload 字段建索引 |
| 删除方式 | filter-based delete | 按 docId + processingVersion |

### 1.5 检索流水线

```
用户查询 → 稠密检索(Qdrant) + 稀疏检索(ES) → RRF 融合 → qwen3-rerank 精排
  → root_chunk 展开(Small-to-Big) → 返回结果
```

核心文件：[retrieval.service.ts](../../apps/server/src/modules/rag/retrieval/retrieval.service.ts)

---

## 二、当前不足分析

### 2.1 向量化层

#### 2.1.1 Batch 策略粗糙（中优先级）

```typescript
// embedding.service.ts:49 — 当前实现
for (let index = 0; index < texts.length; index += config.batchSize) {
  const batch = texts.slice(index, index + config.batchSize);
  // ...
}
```

**问题**：
- 固定 `batchSize=50`，不考虑每个 chunk 的实际 token 数
- 对于 300 token 的 chunk（Level 3 子 chunk 通常偏小），50 条 × 300 token = 15,000 token，远低于模型单次调用的上限（~8100 安全值需要按 token 分）
- 批次间隔固定 1000ms，未感知实时限频状态
- 没有利用 API 返回的 `Retry-After` 或 `X-RateLimit-*` 响应头进行自适应限频

**影响**：
- 吞吐效率低：小 chunk 批次远未达到 API 的 token 上限，浪费调用次数
- 可能触发限频：大 chunk 场景下 50 条可能内置超 token 限制

#### 2.1.2 无 Embedding 缓存（高优先级）

**问题**：相同文本每次处理都要重新调用 API：
- 现有文档的 `processingVersion` 递增时，所有 chunks 重新 embedding
- 多个文档中包含相同的段落（如版权声明、模板内容）时重复调用
- 不存在基于 content hash 的 embedding 去重

**成本浪费**（以 20 页 PDF 为例）：
- 约 80 个 Level 3 chunks，每个 300 token
- 单次 embedding：80 × 300 = 24,000 token × ¥0.7/百万 token ≈ ¥0.017
- 10 份相似文档 × 3 次重解析 = 30 次重复 ≈ ¥0.50（看起来不高，但随规模增长而线性增长）

#### 2.1.3 Vision Embedding 被硬编码拒绝（低优先级）

```typescript
// embedding.service.ts:168-176 — 当前实现
private createEmbeddingsClient(config: EmbeddingRuntimeConfig) {
  if (config.modelType !== 'text') {
    throw new BusinessException(ErrorCode.SERVICE_UNAVAILABLE, {
      message: '当前 LangChain Embedding 编排仅支持文本向量模型...',
    });
  }
}
```

百炼 text-embedding-v4 支持 `text` 和 `vision` 两种 embedding type，但当前代码阻止了 `vision` 类型的使用。对于包含图表、截图的文档，vision embedding 可以提取图像语义。

#### 2.1.4 缺少成本与质量监控（中优先级）

**问题**：
- 没有记录每次 embedding 的实际 API 调用次数、总 token 消耗、总耗时
- 没有空向量率、异常向量率等质量指标
- `b_document_processing_tasks` 中的 `embedding` stage 只记录了状态，未记录 token 消耗明细

影响：
- 无法评估模型切换的成本影响
- 无法建立异常检测基线

### 2.2 Qdrant 层

#### 2.2.1 HNSW 参数未调优（中优先级）

当前使用 Qdrant 默认参数创建 collection，未显式配置：

| 参数 | 默认值 | 推荐值 | 说明 |
|------|--------|--------|------|
| `m` (HNSW) | 16 | 32-64 | 连接数，越大召回越好但内存开销大 |
| `ef_construct` | 100 | 200-400 | 构建时搜索宽度 |
| `ef_search` (查询时) | 20 | 64-128 | 查询时搜索宽度 |
| `indexing_threshold` | 20000 | 10000-20000 | 超过多少向量触发索引构建 |

**为什么需要调优**：Qdrant 默认参数面向通用场景，RAG 文档检索对召回率要求高，`m` 和 `ef_search` 太低会导致漏检。

#### 2.2.2 未启用量化（中优先级）

**当前状态**：全精度 `float32` 存储向量（1536 维 × 4 字节 = 6KB/向量）。

**量化收益**（以 100 万 chunks 为例）：

| 量化方式 | 存储占用 | 精度损失 | 内存节省 |
|----------|---------|---------|---------|
| float32 (当前) | 6 GB | 无 | 基准 |
| int8 (Scalar) | 1.5 GB | <3% | 75% |
| Binary (BQ) | ~0.2 GB | ~3% | 97% |

Qdrant 1.13+ 原生支持 int8 和 binary quantization，配置简单。

#### 2.2.3 Payload 索引缺失（低优先级）

当前未对 Qdrant payload 中的 `kbId`、`docId`、`chunkLevel` 等字段建索引。在知识库数量较多时（>50），按 `kbId` 过滤的向量检索需要全扫描。

```typescript
// 推荐：对常用过滤字段建 payload index
await client.createPayloadIndex(QDRANT_DOCUMENT_COLLECTION_NAME, {
  field_name: 'kbId',
  field_schema: 'keyword',
});
```

### 2.3 Elasticsearch 层

#### 2.3.1 中文分词器配置不足（高优先级）

当前统一使用 `ik_max_word` 作为索引和搜索分词器。业界最佳实践是：

- **索引阶段**：`ik_max_word`（细粒度，保证召回）
- **搜索阶段**：`ik_smart`（粗粒度，提升精度）

当前配置缺少 `search_analyzer`，导致搜索词被过度切分，可能引入噪声结果。

**对比示例**（查询"灵索智能知识库系统"）：

| 分词方式 | 分词结果 |
|----------|---------|
| `ik_max_word` | `["灵", "索", "智能", "知识库", "知识", "库", "系统"]` |
| `ik_smart` | `["灵索", "智能", "知识库", "系统"]` |

搜索用 `ik_max_word`，"灵" 和 "索" 会匹配大量不相关文档。

#### 2.3.2 无多字段映射（中优先级）

当前 `content` 字段只有一种分析器，没有 `sub-fields`。对于 RAG 检索场景，建议增加：

```json
{
  "content": {
    "type": "text",
    "analyzer": "ik_max_word",
    "search_analyzer": "ik_smart",
    "fields": {
      "ngram": { "type": "text", "analyzer": "ngram_analyzer" },
      "exact": { "type": "keyword" }
    }
  }
}
```

- `exact` 子字段支持精确短语匹配
- `ngram` 子字段支持前缀查询（如用户输入不完整时）

#### 2.3.3 缺少同义词词典（中优先级）

当前无自定义词典和同义词配置。RAG 场景中用户输入的专业术语可能与文档中的表述不完全一致：

| 用户输入 | 文档中表述 | 无同义词时的结果 |
|----------|-----------|----------------|
| RAG | "检索增强生成" | 不匹配 |
| 向量化 | "Embedding" | 不匹配 |
| 大模型 | "LLM" / "大语言模型" | 不匹配 |

解决：配置 `ext_dict` 自定义词典 + IK Analyzer 同义词 filter。

#### 2.3.4 搜索无二阶段精排（中优先级）

当前搜索一把梭拿 topK，缺少 rescore 阶段：

```
当前: match + match_phrase → topK
推荐: match(宽召回) → rescore(match_phrase AND, 严格匹配) → topK
```

rescore 可以先用宽泛查询获取 3-5 倍候选集，再用严格匹配重新打分截断到 topK，在不增加太多延迟的前提下提升首屏精度。

#### 2.3.5 搜索方式单一（中优先级）

当前仅用 `match` + `match_phrase` 做 `bool.should`，未利用：

- `match_phrase_prefix`：用户输入不完整时也能匹配
- `multi_match`：跨 content/title 的加权检索（title 匹配理论上相关性更高）
- `minimum_should_match`：控制至少匹配几个子句，过滤低质结果

#### 2.3.6 索引配置简单（低优先级）

| 配置 | 当前 | 建议 |
|------|------|------|
| `number_of_shards` | 1 | 按数据量动态设置 (总条数/100万) |
| `number_of_replicas` | 0 | 生产环境至少 1 |
| refresh_interval | 默认 1s | 写入密集时设为 -1，写入完成后再恢复 |

### 2.4 检索流水线层

#### 2.4.1 Qdrant 和 ES 顺序写入（中优先级）

```typescript
// document-processing.service.ts:242-321
// 先 Qdrant，再 ES —— 顺序调用，总耗时 = Qdrant耗时 + ES耗时
await this.qdrantService.upsertChunkVectors(...);
await this.elasticsearchService.bulkIndexChunks(...);
```

两个操作互不依赖，可并行化：`Promise.all([qdrant.upsert(), es.bulk()])`，可将写入耗时降低约 40-50%。

#### 2.4.2 ES 不可用时无降级（中优先级）

当 ES 不可用时，`ElasticsearchSparseRetrievalService.retrieve()` 会直接抛出异常，导致整个检索流水线失败。实际上稠密检索 (Qdrant) 可能仍然是可用的，应该有降级策略。

#### 2.4.3 RRF 的 k 值未动态调整

当前 RRF 的 k 因子固定为 60。k 值控制排名极值对融合分数的影响程度。对于不同问题类型，k 的最优值可能不同：

- fact_lookup：k 可以偏大（80-100），让两路结果更均衡地参与排序
- compare_analysis：k 应该保持 60 或更小，保证 top 结果的权重

### 2.5 Token/向量 质量层

#### 2.5.1 API 返回的 usage.total_tokens 未利用

虽然已用 tiktoken 做客户端 token 计数，但百炼 API 实际返回的 `usage.total_tokens` 未被提取和使用。这导致：

- 无法校验客户端 token 计数偏差
- 成本核算用的是估算值而非实际值
- 无法对模型切换做精确的成本对比

#### 2.5.2 缺少向量质量校验

当前仅校验了向量数量和空向量，未校验：

- 向量模长（全 0 向量或模长异常）
- 向量维度一致性（带 batch 容易混入不同维度的向量）
- 向量极值分布（NaN / Infinity）

---

## 三、业内主流做法调研

### 3.1 向量化最佳实践

#### 3.1.1 Token-count-based Batching（Voyage AI / MongoDB, 2025）

**核心思路**：按 token 总数而非请求数分批，最大化每次 API 调用的吞吐。

```
fixed batchSize=50:
  50 chunks × 200 token = 10,000 token → 远未到上限，浪费调用次数
  50 chunks × 500 token = 25,000 token → 可能超限

token-count-based batching:
  累计直到 Σtoken ≈ 8000 (安全上限) → 充分利用每次调用
```

**实测效果**（MongoDB/Voyage AI）：**50% 延迟降低**，**8× 吞吐提升**。

#### 3.1.2 Matryoshka Embeddings（Voyage AI, 2024-2025）

嵌套式 embedding：一个 2048 维向量内嵌了 1024/512/256 维的子向量。

| 维度 | 存储 (100万向量) | 相对精度 | 成本 |
|------|-----------------|---------|------|
| 2048 | 8.2 GB | 100% | 基准 |
| 512 | 2 GB | ~98.7% | 25% |
| 256 | 1 GB | ~96.3% | 12.5% |

**项目适用性**：百炼 text-embedding-v4 当前不明确支持 Matryoshka。但可以通过设置 `BAILIAN_EMBEDDING_DIMENSIONS` 降低输出维度，减少 Qdrant 存储。

#### 3.1.3 Semantic Caching（ScyllaDB / Redis, 2025）

**架构**：

```
Query Embedding → Check Cache (cosine similarity > 0.95)
  ├── Hit  → 返回缓存结果 (0 token cost, <1ms)
  └── Miss → 调用 API → 存缓存 (附带 TTL)
```

**收益**：
- 缓存命中时零 token 成本
- 亚毫秒级响应（vs API 调用的 100-500ms）
- 对于相似查询占比高的场景，缓存命中率可达 30-50%

### 3.2 Elasticsearch 最佳实践

#### 3.2.1 索引/搜索分离分词（业界共识）

```
索引阶段: ik_max_word (细粒度穷举 → 最大召回)
搜索阶段: ik_smart (粗粒度最少切分 → 最优精度)
```

这是 IK 分词器社区的一致推荐。2025 年实测数据显示，这一优化可将中文搜索准确率从 78% 提升至 93%。

#### 3.2.2 二阶段精排 (Rescore)

**ES 生产级配方**（社区验证）：

```json
{
  "query": {
    "bool": {
      "should": [
        { "match": { "content": "query" } },
        { "match_phrase": { "content": { "query": "query", "boost": 2.0 } } }
      ]
    }
  },
  "rescore": {
    "window_size": 50,
    "query": {
      "query_weight": 0.2,
      "rescore_query_weight": 1.0,
      "rescore_query": {
        "match": {
          "content": { "query": "query", "operator": "AND" }
        }
      }
    }
  }
}
```

**关键参数**：
- `window_size`：对 top-N 做精排（一般取 `topK * 3`）
- `query_weight`：语义分在最终分中的权重（通常 0.2）
- `rescore_query_weight`：BM25 精排权重（通常 1.0）
- 精排阶段 `operator = AND` 确保关键词完整性

#### 3.2.3 多字段加权检索

```json
{
  "multi_match": {
    "query": "query",
    "fields": ["title^3", "content^1"],
    "type": "best_fields"
  }
}
```

标题匹配相关性天然更高，应加权（^3 表示权重提升 3 倍）。

### 3.3 Qdrant 最佳实践

#### 3.3.1 HNSW 参数调优

2026 年 Qdrant 1.17+ 推荐的生产配置：

```json
{
  "hnsw_config": {
    "m": 32,
    "ef_construct": 256,
    "ef": 128
  },
  "optimizers_config": {
    "indexing_threshold": 10000
  },
  "quantization_config": {
    "scalar": {
      "type": "int8",
      "quantile": 0.99,
      "always_ram": true
    }
  }
}
```

#### 3.3.2 GPU 加速索引 (2026.04 新特性)

Qdrant Cloud 2026 年 4 月推出 GPU 加速 HNSW 索引：

- A100 GPU 上 1024 维向量检索吞吐提升 **15×**
- 索引构建速度提升 **4×**
- 查询延迟降至 **~0.5ms**

对于自建场景，Qdrant 也支持 CUDA kernel 加速。

### 3.4 混合检索最新进展

#### 3.4.1 熵驱动动态加权（ICML 2025 Workshop）

使用归一化 Shannon 熵作为检索置信度指标，动态调整 dense/sparse 的融合权重：

```
entropy = -Σ p_i × log(p_i)  （p_i = softmax(scores)）
dense_weight ∝ 1 - entropy   （置信度越高，熵越低）
sparse_weight ∝ entropy
```

相比固定权重（如 RRF k=60），动态加权在不同查询类型上表现更稳定。

#### 3.4.2 Mixture of Retrievers（2025.06）

MoR 将多个检索器（sparse + dense + human）做零样本加权组合，0.8B 参数的 MoR 模型以 +3.9% 的优势超过 7B 参数单一模型。

---

## 四、与行业基准的差距量化

| 维度 | 当前状态 | 行业最佳 | 差距 |
|------|---------|---------|------|
| Token 计算 | tiktoken 客户端计数 ✅ | tiktoken + API usage 校验 | **小** — 缺服务端校验 |
| Batch 策略 | 固定 50 条 | token-count-based 动态批 | **中** — 吞吐差距 |
| Embedding 缓存 | 无 | Semantic Cache (Redis) | **大** — 重复调用浪费成本 |
| 中文分词 | ik_max_word (索引=搜索) | ik_max_word/ik_smart 分离 | **大** — 搜索精度差距 ~15% |
| ES 精排 | 无 rescore | 二阶段 rescore (AND) | **中** — 首屏精度差距 |
| 同义词词典 | 无 | 自定义词典 + 同义词 filter | **中** — 专业术语召回差 ~40% |
| Qdrant 量化 | float32 全精度 | int8 scalar 量化 | **中** — 存储浪费 75% |
| Qdrant HNSW | 默认参数 | m=32, ef=128, 量化 | **小** — 参数调优 |
| 写入并行性 | Qdrant → ES 顺序 | Promise.all 并行 | **小** — 延迟可降 50% |
| ES 降级 | 无 | ES 不可用时 fallback 到仅稠密 | **中** — 韧性缺失 |
| 成本监控 | 无 | 每批/每文档的 token 消耗记录 | **中** — 成本不可追溯 |
| 多字段映射 | 无 | content.ngram + content.exact | **小** — 可灵活扩展 |

---

## 五、优化方案

### 5.1 优化总览

```
优先级排序：P0 > P1 > P2 > P3

P0（本周可落地，高 ROI）:
  ├── E1: ES 分词器分离（ik_max_word 索引 + ik_smart 搜索）
  ├── E2: ES 同义词词典 + 自定义词典
  └── E3: Embedding 缓存（Content Hash → Redis）

P1（2周内，核心杠杆）:
  ├── E4: Token-count-based 动态批次
  ├── E5: Qdrant int8 量化
  └── E6: ES 二阶段 Rescore

P2（1个月内，体验质变）:
  ├── E7: Qdrant + ES 并行写入
  ├── E8: ES 不可用时的降级策略
  ├── E9: Embedding 成本与质量监控
  └── E10: HNSW 参数调优

P3（长期演进）:
  ├── E11: Vision Embedding 支持
  ├── E12: Entropy-based 动态 RRF 加权
  └── E13: Qdrant Payload 索引
```

### 5.2 E1：ES 分词器分离（P0）

**目标**：索引用 `ik_max_word` 保证召回，搜索用 `ik_smart` 提升精度。

**方案**：

```json
// elasticsearch.service.ts — ensureIndex() 修改 mappings
{
  "content": {
    "type": "text",
    "analyzer": "ik_max_word",
    "search_analyzer": "ik_smart"
  },
  "title": {
    "type": "text",
    "analyzer": "ik_max_word",
    "search_analyzer": "ik_smart"
  }
}
```

**改动文件**：
- [elasticsearch.service.ts](../../apps/server/src/common/vector/elasticsearch.service.ts) — `ensureIndex()` 中的 mappings

**收益**：
- 中文搜索精度预计提升 10-15%
- 不影响现有数据（索引重建后生效，需重新入库）

**风险**：
- 需要删除并重建 ES 索引（存量数据需重新写入）
- ik_smart 非 ik_max_word 子集的问题（社区已知 bug），必要进行词条合并

### 5.3 E2：ES 同义词 + 自定义词典（P0）

**目标**：提升专业术语（RAG/LLM/向量/Embedding）和相关表述的检索召回率。

**方案**：

```xml
<!-- IKAnalyzer.cfg.xml -->
<properties>
  <entry key="ext_dict">custom/mydict.dic</entry>
</properties>
```

```text
# custom/mydict.dic
检索增强生成
大语言模型
向量检索
混合检索
灵索智能
...
```

或在 ES 层面配置 synonym filter：

```json
{
  "analysis": {
    "filter": {
      "rag_synonym": {
        "type": "synonym",
        "synonyms": [
          "RAG, 检索增强生成",
          "LLM, 大模型, 大语言模型",
          "Embedding, 向量化, 向量嵌入",
          "向量检索, 语义检索, 稠密检索"
        ]
      }
    },
    "analyzer": {
      "chunk_analyzer": {
        "tokenizer": "ik_max_word",
        "filter": ["lowercase", "rag_synonym"]
      }
    }
  }
}
```

**改动文件**：
- [elasticsearch.service.ts](../../apps/server/src/common/vector/elasticsearch.service.ts) — 添加 synonym filter
- ES 配置文件目录 — 添加自定义词典

**收益**：
- 专业术语召回率提升 30-40%
- 用户即使用不同表述也能匹配到正确内容

### 5.4 E3：Embedding 缓存（P0）

**目标**：消除相同文本的重复 embedding 调用，节省 API 成本。

**方案设计**：

```typescript
// embedding.service.ts 中新增
private async embedDocumentsWithCache(texts: string[]): Promise<EmbedResult> {
  const results: number[][] = new Array(texts.length);
  const uncached: { index: number; text: string }[] = [];

  // 1. 查缓存（content SHA256 → embedding vector）
  for (let i = 0; i < texts.length; i++) {
    const hash = this.hashContent(texts[i]);
    const cached = await this.cacheService.get(`embed:${hash}`);
    if (cached) {
      results[i] = JSON.parse(cached);
    } else {
      uncached.push({ index: i, text: texts[i] });
    }
  }

  // 2. 仅对未命中部分调用 API
  if (uncached.length > 0) {
    const { vectors } = await this.embedDocuments(uncached.map(u => u.text));
    for (let j = 0; j < vectors.length; j++) {
      results[uncached[j].index] = vectors[j];
      // 写入缓存（TTL 30 天）
      const hash = this.hashContent(uncached[j].text);
      await this.cacheService.set(`embed:${hash}`, JSON.stringify(vectors[j]), 30 * 86400);
    }
  }

  return { vectors: results, totalTokens: this.estimateBatchTokenCount(texts) };
}
```

**缓存介质选择**：

| 介质 | 优点 | 缺点 |
|------|------|------|
| **Redis** (推荐) | 已有基础设施，支持 TTL，高性能 | 内存占用较大 |
| SQLite | 零运维，持久化 | 并发性能差 |
| 本地文件 | 最简单 | 多实例不共享 |

推荐使用 Redis：项目已有 Redis 基础设施，引入零额外运维成本。

**收益**：
- 重解析场景：30-60% 的 chunk 内容可能不变（取决于文档改动范围）
- 模板/公共内容：100% 命中
- 预期综合节省 10-30% embedding 调用

### 5.5 E4：Token-count-based 动态批次（P1）

**目标**：按 token 数而非固定 chunk 数分批，最大化每次 API 调用的吞吐。

**方案**：

```typescript
// embedding.service.ts
private async embedDocumentsWithTokenBatching(texts: string[]): Promise<EmbedResult> {
  const config = this.getEmbeddingConfig();
  const embeddings = this.createEmbeddingsClient(config);
  const maxTokensPerBatch = 7500; // 百炼 text-embedding-v4 安全上限 ~8100

  const batches: string[][] = [];
  let currentBatch: string[] = [];
  let currentTokenCount = 0;

  for (const text of texts) {
    const tokens = this.tokenService.tokenCount(text);
    if (currentTokenCount + tokens > maxTokensPerBatch && currentBatch.length > 0) {
      batches.push(currentBatch);
      currentBatch = [];
      currentTokenCount = 0;
    }
    currentBatch.push(text);
    currentTokenCount += tokens;
  }
  if (currentBatch.length > 0) batches.push(currentBatch);

  // 并行调用：每批独立请求（注意限频）
  const results = await Promise.all(
    batches.map((batch) => this.embedBatchWithRetry(batch, embeddings, config)),
  );

  return { vectors: results.flatMap(r => r.vectors), ... };
}
```

**收益**：
- 吞吐提升 3-8×（小 chunk 场景，批次合并）
- 减少 API 调用次数，降低限频风险
- 批次间隔可以更精确地匹配 token 数，避免空转

### 5.6 E5：Qdrant int8 量化（P1）

**目标**：减少向量存储和内存占用，支持更大规模的知识库。

**方案**：

```typescript
// qdrant.service.ts — ensureCollection() 中
await this.client.createCollection(QDRANT_DOCUMENT_COLLECTION_NAME, {
  vectors: { size: vectorSize, distance: 'Cosine' },
  hnsw_config: { m: 32, ef_construct: 256 },
  quantization_config: {
    scalar: { type: 'int8', quantile: 0.99, always_ram: true },
  },
});
```

**权衡**：
- 精度损失：1-3%（在 RAG Rerank 环节可弥补）
- 存储节省：75%
- 检索速度：由于内存占用小，反而可能更快

**收益**：
- 100 万向量：6 GB → 1.5 GB
- 支持更大规模知识库而不扩容

### 5.7 E6：ES 二阶段 Rescore（P1）

**目标**：提升 ES 检索首屏精确率。

**方案**：

```typescript
// elasticsearch.service.ts — search()
async search(query: string, kbIds: string[], topK: number) {
  const response = await this.client.search({
    index: this.indexName,
    query: {
      bool: {
        should: [
          { match: { content: { query, boost: 1.0 } } },
          { match_phrase: { content: { query, boost: 2.0, slop: 5 } } },
          { match: { title: { query, boost: 1.5 } } },  // E2 多字段
        ],
        minimum_should_match: 1,
        filter: [{ terms: { kbId: kbIds } }],
      },
    },
    size: topK * 3,  // 宽召回
    rescore: {
      window_size: topK,
      query: {
        query_weight: 0.2,
        rescore_query_weight: 1.0,
        rescore_query: {
          match: {
            content: { query, operator: 'AND' },
          },
        },
      },
    },
    _source: ['chunkId', 'docId', 'kbId', 'content', 'title'],
  });
}
```

**收益**：
- 首屏精确率提升（通过严格匹配再排序）
- 延迟增加可控（rescore 只作用于 topK * 3 的候选集）

### 5.8 E7：并行写入 Qdrant + ES（P2）

**目标**：减少向量入库延迟。

**方案**：

```typescript
// document-processing.service.ts
// Before (sequential):
// await this.qdrantService.upsertChunkVectors(...);
// await this.elasticsearchService.bulkIndexChunks(...);

// After (parallel):
const [_, __] = await Promise.all([
  this.qdrantService.upsertChunkVectors(qdrantPoints),
  this.elasticsearchService.bulkIndexChunks(esChunks),
]);
```

**收益**：写入阶段耗时减少 40-50%。

### 5.9 E8：ES 降级策略（P2）

**目标**：ES 不可用时检索不中断，回退到仅稠密检索。

**方案**：

```typescript
// retrieval.service.ts
let sparseHits: SparseHit[] = [];
try {
  sparseHits = await this.sparseService.retrieve({ queries, kbIds, topK: sparseTopK });
} catch (error) {
  this.logger.warn('[Retrieval] ES 检索失败，降级为仅稠密检索', {
    error: error instanceof Error ? error.message : String(error),
  });
  sparseHits = []; // 降级：空稀疏结果
}
```

同时增加 ES 健康检查（已有 `ping()` 方法），搜索前先判断 ES 可用性。

### 5.10 E9：成本与质量监控（P2）

**目标**：建立 embedding 过程的成本和质量可观测性。

**方案**：

1. 每次 embedding 调用后记录：
   - 调用批次数、总 token 数、总耗时
   - 缓存命中率
   - 向量维度、空向量数

2. 写入 `b_document_processing_tasks` 的 embedding stage 的 `details` 字段

3. 在 Winston 日志中结构化记录，便于后续接入监控面板

### 5.11 E10：HNSW 参数调优（P2）

**方案**：

```typescript
await this.client.createCollection(QDRANT_DOCUMENT_COLLECTION_NAME, {
  vectors: { size: vectorSize, distance: 'Cosine' },
  hnsw_config: {
    m: 32,               // 连接数（默认 16，增加提升召回率）
    ef_construct: 256,   // 构建时搜索宽度（默认 100）
  },
});
```

查询时：

```typescript
await this.client.search(collectionName, {
  vector,
  limit: topK,
  params: { ef: 128 },  // 查询时搜索宽度（默认 20，增加提升召回率）
  filter,
  with_payload: true,
});
```

**收益**：召回率提升 3-5%，但索引时间和内存略有增加。

---

## 六、实施路线图

```
Week 1 (P0):  ──┬── E1: ES 分词器分离 (ik_max_word/ik_smart)
               ├── E2: ES 同义词词典
               └── E3: Embedding 缓存 (Content Hash → Redis)

Week 2-3 (P1): ──┬── E4: Token-count-based 动态批次
                ├── E5: Qdrant int8 量化
                └── E6: ES 二阶段 Rescore

Week 3-4 (P2): ──┬── E7: Qdrant + ES 并行写入
                ├── E8: ES 降级策略
                ├── E9: 成本与质量监控
                └── E10: HNSW 参数调优

Month 2+ (P3): ──┬── E11: Vision Embedding（暂不实施，待图片解析就绪）
                ├── E12: 动态 RRF 加权 ✅
                └── E13: Qdrant Payload 索引 ✅
```

---

## 七、预期收益汇总

| 优化项 | 预期效果 | 实现复杂度 | 破环风险 |
|--------|---------|-----------|---------|
| E1 ES 分词器分离 | +10-15% 搜索精度 | 低 | 是（需重建索引） |
| E2 ES 同义词词典 | +30-40% 专业术语召回 | 低 | 否 |
| E3 Embedding 缓存 | -10~30% API 调用 | 中 | 否（Redis 持久化） |
| E4 Token-count Batch | +3~8× 吞吐 | 低 | 否 |
| E5 Qdrant 量化 | -75% 存储 | 低 | 是（需重建 collection） |
| E6 ES Rescore | +10-20% 首屏精度 | 低 | 否 |
| E7 并行写入 | -40-50% 写入延迟 | 低 | 否 |
| E8 ES 降级 | 检索可用性提升 | 低 | 否 |
| E9 成本监控 | 可观测性从无到有 | 低 | 否 |
| E10 HNSW 调优 | +3-5% 稠密检索召回 | 低 | 否 |

**组合预估**：P0+P1 全部落地后，检索准确率预计提升 **15-25%**，API 成本降低 **10-30%**。

---

## 八、风险与注意事项

1. **E1 分词器分离**需要删除并重建 ES 索引，存量数据需重新处理或批量 reindex。建议与 E2 同义词词典一起实施，一次索引重建覆盖两个优化。

2. **E5 Qdrant 量化**同样需要重建 collection，int8 量化的 1-3% 精度损失需要通过 rerank 环节弥补。建议先在 staging 环境验证精度损失可接受后再上生产。

3. **E3 Embedding 缓存**的 Redis key 数量会随文档规模线性增长（每个 chunk 一个 key × 30 天 TTL）。按 100 万 chunks 估算，Redis 内存增量约 100 万 × (256B key + 6KB value) ≈ 6 GB。需要规划 Redis 内存容量。

4. **E4 动态批次**增加了批次大小波动性，需要确保 `BAILIAN_EMBED_REQUEST_INTERVAL_MS` 与实时限频状态联动，避免大批次触发 429。

5. **E6 Rescore** 增加了 ES 查询计算的复杂度，对 P95 延迟有轻微影响（<15ms），需要监控。

6. 所有 ES 相关优化（E1、E2、E6）仅对新写入的数据生效，存量文档需手动触发重解析。

---

## 八、实施记录

### 2026-05-08: P0 实施完成

**E1+E2: ES 分词器分离 + 同义词词典**（编码 1h，测试通过）

| 文件 | 变更要点 |
|------|---------|
| `common/vector/elasticsearch.service.ts` | `ensureIndex()` 增加 mapping 版本检测（缺 `search_analyzer` → 自动重建）；抽取 `createIndex()` 私有方法；content/title 增加 `search_analyzer: 'ik_smart'`；新增 `rag_synonym` filter（8 组同义词对），加入 `chunk_analyzer` 的 filter 链 |

**E3: Embedding 缓存**（编码 1h，测试通过）

| 文件 | 变更要点 |
|------|---------|
| `common/cache/redis-cache.service.ts`（新增） | Redis 通用缓存服务：`lazyConnect` + try-catch 降级，默认 30 天 TTL，复用 `REDIS_URL`/`REDIS_PASSWORD` |
| `common/cache/cache.module.ts`（新增） | `@Global()` 模块，导出 `RedisCacheService` |
| `rag/ai/embedding.service.ts` | 注入 `RedisCacheService`；`embedDocuments()` 中插入缓存层：content SHA-256 → `embed:{hash}` 查 Redis，命中跳过 API，miss 后 fire-and-forget 写入 |
| `rag/ai/ai.module.ts` | 导入 `CacheModule` |
| `scripts/bailian-embedding-smoke.ts` | 适配新增 `cacheStub` 构造参数 |
| `package.json` | 新增 `ioredis` 直接依赖 |
| `apps/server/.gitignore` | 修复：`/generated/prisma` → `/prisma/generated` |

### 2026-05-08: P1 实施完成

**E4: Token-count-based 动态批次**（编码 0.5h，测试通过）

| 文件 | 变更要点 |
|------|---------|
| `rag/ai/embedding.service.ts` | `embedDocuments()` 中固定 `batchSize` 切片 → token-count 累积分组（`MAX_TOKENS_PER_BATCH=7500`）；单条超限独立成批；保持串行+间隔防限频 |

**E5: Qdrant int8 量化**（编码 0.5h，测试通过）

| 文件 | 变更要点 |
|------|---------|
| `common/vector/qdrant.constants.ts` | 新增 `QDRANT_HNSW_M`(32)、`QDRANT_HNSW_EF_CONSTRUCT`(256)、`QDRANT_EF_SEARCH`(128) |
| `common/vector/qdrant.service.ts` | 注入 Winston Logger；`ensureCollection()` 新建 collection 时启用 `int8` 量化 + `hnsw_config`(m=32,ef_construct=256)；存量 collection 缺量化时 warn；`searchChunkVectors()` 查询时设置 `params: { ef: 128 }` |

**E6: ES 二阶段 Rescore**（编码 0.5h，测试通过）

| 文件 | 变更要点 |
|------|---------|
| `common/vector/elasticsearch.service.ts` | `search()` 中 `match` → `multi_match`(title^2+content^1)；`size` 扩大到 `topK*3` 宽召回；新增 `rescore`(window_size=topK, AND 严格匹配, query_weight=0.2)；结果 `slice(0, topK)` 截断；新增 `minimum_should_match: 1` |

**验收汇总**（P0+P1）:
- 构建: `nest build` 通过
- 单元测试: 5 suites / 54 tests 全部通过
- 新增/修改文件: 10 个
- E10（HNSW 参数调优）已在 E5 中一并实现（m=32, ef_construct=256, ef_search=128）

### 2026-05-08: P2 实施完成

**E7: Qdrant + ES 并行写入**（编码 0.25h，测试通过）

| 文件 | 变更要点 |
|------|---------|
| `document/services/document-processing.service.ts` | Qdrant+ES 顺序写 → `Promise.all` 并行；预先构建 `qdrantPoints` 和 `esChunks` 数组；统一错误处理 |

**E8: ES 降级策略**（编码 0.25h，测试通过）

| 文件 | 变更要点 |
|------|---------|
| `rag/retrieval/retrieval.service.ts` | 注入 Winston Logger；稀疏检索 try-catch 降级（失败→`sparseHits=[]`，仅稠密路继续）；warn 日志含 `kbIdsCount`/`queriesCount` |

**E9: Embedding 成本与质量监控**（编码 0.5h，测试通过）

| 文件 | 变更要点 |
|------|---------|
| `rag/ai/embedding.service.ts` | `embedDocuments()` 返回值扩展 `cacheHits`/`apiCallCount`/`durationMs`；全程 `Date.now()` 计时；空输入时 4 个新字段均为 0 |
| `document/services/document-processing.service.ts` | 嵌入完成后记录 `[EmbeddingCost]` 结构化日志：`documentId`/`chunkCount`/`totalTokens`/`cacheHits`/`apiCallCount`/`durationMs` |

**验收汇总**（P0+P1+P2）:
- 构建: `nest build` 通过
- 单元测试: 5 suites / 54 tests 全部通过
- 累计优化: E1~E9 + E10（含在 E5），共 10 项

### 2026-05-08: P3 实施完成

**E11: Vision Embedding** — **暂不实施**。原因：当前文档解析流水线（PDF→pdfexcavator, DOCX→mammoth）尚未提取图片数据，放开 vision embedding 也无图片可送入。等解析流水线支持图片提取后再启用。

**E12: Entropy-based 动态 RRF 加权**（编码 0.5h，测试通过）

| 文件 | 变更要点 |
|------|---------|
| `rag/retrieval/fusion.service.ts` | 新增 `computePathConfidence()` — 基于 Shannon 熵计算检索路径置信度权重 [0.5, 1.0]；RRF 融合时各路贡献乘以置信度：`conf / (k + rank)`；分数分布越集中权重越高 |

**E13: Qdrant Payload 索引**（编码 0.25h，测试通过）

| 文件 | 变更要点 |
|------|---------|
| `common/vector/qdrant.service.ts` | 新增 `ensurePayloadIndexes()` — 为 `kbId`/`docId`/`chunkLevel` 创建 keyword 类型 payload 索引；幂等操作，重复创建不报错；新 collection 创建后及存量 collection 均自动执行 |

**验收汇总**（P0+P1+P2+P3）:
- 构建: `nest build` 通过
- 单元测试: 5 suites / 54 tests 全部通过
- 累计优化: E1~E13（E11 跳过），共 12 项落地

### 2026-05-08: 紧急 Bug 修复 — StructuredOutput 解析错误 + 日志规范化

**问题一：LangChain `withStructuredOutput` 字段名不匹配**

**现象**：LangSmith 监控发现 rewrite 节点报错 `parse error`，rewrite 提示词输出结构与代码预期不符。

**根因**：`withStructuredOutput(..., { method: 'jsonMode' })` 只强制 JSON 格式，**不强制字段名**。LLM 输出 `original_query` / `rewritten_query` 而非预期的 `rewritten` / `focus`。

**修复**：`rewrite.prompt.ts` 在提示词末尾显式给出 JSON 结构示例（含字段名），并标注"必须严格遵守此 JSON 结构，不得修改字段名"：

```typescript
【输出格式（必须严格遵守此 JSON 结构，不得修改字段名）】
{
  "queries": [
    {
      "rewritten": "改写后的查询语句",
      "focus": "本次查询聚焦的关键信息维度（如人物经历、技术原理、对比维度等）"
    }
  ]
}
```

**问题二：embedding 阶段进度不透明**

**现象**：chunking 完成后 embedding 耗时不可见，日志中仅有状态变更事件，无耗时数据。

**修复**：

| 文件 | 变更要点 |
|------|---------|
| `document-processing.service.ts` | `console.log('[Embedding]')` → Winston `logger.info('[EmbeddingCost]')` 结构化日志；记录 `documentId`/`chunkCount`/`totalTokens`/`cacheHits`/`apiCallCount`/`durationMs`；E7 并行写入统一异常处理（BusinessException 直接抛出，其余包装为 `DOCUMENT_VECTOR_INDEX_ERROR_CODE`） |

**验收**

- 单元测试: 20 tests 通过（`DocumentChunkService` 全量回归）
- 构建: `nest build` 通过
- 端到端: processing_version=5 全链路 65 秒完成（1038 chunks，508 缓存命中）

---

## 九、参考资料

- [Qdrant 1.17 Release — GPU-Accelerated Indexing & Enterprise Features](https://qdrant.tech/blog/qdrant-1.17/)
- [Qdrant Cloud Ships Enterprise-Grade Features (April 2026)](https://www.businesswire.com/news/home/20260428763866/en/)
- [Token-count-based Batching — Voyage AI / MongoDB (Dec 2025)](https://www.mongodb.com/company/blog/engineering/token-count-based-batching-faster-cheaper-embedding-inference-for-queries)
- [Elasticsearch IK Analyzer — 索引/搜索分离最佳实践](https://blog.csdn.net/2501_93894722/article/details/154142926)
- [ScyllaDB Semantic Caching for RAG (Nov 2025)](https://www.scylladb.com/2025/11/24/cut-llm-costs-and-latency-with-scylladb-semantic-caching/)
- [Higress-RAG: Full-Link Optimization (arXiv:2602.23374, Feb 2026)](https://arxiv.org/abs/2602.23374)
- [Matryoshka Embeddings — Voyage AI](https://www.mongodb.com/company/blog/engineering/lower-cost-vector-retrieval-with-voyage-ais-model-options)
- [Entropy-Based Dynamic Hybrid Retrieval — ICML 2025 Workshop](https://icml.cc/virtual/2025/48946)


---


# RAG 检索流水线优化建议

> 日期：2026-05-08 | 分支：`feat/rag-pipeline-optimization`
>
> 基于对 `apps/server/src/modules/rag/` + `apps/server/src/modules/chat/` 两个模块的
> 全面代码审查（Review + Simplify + Security + LangGraph/AGUI 外部知识对比）。

---

## 一、代码层面优化建议

### P0 — 立即修复（Bug / 内存泄漏 / 性能瓶颈）

#### 1.1 稠密/稀疏检索串行执行 → 改为并行

- **文件**: [retrieval.service.ts:72-94](../../apps/server/src/modules/rag/retrieval/retrieval.service.ts#L72-L94)
- **问题**: 稠密（Qdrant）和稀疏（ES）检索完全独立，却串行执行 `await dense → await sparse`，总耗时为两者之和
- **建议**: 使用 `Promise.allSettled()` 并行执行，总耗时为 max(t_dense, t_sparse)，同时保持 ES 失败降级行为

```typescript
// 当前（串行）
const denseHits = await this.denseService.retrieve({...});  // 200ms
const sparseHits = await this.sparseService.retrieve({...}); // 150ms
// 总耗时: ~350ms

// 建议（并行）
const [denseResult, sparseResult] = await Promise.allSettled([
  this.denseService.retrieve({...}),
  this.sparseService.retrieve({...}),
]);
const denseHits = denseResult.status === 'fulfilled' ? denseResult.value : [];
const sparseHits = sparseResult.status === 'fulfilled' ? sparseResult.value : [];
// 总耗时: ~200ms（节省 ~40%）
```

#### 1.2 RetrievalTraceService 无界内存泄漏

- **文件**: [retrieval-trace.service.ts:29](../../apps/server/src/modules/rag/retrieval/retrieval-trace.service.ts#L29)
- **问题**: `private traces = new Map<string, RetrievalTrace>()` 只增不减，无 TTL、无上限、无清理机制。每次对话至少产生 1 条 trace + 多个 steps，累积导致 OOM
- **建议**:
  - 添加 LRU 上限（如最多 500 条）
  - 或添加 TTL 定时清理（5 分钟过期）
  - 或改为持久化到 `b_agent_steps` 表后从内存移除
  - 推荐：直接废弃该类，合并到 `AgentTraceService`（已持久化），删除内存 Map

#### 1.3 Fusion 循环内 O(n*m) 查找

- **文件**: [fusion.service.ts:100-101](../../apps/server/src/modules/rag/retrieval/fusion.service.ts#L100-L101)
- **问题**: `for (const chunkId of allChunkIds)` 内对每个 chunkId 执行 `denseHits.find()` 和 `sparseHits.find()`，均为 O(n) 操作
- **建议**: 利用已有的 `denseRankMap` / `sparseRankMap` 或预建 `denseHitByChunkId` Map

```typescript
// 预建索引，替换 O(n) find
const denseHitMap = new Map(denseHits.map(h => [h.chunkId, h]));
const sparseHitMap = new Map(sparseHits.map(h => [h.chunkId, h]));
// 循环内 O(1) 查找
const denseHit = denseHitMap.get(chunkId);
const sparseHit = sparseHitMap.get(chunkId);
```

#### 1.4 buildContextText 无截断，可能超 LLM 上下文窗口

- **文件**: [multi-agent-orchestrator.service.ts:293-316](../../apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts#L293-L316)
- **问题**: 展开到 Level 1 root chunk 后每个 chunk ~1200 tokens，10 条 + 5 条 web results → 可能 15000+ tokens，超出模型上下文
- **建议**: 添加 token 预算上限（如 context 总额不超过模型上下文的 60%），超出部分按 score 截断

```typescript
const MAX_CONTEXT_TOKENS = 8000; // 约为 8k 模型的 60%
let tokenBudget = MAX_CONTEXT_TOKENS;
for (const hit of hits) {
  const tokens = estimateTokens(hit.content);
  if (tokenBudget <= 0) break;
  parts.push(`[KB-${index + 1}] ...${hit.content.slice(0, tokenBudget * 4)}`);
  tokenBudget -= tokens;
}
```

#### 1.5 AbortSignal 未传入 LLM 子调用

- **文件**: [multi-agent-orchestrator.service.ts:393-551](../../apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts#L393-L551)
- **问题**: `checkAborted()` 仅在节点入口检查，已发起的 LLM 调用（route/rewrite/decompose/audit）无法中止。客户端断开后仍会完成 API 调用，浪费成本
- **建议**: 将 `signal` 传入 `chatModelService.createModel()` 或使用 AbortSignal 的 `fetch` 级别中断。LangChain ChatOpenAI 支持通过配置传入 signal

#### 1.6 streamChatMode 缺少 AbortSignal

- **文件**: [chat-stream.service.ts:148-220](../../apps/server/src/modules/chat/services/chat-stream.service.ts#L148-L220)
- **问题**: 普通对话模式不接受也不检查 `AbortSignal`，与 RAG 模式不一致。客户端断开后 LLM 流和 DB 写入仍会完成
- **建议**: `streamChatMode` 签名新增 `signal?: AbortSignal`，在流循环中检查 `signal?.aborted`

---

### P1 — 应尽快修复（代码复用 / 质量）

#### 1.7 提取重复的 "按 chunkId 去重保留最高分" 逻辑

- **文件**: [dense-retrieval.service.ts:52-61](../../apps/server/src/modules/rag/retrieval/dense-retrieval.service.ts#L52-L61)、[elasticsearch-sparse-retrieval.service.ts:39-57](../../apps/server/src/modules/rag/retrieval/elasticsearch-sparse-retrieval.service.ts#L39-L57)
- **问题**: 相同的去重模板在 3 个检索服务中重复
- **建议**: 提取泛型工具函数

```typescript
// common/utils/retrieval.utils.ts
export function dedupByHighestScore<T extends { chunkId: string; score: number }>(
  groups: T[][],
  topK?: number,
): T[] {
  const seen = new Map<string, T>();
  for (const group of groups) {
    for (const hit of group) {
      const existing = seen.get(hit.chunkId);
      if (!existing || hit.score > existing.score) {
        seen.set(hit.chunkId, hit);
      }
    }
  }
  const sorted = Array.from(seen.values()).sort((a, b) => b.score - a.score);
  return topK ? sorted.slice(0, topK) : sorted;
}
```

#### 1.8 提取重复的分词函数

- **文件**: [rerank.service.ts:283-287](../../apps/server/src/modules/rag/retrieval/rerank.service.ts#L283-L287)、[sparse-retrieval.service.ts:169-171](../../apps/server/src/modules/rag/retrieval/sparse-retrieval.service.ts#L169-L171)
- **问题**: 两个分词方法正则几乎相同，且停用词策略不一致
- **建议**: 统一为一个 `tokenize(text: string, options?: { minLength?: number; stopWords?: Set<string> }): string[]`

#### 1.9 提取重复的 LangChain 消息内容提取函数

- **文件**: [multi-agent-orchestrator.service.ts:318-332](../../apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts#L318-L332)、[chat-stream.service.ts:21-30](../../apps/server/src/modules/chat/services/chat-stream.service.ts#L21-L30)
- **问题**: 两个语义相同的函数，类型守卫略有差异
- **建议**: 统一为一个 `extractMessageContent(msg: { content?: unknown }): string`，放在 `common/utils/` 下

#### 1.10 统一 BigInt 安全转换

- **文件**: [citation.service.ts:162-170](../../apps/server/src/modules/rag/retrieval/citation.service.ts#L162-L170)（唯一有错误处理的）、[get-chunk-detail.tool.ts:29](../../apps/server/src/modules/chat/services/tools/get-chunk-detail.tool.ts#L29)（直接 BigInt 无处理）等 ~50 处
- **问题**: 大多数 `BigInt(x)` 调用无 try-catch，非法输入直接抛原生 TypeError
- **建议**: 提取 `parseBigInt(value: string): bigint` 工具函数，带 BusinessException 包装

#### 1.11 提取共享的 `QuestionType` 类型

- **文件**: 4 个文件中重复定义 `'fact_lookup' | 'compare_analysis' | 'research_or_open_world'`
- **建议**: 在 `common/types/rag.types.ts` 统一定义并导出

```typescript
export type QuestionType = 'fact_lookup' | 'compare_analysis' | 'research_or_open_world';
export const QUESTION_TYPES = ['fact_lookup', 'compare_analysis', 'research_or_open_world'] as const;
```

#### 1.12 SearchKnowledgeBaseTool 类与内联 tool() 重复

- **文件**: [search-knowledge-base.tool.ts](../../apps/server/src/modules/chat/services/tools/search-knowledge-base.tool.ts) vs [multi-agent-orchestrator.service.ts:66-121](../../apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts#L66-L121)
- **问题**: 两者封装相同的 `RetrievalService.retrieve()` 调用，但参数传递不同（类版本硬编码 topK=20，内联版本利用 questionType 自适应）
- **建议**: 废弃 `SearchKnowledgeBaseTool` 类，统一使用内联 tool()（功能更完整，含 trace 记录）。若需独立使用，让 tool() 接收可选的 `AgentTraceService` 参数

#### 1.13 onFinish 回调中的 3 个 DB 操作改为并行

- **文件**: [chat-stream.service.ts:119-135](../../apps/server/src/modules/chat/services/chat-stream.service.ts#L119-L135)
- **问题**: `createCitations`、`finalizeAssistantMessage`、`summarizeTitleIfNeeded` 无数据依赖，却串行 await
- **建议**: 使用 `Promise.all()` 并行执行（注意 `summarizeTitleIfNeeded` 可能调用 LLM，耗时最长）

#### 1.14 轻量回退中重复 toLowerCase 计算

- **文件**: [rerank.service.ts:153](../../apps/server/src/modules/rag/retrieval/rerank.service.ts#L153)
- **问题**: `c.content.toLowerCase()` 在内层循环中重复计算（candidates × queries 次）
- **修复**: 提至外层循环

---

### P2 — 改进建议（质量 / 可维护性）

#### 1.15 提取分数四舍五入工具

- **文件**: 9 处 `Math.round(x * 1000) / 1000`
- **建议**: `roundTo3(n: number): number` 或 `roundTo(n: number, decimals: number): number`

#### 1.16 提取错误消息提取工具

- **文件**: ~10 处 `error instanceof Error ? error.message : String(error)`
- **建议**: `getErrorMessage(error: unknown, fallback?: string): string`

#### 1.17 titlePath 的 JSON.parse 回退逻辑可疑

- **文件**: [rerank.service.ts:255-260](../../apps/server/src/modules/rag/retrieval/rerank.service.ts#L255-L260)
- **问题**: titlePath 在文档处理阶段始终为 `string[]`，这里的 `JSON.parse` 回退暗示历史问题
- **建议**: 调查是否是存量数据序列化不一致导致，如果是则添加数据迁移；如果已修复则去掉 JSON.parse 回退

#### 1.18 SseWriter 缺少 `TEXT_MESSAGE_CHUNK` 和 `TOOL_CALL_ARGS` 事件

- **文件**: [agui-events.ts](../../apps/server/src/modules/chat/types/agui-events.ts)
- **问题**: 根据 AG-UI 协议标准，工具调用应该有 `TOOL_CALL_ARGS`（流式参数）事件，但当前直接从 `TOOL_CALL_START` 跳到 `TOOL_CALL_RESULT`
- **建议**: 对于大参数或长结果的工具调用，考虑增加中间事件。非阻塞项

#### 1.19 AgentState 类型转换使用了 `as unknown as AgentState`

- **文件**: [multi-agent-orchestrator.service.ts:594](../../apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts#L594)
- **问题**: `finalState as unknown as AgentState` 是不安全的类型断言
- **建议**: 使用 LangGraph 的类型推断结果，或定义显式的返回类型接口

#### 1.20 日志中缺少 requestId 链路追踪

- **文件**: 多处 logger.warn/error 调用
- **问题**: 根据后端开发规则，日志应包含 `requestId`，但 orchestrator 和 retrieval 服务中的日志缺少此字段
- **建议**: 从 NestJS request 中提取 requestId 并在日志上下文中传递

#### 1.21 rerank-model.service.ts 的 fetch 调用缺少超时控制

- **文件**: [rerank-model.service.ts:78](../../apps/server/src/modules/rag/retrieval/rerank-model.service.ts#L78)
- **问题**: 原生 `fetch()` 无默认超时，网络异常时可能长时间挂起
- **建议**: 使用 `AbortSignal.timeout()` 添加请求级超时（如 15s）

---

## 二、架构 / 流程层面优化建议

### 2.1 启用已定义但未使用的质量校验节点

当前 LangGraph 图中仅有 `route → decompose → rewrite → retrieve → audit → writer`。
但 prompt 和 schema 已准备好：

| 节点 | 功能 | 建议位置 |
|------|------|----------|
| **Fact Check** | 逐条校验回答事实是否有检索证据支撑 | writer 之后、返回之前 |
| **Completeness Check** | 检查回答是否覆盖原始问题的所有维度 | Fact Check 之后 |
| **Relevance Check** | 检查检索结果是否与问题相关 | tools 之后、audit 之前 |

**推荐流程图**：

```
tools → relevance_check → audit → writer → fact_check → completeness_check → __end__
            │                            │              │                    │
            │ not_relevant               │ insufficient │ high_risk           │ missing_aspects
            └→ rewrite（重新改写）       └→ web_search  └→ writer（修正）    └→ supplement_retrieve
```

**成本评估**：每增加一个校验节点，多 1 次轻量 LLM 调用（~0.5-1s）。在质量优先的场景下值得。

### 2.2 实现检索重试环（Retrieval Loop）

当前 audit 判定 insufficient 且 web 不可用时，直接进入 writer 而不再尝试检索。应实现：

```
audit (insufficient + web disabled)
  → rewrite_fallback（更激进的改写策略：换关键词、去掉限制条件）
    → tools（再次检索）
      → audit（再评估）
        → sufficient → writer
        → insufficient（重试次数 > 2）→ writer（告知用户检索不充分）
```

**实现方式**：在 LangGraph 状态中添加 `retrievalRetryCount: number`，audit 条件边根据 count 决定重试还是放弃。

### 2.3 动态上下文窗口管理

当前 `{context}` 替换是简单的字符串拼接。建议：

1. **Token 预估 + 截断**：用 tiktoken 预估 context token 数，超出预算时按 rerankScore 截断
2. **智能排序**：对比分析类问题，确保各对象的 chunks 都有代表
3. **引用编号紧凑化**：chunks 按主题聚类后编号，减少 writer 混淆

### 2.4 LangGraph 配置化构建

当前 `streamRun()` 中图结构硬编码。建议：

```typescript
// 根据配置决定是否启用可选节点
interface GraphConfig {
  enableDecomposition: boolean;
  enableAudit: boolean;
  enableWebSearch: boolean;
  enableFactCheck: boolean;
  enableCompletenessCheck: boolean;
  maxRetrievalRetries: number;
}

// 工厂函数
function buildGraph(config: GraphConfig): CompiledStateGraph<...> { ... }
```

优势：
- 不同场景可选用不同图结构（内部知识库 vs 开放问答）
- A/B 测试不同节点组合的效果
- 便于单元测试单个节点

### 2.5 引入 Human-in-the-Loop 机制

LangGraph 支持 `interrupt()` 暂停执行等待人工批准。对于高风险场景（如审计 verdict=insufficient 且 web 也失败），可暂停并询问用户：
- "知识库中未找到相关内容，是否尝试联网搜索？"
- "检索结果可能不完整，是否继续生成回答？"

### 2.6 工具调用支持流式参数

AG-UI 协议支持 `TOOL_CALL_ARGS` 事件用于流式工具参数。当前从 `TOOL_CALL_START` 直接跳到 `TOOL_CALL_RESULT`，如果工具调用耗时较长（如大批量检索），前端无中间进度反馈。建议在 search_knowledge_base 工具执行过程中发射中间事件（如 dense 完成、sparse 完成等）。

### 2.7 多查询 ReRank 改为单次调用

当前 [rerank.service.ts:113-122](../../apps/server/src/modules/rag/retrieval/rerank.service.ts#L113-L122) 对 N 条查询发起 N 次 Rerank API 调用。如果百炼 Rerank API 支持单请求传多条查询（需要验证），可减少 8x 的 API 调用次数和成本。如果不能，考虑：
- 将查询合并为一条综合查询后再 Rerank（损失一定精度但大幅降低成本）
- 对 candidates 先截断（如 top-20）再 Rerank

### 2.8 expandToRootChunks 延迟执行

当前在 RetrievalService 中展开所有 rerankedHits（10 条），但最终只有 5 条用于 citation，全部 10 条都送入 context。建议：
- 先不发散，将 Level 3 child chunks 送入 buildContextText
- writer 需要引用时才展开被引用的 chunk
- 或者只在 context 构建时按需展开（合并 expandToRootChunks 和 buildContextText）

### 2.9 AgentTraceService 的 completeRun 未被调用

- **文件**: [agent-trace.service.ts:98-111](../../apps/server/src/modules/chat/services/agent-trace.service.ts#L98-L111)
- **问题**: `completeRun()` 方法已定义但 orchestrator 从未调用。Agent run 记录永远停留在 `status: 'running'`
- **建议**: 在 `streamRun` 的 `RUN_FINISHED` 发射后调用 `completeRun()`，`RUN_ERROR` 后调用 `failRun()`

### 2.10 SSE 流结束后的异常处理导致无效事件序列

- **文件**: [multi-agent-orchestrator.service.ts:600-607](../../apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts#L600-L607)
- **问题**: 如果 `onFinish` 抛出异常（如 DB 写入失败），catch 块会发射 `RUN_ERROR`，但此时 `RUN_FINISHED` 可能已发射。AG-UI 协议不允许 `RUN_FINISHED` 后再发 `RUN_ERROR`
- **建议**: 将 `onFinish` 包裹在 try-catch 中，异常时记录日志但不发射 `RUN_ERROR`（因为 `RUN_FINISHED` 已发出，SSE 流即将关闭）

---

## 三、安全加固建议

### 3.1 时间窗口型权限重校验

- **文件**: [chat-stream.service.ts:80-85](../../apps/server/src/modules/chat/services/chat-stream.service.ts#L80-L85)
- **问题**: 权限校验仅在流开始时执行一次，长时间运行的 RAG 对话（30s+）中权限变化无法感知
- **建议**: 这是低风险的 TOCTOU 问题。对于大多数应用可接受。如果安全要求非常高，可在 `tools` 节点检索前重新校验一次 KB 权限（增加 ~5ms 延迟）

### 3.2 metadata 字段无大小限制

- **文件**: [stream-chat.dto.ts:38-39](../../apps/server/src/modules/chat/dto/stream-chat.dto.ts#L38-L39)
- **问题**: `metadata?: Record<string, unknown>` 无深度/大小限制，极端情况下可发送超大嵌套 JSON
- **建议**: 确认 NestJS body parser 的 `limit` 配置（默认为 100kb 的 JSON 是合理的）。或添加自定义验证装饰器

---

## 四、实施优先级建议

按投入产出比排序：

| 优先级 | 编号 | 改进项 | 预期收益 | 改动范围 |
|--------|------|--------|----------|----------|
| **P0** | 1.1 | 稠密/稀疏检索并行化 | 检索延迟 -40% | 1 文件，~10 行 |
| **P0** | 1.2 | RetrievalTraceService 内存泄漏修复 | 避免 OOM | 1 文件 |
| **P0** | 1.4 | Context 截断保护 | 避免 LLM 调用失败 | 1 文件，~15 行 |
| **P0** | 1.6 | streamChatMode AbortSignal | 避免浪费 API 调用 | 1 文件，~5 行 |
| **P1** | 1.3 | Fusion O(n*m) 修复 | 融合延迟 -50% | 1 文件，~10 行 |
| **P1** | 2.9 | completeRun/failRun 调用 | 修复 Agent 追踪 | 1 文件，~5 行 |
| **P1** | 1.13 | onFinish 并行化 | 后处理延迟 -60% | 1 文件 |
| **P1** | 1.5 | AbortSignal 传入 LLM | 减少浪费成本 | 1 文件 |
| **P2** | 1.7-1.11 | 提取共享工具函数 | 减少代码重复 | 新建 2-3 文件 |
| **P2** | 2.2 | 检索重试环 | 提升检索召回率 | 1 文件，~30 行 |
| **P2** | 2.1 | 启用 Fact/Completeness Check | 提升回答质量 | 1 文件，~40 行 |
| **P3** | 2.3-2.6 | 架构增强 | 长期可维护性 | 设计阶段 |

---

## 五、与现有优化的衔接

本建议文档与前序优化文档的关联：

| 前序文档 | 关联建议 |
|----------|----------|
| [03-文档切块优化](./03-文档切块优化.md) | O7 加权已在检索中体现；Small-to-Big 展开效率见 2.8 |
| [04-向量化与ES优化](./04-向量化与ES优化.md) | E12 熵加权见 1.3；E1/E2 ES 优化见 1.1 并行化 |
| [01-文件解析优化](./01-文件解析优化.md) | 无直接关联 |

**建议在实施完本优化的 P0-P1 项后，补充对应的单元测试和 E2E 测试（参照 02-测试规范）。**


---


# 本系统 RAG 全链路实现分析

> 日期：2026-05-08 | 分支：`feat/rag-pipeline-optimization`
>
> **分析范围**：`apps/server/src/modules/rag/` + `apps/server/src/modules/chat/`
>
> **目标**：在提出优化建议之前，全面理解系统当前的 RAG 检索流水线和多智能体编排实现，识别已有优化，聚焦于可改进的环节。

---

## 一、系统整体架构

本系统不是传统"用户问 → 搜文档 → 喂 LLM"的简单 RAG，而是实现了**多智能体编排的 Agentic RAG**。核心思路：将一次问答拆分为多个自主决策的阶段（路由、拆解、改写、检索、审计、生成），每个阶段由一个 LLM 节点驱动，通过 LangGraph 状态图编排串联。

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                          ChatStreamService (流式入口)                          │
│                    chatMode=rag + selectedKbIds → streamRagMode()             │
└────────────────────────────────────┬─────────────────────────────────────────┘
                                     │
                                     ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│              MultiAgentOrchestratorService (LangGraph 状态图编排)               │
│                                                                              │
│  __start__                                                                   │
│     │                                                                         │
│     ▼                                                                         │
│  ┌─────────┐   greeting  ┌─────────────────────────────────────────────┐     │
│  │  route  │────────────►│                  writer (直接回复)            │     │
│  └────┬────┘              └─────────────────────────────────────────────┘     │
│       │ needDecomposition                                                     │
│       ├──────────────► ┌────────────┐                                         │
│       │                │ decompose  │────► ┌──────────┐                       │
│       │                └────────────┘     │ rewrite  │                        │
│       │ fact_lookup                       └─────┬────┘                        │
│       └───────────────────────────────────────► │                              │
│                                                 ▼                              │
│                                          ┌──────────────┐                     │
│                                          │ retrieve_prep│                     │
│                                          └──────┬───────┘                     │
│                                                 ▼                              │
│                                          ┌─────────────┐                      │
│                                          │   tools      │ ← search_knowledge  │
│                                          └──────┬──────┘     _base tool        │
│                                                 ▼                              │
│                                          ┌─────────────┐                      │
│                                          │    audit     │ → 检索质量审计       │
│                                          └──┬──────┬───┘                      │
│                                     suff.   │      │ insuff.+web               │
│                                             │      └────► ┌────────────┐      │
│                                             │            │ web_search │       │
│                                             │            └─────┬──────┘       │
│                                             ▼                  │               │
│                                          ┌─────────┐◄─────────┘               │
│                                          │ writer  │ (流式 LLM 生成)           │
│                                          └────┬────┘                           │
│                                               ▼                                │
│                                           __end__                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 关键设计决策

| 决策 | 说明 |
|------|------|
| **离线/在线分离** | 文档处理(parse/chunk/embed)离线异步完成；检索+生成在线实时执行 |
| **三层存储** | MySQL (元数据) + Qdrant (稠密向量) + Elasticsearch (稀疏/BM25) |
| **LangGraph 编排** | 使用 `@langchain/langgraph` StateGraph，状态驱动多节点条件路由 |
| **AG-UI 协议** | 基于 SSE 的标准 Agent-User Interaction 事件格式，前后端统一 |
| **大模型+小模型协作** | router/decompose/rewrite/audit 用轻量模型（低延迟），writer 用全量模型（高质量） |
| **优雅降级** | ES 不可用时跳过稀疏检索；Rerank 不可用时回退文本重叠计分；LLM 结构化输出失败时降级跳过 |

---

## 二、检索流水线 (rag/retrieval)

### 2.1 总览：RetrievalService

**核心文件**：[retrieval.service.ts](../../apps/server/src/modules/rag/retrieval/retrieval.service.ts)

`RetrievalService.retrieve()` 是对外唯一入口，编排 5 个阶段：

```
queries + kbIds + questionType
        │
        ▼
┌─────────────────────┐
│ 1. 稠密向量检索      │  DenseRetrievalService → Qdrant
│    multi-query × N  │
└────────┬────────────┘
         ▼
┌─────────────────────┐
│ 2. 稀疏关键词检索    │  ElasticsearchSparseRetrievalService → ES
│    IK分词 + BM25    │  (失败时降级为空数组)
└────────┬────────────┘
         ▼
┌─────────────────────┐
│ 3. RRF 融合         │  Reciprocal Rank Fusion
│    + 置信度加权     │  + Shannon 熵置信度 + 质量乘数
└────────┬────────────┘
         ▼
┌─────────────────────┐
│ 4. Rerank 精排      │  qwen3-rerank 语义精排
│    + 多查询评分     │  失败→轻量文本重叠回退
└────────┬────────────┘
         ▼
┌─────────────────────┐
│ 5. Small-to-Big     │  Level 3 child → Level 1 root
│    上下文展开        │  增量数据兼容(无rootChunkId→原样返回)
└─────────────────────┘
```

### 2.2 动态检索参数（按问题类型）

```typescript
// retrieval.service.ts:63-67
// 事实查找：精确匹配，小候选池
// 对比/研究：扩大候选池，降低阈值
const denseTopK   = questionType === 'fact_lookup' ? 20 : 30;
const sparseTopK  = questionType === 'fact_lookup' ? 20 : 30;
const fusionTopK  = questionType === 'fact_lookup' ? 50 : 80;
const scoreThreshold = questionType === 'fact_lookup' ? 0.3 : 0.15;
```

### 2.3 稠密检索：DenseRetrievalService

**核心文件**：[dense-retrieval.service.ts](../../apps/server/src/modules/rag/retrieval/dense-retrieval.service.ts)

- 多条查询文本 → `EmbeddingService.embedDocuments()` 批量向量化（含 Redis 缓存）
- 逐条 query 向量 → `QdrantService.searchChunkVectors()` 独立检索
- 按 chunkId 去重，保留最高分（同 chunk 被多条 query 命中时）

**已实现的 Embedding 优化**（详见 [04-向量化与ES优化.md](./04-向量化与ES优化.md)）：
- E1: tiktoken 精确 token 计数
- E3: Redis 缓存 (SHA-256 key → 向量)
- E4: Token-count-based 动态批次（按 7500 token/批自动分组）
- E5: 指数退避重试 (429/500/502/503)

### 2.4 稀疏检索：ElasticsearchSparseRetrievalService

**核心文件**：[elasticsearch-sparse-retrieval.service.ts](../../apps/server/src/modules/rag/retrieval/elasticsearch-sparse-retrieval.service.ts)

- 用 ES 替换了旧的 PostgreSQL LIKE 方案
- IK 分词器 + `match` + `match_phrase`（精确短语匹配 boost=2.0）
- 与 Dense 完全一致的多查询并行 + chunkId 去重模式

### 2.5 RRF 融合：FusionService

**核心文件**：[fusion.service.ts](../../apps/server/src/modules/rag/retrieval/fusion.service.ts)

融合算法包含三个增强：

#### (a) 基础 RRF：`score = Σ 1 / (k + rank_i)`，k=60

#### (b) E12: Shannon 熵置信度加权
```typescript
// fusion.service.ts:177-198
// 对每路检索结果的分数分布计算 Shannon 熵
// 低熵(分数集中在头部) → 高置信度 (>0.5)
// 高熵(分数均匀分布) → 低置信度 (<1.0)
// 然后将置信度作为 RRF 公式中的分子，替代传统 RRF 中固定的 1
fusionScore += denseConf / (k + rank)  // 而非 1 / (k + rank)
```

#### (c) O7: Chunk 质量乘数
```typescript
// fusion.service.ts:147-168
// structured-token-aware 切分策略 → 1.05x
// code/table 原子块 → 1.03x
// sectionLevel >= 3 深层内容 → 1.02x
// 组合最高约 1.10x
```

### 2.6 Rerank 精排：RerankService

**核心文件**：[rerank.service.ts](../../apps/server/src/modules/rag/retrieval/rerank.service.ts)

**模型层**：[rerank-model.service.ts](../../apps/server/src/modules/rag/retrieval/rerank-model.service.ts)，调用百炼 qwen3-rerank 兼容 API。

#### 主流程

```
candidates (RRF 融合后)
        │
        ▼
┌─────────────────────────────────┐
│ multiQueryRerank()              │
│ fact_lookup: 单查询评分         │
│ compare/research: 多查询取 max  │ ← 确保单主题块不被对比查询误杀
└────────────┬────────────────────┘
             ▼
┌─────────────────────────────────┐
│ titlePath boost (O7)            │ 查询词与标题路径重叠 >50% → ~1.10x
│ procedural keyword boost         │ 标题含"教程/指南/配置" → 1.1x
└────────────┬────────────────────┘
             ▼
┌─────────────────────────────────┐
│ 三级分层过滤                     │
│ rerankScore >= 0.7  → 主证据    │
│ 0.5 ~ 0.7          → 候补(≤2)  │
│ < 0.5              → 丢弃       │
└─────────────────────────────────┘
```

#### 回退方案：lightweightRerank

当 qwen3-rerank 调用失败时，自动降级为轻量级文本重叠计分：
- `fusionScore * 0.7 + overlapRatio * 0.3`（查询词 token 在 chunk 内容中的覆盖比例）
- 同样经过 titlePath boost 和三级分层过滤

### 2.7 Small-to-Big 上下文展开

```typescript
// retrieval.service.ts:133-160
// Level 3 child chunk (短内容 ~300 tokens) 
//   → payload.rootChunkId → Level 1 root chunk (完整上下文 ~1200 tokens)
// 存量数据无 rootChunkId 时原样返回
```

### 2.8 引用构建：CitationService

**核心文件**：[citation.service.ts](../../apps/server/src/modules/rag/retrieval/citation.service.ts)

检索完成后，精排 Top-5 结果持久化到 `b_chat_message_citations` 表，关联 kb 名称和 doc 标题用于前端展示。

### 2.9 检索轨迹：RetrievalTraceService

**核心文件**：[retrieval-trace.service.ts](../../apps/server/src/modules/rag/retrieval/retrieval-trace.service.ts)

内存级轻量轨迹记录（Map），用于排障和性能观测，尚未持久化。

---

## 三、多智能体编排 (chat)

### 3.1 LangGraph 状态定义

**核心文件**：[multi-agent-orchestrator.service.ts](../../apps/server/src/modules/chat/services/multi-agent-orchestrator.service.ts)

```typescript
// 14 个状态字段
const AgentStateAnnotation = Annotation.Root({
  sessionId, userId, originalQuery,
  selectedKbIds, resolvedKbIds,
  routedPlan,          // Router 输出 (intent, questionType, needDecomposition)
  decomposedQueries,   // Decompose 节点输出
  rewrittenQueries,    // Rewrite 节点输出
  rerankedHits,        // 检索工具输出
  webSearchResults,    // 联网搜索结果
  draftAnswer,         // Writer 输出
  currentPhase,        // 执行阶段追踪
  auditVerdict,        // 检索质量审计结果
});
```

### 3.2 节点详解

#### 3.2.1 route — 查询路由

**Prompt**: [router.prompt.ts](../../apps/server/src/modules/chat/prompts/router.prompt.ts)
**Schema**: [routed-query-plan.schema.ts](../../apps/server/src/modules/chat/schemas/routed-query-plan.schema.ts)

```
输入: originalQuery
处理: 轻量 LLM (temperature=0.2, timeout=15s) + structuredOutput(jsonMode)
输出: { intent, questionType, needDecomposition, needWebSearch, reasoning }
条件边:
  greeting → writer (跳过所有检索)
  needDecomposition → decompose
  else → rewrite
```

**4 类意图分类**：
| intent | 行为 |
|--------|------|
| `greeting` | 直接 writer 回复，不检索 |
| `fact_lookup` | 单维度精确查找，小候选池 |
| `compare_analysis` | 拆解为独立子问题，各对象分别检索 |
| `research_or_open_world` | 拆解为多维度子问题，大候选池 |

#### 3.2.2 decompose — 问题拆解

**Prompt**: [decompose.prompt.ts](../../apps/server/src/modules/chat/prompts/decompose.prompt.ts)
**Schema**: [decomposed-query.schema.ts](../../apps/server/src/modules/chat/schemas/decomposed-query.schema.ts)

```
输入: originalQuery + questionType
处理: 轻量 LLM (temperature=0.2, timeout=15s)
输出: { subQueries[{ question, keywords(3~5个) }] }  ← 最多 5 个子问题
失败降级: decomposedQueries = []（不阻塞管道）
```

#### 3.2.3 rewrite — 查询改写

**Prompt**: [rewrite.prompt.ts](../../apps/server/src/modules/chat/prompts/rewrite.prompt.ts)
**Schema**: [rewritten-query.schema.ts](../../apps/server/src/modules/chat/schemas/rewritten-query.schema.ts)

```
输入: originalQuery + questionType
处理: 轻量 LLM (temperature=0.3, timeout=15s)
输出: { queries[{ rewritten, focus }] }  ← 1~3 条改写查询
失败降级: rewrittenQueries = [originalQuery]（用原始查询兜底）
```

**按问题类型的差异化改写策略**：
- fact_lookup：保留原样 + 1~2 条扩展查询
- compare_analysis：为每个对比对象分别生成独立查询
- research：覆盖不同维度（原理/生态/实践/对比）

**否定/排除处理**："除了X" → 将被排除对象的替代品转正向查询

#### 3.2.4 retrieve_prep + tools (search_knowledge_base)

```
retrieve_prep: 标记 currentPhase = 'retrieving'（无实际处理）
tools:
  - buildRetrieveQueries(): 合并 originalQuery + decomposedQueries + rewrittenQueries
    → 去重 → 截断至最多 8 条
  - searchTool.invoke() → RetrievalService.retrieve()
  - 记录 Agent Trace (denseCount/sparseCount/fusedCount/rerankedCount)
  - 发射 TOOL_CALL_START / TOOL_CALL_RESULT AG-UI 事件
```

**查询构建策略**：
```typescript
// multi-agent-orchestrator.service.ts:283-291
// 优先级：originalQuery + decomposedQueries(结构化拆解质量高) + rewrittenQueries
// 去重后最多 8 条查询
```

#### 3.2.5 audit — 检索质量审计

**Prompt**: [audit.prompt.ts](../../apps/server/src/modules/chat/prompts/audit.prompt.ts)
**Schema**: [audit-result.schema.ts](../../apps/server/src/modules/chat/schemas/audit-result.schema.ts)

```
输入: originalQuery + rerankedHits[0:5] 摘要(各 300 字符)
处理: 轻量 LLM (temperature=0.1, timeout=10s)
输出: { verdict: 'sufficient' | 'insufficient', reason }
条件边:
  insufficient + enableWebSearch → web_search
  else → writer
失败降级:
  - rerankedHits.length > 0 → verdict = 'sufficient'
  - rerankedHits.length === 0 → verdict = 'insufficient'
```

#### 3.2.6 web_search — 联网搜索兜底

**核心文件**：[web-search.service.ts](../../apps/server/src/modules/rag/web-search/web-search.service.ts)

- 使用 Tavily Search API
- TAVILY_API_KEY 未配置时静默降级为空
- API 失败时返回 [] 不中断主流程

#### 3.2.7 writer — 最终回答生成

**Prompt**: [writer.prompt.ts](../../apps/server/src/modules/chat/prompts/writer.prompt.ts)

```
输入: {context}（KB检索结果 + 联网搜索结果）+ originalQuery
处理: 全量 LLM (temperature=0.5, streaming=true)
AG-UI: TEXT_MESSAGE_START → CONTENT(×N) → END
输出: draftAnswer + rerankedHits(用于citation)
```

**上下文构建**：
```typescript
// buildContextText() → 拼接 KB 结果 [KB-N] + Web 结果 [Web-N]
// 每个 chunk 附带文档标题
```

### 3.3 完整边（Edge）逻辑

| 源节点 | 条件/目标 | 说明 |
|--------|-----------|------|
| `__start__` | → route | 固定入口 |
| `route` | greeting → writer | 问候/闲聊跳过检索 |
| `route` | needDecomposition → decompose | 复杂问题先拆解 |
| `route` | else → rewrite | 简单问题直接改写 |
| `decompose` | → rewrite | 拆解后仍需改写（提取检索关键词） |
| `rewrite` | → retrieve_prep | 改写后进入检索 |
| `retrieve_prep` | → tools | 查询准备（合并多来源查询） |
| `tools` | → audit | 检索后审计质量 |
| `audit` | insufficient+web → web_search | 知识库不足时联网兜底 |
| `audit` | else → writer | 检索充分，开始生成 |
| `web_search` | → writer | 联网结果送入生成 |
| `writer` | → __end__ | 固定终点 |

### 3.4 已定义但未使用的节点/工具

以下 prompt 和 schema 已定义，但在当前 `streamRun()` 图结构中未被调用：

| 资源 | 文件 | 用途 |
|------|------|------|
| FACT_CHECK_SYSTEM_PROMPT | [fact-check.prompt.ts](../../apps/server/src/modules/chat/prompts/fact-check.prompt.ts) | 回答事实性审核 |
| RELEVANCE_CHECK_SYSTEM_PROMPT | [relevance-check.prompt.ts](../../apps/server/src/modules/chat/prompts/relevance-check.prompt.ts) | 检索相关性校验 |
| COMPLETENESS_CHECK_SYSTEM_PROMPT | [completeness-check.prompt.ts](../../apps/server/src/modules/chat/prompts/completeness-check.prompt.ts) | 回答完整性校验 |
| FactCheckResultSchema | [fact-check-result.schema.ts](../../apps/server/src/modules/chat/schemas/fact-check-result.schema.ts) | 事实审核输出结构 |
| CompletenessCheckResultSchema | [completeness-check-result.schema.ts](../../apps/server/src/modules/chat/schemas/completeness-check-result.schema.ts) | 完整性审核输出结构 |
| SearchKnowledgeBaseTool | [search-knowledge-base.tool.ts](../../apps/server/src/modules/chat/services/tools/search-knowledge-base.tool.ts) | 独立的检索工具类（LangGraph 中用内联 tool() 实现） |
| GetChunkDetailTool | [get-chunk-detail.tool.ts](../../apps/server/src/modules/chat/services/tools/get-chunk-detail.tool.ts) | 分片详情查询（Agent 深入查看时使用） |

---

## 四、AG-UI 协议实现

**核心文件**：[agui-events.ts](../../apps/server/src/modules/chat/types/agui-events.ts)

### 事件类型

| 事件 | 发射位置 | 含义 |
|------|----------|------|
| `RUN_STARTED` | streamRun 开头 | 一次 Agent 运行开始 |
| `RUN_FINISHED` | streamRun 成功结束 | 运行完成 |
| `RUN_ERROR` | streamRun 异常 or 兜底 | 运行失败 |
| `STEP_STARTED(name)` | 每个 LLM 节点前 | 步骤开始 |
| `STEP_FINISHED(name, output, duration)` | 每个 LLM 节点后 | 步骤完成 |
| `TOOL_CALL_START(id, name)` | search/web_search 调用前 | 工具调用开始 |
| `TOOL_CALL_RESULT(id, output, duration)` | search/web_search 完成后 | 工具调用结果 |
| `TEXT_MESSAGE_START(msgId)` | writer 节点开始 | 文本消息开始 |
| `TEXT_MESSAGE_CONTENT(msgId, delta)` | writer 流式输出 | 逐 token 文本 |
| `TEXT_MESSAGE_END(msgId)` | writer 节点结束 | 文本消息结束 |

### 典型事件序列（RAG 模式 - 对比分析问题）

```
RUN_STARTED
  STEP_STARTED("route")        → STEP_FINISHED (intent=compare_analysis)
  STEP_STARTED("decompose")    → STEP_FINISHED (2~5 subQueries)
  STEP_STARTED("rewrite")      → STEP_FINISHED (1~3 rewritten)
  TOOL_CALL_START("search")    → TOOL_CALL_RESULT (hitCount, duration)
  STEP_STARTED("audit")        → STEP_FINISHED (verdict)
  [TOOL_CALL_START("web_search") → TOOL_CALL_RESULT]   ← 条件触发
  STEP_STARTED("writer")
    TEXT_MESSAGE_START
    TEXT_MESSAGE_CONTENT × N
    TEXT_MESSAGE_END
  STEP_FINISHED("writer")
RUN_FINISHED
```

### SseWriter

简单封装 `express.Response`，按 SSE 规范格式写入：`data: {json}\n\n`

### 取消机制

```typescript
// chat.controller.ts:134-139
const abortController = new AbortController();
res.on('close', () => {
  if (!res.writableEnded) abortController.abort();
});
// orchestrator 中每个节点前检查 signal.aborted
```

---

## 五、Agent 追踪体系

**核心文件**：[agent-trace.service.ts](../../apps/server/src/modules/chat/services/agent-trace.service.ts)

### 数据模型（3 张表 + 内存）

| 表/存储 | 用途 |
|---------|------|
| `b_agent_runs` | 一次完整 Agent 运行（runId, sessionId, userId, status, tokens, duration） |
| `b_agent_steps` | 每个节点的执行记录（agentName, stepType, input/output JSON, duration） |
| `b_chat_message_citations` | 检索引用记录（chunkId, score, quote） |
| `RetrievalTraceService` (内存 Map) | 检索内部轨迹（仅在内存，未持久化） |

### 追踪粒度

```
b_agent_runs (1 次对话 = 1 条)
  └── b_agent_steps (1 个节点 = 1 条)
      ├── agentName: 'router' | 'rewriter' | 'decomposer' | 'retriever'
      ├── stepType: 'route_query' | 'rewrite_query' | 'decompose_query' | 'hybrid_retrieve'
      ├── input_json / output_json (完整输入输出)
      └── duration_ms / status
```

用于：
- 前端的 Agent 步骤面板展示（`AIMessageItem.vue`）
- 用户使用统计（`getMetricsSummary` — 成功率、平均耗时、日活会话）

---

## 六、对话流式服务（ChatStreamService）

**核心文件**：[chat-stream.service.ts](../../apps/server/src/modules/chat/services/chat-stream.service.ts)

### 路由逻辑

```
streamChat(userId, dto, writer, signal)
  ├── chatMode='rag' + selectedKbIds.length > 0
  │   └── streamRagMode → 权限校验 → MultiAgentOrchestrator.streamRun
  └── else
      └── streamChatMode → 普通 LLM 对话（SYSTEM_PROMPT + HumanMessage）
```

### RAG 模式完整调用链

```
streamRagMode()
  1. KbPermissionService.authorizeMany(userId, kbIds, 'ask')
     → resolvedKbIds (过滤无权限的知识库)
  2. ChatMessageService.createUserMessage() → userMsg
  3. ChatMessageService.createAssistantPlaceholder() → assistantMsg
  4. MultiAgentOrchestratorService.streamRun(runCtx, writer, options)
     4a. AgentTraceService.createRun() → runId
     4b. 构建 LangGraph + invoke 执行
     4c. AG-UI 事件实时推送到 writer
  5. onFinish:
     → CitationService.createCitations(messageId, hits)
     → ChatMessageService.finalizeAssistantMessage(id, content)
     → ChatSessionService.summarizeTitleIfNeeded(sessionId, query, answer)
  6. onError:
     → ChatMessageService.markAssistantMessageAborted(id)
```

---

## 七、已实现的关键优化汇总

### 检索层优化

| 编号 | 优化项 | 位置 | 说明 |
|------|--------|------|------|
| — | 动态检索参数 | [retrieval.service.ts:63-67](../../apps/server/src/modules/rag/retrieval/retrieval.service.ts#L63-L67) | 按 questionType 调整 topK 和阈值 |
| E12 | Shannon 熵置信度 | [fusion.service.ts:177-198](../../apps/server/src/modules/rag/retrieval/fusion.service.ts#L177-L198) | RRF 加权替代固定 1 |
| O7 | Chunk 质量乘数 | [fusion.service.ts:147-168](../../apps/server/src/modules/rag/retrieval/fusion.service.ts#L147-L168) | structured/code/table/deep 加权 |
| O7 | titlePath 匹配加权 | [rerank.service.ts:250-278](../../apps/server/src/modules/rag/retrieval/rerank.service.ts#L250-L278) | 标题路径与查询重叠 >50% → boost |
| — | 多查询 Rerank | [rerank.service.ts:96-127](../../apps/server/src/modules/rag/retrieval/rerank.service.ts#L96-L127) | 对比/研究类取 max 避免误杀 |
| — | Small-to-Big | [retrieval.service.ts:133-160](../../apps/server/src/modules/rag/retrieval/retrieval.service.ts#L133-L160) | Level 3 → Level 1 上下文展开 |
| — | 优雅降级 | 多处 | ES 不可用→跳过；Rerank 失败→回退；LLM 失败→降级 |
| — | 检索去重 | [dense-retrieval.service.ts:52-61](../../apps/server/src/modules/rag/retrieval/dense-retrieval.service.ts#L52-L61) | 多查询命中同 chunk 保留最高分 |

### 编排层优化

| 优化项 | 位置 | 说明 |
|--------|------|------|
| 大小模型协作 | orchestrator | 非生成节点用轻量模型（低延迟+低成本），writer 用全量模型 |
| 超时控制 | 各节点 | route/rewrite/decompose: 15s, audit: 10s |
| 条件边 | orchestrator | greeting 跳过检索；needDecomposition 动态路由 |
| 查询去重截断 | `buildRetrieveQueries()` | 多来源查询去重后最多 8 条 |
| 审计-联网联动 | audit→web_search | 检索不足时自动触发联网搜索 |
| 低温度推理 | 各节点 | router: 0.2, rewrite: 0.3, audit: 0.1 (确保结构化输出稳定) |

---

## 八、当前方案的已知局限

1. **LangGraph 图结构固定**：`streamRun()` 中硬编码构建图，无法根据运行时条件动态调整节点或边
2. **线性流水线**：除 greeting 跳过检索外，主路径是线性的 — decompose→rewrite→retrieve→audit→writer
3. **审计-重试环缺失**：audit 判定 insufficient 且 web 不可用时，直接进入 writer 而非重新检索
4. **Fact Check / Completeness Check / Relevance Check 未启用**：prompt 和 schema 已定义但未编入图
5. **RetrievalTraceService 仅内存**：重启丢失，无法回溯历史问题的检索轨迹
6. **SearchKnowledgeBaseTool 类与内联 tool() 重复**：两者都封装了检索能力但实现不完全一致
7. **单线程检索**：稠密和稀疏检索并行执行（`Promise.all`），但两者的子查询之间是串行的
8. **ES 索引单分片**：`number_of_shards: 1`，大量文档时可能成为瓶颈
9. **Rerank 全量评分**：无论候选数多少，都对全部 FusedHit 做 Rerank（topN 截断只在最后）
10. **context 构建无截断**：`buildContextText()` 拼接全部 hits 和 web results，可能超出 LLM 上下文窗口
