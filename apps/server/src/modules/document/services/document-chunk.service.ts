import { createHash } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters';
import { Prisma } from '@prisma-client';
import { PrismaService } from '@common/prisma/prisma.service';
import { TokenService } from '@common/utils/token.service';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import {
  HIERARCHICAL_CHUNK_OVERLAP,
  CHUNK_PROFILES,
  ChunkProfile,
  CODE_HEAVY_RATIO_THRESHOLD,
  TABLE_HEAVY_RATIO_THRESHOLD,
  COMPACT_CONTENT_LENGTH_THRESHOLD,
  PRE_SPLIT_MAX_CHARS,
} from '../document-processing.constants';
import { ParsedDocument } from '../parsed-document.interface';
import { ParsedSection } from '../parsed-section.interface';

export interface CreatedChunkResult {
  chunkIds: string[];
  totalChunks: number;
  totalTokens: number;
}

type StructuredChunkDraft = {
  content: string;
  pageNo: number | null;
  charStart?: number;
  charEnd?: number;
  titlePath: string[];
  sectionLevel: number | null;
  chunkStrategy: 'structured-token-aware' | 'plainText-recursive';
  blockType?: string;
  chunkProfile?: string;
};

type HierarchicalChunkDraft = StructuredChunkDraft & {
  chunkIndex: number;
  chunkLevel: number;
  isRoot?: boolean;
};

type ChunkSourceDocument = {
  id: bigint;
  title: string;
  original_filename: string | null;
};

/**
 * 基于文档维度生成稳定的 Qdrant point UUID，兼顾幂等写入与 Qdrant ID 约束。
 */
export function buildDocumentChunkVectorId(
  documentId: bigint | string,
  chunkIndex: number,
  processingVersion: number,
) {
  const seed = `doc:${documentId.toString()}:chunk:${chunkIndex}:v:${processingVersion}`;
  const bytes = Buffer.from(
    createHash('sha256').update(seed).digest('hex').slice(0, 32),
    'hex',
  );

  // 按 RFC 4122 设置 version / variant，确保生成结果可被 Qdrant 识别为 UUID。
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const uuid = bytes.toString('hex');
  return `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(
    12,
    16,
  )}-${uuid.slice(16, 20)}-${uuid.slice(20, 32)}`;
}

/**
 * 负责将解析后的文档做结构化切块并落库。
 */
