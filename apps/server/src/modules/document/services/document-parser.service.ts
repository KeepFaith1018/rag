import { readFile } from 'node:fs/promises';
import { Injectable } from '@nestjs/common';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { PDFParse } from 'pdf-parse';
import type { PageTextResult } from 'pdf-parse';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { FileStorageService } from '@common/storage/file-storage.service';
import {
  DOCUMENT_PARSE_ERROR_CODE,
  DOCUMENT_PARSE_UNSUPPORTED_ERROR_CODE,
} from '../document-processing.constants';
import { ParsedDocument } from '../parsed-document.interface';
import { ParsedSection } from '../parsed-section.interface';

type LoaderDocument = {
  pageContent: string;
  metadata?: Record<string, unknown>;
};

/** pdfexcavator page text item */
interface PEWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  size?: number;
  font?: string;
}

/** pdfexcavator table row */
interface PETable {
  rows: string[][];
  confidence?: number;
  detectionMethod?: string;
}

/**
 * 负责统一解析文档内容。
 */
@Injectable()
export class DocumentParserService {
  constructor(private readonly fileStorageService: FileStorageService) {}

  /**
   * 根据文件类型分发到对应解析器。
   */
  async parseDocument(filePath: string, fileType?: string | null) {
    const normalizedType = (fileType || '').toLowerCase();
    const absolutePath = this.fileStorageService.resolveAbsolutePath(filePath);

    switch (normalizedType) {
      case 'pdf':
        return this.parsePdf(absolutePath);
      case 'docx':
        return this.parseDocx(absolutePath);
      case 'md':
        return this.parseMarkdown(absolutePath);
      case 'txt':
        return this.parseText(absolutePath);
      default:
        throw new BusinessException(ErrorCode.FILE_TYPE_UNSUPPORTED, {
          message: `当前阶段暂不支持解析 ${normalizedType || 'unknown'} 类型文件`,
          context: {
            internalErrorCode: DOCUMENT_PARSE_UNSUPPORTED_ERROR_CODE,
            filePath,
            fileType: normalizedType,
          },
        });
    }
  }

  // ────────────────────────────────
  //  PDF
  // ────────────────────────────────

  /**
   * 使用 pdfexcavator 提取文本、表格与字体信息组装 Markdown；
   * 失败时自动回退 pdf-parse。
   */
  async parsePdf(absolutePath: string): Promise<ParsedDocument> {
    try {
      return await this.parsePdfViaExcavator(absolutePath);
    } catch (error) {
      // pdfexcavator 失败时回退
      const warn =
        error instanceof Error ? error.message : String(error);
      console.warn(
        `[DocumentParserService] pdfexcavator 解析失败，回退 pdf-parse: ${warn}`,
      );
      return this.parsePdfFallback(absolutePath);
    }
  }

  private async parsePdfViaExcavator(absolutePath: string): Promise<ParsedDocument> {
    const { default: pdfexcavator } = await import('pdfexcavator');

    const pdf = await pdfexcavator.open(absolutePath);
    const sections: ParsedSection[] = [];
    const pageTexts: string[] = [];
    const pageMap: ParsedDocument['pageMap'] = [];

    try {
      for (const page of pdf.pages) {
        const pageSections = await this.processExcavatorPage(page);
        sections.push(...pageSections);

        const pageText = pageSections
          .map((s) => s.content)
          .join('\n\n');
        pageTexts.push(pageText);

        const charStart = pageMap.length > 0
          ? pageMap[pageMap.length - 1].charEnd + 2
          : 0;
        pageMap.push({
          pageNo: page.pageNumber,
          text: pageText,
          charStart,
          charEnd: charStart + pageText.length,
        });
      }

      const plainText = pageTexts.join('\n\n');
      const markdown = this.buildMarkdownFromSections(sections);

      return {
        plainText,
        markdown,
        sections,
        pageMap,
        metadata: { loader: 'pdfexcavator', source: absolutePath },
      };
    } finally {
      await pdf.close();
    }
  }

