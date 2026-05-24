/**
 * 引用标记解析工具
 *
 * 将 LLM 输出的引用标记从纯文本中分割为 text / citation-marker 片段，
 * 兼容 [来源 N]、[KB-N] 两种格式，供 InlineRenderer 渲染为可点击角标。
 */

export interface CitationSegment {
  type: 'text' | 'citation-marker';
  value: string;
  citationIndex?: number;
}

/** 匹配 [来源 1] / [来源1] / [KB-1] / [kb-1] / [KB- 1] 等变体 */
const CITATION_PATTERN = /\[(?:来源\s*|[Kk][Bb]\s*-\s*)(\d+)\]/g;

export function parseCitationMarkers(text: string): CitationSegment[] {
  const segments: CitationSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  CITATION_PATTERN.lastIndex = 0;

  while ((match = CITATION_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) {
      segments.push({
        type: 'text',
        value: text.slice(lastIndex, match.index),
      });
    }
    segments.push({
      type: 'citation-marker',
      value: match[0],
      citationIndex: parseInt(match[1], 10),
    });
    lastIndex = CITATION_PATTERN.lastIndex;
  }

  if (lastIndex < text.length) {
    segments.push({
      type: 'text',
      value: text.slice(lastIndex),
    });
  }

  return segments;
}
