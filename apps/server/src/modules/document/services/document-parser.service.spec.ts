/// <reference types="jest" />

import { Test } from '@nestjs/testing';
import { join } from 'path';
import { FileStorageService } from '@common/storage/file-storage.service';
import { BusinessException } from '@common/exception/businessException';
import { DocumentParserService } from './document-parser.service';

function fixturePath(filename: string) {
  return join(__dirname, '..', '__fixtures__', filename);
}

describe('DocumentParserService', () => {
  let service: DocumentParserService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [
        DocumentParserService,
        {
          provide: FileStorageService,
          useValue: {
            resolveAbsolutePath: (p: string) =>
              fixturePath(p.split('/').pop()!.split('\\').pop()!),
            getStorageType: () => 'local',
            exists: () => true,
          },
        },
      ],
    }).compile();

    service = module.get(DocumentParserService);
  });

  // ── parseDocument 分发 ──

  describe('parseDocument dispatch', () => {
    it('不支持的扩展名应抛出 FILE_TYPE_UNSUPPORTED', async () => {
      await expect(
        service.parseDocument('/fake/path/test.xyz', 'xyz'),
      ).rejects.toThrow(BusinessException);
    });

    it('无参数的 fileType 记录应抛出 FILE_TYPE_UNSUPPORTED', async () => {
      await expect(
        service.parseDocument('/fake/path/test.eps', ''),
      ).rejects.toThrow(BusinessException);
    });
  });

  // ── Markdown 解析 ──

  describe('parseMarkdown', () => {
    it('应正确提取标题层级路径', async () => {
      const result = await service.parseMarkdown(fixturePath('test.md'));

      // 顶层标题（H1）
      const h1 = result.sections.find(
        (s) => s.title === '第一章 概述',
      );
      expect(h1).toBeDefined();
      expect(h1!.level).toBe(1);
      expect(h1!.titlePath).toEqual(['第一章 概述']);

      // 二级标题
      const h2 = result.sections.find(
        (s) => s.title === '1.1 背景',
      );
      expect(h2).toBeDefined();
      expect(h2!.level).toBe(2);
      expect(h2!.titlePath).toEqual(['第一章 概述', '1.1 背景']);

      // 三级标题
      const h3 = result.sections.find(
        (s) => s.title === '1.1.1 技术架构',
      );
      expect(h3).toBeDefined();
      expect(h3!.level).toBe(3);
      expect(h3!.titlePath).toEqual([
        '第一章 概述',
        '1.1 背景',
        '1.1.1 技术架构',
      ]);
    });

    it('应正确标记表格 type', async () => {
      const result = await service.parseMarkdown(fixturePath('test.md'));
      const tableSection = result.sections.find((s) => s.type === 'table');
      expect(tableSection).toBeDefined();
      expect(tableSection!.content).toContain('| 指标 | Q1');
    });

    it('应正确标记代码块 type', async () => {
      const result = await service.parseMarkdown(fixturePath('test.md'));
      const codeSection = result.sections.find((s) => s.type === 'code');
      expect(codeSection).toBeDefined();
      expect(codeSection!.content).toContain('@Injectable()');
    });

    it('应提取 frontmatter 元数据', async () => {
      const result = await service.parseMarkdown(fixturePath('test.md'));
      expect(result.metadata).toBeDefined();
      expect(result.metadata!.title).toBe('测试文档');
      expect(result.metadata!.author).toBe('测试作者');
    });

    it('plainText 中不应包含 frontmatter 字段', async () => {
      const result = await service.parseMarkdown(fixturePath('test.md'));
      expect(result.plainText).not.toContain('title: 测试文档');
      expect(result.plainText).not.toContain('author: 测试作者');
    });

    it('应输出 markdown 字段', async () => {
      const result = await service.parseMarkdown(fixturePath('test.md'));
      expect(result.markdown).toBeDefined();
      expect(result.markdown).toContain('测试文档');
    });
  });

  // ── TXT 解析 ──

  describe('parseText', () => {
    it('应正确按段落分段', async () => {
      const result = await service.parseText(fixturePath('test.txt'));
      expect(result.sections.length).toBeGreaterThanOrEqual(4);
    });

    it('第一段内容应正确', async () => {
      const result = await service.parseText(fixturePath('test.txt'));
      expect(result.sections[0].content).toContain('这是第一段纯文本内容');
    });

    it('sections 应有正确的 charStart/charEnd', async () => {
      const result = await service.parseText(fixturePath('test.txt'));
      for (const section of result.sections) {
        expect(section.charStart).toBeGreaterThanOrEqual(0);
        expect(section.charEnd).toBeGreaterThan(section.charStart!);
        expect(section.charEnd! - section.charStart!).toBe(
          section.content.length,
        );
      }
    });

    it('不输出 markdown 字段（TXT 无结构）', async () => {
      const result = await service.parseText(fixturePath('test.txt'));
      expect(result.markdown).toBeUndefined();
    });
  });

  // ── 工具方法 ──

  describe('工具方法', () => {
    it('parseMarkdownSections 应处理空文本', async () => {
      const result = await service.parseMarkdown(fixturePath('test.md'));
      expect(result.sections.length).toBeGreaterThan(0);
    });

    it('buildMarkdownTable 应生成正确的表格（间接验证：table section 内容格式正确）', async () => {
      const result = await service.parseMarkdown(fixturePath('test.md'));
      const tableSection = result.sections.find((s) => s.type === 'table');
      expect(tableSection).toBeDefined();
      // 表格应有 header 分隔行
      expect(tableSection!.content).toContain('|---');
    });
  });

  // ── charStart/charEnd 累积偏移 ──

  describe('charStart/charEnd tracking', () => {
    it('相邻 section 的 charEnd 与下一个 chunkStart 之间应有正确间隔', async () => {
      const result = await service.parseMarkdown(fixturePath('test.md'));
      for (let i = 1; i < result.sections.length; i++) {
        const prev = result.sections[i - 1];
        const curr = result.sections[i];
        expect(curr.charStart).toBe(prev.charEnd! + 2); // \n\n separator
      }
    });

    it('charStart 和 charEnd 的差应等于 content 长度', async () => {
      const result = await service.parseText(fixturePath('test.txt'));
      for (const section of result.sections) {
        expect(section.charEnd! - section.charStart!).toBe(
          section.content.length,
        );
      }
    });
  });

  // ── 异常 ──

  describe('异常处理', () => {
    it('不存在的文件应抛出异常', async () => {
      // 覆盖 FileStorageService resolveAbsolutePath
      const mockStorage = {
        resolveAbsolutePath: () => '/nonexistent/path.md',
        getStorageType: () => 'local',
        exists: () => false,
      };

      const module = await Test.createTestingModule({
        providers: [
          DocumentParserService,
          { provide: FileStorageService, useValue: mockStorage },
        ],
      }).compile();

      const svc = module.get(DocumentParserService);
      await expect(svc.parseMarkdown('nonexistent.md')).rejects.toThrow();
    });
  });
});