  /**
   * 处理单页：提取词 → 按 y 聚行为行 → 按字体大小判定标题 / 正文 → 提取表格 → 组装 sections。
   */
  private async processExcavatorPage(
    page: Awaited<ReturnType<typeof import('pdfexcavator').default.open>>['pages'][number],
  ): Promise<ParsedSection[]> {
    const wordItems = await page.extractWords();

    if (wordItems.length === 0) {
      const rawText = await page.extractText();
      return rawText.trim()
        ? [{ content: rawText.trim(), titlePath: [], charStart: 0, charEnd: rawText.length }]
        : [];
    }

    // 按 y 坐标聚类成行
    const lineGroups = this.clusterWordsToLines(wordItems);
    const bodySize = this.inferBodyFontSize(lineGroups);

    // 提取表格
    const tables = await this.extractPageTables(page);

    // 逐行判定标题/正文，构建 sections
    const items = this.buildPageSections(lineGroups, tables, bodySize);

    // 用累积偏移量修正 charStart/charEnd
    return this.applyCumulativeOffsets(items);
  }

  private clusterWordsToLines(words: PEWord[]) {
    const sorted = [...words].sort((a, b) => a.y0 - b.y0 || a.x0 - b.x0);
    const groups: PEWord[][] = [];
    for (const w of sorted) {
      const last = groups[groups.length - 1];
      if (last) {
        const lastMeanY = last.reduce((s, lw) => s + (lw.y0 + lw.y1) / 2, 0) / last.length;
        const wMeanY = (w.y0 + w.y1) / 2;
        if (Math.abs(wMeanY - lastMeanY) < 5 && Math.abs(w.y0 - last[0].y0) < 10) {
          last.push(w);
          continue;
        }
      }
      groups.push([w]);
    }
    return groups;
  }

  /**
   * 推断正文基准字号：取中位数字号，忽略明显是标题的超大 / 超小字。
   */
  private inferBodyFontSize(lineGroups: PEWord[][]) {
    const sizes = lineGroups
      .map((line) => {
        const avgSize =
          line.reduce((s, w) => s + (w.size ?? 12), 0) / line.length;
        return avgSize;
      })
      .filter((s) => s >= 8 && s <= 20);
    if (sizes.length === 0) return 12;
    sizes.sort((a, b) => a - b);
    return sizes[Math.floor(sizes.length / 2)];
  }

  private async extractPageTables(
    page: Awaited<ReturnType<typeof import('pdfexcavator').default.open>>['pages'][number],
  ) {
    try {
      const tables: PETable[] = (await page.extractTables()) as PETable[];
      return (tables || []).filter((t) => (t.confidence ?? 0) >= 0.6);
    } catch {
      return [];
    }
  }

  private buildPageSections(
    lineGroups: PEWord[][],
    tables: PETable[],
    bodySize: number,
  ): ParsedSection[] {
    const result: ParsedSection[] = [];
    const tableSpans = this.resolveTableCharSpans(tables);

    let currentLines: string[] = [];
    let currentIsHeading = false;
    let currentLevel = 0;
    const flushTextBlock = () => {
      const content = currentLines.join('\n').trim();
      if (!content) return;
      result.push({
        content,
        title: currentIsHeading ? content.split('\n')[0] : undefined,
        titlePath: currentIsHeading ? [content.split('\n')[0]] : [],
        level: currentIsHeading ? currentLevel : undefined,
        type: 'text',
        charStart: 0,
        charEnd: 0,
      });
      currentLines = [];
    };

    for (const lineWords of lineGroups) {
      const lineText = lineWords
        .sort((a, b) => a.x0 - b.x0)
        .map((w) => w.text)
        .join(' ');
      const avgSize =
        lineWords.reduce((s, w) => s + (w.size ?? bodySize), 0) / lineWords.length;

      // 判断是否表格行（按 avgSize == bodySize 且内容含大量空白间隔的略过）
      const isTableLine = tableSpans.some(
        () => false, // 表格由 extractTables 专门处理，不在这里混入
      );
      if (isTableLine) continue;

      const isHeading = avgSize > bodySize * 1.25;
      const level = avgSize > bodySize * 1.5 ? 1 : avgSize > bodySize * 1.25 ? 2 : 0;

      if (isHeading) {
        flushTextBlock();
        currentLines = [lineText];
        currentIsHeading = true;
        currentLevel = level;
        // heading detected
      } else if (currentIsHeading) {
        flushTextBlock();
        currentIsHeading = false;
        currentLines = [lineText];
      } else {
        currentLines.push(lineText);
      }
    }
    flushTextBlock();

    // 插入表格 sections
    for (const table of tables) {
      const md = this.buildMarkdownTable(table.rows);
      result.push({
        content: md,
        type: 'table',
        titlePath: [],
        charStart: 0,
        charEnd: 0,
      });
    }

    return result;
  }

