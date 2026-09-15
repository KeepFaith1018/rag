import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { get_encoding, type TiktokenEncoding } from 'tiktoken';
import { BusinessError } from '../../../shared/errors/business-error';
import { ErrorCode } from '../../../shared/errors/error-code';
import {
  AstDocumentSchema,
  ChunkMetadataSchema,
  type AstDocument,
  type AstNode,
  type ChunkMetadata,
  type SourceSpan,
} from '../contracts/schemas';

export interface ChunkingConfig {
  schemaVersion: number;
  tokenizer: { name: string; version: string };
  rootTokenLimit: number;
  parentTokenLimit: number;
  childTokenLimit: number;
  overlapTokens: number;
  titlePrefix: string;
}

export interface ChunkDraft {
  chunkNo: number;
  content: string;
  contentHash: string;
  tokenCount: number;
  pageStart: number | null;
  pageEnd: number | null;
  charStart: number | null;
  charEnd: number | null;
  chunkLevel: 1 | 2 | 3;
  parentIndex: number | null;
  rootIndex: number;
  metadata: ChunkMetadata;
}

export const DEFAULT_CHUNKING_CONFIG: ChunkingConfig = {
  schemaVersion: 1,
  tokenizer: { name: 'cl100k_base', version: 'tiktoken-1.0.22' },
  rootTokenLimit: 4096,
  parentTokenLimit: 2048,
  childTokenLimit: 512,
  overlapTokens: 48,
  titlePrefix: '> 章节路径：',
};

/** 结构感知三级分块器。它只读取统一 AST，不依赖任何 parser 的原始对象。 */
@Injectable()
export class ChunkerService {
  createChunks(
    astInput: AstDocument,
    config = DEFAULT_CHUNKING_CONFIG,
  ): ChunkDraft[] {
    const ast = AstDocumentSchema.parse(astInput);
    if (sha256(ast.markdown) !== ast.markdownSha256)
      throw new BusinessError(
        ErrorCode.DOCUMENT_SCHEMA_VERSION_UNSUPPORTED,
        'Markdown 来源版本不匹配',
        'validation',
      );
    if (!ast.markdown.trim() || ast.root.children.length === 0)
      throw new BusinessError(
        ErrorCode.DOCUMENT_PARSE_EMPTY_TEXT,
        '文档没有可分块内容',
        'validation',
      );
    const drafts: ChunkDraft[] = [];
    const rootNodes = splitNode(
      { ...ast.root, value: ast.markdown },
      config.rootTokenLimit,
      0,
    );
    for (const [rootIndex, rootNode] of rootNodes.entries())
      drafts.push(
        this.makeDraft(
          1,
          rootNode.value ?? '',
          rootNode,
          ast.markdownSha256,
          null,
          rootIndex,
          [],
        ),
      );
    const sections = sectionsOf(ast.root.children);
    const parents = sections.length
      ? sections
      : [{ titlePath: [], nodes: ast.root.children }];
    for (const section of parents) {
      const sectionNode = aggregateSection(section.nodes, ast.markdown);
      if (!sectionNode?.value?.trim()) continue;
      const parentLimit = contentLimit(
        config.parentTokenLimit,
        section.titlePath,
        config.titlePrefix,
      );
      const childLimit = contentLimit(
        config.childTokenLimit,
        section.titlePath,
        config.titlePrefix,
      );
      for (const parentPart of splitNode(sectionNode, parentLimit, 0)) {
        const rootIndex = rootNodes.findIndex(
          (root) =>
            (parentPart.source?.start ?? 0) >= (root.source?.start ?? 0) &&
            (parentPart.source?.start ?? 0) <
              (root.source?.end ?? ast.markdown.length),
        );
        const parentIndex = drafts.length;
        drafts.push(
          this.makeDraft(
            2,
            this.withTitle(
              section.titlePath,
              parentPart.value ?? '',
              config.titlePrefix,
            ),
            parentPart,
            ast.markdownSha256,
            null,
            rootIndex,
            section.titlePath,
          ),
        );
        for (const block of splitNode(
          parentPart,
          childLimit,
          config.overlapTokens,
        )) {
          if (!block.value?.trim()) continue;
          drafts.push(
            this.makeDraft(
              3,
              this.withTitle(
                section.titlePath,
                block.value,
                config.titlePrefix,
              ),
              block,
              ast.markdownSha256,
              parentIndex,
              rootIndex,
              section.titlePath,
            ),
          );
        }
      }
    }
    return drafts.map((draft, index) => ({ ...draft, chunkNo: index + 1 }));
  }

