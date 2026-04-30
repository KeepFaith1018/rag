/**
 * 文档上传大小上限，首版按 20MB 控制。
 */
export const MAX_DOCUMENT_FILE_SIZE = 20 * 1024 * 1024;

/**
 * 当前允许上传的文档扩展名白名单。
 */
export const SUPPORTED_DOCUMENT_EXTENSIONS = [
  '.pdf',
  '.doc',
  '.docx',
  '.txt',
  '.md',
] as const;

/**
 * 根据扩展名补全默认 MIME 类型。
 */
export function resolveDocumentMimeType(extension: string) {
  switch (extension) {
    case '.pdf':
      return 'application/pdf';
    case '.doc':
      return 'application/msword';
    case '.docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case '.md':
      return 'text/markdown';
    default:
      return 'text/plain';
  }
}