  private resolveTableCharSpans(_tables: PETable[]): Array<{ start: number; end: number }> {
    return [];
  }

  private buildMarkdownTable(rows: string[][]): string {
    if (rows.length === 0) return '';
    const header = rows[0];
    const data = rows.length > 1 ? rows.slice(1) : [];
    const mdRows: string[] = [
      `| ${header.join(' | ')} |`,
      `| ${header.map(() => '---').join(' | ')} |`,
    ];
    for (const row of data) {
      mdRows.push(`| ${row.join(' | ')} |`);
    }
    return mdRows.join('\n');
  }

  /**
   * 按累积偏移量统一计算 charStart/charEnd，替代 indexOf 定位。
   */
  private applyCumulativeOffsets(sections: ParsedSection[]): ParsedSection[] {
    let cursor = 0;
    const separator = '\n\n';
    return sections.map((section) => {
      const charStart = cursor;
      const charEnd = charStart + section.content.length;
      cursor = charEnd + separator.length;
      return { ...section, charStart, charEnd };
    });
  }

  /**
   * 将 sections 组装为 Markdown 字符串。
   */
  private buildMarkdownFromSections(sections: ParsedSection[]): string {
    const blocks: string[] = [];
    for (const section of sections) {
      if (section.type === 'table') {
        blocks.push(section.content);
        continue;
      }
      if (section.title && section.level) {
        blocks.push(`${'#'.repeat(Math.min(section.level, 6))} ${section.title}\n\n${section.title ? section.content.replace(section.title + '\n', '') : section.content}`);
        continue;
      }
      blocks.push(section.content);
    }
    return blocks.join('\n\n');
  }

  // 回退
  private async parsePdfFallback(absolutePath: string): Promise<ParsedDocument> {
    let parser: PDFParse | null = null;
    try {
      const fileBuffer = await readFile(absolutePath);
      parser = new PDFParse({
        data: new Uint8Array(fileBuffer),
      });
      const textResult = await parser.getText();

      if (textResult.pages.length === 0) {
        throw new BusinessException(ErrorCode.VECTOR_FILE_IMG_EMPTY, {
          message: 'PDF 解析结果为空',
          context: {
            internalErrorCode: DOCUMENT_PARSE_ERROR_CODE,
            absolutePath,
          },
        });
      }

      return this.buildParsedDocumentFromPdfPages(
        textResult.pages,
        textResult.total,
      );
    } catch (error) {
      throw new BusinessException(ErrorCode.VECTOR_FILE_FAILED, {
        message: 'PDF 文档解析失败',
        cause: error,
        context: {
          internalErrorCode: DOCUMENT_PARSE_ERROR_CODE,
          absolutePath,
        },
      });
    } finally {
      await parser?.destroy();
    }
  }

  // ────────────────────────────────
  //  DOCX
  // ────────────────────────────────

  /**
   * 使用 mammoth 转 Markdown 后走 Markdown section 提取，
   * 失败时回退 LangChain DocxLoader。
   */
  async parseDocx(absolutePath: string): Promise<ParsedDocument> {
    try {
      return await this.parseDocxViaMammoth(absolutePath);
    } catch (error) {
      const warn =
        error instanceof Error ? error.message : String(error);
      console.warn(
        `[DocumentParserService] mammoth 解析失败，回退 DocxLoader: ${warn}`,
      );
      return this.parseDocxFallback(absolutePath);
    }
  }

