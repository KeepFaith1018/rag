import { ParsedSection } from './parsed-section.interface';

/**
 * 标准化后的文档解析结果。
 */
export interface ParsedDocument {
  plainText: string;
  /** Markdown 格式输出（PDF/DOCX/MD 有，TXT 无） */
  markdown?: string;
  sections: ParsedSection[];
  pageMap?: Array<{
    pageNo: number;
    text: string;
    charStart: number;
    charEnd: number;
  }>;
  metadata?: Record<string, unknown>;
}
