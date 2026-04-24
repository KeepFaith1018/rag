/**
 * 标准化文档分段结构。
 */
export interface ParsedSection {
  title?: string;
  titlePath?: string[];
  level?: number;
  content: string;
  pageNo?: number;
  charStart?: number;
  charEnd?: number;
}