  private async parseDocxViaMammoth(absolutePath: string): Promise<ParsedDocument> {
    const fileBuffer = await readFile(absolutePath);
    type MammothWithMarkdown = { convertToMarkdown: (input: { buffer: Buffer }) => Promise<{ value: string; messages: Array<{ type: string; message: string }> }> };
    // mammoth 类型声明未包含 convertToMarkdown，但运行时存在
    const mammoth = (await import('mammoth')) as unknown as MammothWithMarkdown;
    const result = await mammoth.convertToMarkdown({ buffer: fileBuffer });

    const markdown = result.value.trim();
    if (!markdown) {
      throw new BusinessException(ErrorCode.VECTOR_FILE_IMG_EMPTY, {
        message: 'DOCX 解析结果为空',
        context: {
          internalErrorCode: DOCUMENT_PARSE_ERROR_CODE,
          absolutePath,
        },
      });
    }

    const plainText = markdown.replace(/^#{1,6}\s+/gm, '').replace(/```[\s\S]*?```/g, '');
    const sections = this.parseMarkdownSections(markdown);

    if (result.messages.length > 0) {
      console.warn(
        `[DocumentParserService] mammoth 转换警告: ${absolutePath}`,
        result.messages,
      );
    }

    return {
      plainText,
      markdown,
      sections,
      metadata: {
        loader: 'mammoth',
        source: absolutePath,
        warnings: result.messages,
      },
    };
  }

  private async parseDocxFallback(absolutePath: string): Promise<ParsedDocument> {
    try {
      const loader = new DocxLoader(absolutePath);
      const docs = (await loader.load()) as LoaderDocument[];
      const plainText = docs.map((item) => item.pageContent).join('\n\n').trim();

      if (!plainText) {
        throw new BusinessException(ErrorCode.VECTOR_FILE_IMG_EMPTY, {
          message: 'DOCX 解析结果为空',
          context: {
            internalErrorCode: DOCUMENT_PARSE_ERROR_CODE,
            absolutePath,
          },
        });
      }

      return {
        plainText,
        sections: this.parseSectionsFromText(plainText, 'plain'),
        metadata: {
          loader: 'DocxLoader',
          source: absolutePath,
        },
      };
    } catch (error) {
      throw new BusinessException(ErrorCode.VECTOR_FILE_FAILED, {
        message: 'DOCX 文档解析失败',
        cause: error,
        context: {
          internalErrorCode: DOCUMENT_PARSE_ERROR_CODE,
          absolutePath,
        },
      });
    }
  }

  // ────────────────────────────────
  //  Markdown
  // ────────────────────────────────

  /**
   * 使用 TextLoader 读取全文后做增强 Markdown 解析，
   * 包含 frontmatter 提取与代码块 / 表格类型标记。
   */
  async parseMarkdown(absolutePath: string): Promise<ParsedDocument> {
    return this.parseTextLikeDocument(absolutePath, 'markdown');
  }

  // ────────────────────────────────
  //  TXT
  // ────────────────────────────────

  async parseText(absolutePath: string): Promise<ParsedDocument> {
    return this.parseTextLikeDocument(absolutePath, 'plain');
  }

  // ────────────────────────────────
  //  文本类文件共用
  // ────────────────────────────────

  private async parseTextLikeDocument(
    absolutePath: string,
    mode: 'plain' | 'markdown',
  ): Promise<ParsedDocument> {
    try {
      const rawText = (await readFile(absolutePath, 'utf-8')).trim();

      if (!rawText) {
        throw new BusinessException(ErrorCode.VECTOR_FILE_IMG_EMPTY, {
          message: '文本文档解析结果为空',
          context: {
            internalErrorCode: DOCUMENT_PARSE_ERROR_CODE,
            absolutePath,
            mode,
          },
        });
      }

      // frontmatter 提取（仅 Markdown）
      let plainText = rawText;
      let frontmatter: Record<string, unknown> | undefined;
      let markdown: string | undefined;

      if (mode === 'markdown') {
        const fm = this.extractFrontmatter(rawText);
        plainText = fm.body;
        frontmatter = fm.frontmatter;
        markdown = rawText; // 保留完整 Markdown（含结构）
        const sections = this.parseMarkdownSections(plainText);
        return {
          plainText: sections.map((s) => s.content).join('\n\n'),
          markdown,
          sections,
          metadata: { loader: 'TextLoader', source: absolutePath, mode, ...frontmatter },
        };
      }

      // plain 模式
      return {
        plainText,
        sections: this.parseSectionsFromText(plainText, mode),
        metadata: { loader: 'TextLoader', source: absolutePath, mode },
      };
    } catch (error) {
      throw new BusinessException(ErrorCode.VECTOR_FILE_FAILED, {
        message: '文本文档解析失败',
        cause: error,
        context: {
          internalErrorCode: DOCUMENT_PARSE_ERROR_CODE,
          absolutePath,
          mode,
        },
      });
    }
  }

  // ────────────────────────────────
  //  Markdown section 提取（增强）
  // ────────────────────────────────

  /**
   * 以累积偏移量按自然边界切分段落。
   */
  private parseSectionsFromText(
    plainText: string,
    mode: 'plain' | 'markdown',
  ): ParsedSection[] {
    const normalizedText = plainText.replace(/\r\n/g, '\n');
    if (mode === 'markdown') {
      return this.parseMarkdownSections(normalizedText);
    }

    // 对长段落做预分割：按中文标点切分超过 2000 字符的段落
    const paragraphs = normalizedText
      .split(/\n{2,}/)
      .map((item) => item.trim())
      .filter(Boolean)
      .flatMap((para) => {
        if (para.length <= 2000) return [para];
        return this.splitLongParagraph(para);
      });

    if (paragraphs.length === 0) {
      return [
        {
          content: normalizedText,
          charStart: 0,
          charEnd: normalizedText.length,
        },
      ];
    }

    let cursor = 0;
    const sections: ParsedSection[] = [];
    for (const paragraph of paragraphs) {
      const charStart = cursor;
      const charEnd = charStart + paragraph.length;
      sections.push({
        content: paragraph,
        titlePath: [],
        charStart,
        charEnd,
      });
      cursor = charEnd + 2; // \n\n
    }

    return sections;
  }

  /**
   * 以。！？标点将超长段落切分为多段。
   */
  private splitLongParagraph(text: string): string[] {
    const parts = text.split(/(?<=[。！？])/);
    const result: string[] = [];
    let buffer = '';
    for (const part of parts) {
      if (buffer.length + part.length > 2000 && buffer.length > 0) {
        result.push(buffer.trim());
        buffer = part;
      } else {
        buffer += part;
      }
    }
    if (buffer.trim()) result.push(buffer.trim());
    return result;
  }

  // ────────────────────────────────
  //  Markdown headings + frontmatter + type
  // ────────────────────────────────

  /**
   * 解析 YAML frontmatter（若存在），返回剥离后的 body 与键值对。
   */
  private extractFrontmatter(rawText: string): {
    body: string;
    frontmatter?: Record<string, unknown>;
  } {
    const normalized = rawText.replace(/\r\n/g, '\n');
    const match = normalized.match(/^---\n([\s\S]*?)\n---\n?/);
    if (!match) return { body: normalized };

    const frontmatter: Record<string, unknown> = {};
    const lines = match[1].split('\n');
    for (const line of lines) {
      const kv = line.match(/^(\w[\w-]*):\s*(.*)$/);
      if (kv) {
        const value = kv[2].trim();
        frontmatter[kv[1]] =
          value.startsWith('"') && value.endsWith('"')
            ? value.slice(1, -1)
            : value.startsWith("'") && value.endsWith("'")
              ? value.slice(1, -1)
              : value;
      }
    }
    return { body: normalized.slice(match[0].length), frontmatter };
  }

  /**
   * 增强 Markdown section 提取：
   * - #~###### 标题 → titlePath + level
   * - ```...``` 代码块 → type=code
   * - |...| 表格 → type=table
   */
  private parseMarkdownSections(plainText: string): ParsedSection[] {
    const normalized = plainText.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const sections: ParsedSection[] = [];
    let currentTitle: string | undefined;
    let currentLevel: number | undefined;
    let currentTitlePath: string[] = [];
    const headingStack: Array<{ level: number; title: string }> = [];
    let buffer: string[] = [];
    let inCodeBlock = false;

    const flushSection = (forceType?: ParsedSection['type']) => {
      const content = buffer.join('\n').trim();
      if (!content) {
        buffer = [];
        return;
      }

      const isTable = forceType === 'table' || this.isMarkdownTable(content);
      const isCode = forceType === 'code' || inCodeBlock;

      sections.push({
        title: currentTitle,
        titlePath: currentTitlePath.length > 0 ? currentTitlePath : undefined,
        level: currentLevel,
        content,
        type: isTable ? 'table' : isCode ? 'code' : 'text',
        charStart: 0,
        charEnd: 0,
      });

      buffer = [];
    };

    for (const line of lines) {
      // 代码块边界
      if (line.trim().startsWith('```')) {
        if (!inCodeBlock) {
          flushSection();
          inCodeBlock = true;
          buffer = [];
        } else {
          flushSection('code');
          inCodeBlock = false;
          buffer = [];
          currentTitle = undefined;
          currentLevel = undefined;
          currentTitlePath = [];
        }
        continue;
      }

      if (inCodeBlock) {
        buffer.push(line);
        continue;
      }

      const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line.trim());
      if (headingMatch) {
        flushSection();
        const nextLevel = headingMatch[1].length;
        const nextTitle = headingMatch[2].replace(/[*_~`#]+/g, '').trim();

        // 维护标题栈
        while (
          headingStack.length > 0 &&
          headingStack[headingStack.length - 1].level >= nextLevel
        ) {
          headingStack.pop();
        }
        headingStack.push({ level: nextLevel, title: nextTitle });

        currentTitle = nextTitle;
        currentLevel = nextLevel;
        currentTitlePath = headingStack.map((item) => item.title);
        continue;
      }

      buffer.push(line);
    }

    flushSection();

    if (sections.length === 0) {
      return [
        {
          content: normalized,
          titlePath: [],
          charStart: 0,
          charEnd: normalized.length,
        },
      ];
    }

    // 用累积偏移量修正位置
    return this.applyCumulativeOffsets(sections);
  }

  /**
   * 判断内容是否为 Markdown 表格（含 | 分隔符且至少有两行）。
   */
  private isMarkdownTable(content: string): boolean {
    const lines = content.split('\n').filter((l) => l.includes('|'));
    if (lines.length < 2) return false;
    return lines.some((l) => /^\|[\s\-:|]+\|$/.test(l));
  }

  // ────────────────────────────────
  //  PDF 回退方法（pdf-parse，兼容旧逻辑）
  // ────────────────────────────────

  private buildParsedDocumentFromPdfPages(
    pages: PageTextResult[],
    totalPages: number,
  ): ParsedDocument {
    const pageMap: ParsedDocument['pageMap'] = [];
    const sections: ParsedSection[] = [];
    let cursor = 0;

    for (const page of pages) {
      const pageContent = page.text.trim();
      if (!pageContent) continue;

      const pageNo = page.num;
      const charStart = cursor;
      const charEnd = charStart + pageContent.length;

      pageMap.push({
        pageNo,
        text: pageContent,
        charStart,
        charEnd,
      });
      sections.push({
        title: `第 ${pageNo} 页`,
        titlePath: [`第 ${pageNo} 页`],
        level: 1,
        content: pageContent,
        pageNo,
        charStart,
        charEnd,
      });

      cursor = charEnd + 2;
    }

    return {
      plainText: pageMap.map((page) => page.text).join('\n\n'),
      sections,
      pageMap,
      metadata: {
        loader: 'pdf-parse',
        totalPages,
      },
    };
  }
}
