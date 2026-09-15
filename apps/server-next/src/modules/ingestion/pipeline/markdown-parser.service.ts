import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import * as mammoth from 'mammoth';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { RuntimeConfig } from '../../../platform/config/runtime-config.service';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';
import {
  AstDocumentSchema,
  type AstDocument,
  type AstNode,
  SourceSpanSchema,
} from '../contracts/schemas';

export interface ParserInput {
  extension: string;
  documentId: string;
  processingRunId: string;
}

export type ParserOutput = AstDocument;

/** 四种输入格式的统一 parser adapter；下游只依赖 AstDocument。 */
@Injectable()
export class MarkdownParserService {
  constructor(private readonly runtime: RuntimeConfig) {}

  async parse(buffer: Buffer, input: ParserInput): Promise<ParserOutput> {
    if (buffer.length > this.runtime.parser.maxBytes)
      throw new BusinessError(
        ErrorCode.DOCUMENT_PROCESSING_RESOURCE_LIMIT,
        '文档超过解析大小限制',
        'validation',
      );
    switch (input.extension.toLowerCase()) {
      case '.txt':
        return this.parseText(buffer, 'txt');
      case '.md':
        return this.parseText(buffer, 'md');
      case '.docx':
        return this.parseDocx(buffer);
      case '.pdf':
        return this.parsePdf(buffer);
      default:
        throw new BusinessError(
          ErrorCode.DOCUMENT_PROCESSING_FAILED,
          '不支持的文档格式',
          'validation',
        );
    }
  }

  parseMarkdown(
    markdown: string,
    parser = 'markdown',
    warnings: string[] = [],
  ) {
    const normalized = normalizeText(sanitizeMarkdown(markdown));
    if (!normalized.trim()) throw this.emptyText();
    return this.document(normalized, parser, warnings);
  }

  private parseText(buffer: Buffer, kind: 'txt' | 'md'): ParserOutput {
    const markdown = normalizeUtf8(buffer);
    if (!markdown.trim()) throw this.emptyText();
    const sanitized =
      kind === 'md' ? sanitizeMarkdown(markdown) : toPlainMarkdown(markdown);
    if (!sanitized.trim()) throw this.emptyText();
    return this.document(
      sanitized,
      kind === 'md' ? 'markdown-utf8' : 'text-utf8',
    );
  }

  private async parseDocx(buffer: Buffer): Promise<ParserOutput> {
    await validateZip(buffer, this.runtime.parser);
    try {
      const result = await mammoth.convertToHtml(
        { buffer },
        {
          styleMap: [
            "p[style-name='Title'] => h1:fresh",
            "p[style-name='Heading 1'] => h1:fresh",
            "p[style-name='Heading 2'] => h2:fresh",
            "p[style-name='Heading 3'] => h3:fresh",
          ],
          includeDefaultStyleMap: true,
          externalFileAccess: false,
        },
      );
      const markdown = htmlToMarkdown(result.value);
      if (markdown.trim()) {
        return this.document(
          markdown,
          'docx-mammoth',
          result.messages.map((item) => item.message),
        );
      }
    } catch {
      // 主路径失败时按契约使用纯文本 fallback；不把底层异常暴露给 API。
    }
    const loader = new DocxLoader(
      new Blob([new Uint8Array(buffer)], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    );
    const documents = await loader.load();
    const markdown = normalizeText(
      documents.map((item) => item.pageContent).join('\n\n'),
    );
    if (!markdown.trim()) throw this.emptyText();
    return this.document(markdown, 'docx-plain-text', [
      'DOCX_SEMANTIC_CONVERSION_DEGRADED',
    ]);
  }

  private async parsePdf(buffer: Buffer): Promise<ParserOutput> {
    // PDF 引擎含原生 Canvas 依赖，只在实际解析 PDF 时加载。
    const { PDFParse } = await import('pdf-parse');
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const markdown = normalizeText(result.text);
      if (markdown.trim()) return this.document(markdown, 'pdf-parse');
    } catch {
      // PDF 解析失败统一转换成稳定业务错误。
    } finally {
      await parser.destroy();
    }
    throw this.emptyText();
  }

  private document(
    markdown: string,
    parser: string,
    warnings: string[] = [],
  ): ParserOutput {
    const normalized = normalizeText(markdown);
    const root = markdownToAst(normalized);
    const output = {
      schemaVersion: 1,
      markdown: normalized,
      markdownSha256: createHash('sha256').update(normalized).digest('hex'),
      root,
      parser,
      parserVersion: '1',
      degraded: parser.includes('fallback') || parser === 'docx-plain-text',
      warnings,
    } satisfies AstDocument;
    return AstDocumentSchema.parse(output);
  }

