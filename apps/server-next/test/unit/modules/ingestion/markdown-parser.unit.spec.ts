import { MarkdownParserService } from '@app/modules/ingestion/pipeline/markdown-parser.service';
import { RuntimeConfig } from '@platform/config/runtime-config.service';
import { ErrorCode } from '@shared/errors/error-code';

jest.mock('pdf-parse', () => ({
  PDFParse: jest.fn().mockImplementation(() => ({
    getText: jest.fn().mockResolvedValue({ text: '# PDF 标题\n\nPDF 正文' }),
    destroy: jest.fn().mockResolvedValue(undefined),
  })),
}));

function parser() {
  return new MarkdownParserService({
    parser: {
      maxBytes: 1024 * 1024,
      maxZipFiles: 100,
      maxUncompressedBytes: 10 * 1024 * 1024,
    },
  } as RuntimeConfig);
}

describe('统一 Markdown AST parser', () => {
  it('使用 pdf-parse 解析 PDF，并将结果视为正常解析产物', async () => {
    const result = await parser().parse(Buffer.from('%PDF-1.7'), {
      extension: '.pdf',
      documentId: '1',
      processingRunId: '2',
    });

    expect(result).toMatchObject({
      parser: 'pdf-parse',
      degraded: false,
      warnings: [],
    });
    expect(result.markdown).toBe('# PDF 标题\n\nPDF 正文');
    expect(result.root.children.map((item) => item.type)).toEqual([
      'heading',
      'paragraph',
    ]);
  });

  it('规范化 BOM/CRLF 并保持 Emoji 的 UTF-16 来源范围可回放', async () => {
    const result = await parser().parse(
      Buffer.from('\ufeff# 标题\r\n\r\n正文😀组合e\u0301'),
      { extension: '.md', documentId: '1', processingRunId: '2' },
    );
    expect(result.markdown).toBe('# 标题\n\n正文😀组合é');
    for (const item of result.root.children) {
      expect(
        result.markdown.slice(item.source?.start, item.source?.end),
      ).toContain(item.value ?? '');
    }
  });

  it('移除危险 Markdown 内容并识别表格与公式节点', async () => {
    const result = await parser().parse(
      Buffer.from('<script>alert(1)</script>\n\n| A | B |\n\n$$x^2$$'),
      { extension: '.md', documentId: '1', processingRunId: '2' },
    );
    expect(result.markdown).not.toContain('<script>');
    expect(result.root.children.map((item) => item.type)).toEqual([
      'table',
      'equation',
    ]);
  });

  it('拒绝非法 UTF-8 和空正文', async () => {
    await expect(
      parser().parse(Buffer.from([0xff, 0xfe]), {
        extension: '.txt',
        documentId: '1',
        processingRunId: '2',
      }),
    ).rejects.toMatchObject({
      code: ErrorCode.DOCUMENT_TEXT_ENCODING_UNSUPPORTED,
    });
    await expect(
      parser().parse(Buffer.from('  \n\n'), {
        extension: '.txt',
        documentId: '1',
        processingRunId: '2',
      }),
    ).rejects.toMatchObject({ code: ErrorCode.DOCUMENT_PARSE_EMPTY_TEXT });
  });
});
