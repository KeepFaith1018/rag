/**
 * 标准化文档分段结构。
 */
export interface ParsedSection {
  title?: string;
  titlePath?: string[];
  level?: number;
  content: string;
  /** 分段类型：'text' | 'table' | 'code' | 'list'，默认 'text' */
  type?: 'text' | 'table' | 'code' | 'list';
  pageNo?: number;
  charStart?: number;
  charEnd?: number;
}