@Injectable()
export class DocumentChunkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tokenService: TokenService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /**
   * 对指定文档执行三层粒度切块（根 → 父 → 子），写入 b_document_chunks。
   *
   * 仅 Level 3（子 chunk）参与后续 embedding，Level 1/2 仅存储于 DB 作为上下文载体。
   */
  async createChunks(
    document: ChunkSourceDocument,
    parsed: ParsedDocument,
    version: number,
  ): Promise<CreatedChunkResult> {
    // 1. 清空旧数据
    this.logger.info('[Chunking] 开始切块，即将清空旧数据', { documentId: document.id.toString() });
    await this.prisma.b_document_chunks.deleteMany({
      where: { doc_id: document.id },
    });
    this.logger.info('[Chunking] 旧数据已清空');

    // 2. 获取可用的 section 列表，无结构时用全文作为单一 section
    const sections = this.resolveSections(parsed);
    if (sections.length === 0) {
      return { chunkIds: [], totalChunks: 0, totalTokens: 0 };
    }
    this.logger.info('[Chunking] sections 解析完成', {
      documentId: document.id.toString(),
      sectionCount: sections.length,
      totalChars: sections.reduce((s, sec) => s + sec.content.length, 0),
    });

    // 3. 根据文档内容特征选择自适应 chunk profile
    const profile = this.selectChunkProfile(sections);
    this.logger.info('[Chunking] chunk profile 已选择', { profile: profile.name, rootSize: profile.rootSize, parentSize: profile.parentSize, childSize: profile.childSize });

    // 4. 三层切块：逐 section → Level 1 → Level 2 → Level 3
    const allLevel1Rows: Prisma.b_document_chunksCreateManyInput[] = [];
    const allLevel2Rows: Prisma.b_document_chunksCreateManyInput[] = [];
    const allLevel3Rows: Prisma.b_document_chunksCreateManyInput[] = [];

    let globalIndex = 0;
    let totalTokens = 0;

    let sectionIdx = 0;
    for (const section of sections) {
      sectionIdx++;
      const sectionStartTime = Date.now();
      // O8: 代码块/表格块作为原子单元，不拆分，保持完整性
      const isAtomic =
        section.type === 'code' || section.type === 'table';
      this.logger.info(`[Chunking] 处理 section ${sectionIdx}/${sections.length}`, {
        isAtomic,
        contentLen: section.content.length,
        titlePath: section.titlePath.join(' > '),
      });
      const level1Texts = isAtomic
        ? [section.content]
        : await this.splitText(section.content, profile.rootSize);

      this.logger.info(`[Chunking]  section ${sectionIdx} L1 拆分完成`, {
        l1Count: level1Texts.length,
        durationMs: Date.now() - sectionStartTime,
      });

      for (const l1Text of level1Texts) {
        const l1Index = globalIndex++;
        const l1Row = this.buildChunkRow(document, version, {
          content: l1Text,
          chunkIndex: l1Index,
          chunkLevel: 1,
          isRoot: true,
          pageNo: section.pageNo,
          titlePath: section.titlePath,
          sectionLevel: section.level ?? null,
          chunkStrategy: 'structured-token-aware',
          chunkProfile: profile.name,
        });
        allLevel1Rows.push(l1Row);

        // Level 2: 对每个 Level 1 做二级切分（原子块跳过拆分）
        const level2Texts = isAtomic
          ? [l1Text]
          : await this.splitText(l1Text, profile.parentSize);

        for (const l2Text of level2Texts) {
          const l2Index = globalIndex++;
          const l2Row = this.buildChunkRow(document, version, {
            content: l2Text,
            chunkIndex: l2Index,
            chunkLevel: 2,
            isRoot: false,
            // parent/root 引用在写入 Level 1 后回填
            pageNo: section.pageNo,
            titlePath: section.titlePath,
            sectionLevel: section.level ?? null,
            chunkStrategy: 'structured-token-aware',
            chunkProfile: profile.name,
          });
          allLevel2Rows.push(l2Row);

          // Level 3: 对每个 Level 2 做三级切分（原子块跳过拆分）
          const level3Texts = isAtomic
            ? [l2Text]
            : await this.splitText(l2Text, profile.childSize);
          for (const l3Text of level3Texts) {
            const l3Index = globalIndex++;
            const chunkDraft: HierarchicalChunkDraft = {
              content: l3Text,
              chunkIndex: l3Index,
              chunkLevel: 3,
              pageNo: section.pageNo,
              charStart: section.charStart + section.content.indexOf(l3Text),
              charEnd:
                section.charStart +
                section.content.indexOf(l3Text) +
                l3Text.length,
              titlePath: section.titlePath,
              sectionLevel: section.level ?? null,
              chunkStrategy: 'structured-token-aware',
              blockType: section.type,
              chunkProfile: profile.name,
            };
            const contextualizedContent =
              this.buildContextualizedContent(chunkDraft);
            const tokenCount = this.tokenCount(contextualizedContent);
            const vectorId = buildDocumentChunkVectorId(
              document.id,
              l3Index,
              version,
            );

            allLevel3Rows.push({
              doc_id: document.id,
              chunk_index: l3Index,
              content: contextualizedContent,
              token_count: tokenCount,
              page_no: section.pageNo,
              char_start: chunkDraft.charStart,
              char_end: chunkDraft.charEnd,
              vector_id: vectorId,
              metadata_json: this.buildChunkMetadata(
                document,
                version,
                chunkDraft,
              ),
              embedding_status: 'pending',
              chunk_level: 3,
              is_root: false,
            });

            totalTokens += tokenCount;
          }
        }
      }
    }

    if (allLevel3Rows.length === 0) {
      return { chunkIds: [], totalChunks: 0, totalTokens: 0 };
    }

    this.logger.info('[Chunking] 拆分循环完成，即将入库', {
      l1Rows: allLevel1Rows.length,
      l2Rows: allLevel2Rows.length,
      l3Rows: allLevel3Rows.length,
      totalTokens,
    });

    // 4. 按层级顺序入库（Level 1 → Level 2 → Level 3），通过 $transaction 保证写入完整性
    await this.prisma.$transaction(async (tx) => {
      // Level 1
      await tx.b_document_chunks.createMany({ data: allLevel1Rows });
      const createdL1 = await tx.b_document_chunks.findMany({
        where: { doc_id: document.id, chunk_level: 1 },
        orderBy: { chunk_index: 'asc' },
      });

      // 回填 Level 2 的 parent/root 引用
      const l1ByIdx = new Map(createdL1.map((r) => [r.chunk_index, r.id]));
      for (const row of allLevel2Rows) {
        // Level 2 的 parent 是包含它的 Level 1
        // 找到 chunk_index 小于当前 L2 且最大的 L1
        let l1Idx = -1;
        for (const idx of l1ByIdx.keys()) {
          if (idx < row.chunk_index && idx > l1Idx) l1Idx = idx;
        }
        const parentId = l1Idx >= 0 ? l1ByIdx.get(l1Idx) : null;
        row.parent_chunk_id = parentId;
        row.root_chunk_id = parentId;
      }
      await tx.b_document_chunks.createMany({ data: allLevel2Rows });
      const createdL2 = await tx.b_document_chunks.findMany({
        where: { doc_id: document.id, chunk_level: 2 },
        orderBy: { chunk_index: 'asc' },
      });

      // 回填 Level 3 的 parent/root 引用
      const l2ByIdx = new Map(createdL2.map((r) => [r.chunk_index, r.id]));
      for (const row of allLevel3Rows) {
        let l2Idx = -1;
        for (const idx of l2ByIdx.keys()) {
          if (idx < row.chunk_index && idx > l2Idx) l2Idx = idx;
        }
        const parentId = l2Idx >= 0 ? l2ByIdx.get(l2Idx) : null;
        // root 指向包含此 L2 的 L1
        let rootId: bigint | null = null;
        if (parentId) {
          let l1TargetIdx = -1;
          for (const idx of l1ByIdx.keys()) {
            if (idx < l2Idx && idx > l1TargetIdx) l1TargetIdx = idx;
          }
          rootId = l1TargetIdx >= 0 ? l1ByIdx.get(l1TargetIdx) ?? null : null;
        }
        row.parent_chunk_id = parentId;
        row.root_chunk_id = rootId;
      }
      await tx.b_document_chunks.createMany({ data: allLevel3Rows });
    });

    this.logger.info('[Chunking] 入库完成');

    return {
      chunkIds: allLevel3Rows
        .map((r) => r.vector_id ?? '')
        .filter(Boolean),
      totalChunks: allLevel3Rows.length,
      totalTokens,
    };
  }

  /**
   * 获取可用的 section 列表。
   * 当 parsed.sections 有有效内容时使用之，否则回退到全文作为单一 section。
   */
  private resolveSections(parsed: ParsedDocument) {
    const normalized = parsed.sections
      .map((s) => this.normalizeSection(s, parsed))
      .filter(Boolean) as Array<
      ParsedSection & {
        content: string;
        pageNo: number | null;
        charStart: number;
        charEnd: number;
        titlePath: string[];
      }
    >;

    if (normalized.length > 0) return normalized;

    // fallback：全文作为单一 section
    const trimmed = parsed.plainText.trim();
    if (!trimmed) return [];
    return [
      {
        content: trimmed,
        pageNo: null,
        charStart: 0,
        charEnd: trimmed.length,
        titlePath: [],
        level: undefined,
        type: 'text' as const,
      },
    ];
  }

  /**
   * 根据文档 section 组成特征自动选择最优 chunk profile。
   *
   * 启发式规则（优先级从高到低）：
   * 1. 代码块占比 > 30% → code-heavy（更大窗口保护代码完整性）
   * 2. 表格占比 > 20% 或平均 content 长度 > 2000 字符 → verbose
   * 3. 平均 content 长度 < 500 字符 → compact（文本密度高，小块足够）
   * 4. 其余 → default
   */
  private selectChunkProfile(
    sections: Array<{ type?: string; content: string }>,
  ): ChunkProfile {
    const total = sections.length || 1;
    const codeRatio =
      sections.filter((s) => s.type === 'code').length / total;
    const tableRatio =
      sections.filter((s) => s.type === 'table').length / total;
    const avgLen =
      sections.reduce((sum, s) => sum + (s.content?.length ?? 0), 0) / total;

    if (codeRatio > CODE_HEAVY_RATIO_THRESHOLD) {
      return CHUNK_PROFILES['code-heavy'];
    }
    if (tableRatio > TABLE_HEAVY_RATIO_THRESHOLD || avgLen > 2000) {
      return CHUNK_PROFILES['verbose'];
    }
    if (avgLen < COMPACT_CONTENT_LENGTH_THRESHOLD) {
      return CHUNK_PROFILES['compact'];
    }
    return CHUNK_PROFILES['default'];
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
      pageNo:
        section.pageNo ?? this.resolvePageNumber(parsed, charStart, charEnd),
      titlePath: section.titlePath ?? (section.title ? [section.title] : []),
    };
  }

  /**
   * 按指定 token 大小对文本做递归切分，复用中文分隔符 + 真实 tokenizer。
   *
   * 大文本预切分：当输入文本超过 PRE_SPLIT_MAX_CHARS 时，先按段落（\n\n）粗切，
   * 避免 RecursiveCharacterTextSplitter 在巨量文本上产生 O(n²) 的内存与计算开销。
   */
  private async splitText(text: string, chunkSize: number): Promise<string[]> {
    if (!text.trim()) return [];

    // 防御性剥除 data URI（解析阶段已处理，此处二次兜底）
    text = text.replace(/!\[.*?\]\(data:[^)]+\)/g, '[图片]')
      .replace(/data:[a-zA-Z][\w+-]*\/[a-zA-Z][\w+-]*;base64,[A-Za-z0-9+/=]+/g, '[内嵌资源]');

    if (text.length > PRE_SPLIT_MAX_CHARS) {
      this.logger.info('[Chunking] 大文本预切分开始', { textLen: text.length, chunkSize });
      const results: string[] = [];
      const paragraphs = text.split('\n\n');
      const oversized = paragraphs.filter((p) => p.length > PRE_SPLIT_MAX_CHARS);
      if (oversized.length > 0) {
        this.logger.warn('[Chunking] 存在超长段落需按行拆分', { oversizedCount: oversized.length, maxLen: Math.max(...paragraphs.map((p) => p.length)) });
      }

      for (const para of paragraphs) {
        if (para.length > PRE_SPLIT_MAX_CHARS) {
          const lines = para.split('\n');
          for (const line of lines) {
            const subChunks = await this.doSplit(line, chunkSize);
            results.push(...subChunks);
          }
        } else {
          const subChunks = await this.doSplit(para, chunkSize);
          results.push(...subChunks);
        }
      }
      this.logger.info('[Chunking] 大文本预切分完成', { paragraphCount: paragraphs.length, totalChunks: results.length });
      return results;
    }

    return this.doSplit(text, chunkSize);
  }

  /**
   * 实际调用 RecursiveCharacterTextSplitter，不对输入做预切分。
   */
  private async doSplit(text: string, chunkSize: number): Promise<string[]> {
    if (!text.trim()) return [];
    if (text.length > 20000) {
      this.logger.warn('[Chunking] doSplit 处理超长单块文本', { textLen: text.length, chunkSize });
    }
    const splitter = this.createHierarchicalSplitter(chunkSize);
    const chunks = await splitter.splitText(text);
    return chunks.map((c) => c.trim()).filter(Boolean);
  }

  /**
   * 构建单层分块器，参数由调用方指定 chunkSize，分隔符与 lengthFunction 统一复用。
   */
  private createHierarchicalSplitter(chunkSize: number) {
    return new RecursiveCharacterTextSplitter({
      chunkSize,
      chunkOverlap: HIERARCHICAL_CHUNK_OVERLAP,
      separators: [
        '\n\n',    // 段落边界
        '\n',      // 行边界
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
      lengthFunction: (text) => this.tokenService.tokenCount(text),
    });
  }

  /**
   * 构建统一的 chunk 行数据，含层级字段。
   */
  private buildChunkRow(
    document: ChunkSourceDocument,
    version: number,
    draft: HierarchicalChunkDraft,
  ): Prisma.b_document_chunksCreateManyInput {
    const contextualizedContent = this.buildContextualizedContent(draft);
    return {
      doc_id: document.id,
      chunk_index: draft.chunkIndex,
      content: contextualizedContent,
      token_count: this.tokenCount(contextualizedContent),
      page_no: draft.pageNo,
      char_start: draft.charStart ?? 0,
      char_end: draft.charEnd ?? 0,
      vector_id: draft.chunkLevel === 3
        ? buildDocumentChunkVectorId(document.id, draft.chunkIndex, version)
        : null,
      metadata_json: this.buildChunkMetadata(document, version, draft),
      embedding_status: 'pending',
      chunk_level: draft.chunkLevel,
      is_root: draft.isRoot ?? false,
    };
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
      blockType: chunk.blockType,
      chunkProfile: chunk.chunkProfile,
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
   * 利用 titlePath 为 chunk content 附加结构上下文。
   *
   * 轻量版上下文增强 — 零额外 API 调用成本，利用解析阶段已产出的标题路径
   * 让 embedding 向量携带文档结构定位信息，提升检索阶段的结构感知能力。
   *
   * 示例：["第三章", "3.1 系统架构"] → "第三章 > 3.1 系统架构"
   */
  private buildContextualizedContent(chunk: StructuredChunkDraft): string {
    const pathStr = chunk.titlePath.length > 0
      ? chunk.titlePath.join(' > ')
      : '';
    if (!pathStr) return chunk.content;
    return `[文档段落路径: ${pathStr}]\n${chunk.content}`;
  }

  /**
   * 真实 token 计数，基于 tiktoken cl100k_base 编码器（百炼 text-embedding-v4 兼容）。
   */
  private tokenCount(content: string): number {
    return this.tokenService.tokenCount(content);
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
      const sectionEnd =
        section.charEnd ?? sectionStart + section.content.length;

      return charStart >= sectionStart && charEnd <= sectionEnd + 2;
    });
  }
}