  private emptyText() {
    return new BusinessError(
      ErrorCode.DOCUMENT_PARSE_EMPTY_TEXT,
      '文档没有可处理的正文',
      'validation',
    );
  }
}

export function normalizeUtf8(buffer: Buffer) {
  const bytes =
    buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf
      ? buffer.subarray(3)
      : buffer;
  let value: string;
  try {
    value = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new BusinessError(
      ErrorCode.DOCUMENT_TEXT_ENCODING_UNSUPPORTED,
      '文本编码不受支持，仅支持 UTF-8',
      'validation',
    );
  }
  if (looksBinary(value))
    throw new BusinessError(
      ErrorCode.DOCUMENT_TEXT_ENCODING_UNSUPPORTED,
      '文件不是有效的 UTF-8 文本',
      'validation',
    );
  return normalizeText(value);
}

export function normalizeText(value: string) {
  return stripUnsupportedControls(value)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripUnsupportedControls(value: string) {
  return Array.from(value)
    .filter((char) => {
      const code = char.charCodeAt(0);
      return !(
        code <= 8 ||
        code === 11 ||
        code === 12 ||
        (code >= 14 && code <= 31) ||
        code === 127
      );
    })
    .join('');
}

function looksBinary(value: string) {
  if (!value) return false;
  let suspicious = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 0 || (code < 32 && ![9, 10, 13].includes(code))) suspicious++;
  }
  return suspicious > 0 || suspicious / value.length > 0.01;
}

function toPlainMarkdown(value: string) {
  return value
    .split('\n')
    .map((line) => (line.startsWith('#') ? `\\${line}` : line))
    .join('\n');
}

function sanitizeMarkdown(value: string) {
  return value
    .replace(/!\[([^\]]*)\]\(data:[^)]+\)/gi, '![$1](image-omitted)')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '')
    .replace(/\b(href|src)\s*=\s*["']\s*javascript:[^"']*["']/gi, '')
    .trim();
}

function markdownToAst(markdown: string): AstNode {
  const lines = markdown.split('\n');
  const children: AstNode[] = [];
  let offset = 0;
  let paragraphStart = -1;
  let paragraphLines: string[] = [];
  let codeStart = -1;
  let codeLines: string[] = [];
  let codeLanguage = '';
  const flushParagraph = (end: number) => {
    if (paragraphStart < 0) return;
    const value = paragraphLines.join('\n');
    children.push(node('paragraph', value, paragraphStart, end));
    paragraphStart = -1;
    paragraphLines = [];
  };
  const flushCode = (end: number) => {
    if (codeStart < 0) return;
    children.push({
      ...node('code', codeLines.join('\n'), codeStart, end),
      language: codeLanguage || undefined,
    });
    codeStart = -1;
    codeLines = [];
    codeLanguage = '';
  };
  for (const line of lines) {
    const start = offset;
    const end = start + line.length;
    offset = end + 1;
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      if (codeStart < 0) {
        flushParagraph(start - 1);
        codeStart = start;
        codeLanguage = fence[1].trim();
      } else flushCode(end);
      continue;
    }
    if (codeStart >= 0) {
      codeLines.push(line);
      continue;
    }
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*$/);
    if (heading) {
      flushParagraph(start - 1);
      children.push(
        node('heading', heading[2], start, end, { titlePath: [heading[2]] }),
      );
      continue;
    }
    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushParagraph(start - 1);
      children.push(node('thematicBreak', '', start, end));
      continue;
    }
    if (!line.trim()) {
      flushParagraph(start - 1);
      continue;
    }
    if (/^\s*(?:[-*+] |\d+\. )/.test(line)) {
      flushParagraph(start - 1);
      children.push(
        node('listItem', line.replace(/^\s*(?:[-*+] |\d+\. )/, ''), start, end),
      );
      continue;
    }
    if (/^\s*>/.test(line)) {
      flushParagraph(start - 1);
      children.push(
        node('blockquote', line.replace(/^\s*>\s?/, ''), start, end),
      );
      continue;
    }
    if (/^\s*!\[[^\]]*\]\([^)]*\)/.test(line)) {
      flushParagraph(start - 1);
      const image = line.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)/);
      children.push({
        ...node('image', image?.[1] ?? '', start, end),
        url: image?.[2],
      });
      continue;
    }
    if (/^\s*\$\$[\s\S]*\$\$\s*$/.test(line)) {
      flushParagraph(start - 1);
      children.push(
        node(
          'equation',
          line.replace(/^\s*\$\$|\$\$\s*$/g, '').trim(),
          start,
          end,
        ),
      );
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      flushParagraph(start - 1);
      children.push(node('table', line, start, end));
      continue;
    }
    if (paragraphStart < 0) paragraphStart = start;
    paragraphLines.push(line);
  }
  flushCode(markdown.length);
  flushParagraph(markdown.length);
  const rootId = `ast-root-${hash(markdown).slice(0, 16)}`;
  const root: AstNode = {
    schemaVersion: 1,
    id: rootId,
    type: 'document',
    titlePath: [],
    source: SourceSpanSchema.parse({
      nodeId: rootId,
      start: 0,
      end: markdown.length,
      confidence: 'exact',
      derived: false,
    }),
    children,
  };
  return root;
}

