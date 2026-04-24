import { Injectable } from '@nestjs/common';
import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf';
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx';
import { TextLoader } from '@langchain/classic/document_loaders/fs/text';
import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { FileStorageService } from '@common/storage/file-storage.service';
import {
  DOCUMENT_PARSE_ERROR_CODE,
  DOCUMENT_PARSE_UNSUPPORTED_ERROR_CODE,
} from '../constants/document-processing.constants';
import { ParsedDocument } from '../interfaces/parsed-document.interface';
import { ParsedSection } from '../interfaces/parsed-section.interface';

type LoaderDocument = {
  pageContent: string;
  metadata?: Record<string, unknown>;
};

/**
 * 负责使用 LangChain Loader 解析文档内容。
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

  /**
   * 使用 LangChain PDFLoader 解析 PDF，并尽量保留页级结构。
   */
  async parsePdf(absolutePath: string): Promise<ParsedDocument> {
    try {
      const loader = new PDFLoader(absolutePath, {
        splitPages: true,
      });
      const docs = (await loader.load()) as LoaderDocument[];

      if (docs.length === 0) {
        throw new BusinessException(ErrorCode.VECTOR_FILE_IMG_EMPTY, {
          message: 'PDF 解析结果为空',
          context: {
            internalErrorCode: DOCUMENT_PARSE_ERROR_CODE,
            absolutePath,
          },
        });
      }

      return this.buildParsedDocumentFromPagedDocs(docs);
    } catch (error) {
      throw new BusinessException(ErrorCode.VECTOR_FILE_FAILED, {
        message: 'PDF 文档解析失败',
        cause: error,
        context: {
          internalErrorCode: DOCUMENT_PARSE_ERROR_CODE,
          absolutePath,
        },
      });
    }
  }

  /**
   * 使用 LangChain DocxLoader 解析 docx 文档。
   */
  async parseDocx(absolutePath: string): Promise<ParsedDocument> {
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

  /**
   * 使用 LangChain TextLoader 解析 Markdown 文档。
   */
  async parseMarkdown(absolutePath: string): Promise<ParsedDocument> {
    return this.parseTextLikeDocument(absolutePath, 'markdown');
  }

  /**
   * 使用 LangChain TextLoader 解析 TXT 文档。
   */
  async parseText(absolutePath: string): Promise<ParsedDocument> {
    return this.parseTextLikeDocument(absolutePath, 'plain');
  }

  /**
   * 统一处理文本类文件解析。
   */
  private async parseTextLikeDocument(
    absolutePath: string,
    mode: 'plain' | 'markdown',
  ): Promise<ParsedDocument> {
    try {
      const loader = new TextLoader(absolutePath);
      const docs = (await loader.load()) as LoaderDocument[];
      const plainText = docs.map((item) => item.pageContent).join('\n\n').trim();

      if (!plainText) {
        throw new BusinessException(ErrorCode.VECTOR_FILE_IMG_EMPTY, {
          message: '文本文档解析结果为空',
          context: {
            internalErrorCode: DOCUMENT_PARSE_ERROR_CODE,
            absolutePath,
            mode,
          },
        });
      }

      return {
        plainText,
        sections: this.parseSectionsFromText(plainText, mode),
        metadata: {
          loader: 'TextLoader',
          source: absolutePath,
          mode,
        },
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

  /**
   * 将分页文档构造成统一的 ParsedDocument 结构。
   */
  private buildParsedDocumentFromPagedDocs(docs: LoaderDocument[]): ParsedDocument {
    const pageMap: ParsedDocument['pageMap'] = [];
    const sections: ParsedSection[] = [];
    let cursor = 0;

    for (let index = 0; index < docs.length; index += 1) {
      const pageContent = docs[index].pageContent.trim();
      if (!pageContent) {
        continue;
      }

      const pageNo = this.resolvePageNumber(docs[index].metadata, index);
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
        loader: 'PDFLoader',
      },
    };
  }

  /**
   * 通过简单规则将文本拆成结构化 section。
   */
  private parseSectionsFromText(
    plainText: string,
    mode: 'plain' | 'markdown',
  ): ParsedSection[] {
    const normalizedText = plainText.replace(/\r\n/g, '\n');
    if (mode === 'markdown') {
      return this.parseMarkdownSections(normalizedText);
    }

    const paragraphs = normalizedText
      .split(/\n{2,}/)
      .map((item) => item.trim())
      .filter(Boolean);

    if (paragraphs.length === 0) {
      return [
        {
          content: normalizedText,
          charStart: 0,
          charEnd: normalizedText.length,
        },
      ];
    }

    const sections: ParsedSection[] = [];
    let cursor = 0;
    for (const paragraph of paragraphs) {
      const startIndex = normalizedText.indexOf(paragraph, cursor);
      const safeStart = startIndex >= 0 ? startIndex : cursor;
      const safeEnd = safeStart + paragraph.length;

      sections.push({
        content: paragraph,
        titlePath: [],
        charStart: safeStart,
        charEnd: safeEnd,
      });
      cursor = safeEnd;
    }

    return sections;
  }

  /**
   * 针对 Markdown 标题做简化结构提取。
   */
  private parseMarkdownSections(plainText: string): ParsedSection[] {
    const lines = plainText.split('\n');
    const sections: ParsedSection[] = [];
    let currentTitle: string | undefined;
    let currentLevel: number | undefined;
    let currentTitlePath: string[] = [];
    let buffer: string[] = [];
    let cursor = 0;
    const headingStack: Array<{ level: number; title: string }> = [];

    const flushSection = () => {
      const content = buffer.join('\n').trim();
      if (!content) {
        buffer = [];
        return;
      }

      const startIndex = plainText.indexOf(content, cursor);
      const safeStart = startIndex >= 0 ? startIndex : cursor;
      const safeEnd = safeStart + content.length;

      sections.push({
        title: currentTitle,
        titlePath: currentTitlePath,
        level: currentLevel,
        content,
        charStart: safeStart,
        charEnd: safeEnd,
      });

      cursor = safeEnd;
      buffer = [];
    };

    for (const line of lines) {
      const headingMatch = /^(#{1,6})\s+(.+)$/.exec(line.trim());
      if (headingMatch) {
        flushSection();
        const nextLevel = headingMatch[1].length;
        const nextTitle = headingMatch[2];

        while (
          headingStack.length > 0 &&
          headingStack[headingStack.length - 1].level >= nextLevel
        ) {
          headingStack.pop();
        }

        headingStack.push({
          level: nextLevel,
          title: nextTitle,
        });
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
          content: plainText,
          titlePath: [],
          charStart: 0,
          charEnd: plainText.length,
        },
      ];
    }

    return sections;
  }

  /**
   * 尝试从 PDF 元数据中获取页码，取不到时回退到顺序页码。
   */
  private resolvePageNumber(
    metadata: Record<string, unknown> | undefined,
    index: number,
  ) {
    const pageCandidate =
      typeof metadata?.page === 'number'
        ? metadata.page
        : typeof metadata?.pageNumber === 'number'
          ? metadata.pageNumber
          : undefined;

    return pageCandidate && pageCandidate > 0 ? pageCandidate : index + 1;
  }
}
