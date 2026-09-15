import { ChunkerService } from '@app/modules/ingestion/pipeline/chunker.service';
import { MarkdownParserService } from '@app/modules/ingestion/pipeline/markdown-parser.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';

const config = {
  schemaVersion: 1,
  tokenizer: { name: 'cl100k_base', version: 'tiktoken-1.0.22' },
  rootTokenLimit: 30,
  parentTokenLimit: 18,
  childTokenLimit: 12,
  overlapTokens: 2,
  titlePrefix: '> 路径：',
};

function markdownParser() {
  return new MarkdownParserService({
    parser: {
      maxBytes: 1024 * 1024,
      maxZipFiles: 100,
      maxUncompressedBytes: 10 * 1024 * 1024,
    },
  } as RuntimeConfig);
}

describe('三级 AST 分块', () => {
  it('输出稳定层级、遵守 Token 上限并保留 UTF-16 来源', () => {
    const ast = markdownParser().parseMarkdown(
      '# 第一章\n\n中文😀组合é与较长正文，用于验证重叠切片和来源位置。',
      'test',
    );
    const service = new ChunkerService();
    const first = service.createChunks(ast, config);
    const second = service.createChunks(ast, config);
    expect(second).toEqual(first);
    expect(new Set(first.map((item) => item.chunkLevel))).toEqual(
      new Set([1, 2, 3]),
    );
    expect(
      first.every(
        (item) =>
          item.tokenCount <=
          config[
            `${item.chunkLevel === 1 ? 'root' : item.chunkLevel === 2 ? 'parent' : 'child'}TokenLimit`
          ],
      ),
    ).toBe(true);
    for (const chunk of first) {
      expect(first[chunk.rootIndex].chunkLevel).toBe(1);
      if (chunk.chunkLevel === 3) {
        expect(chunk.parentIndex).not.toBeNull();
        const exact = chunk.metadata.sourceSpans.find((span) => !span.derived);
        expect(ast.markdown.slice(exact?.start, exact?.end)).not.toBe('');
        expect(chunk.metadata.sourceSpans.some((span) => span.derived)).toBe(
          true,
        );
      }
    }
  });

  it('Markdown 哈希不一致时拒绝解释旧范围', () => {
    const ast = markdownParser().parseMarkdown('正文', 'test');
    expect(() =>
      new ChunkerService().createChunks({ ...ast, markdown: '已变化' }, config),
    ).toThrow('Markdown 来源版本不匹配');
  });

  it('大文档保留全部 Level 1 分片，并把父子 Chunk 关联到对应根块', () => {
    const ast = markdownParser().parseMarkdown(
      '长文😀正文与来源。'.repeat(60),
      'test',
    );
    const chunks = new ChunkerService().createChunks(ast, config);
    const roots = chunks.filter((chunk) => chunk.chunkLevel === 1);
    expect(roots.length).toBeGreaterThan(1);
    expect(roots.map((root) => root.content).join('')).toBe(ast.markdown);
    expect(
      chunks
        .filter((chunk) => chunk.chunkLevel === 2)
        .some((chunk) => chunk.rootIndex > 0),
    ).toBe(true);
    for (const chunk of chunks) {
      expect(chunks[chunk.rootIndex].chunkLevel).toBe(1);
      if (chunk.chunkLevel === 3)
        expect(chunk.rootIndex).toBe(chunks[chunk.parentIndex!].rootIndex);
    }
  });
});