function node(
  type: AstNode['type'],
  value: string,
  start: number,
  end: number,
  extra: Partial<AstNode> = {},
): AstNode {
  return {
    schemaVersion: 1,
    id: `ast-${type}-${hash(`${type}:${start}:${end}:${value}`).slice(0, 16)}`,
    type,
    value,
    titlePath: [],
    source: SourceSpanSchema.parse({
      nodeId: `ast-${type}-${start}`,
      start: Math.max(0, start),
      end: Math.max(start, end),
      confidence: 'exact',
      derived: false,
    }),
    children: [],
    ...extra,
  };
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function htmlToMarkdown(html: string) {
  const value = html
    .replace(/<\/?(strong|b)>/gi, '**')
    .replace(/<\/?(em|i)>/gi, '*')
    .replace(
      /<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi,
      (_match: string, level: string, text: string) =>
        `${'#'.repeat(Number(level))} ${stripTags(text)}\n\n`,
    )
    .replace(
      /<li[^>]*>([\s\S]*?)<\/li>/gi,
      (_match: string, text: string) => `- ${stripTags(text)}\n`,
    )
    .replace(
      /<p[^>]*>([\s\S]*?)<\/p>/gi,
      (_match: string, text: string) => `${stripTags(text)}\n\n`,
    )
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<table[\s\S]*?<\/table>/gi, (table: string) =>
      table.replace(
        /<tr[^>]*>([\s\S]*?)<\/tr>/gi,
        (_match: string, row: string) =>
          `| ${[...row.matchAll(/<(?:td|th)[^>]*>([\s\S]*?)<\/(?:td|th)>/gi)].map((m) => stripTags(m[1])).join(' | ')} |\n`,
      ),
    )
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
  return normalizeText(value);
}

function stripTags(value: string) {
  return value
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function validateZip(
  buffer: Buffer,
  limits: { maxZipFiles: number; maxUncompressedBytes: number },
) {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(buffer, {
      createFolders: false,
      checkCRC32: false,
    });
  } catch {
    throw new BusinessError(
      ErrorCode.DOCUMENT_PROCESSING_FAILED,
      '文档压缩结构无效',
      'validation',
    );
  }
  const paths = new Set<string>();
  let total = 0;
  const entries = Object.values(zip.files);
  if (entries.length > limits.maxZipFiles) throw resourceLimit();
  for (const entry of entries) {
    const normalized = entry.name.replaceAll('\\', '/');
    if (
      normalized.startsWith('/') ||
      normalized.split('/').includes('..') ||
      normalized !== entry.name
    )
      throw new BusinessError(
        ErrorCode.DOCUMENT_PROCESSING_FAILED,
        '压缩包路径不安全',
        'validation',
      );
    if (paths.has(normalized.toLowerCase()))
      throw new BusinessError(
        ErrorCode.DOCUMENT_PROCESSING_FAILED,
        '压缩包包含重复路径',
        'validation',
      );
    paths.add(normalized.toLowerCase());
    if (!entry.dir && !normalized.endsWith('/')) {
      const data = await entry.async('uint8array');
      total += data.byteLength;
      if (total > limits.maxUncompressedBytes) throw resourceLimit();
      if (/\.zip$/i.test(normalized))
        throw new BusinessError(
          ErrorCode.DOCUMENT_PROCESSING_FAILED,
          '不允许嵌套压缩包',
          'validation',
        );
    }
  }
}

function resourceLimit() {
  return new BusinessError(
    ErrorCode.DOCUMENT_PROCESSING_RESOURCE_LIMIT,
    '压缩包超过资源限制',
    'validation',
  );
}
