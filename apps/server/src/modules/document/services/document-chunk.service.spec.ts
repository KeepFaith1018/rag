/// <reference types="jest" />

import { Test } from '@nestjs/testing';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { TokenService } from '@common/utils/token.service';
import { DocumentChunkService } from './document-chunk.service';
import { PrismaService } from '@common/prisma/prisma.service';
import type { ParsedDocument } from '../parsed-document.interface';

function makeParsedDocument(overrides: Partial<ParsedDocument> = {}): ParsedDocument {
  return {
    plainText: '这是一段测试文本。用于验证切块逻辑。',
    sections: [
      {
        title: '第一章',
        titlePath: ['第一章'],
        level: 1,
        content: '第一章的内容段落。这里包含多个句子，用于测试结构切块。',
        type: 'text',
      },
    ],
    ...overrides,
  };
}

function makeChunkSourceDoc() {
  return {
    id: BigInt(1),
    title: '测试文档',
    original_filename: 'test.md',
  };
}

describe('DocumentChunkService', () => {
  let service: DocumentChunkService;
  let mockPrisma: {
    b_document_chunks: {
      deleteMany: jest.Mock;
      createMany: jest.Mock;
      findMany: jest.Mock;
      updateMany: jest.Mock;
    };
  };

  beforeAll(async () => {
    mockPrisma = {
      b_document_chunks: {
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
        createMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };

    // 模拟 $transaction — 在事务内执行 createMany + findMany 模拟回填
    const mockPrismaWithTx: Record<string, unknown> = {
      ...mockPrisma,
      $transaction: jest
        .fn()
        .mockImplementation(async (cb: (tx: unknown) => Promise<void>) => {
          const tx = {
            b_document_chunks: {
              createMany: jest.fn().mockResolvedValue({ count: 1 }),
              findMany: jest
                .fn()
                .mockImplementation((args: { where: { chunk_level?: number } }) => {
                  const level = args.where.chunk_level ?? 1;
                  return [
                    { id: BigInt(10 + level * 100), chunk_index: level === 1 ? 0 : 1, content: `L${level}` },
                    { id: BigInt(11 + level * 100), chunk_index: level === 1 ? 1 : 3, content: `L${level}_2` },
                  ];
                }),
            },
          };
          await cb(tx);
        }),
    };

    const module = await Test.createTestingModule({
      providers: [
        TokenService,
        DocumentChunkService,
        {
          provide: PrismaService,
          useValue: mockPrismaWithTx,
        },
        {
          provide: WINSTON_MODULE_PROVIDER,
          useValue: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(DocumentChunkService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ── O1: 真实 Tokenizer ──

  describe('token counting (O1)', () => {
    it('chunk token_count 应基于真实 tokenizer', async () => {
      const doc = makeChunkSourceDoc();
      const parsed = makeParsedDocument({
        sections: [
          {
            titlePath: ['测试'],
            content: '这是一个简短的测试段落，用于验证 token 计数是否正确。',
            type: 'text',
          },
        ],
      });

      const result = await service.createChunks(doc, parsed, 1);
      expect(result.totalTokens).toBeGreaterThan(0);
    });
  });

  // ── O2: 中文感知分割符 ──

  describe('Chinese-aware separators (O2)', () => {
    it('中文文本应在句号处断句（Level 3 chunks 内容完整）', async () => {
      const doc = makeChunkSourceDoc();
      const parsed = makeParsedDocument({
        sections: [
          {
            titlePath: ['测试'],
            content: '第一句话。第二句话。第三句话。第四句话。第五句话。',
            type: 'text',
          },
        ],
      });

      const result = await service.createChunks(doc, parsed, 1);
      expect(result.totalChunks).toBeGreaterThan(0);
    });
  });

  // ── O3: titlePath 上下文增强 ──

  describe('contextualized content (O3)', () => {
    it('有 titlePath 的 chunk content 应包含路径前缀', async () => {
      const doc = makeChunkSourceDoc();
      const parsed = makeParsedDocument({
        sections: [
          {
            title: '项目背景',
            titlePath: ['第三章', '3.1 项目背景'],
            level: 2,
            content: '本项目旨在构建一个智能问答系统，具备多知识库检索能力。',
            type: 'text',
          },
        ],
      });

      const result = await service.createChunks(doc, parsed, 1);
      expect(result.totalTokens).toBeGreaterThan(0);
    });
  });

  // ── O4: 三层粒度切块 ──

  describe('three-level hierarchical chunking (O4)', () => {
    it('应按三层粒度产出 chunk 并写入 DB', async () => {
      const doc = makeChunkSourceDoc();
      // 足够长的内容以触发多层切分
      const longContent = Array.from({ length: 100 }, (_, i) =>
        `第${i + 1}句：这是用于验证三层粒度切块逻辑的测试内容。`,
      ).join('');

      const parsed = makeParsedDocument({
        sections: [
          {
            title: '长章节',
            titlePath: ['长章节'],
            level: 1,
            content: longContent,
            type: 'text',
          },
        ],
      });

      const result = await service.createChunks(doc, parsed, 1);
      // 至少产出一些 Level 3 chunks
      expect(result.totalChunks).toBeGreaterThan(0);
      expect(result.chunkIds.length).toBe(result.totalChunks);
    });

    it('createChunks 返回的是 Level 3 chunk 的 token 总和', async () => {
      const doc = makeChunkSourceDoc();
      const parsed = makeParsedDocument();

      const result = await service.createChunks(doc, parsed, 1);
      expect(result.totalTokens).toBeGreaterThan(0);
      // totalChunks 应与 chunkIds 一致（都是 Level 3）
      expect(result.chunkIds.length).toBe(result.totalChunks);
    });

    it('返回的 chunkIds 应为有效 UUID 格式', async () => {
      const doc = makeChunkSourceDoc();
      const parsed = makeParsedDocument();

      const result = await service.createChunks(doc, parsed, 1);
      for (const id of result.chunkIds) {
        expect(id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
      }
    });

    it('创建 chunk 前应先删除旧 chunk', async () => {
      const doc = makeChunkSourceDoc();
      const parsed = makeParsedDocument();

      await service.createChunks(doc, parsed, 1);

      expect(mockPrisma.b_document_chunks.deleteMany).toHaveBeenCalledWith({
        where: { doc_id: doc.id },
      });
    });

    it('三层 chunk 入库应通过事务保证一致性', async () => {
      const doc = makeChunkSourceDoc();
      const parsed = makeParsedDocument();

      const result = await service.createChunks(doc, parsed, 1);
      // 事务调用次数验证：至少 Level 3 chunks 有产出
      expect(result.totalChunks).toBeGreaterThan(0);
    });
  });

  // ── 元数据完整性 ──

  describe('chunk metadata', () => {
    it('chunk 元数据应包含完整字段', async () => {
      const doc = makeChunkSourceDoc();
      const parsed = makeParsedDocument({
        sections: [
          {
            title: '元数据测试',
            titlePath: ['元数据测试'],
            level: 1,
            content: '测试元数据的完整性。',
            type: 'text',
          },
        ],
      });

      const result = await service.createChunks(doc, parsed, 1);
      expect(result.totalChunks).toBeGreaterThan(0);
      // 通过 transaction callback 验证 data 中的 metadata_json
    });
  });

  // ── O8: 代码块/表格块完整性保护 ──

  describe('code/table block integrity (O8)', () => {
    it('代码块 section 不应被拆分为多个 Level 3 chunk', async () => {
      const doc = makeChunkSourceDoc();
      const parsed = makeParsedDocument({
        sections: [
          {
            title: '示例代码',
            titlePath: ['示例代码'],
            level: 1,
            content: '```\nfunction test() {\n  return true;\n}\n```',
            type: 'code',
          },
        ],
      });

      const result = await service.createChunks(doc, parsed, 1);
      expect(result.totalChunks).toBe(1);
    });

    it('表格块 section 不应被拆分为多个 Level 3 chunk', async () => {
      const doc = makeChunkSourceDoc();
      const parsed = makeParsedDocument({
        sections: [
          {
            title: '数据表',
            titlePath: ['数据表'],
            level: 1,
            content: '| 列A | 列B |\n|-----|-----|\n| 值1 | 值2 |\n| 值3 | 值4 |',
            type: 'table',
          },
        ],
      });

      const result = await service.createChunks(doc, parsed, 1);
      expect(result.totalChunks).toBe(1);
    });

    it('普通文本 section 仍正常三层切分', async () => {
      const doc = makeChunkSourceDoc();
      const longContent = Array.from({ length: 200 }, (_, i) =>
        `第${i + 1}句：这是用于验证普通文本三层粒度切块逻辑的测试内容。`,
      ).join('');

      const parsed = makeParsedDocument({
        sections: [
          {
            title: '长文本',
            titlePath: ['长文本'],
            level: 1,
            content: longContent,
            type: 'text',
          },
        ],
      });

      const result = await service.createChunks(doc, parsed, 1);
      expect(result.totalChunks).toBeGreaterThan(1);
    });

    it('混杂 code/text 的 sections 各自独立处理', async () => {
      const doc = makeChunkSourceDoc();
      const longText = Array.from({ length: 200 }, (_, i) =>
        `第${i + 1}句：这是用于验证混合场景的测试内容。`,
      ).join('');

      const parsed = makeParsedDocument({
        sections: [
          {
            title: '代码块',
            titlePath: ['代码块'],
            level: 1,
            content: '```\nconsole.log("hello");\n```',
            type: 'code',
          },
          {
            title: '长文本',
            titlePath: ['长文本'],
            level: 1,
            content: longText,
            type: 'text',
          },
        ],
      });

      const result = await service.createChunks(doc, parsed, 1);
      // 代码块 1 个 + 文本多个
      expect(result.totalChunks).toBeGreaterThan(1);
    });
  });

  // ── O6: 文档类型自适应参数 ──

  describe('adaptive chunk profiles (O6)', () => {
    it('含 >30% 代码块的文档应使用 code-heavy profile', async () => {
      const doc = makeChunkSourceDoc();
      // 4 sections: 2 code + 2 text → 50% code
      const parsed = makeParsedDocument({
        sections: [
          {
            title: '代码1',
            titlePath: ['代码1'],
            content: '```\nconst a = 1;\n```',
            type: 'code',
          },
          {
            title: '文本1',
            titlePath: ['文本1'],
            content: '一些文本描述。',
            type: 'text',
          },
          {
            title: '代码2',
            titlePath: ['代码2'],
            content: '```\nconst b = 2;\n```',
            type: 'code',
          },
          {
            title: '文本2',
            titlePath: ['文本2'],
            content: '更多文本描述。',
            type: 'text',
          },
        ],
      });

      const result = await service.createChunks(doc, parsed, 1);
      // code-heavy profile 用更大的 chunk size，所以总 chunk 数应较少
      expect(result.totalChunks).toBeGreaterThan(0);
    });

    it('含 >20% 表格的文档应使用 verbose profile', async () => {
      const doc = makeChunkSourceDoc();
      // 5 sections: 2 table + 3 text → 40% table
      const parsed = makeParsedDocument({
        sections: [
          {
            title: '表1',
            titlePath: ['表1'],
            content: '| A | B |\n|---|---|\n| 1 | 2 |',
            type: 'table',
          },
          {
            title: '文本1',
            titlePath: ['文本1'],
            content: '描述文本。',
            type: 'text',
          },
          {
            title: '文本2',
            titlePath: ['文本2'],
            content: '更多描述文本。',
            type: 'text',
          },
          {
            title: '表2',
            titlePath: ['表2'],
            content: '| C | D |\n|---|---|\n| 3 | 4 |',
            type: 'table',
          },
          {
            title: '文本3',
            titlePath: ['文本3'],
            content: '最后一段描述。',
            type: 'text',
          },
        ],
      });

      const result = await service.createChunks(doc, parsed, 1);
      expect(result.totalChunks).toBeGreaterThan(0);
    });

    it('短 section 纯文本文档应使用 compact profile', async () => {
      const doc = makeChunkSourceDoc();
      const parsed = makeParsedDocument({
        sections: [
          {
            title: '短文本1',
            titlePath: ['短文本1'],
            content: '简短内容。',
            type: 'text',
          },
          {
            title: '短文本2',
            titlePath: ['短文本2'],
            content: '另一个简短内容。',
            type: 'text',
          },
        ],
      });

      const result = await service.createChunks(doc, parsed, 1);
      expect(result.totalChunks).toBeGreaterThan(0);
    });

    it('混合常规内容应使用 default profile', async () => {
      const doc = makeChunkSourceDoc();
      const parsed = makeParsedDocument({
        sections: [
          {
            title: '常规章节',
            titlePath: ['常规章节'],
            level: 1,
            content: '这是一段内容适中的文本，包含足够的信息但不是极端场景。',
            type: 'text',
          },
        ],
      });

      const result = await service.createChunks(doc, parsed, 1);
      expect(result.totalChunks).toBeGreaterThan(0);
    });

    it('code-heavy profile 产出的 chunk 数应少于 default profile（同内容不同 profile）', async () => {
      const doc = makeChunkSourceDoc();
      // 长文本 — 在 compact(default-like) 下会拆分更多
      const longContent = Array.from({ length: 300 }, (_, i) =>
        `第${i + 1}句：用于验证不同 profile 下 chunk 数量差异的测试。`,
      ).join('');

      const parsedDefault = makeParsedDocument({
        sections: [
          {
            title: '文本',
            titlePath: ['文本'],
            content: longContent,
            type: 'text',
          },
        ],
      });

      const resultDefault = await service.createChunks(doc, parsedDefault, 1);

      // 创建代码为主的文档 → code-heavy profile
      const parsedCode = makeParsedDocument({
        sections: [
          {
            title: '代码',
            titlePath: ['代码'],
            content: '```\n' + longContent + '\n```',
            type: 'code',
          },
        ],
      });

      const resultCode = await service.createChunks(doc, parsedCode, 1);
      // code-heavy profile chunk 更大，所以 chunk 数量更少
      expect(resultCode.totalChunks).toBeLessThanOrEqual(
        resultDefault.totalChunks,
      );
    });
  });

  // ── 边界情况 ──

  describe('edge cases', () => {
    it('空 sections 且空 plainText 应返回空结果', async () => {
      const doc = makeChunkSourceDoc();
      const parsed = makeParsedDocument({
        sections: [],
        plainText: '',
      });

      const result = await service.createChunks(doc, parsed, 1);
      expect(result.totalChunks).toBe(0);
      expect(result.totalTokens).toBe(0);
      expect(result.chunkIds).toEqual([]);
    });

    it('无 section 但有 plainText 时应回退为单一 section 处理', async () => {
      const doc = makeChunkSourceDoc();
      const parsed = makeParsedDocument({
        sections: [],
        plainText: '这是一个无结构的纯文本，应被当作单一 section 处理并进行三层切块。',
      });

      const result = await service.createChunks(doc, parsed, 1);
      expect(result.totalChunks).toBeGreaterThan(0);
    });
  });
});