  private makeDraft(
    level: 1 | 2 | 3,
    content: string,
    node: AstNode,
    markdownSha256: string,
    parentIndex: number | null,
    rootIndex: number,
    titlePath: string[],
  ): ChunkDraft {
    const source = node.source ?? null;
    const sourceSpans: SourceSpan[] =
      source && source.start !== undefined && source.end !== undefined
        ? [{ ...source, nodeId: node.id }]
        : [{ nodeId: node.id, confidence: 'derived', derived: true }];
    if (titlePath.length) {
      sourceSpans.unshift({
        nodeId: `derived-title:${titlePath.join('/')}`,
        confidence: 'derived',
        derived: true,
      });
    }
    const metadata = ChunkMetadataSchema.parse({
      schemaVersion: 1,
      markdownSha256,
      titlePath,
      astNodeIds: [node.id],
      sourceSpans,
      contentHash: sha256(content),
    });
    return {
      chunkNo: 0,
      content,
      contentHash: metadata.contentHash,
      tokenCount: countTokens(content),
      pageStart: source?.pageStart ?? null,
      pageEnd: source?.pageEnd ?? null,
      charStart: source?.start ?? null,
      charEnd: source?.end ?? null,
      chunkLevel: level,
      parentIndex,
      rootIndex,
      metadata,
    };
  }

  private withTitle(titlePath: string[], value: string, titlePrefix: string) {
    return titlePath.length
      ? `${titlePrefix}${titlePath.join(' / ')}\n\n${value}`
      : value;
  }
}

function sectionsOf(nodes: AstNode[]) {
  const result: Array<{ titlePath: string[]; nodes: AstNode[] }> = [];
  let current: { titlePath: string[]; nodes: AstNode[] } | null = null;
  for (const node of nodes) {
    if (node.type === 'heading') {
      current = { titlePath: [node.value ?? ''], nodes: [node] };
      result.push(current);
    } else {
      if (!current) {
        current = { titlePath: [], nodes: [] };
        result.push(current);
      }
      current.nodes.push(node);
    }
  }
  return result;
}

function splitNode(node: AstNode, limit: number, overlap: number): AstNode[] {
  if (countTokens(node.value ?? '') <= limit) return [node];
  const value = node.value ?? '';
  const boundaries = utf16Boundaries(value);
  const result: AstNode[] = [];
  let startIndex = 0;
  while (startIndex < boundaries.length - 1) {
    const endIndex = maxFittingBoundary(value, boundaries, startIndex, limit);
    const start = boundaries[startIndex];
    const end = boundaries[endIndex];
    const part = value.slice(start, end);
    result.push({
      ...node,
      id: `${node.id}-part-${start}`,
      value: part,
      source:
        node.source && node.source.start !== undefined
          ? {
              ...node.source,
              start: node.source.start + start,
              end: node.source.start + end,
              confidence: 'aligned',
            }
          : node.source,
    });
    if (endIndex >= boundaries.length - 1) break;
    let nextIndex = endIndex;
    while (
      nextIndex > startIndex + 1 &&
      countTokens(value.slice(boundaries[nextIndex - 1], end)) <= overlap
    )
      nextIndex--;
    startIndex = Math.max(startIndex + 1, nextIndex);
  }
  return result;
}

export function countTokens(value: string) {
  return tokenizer.encode(value).length;
}

const tokenizer = get_encoding('cl100k_base' as TiktokenEncoding);

function utf16Boundaries(value: string) {
  const result = [0];
  let offset = 0;
  for (const unit of value) {
    offset += unit.length;
    result.push(offset);
  }
  return result;
}

function maxFittingBoundary(
  value: string,
  boundaries: number[],
  startIndex: number,
  limit: number,
) {
  let low = startIndex + 1;
  let high = boundaries.length - 1;
  let best = low;
  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    if (
      countTokens(value.slice(boundaries[startIndex], boundaries[middle])) <=
      limit
    ) {
      best = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return best;
}

function contentLimit(limit: number, titlePath: string[], titlePrefix: string) {
  if (!titlePath.length) return limit;
  const available =
    limit - countTokens(`${titlePrefix}${titlePath.join(' / ')}\n\n`);
  if (available < 1)
    throw new BusinessError(
      ErrorCode.DOCUMENT_PROCESSING_RESOURCE_LIMIT,
      '标题路径超过 Chunk Token 上限',
      'validation',
    );
  return available;
}

function aggregateSection(nodes: AstNode[], markdown: string): AstNode | null {
  const exact = nodes.filter(
    (item) =>
      item.source?.start !== undefined && item.source?.end !== undefined,
  );
  if (!exact.length) return null;
  const start = Math.min(...exact.map((item) => item.source!.start!));
  const end = Math.max(...exact.map((item) => item.source!.end!));
  const ids = exact.map((item) => item.id).join(':');
  return {
    schemaVersion: 1,
    id: `ast-section-${sha256(ids).slice(0, 16)}`,
    type: 'document',
    value: markdown.slice(start, end),
    titlePath: [],
    source: { nodeId: ids, start, end, confidence: 'exact', derived: false },
    children: nodes,
  };
}

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}
