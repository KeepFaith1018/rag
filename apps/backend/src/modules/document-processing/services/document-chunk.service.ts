import { Injectable } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Prisma } from '@prisma-client';
import { PrismaService } from '@common/prisma/prisma.service';
import {
  DOCUMENT_CHUNK_OVERLAP,
  DOCUMENT_CHUNK_SIZE,
} from '../constants/document-processing.constants';
import { ParsedDocument } from '../interfaces/parsed-document.interface';
import { ParsedSection } from '../interfaces/parsed-section.interface';

export interface CreatedChunkResult {
  chunkIds: string[];
  totalChunks: number;
  totalTokens: number;
}

type StructuredChunkDraft = {
  content: string;
  pageNo: number | null;
  charStart: number;
  charEnd: number;
  titlePath: string[];
  sectionLevel: number | null;
  chunkStrategy: 'structured-token-aware' | 'plainText-recursive';
};

type ChunkSourceDocument = {
  id: bigint;
  title: string;
  original_filename: string | null;
};

/**
 * 负责将解析后的文档做结构化切块并落库。
 */
@Injectable()
export class DocumentChunkService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 对指定文档执行结构感知切块，并写入 b_document_chunks。
   */
  async createChunks(
    document: ChunkSourceDocument,
    parsed: ParsedDocument,
    version: number,
  ): Promise<CreatedChunkResult> {
    await this.prisma.b_document_chunks.deleteMany({
      where: {
        doc_id: document.id,
      },
    });

    const chunkDrafts = await this.createStructuredChunks(parsed);
    if (chunkDrafts.length === 0) {
      return {
        chunkIds: [],
        totalChunks: 0,
        totalTokens: 0,
      };
    }

    const rows: Prisma.b_document_chunksCreateManyInput[] = [];
    let totalTokens = 0;
    chunkDrafts.forEach((chunk, index) => {
      const tokenCount = this.estimateTokenCount(chunk.content);
      const vectorId = `doc:${document.id.toString()}:chunk:${index}:v:${version}`;

      rows.push({
        doc_id: document.id,
        chunk_index: index,
        content: chunk.content,
        token_count: tokenCount,
        page_no: chunk.pageNo,
        char_start: chunk.charStart,
        char_end: chunk.charEnd,
        vector_id: vectorId,
        metadata_json: this.buildChunkMetadata(document, version, chunk),
        embedding_status: 'pending',
      });

      totalTokens += tokenCount;
    });

    await this.prisma.b_document_chunks.createMany({
      data: rows,
    });

    return {
      chunkIds: rows.map((item) => item.vector_id ?? '').filter(Boolean),
      totalChunks: rows.length,
      totalTokens,
    };
  }

  /**
   * 优先基于结构块切分文本，结构不足时回退到全文递归切分。
   */
  private async createStructuredChunks(parsed: ParsedDocument) {
    const sections = parsed.sections
      .map((section) => this.normalizeSection(section, parsed))
      .filter(Boolean) as Array<
      ParsedSection & {
        content: string;
        pageNo: number | null;
        charStart: number;
        charEnd: number;
        titlePath: string[];
      }
    >;

    if (sections.length === 0) {
      return this.createFallbackChunks(parsed);
    }

    const chunkDrafts: StructuredChunkDraft[] = [];
    for (const section of sections) {
      if (this.estimateTokenCount(section.content) <= DOCUMENT_CHUNK_SIZE) {
        chunkDrafts.push({
          content: section.content,
          pageNo: section.pageNo,
          charStart: section.charStart,
          charEnd: section.charEnd,
          titlePath: section.titlePath,
          sectionLevel: section.level ?? null,
          chunkStrategy: 'structured-token-aware',
        });
        continue;
      }

      const splittedChunks = await this.splitOversizedSection(section);
      chunkDrafts.push(...splittedChunks);
    }

    return chunkDrafts.length > 0 ? chunkDrafts : this.createFallbackChunks(parsed);
  }

  /**
   * 对超长结构块执行近似 token 窗口二次切分。
   */
  private async splitOversizedSection(
    section: ParsedSection & {
      content: string;
      pageNo: number | null;
      charStart: number;
      charEnd: number;
      titlePath: string[];
    },
  ) {
    const splitter = this.createTextSplitter();
    const chunks = await splitter.splitText(section.content);
    const normalizedChunks = chunks.map((item) => item.trim()).filter(Boolean);

    const draftChunks: StructuredChunkDraft[] = [];
    let localCursor = 0;

    for (const chunk of normalizedChunks) {
      const searchStart = Math.max(0, localCursor - Math.max(1, chunk.length));
      const localStart = section.content.indexOf(chunk, searchStart);
      const safeLocalStart = localStart >= 0 ? localStart : localCursor;
      const safeLocalEnd = safeLocalStart + chunk.length;

      draftChunks.push({
        content: chunk,
        pageNo: section.pageNo,
        charStart: section.charStart + safeLocalStart,
        charEnd: section.charStart + safeLocalEnd,
        titlePath: section.titlePath,
        sectionLevel: section.level ?? null,
        chunkStrategy: 'structured-token-aware',
      });

      localCursor = safeLocalEnd;
    }

    return draftChunks;
  }

  /**
   * 当结构信息不可用时，回退到全文递归切分。
   */
  private async createFallbackChunks(parsed: ParsedDocument) {
    const splitter = this.createTextSplitter();
    const chunks = await splitter.splitText(parsed.plainText);
    const normalizedChunks = chunks.map((item) => item.trim()).filter(Boolean);
    const draftChunks: StructuredChunkDraft[] = [];
    let cursor = 0;

    for (const content of normalizedChunks) {
      const searchStart = Math.max(0, cursor - Math.max(1, content.length));
      const startIndex = parsed.plainText.indexOf(content, searchStart);
      const charStart = startIndex >= 0 ? startIndex : cursor;
      const charEnd = charStart + content.length;
      const section = this.resolveSection(parsed.sections, charStart, charEnd);

      draftChunks.push({
        content,
        pageNo: this.resolvePageNumber(parsed, charStart, charEnd),
        charStart,
        charEnd,
        titlePath: section?.titlePath ?? (section?.title ? [section.title] : []),
        sectionLevel: section?.level ?? null,
        chunkStrategy: 'plainText-recursive',
      });

      cursor = charEnd;
    }

    return draftChunks;
  }

  /**
   * 对解析 section 做标准化，便于后续结构切分。
   */
  private normalizeSection(section: ParsedSection, parsed: ParsedDocument) {
    const rawContent = section.content ?? '';
    const normalizedContent = rawContent.trim();
    if (!normalizedContent) {
      return null;
    }

    const leadingTrimOffset = rawContent.indexOf(normalizedContent);
    const baseCharStart = section.charStart ?? 0;
    const charStart = baseCharStart + Math.max(0, leadingTrimOffset);
    const charEnd = charStart + normalizedContent.length;

    return {
      ...section,
      content: normalizedContent,
      charStart,
      charEnd,
      pageNo: section.pageNo ?? this.resolvePageNumber(parsed, charStart, charEnd),
      titlePath: section.titlePath ?? (section.title ? [section.title] : []),
    };
  }

  /**
   * 构建统一的文本切分器，按近似 token 长度控制分片大小。
   */
  private createTextSplitter() {
    return new RecursiveCharacterTextSplitter({
      chunkSize: DOCUMENT_CHUNK_SIZE,
      chunkOverlap: DOCUMENT_CHUNK_OVERLAP,
      lengthFunction: (text) => this.estimateTokenCount(text),
    });
  }

  /**
   * 构建 chunk 元数据，统一记录分片策略和结构信息。
   */
  private buildChunkMetadata(
    document: ChunkSourceDocument,
    version: number,
    chunk: StructuredChunkDraft,
  ) {
    return {
      processingVersion: version,
      title: document.title,
      sourceFileName: document.original_filename,
      titlePath: chunk.titlePath,
      sectionLevel: chunk.sectionLevel,
      chunkStrategy: chunk.chunkStrategy,
    };
  }

  /**
   * 查询指定文档当前版本的全部分片，按 chunk_index 顺序返回。
   */
  async getChunksByDocument(documentId: bigint) {
    return this.prisma.b_document_chunks.findMany({
      where: {
        doc_id: documentId,
      },
      orderBy: {
        chunk_index: 'asc',
      },
    });
  }

  /**
   * 在进入向量化阶段时，将文档分片状态标记为处理中。
   */
  async markEmbeddingProcessing(documentId: bigint) {
    await this.prisma.b_document_chunks.updateMany({
      where: {
        doc_id: documentId,
      },
      data: {
        embedding_status: 'processing',
      },
    });
  }

  /**
   * 在向量入库完成后，将分片状态标记为完成。
   */
  async markEmbeddingCompleted(documentId: bigint) {
    await this.prisma.b_document_chunks.updateMany({
      where: {
        doc_id: documentId,
      },
      data: {
        embedding_status: 'completed',
      },
    });
  }

  /**
   * 当向量化失败时，将分片状态标记为失败。
   */
  async markEmbeddingFailed(documentId: bigint) {
    await this.prisma.b_document_chunks.updateMany({
      where: {
        doc_id: documentId,
      },
      data: {
        embedding_status: 'failed',
      },
    });
  }

  /**
   * 当前阶段尚未接入模型 tokenizer，先用轻量估算值支撑治理字段。
   */
  private estimateTokenCount(content: string) {
    return Math.max(1, Math.ceil(content.length / 4));
  }

  /**
   * 根据字符区间回推 chunk 所属页码。
   */
  private resolvePageNumber(
    parsed: ParsedDocument,
    charStart: number,
    charEnd: number,
  ) {
    const matchedPage = parsed.pageMap?.find(
      (page) => charStart >= page.charStart && charEnd <= page.charEnd + 2,
    );

    return matchedPage?.pageNo ?? null;
  }

  /**
   * 根据字符区间回推 chunk 所属 section。
   */
  private resolveSection(
    sections: ParsedSection[],
    charStart: number,
    charEnd: number,
  ) {
    return sections.find((section) => {
      const sectionStart = section.charStart ?? 0;
      const sectionEnd = section.charEnd ?? sectionStart + section.content.length;

      return charStart >= sectionStart && charEnd <= sectionEnd + 2;
    });
  }
}
