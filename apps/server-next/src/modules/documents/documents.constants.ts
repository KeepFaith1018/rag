export const MAX_DOCUMENT_FILE_SIZE = 20 * 1024 * 1024;

export const DOCUMENT_EXTENSIONS = ['.pdf', '.docx', '.txt', '.md'] as const;

export const DOCUMENT_MIME_TYPES: Record<
  (typeof DOCUMENT_EXTENSIONS)[number],
  string[]
> = {
  '.pdf': ['application/pdf'],
  '.docx': [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/zip',
    'application/octet-stream',
  ],
  '.txt': ['text/plain', 'application/octet-stream'],
  '.md': ['text/markdown', 'text/plain', 'application/octet-stream'],
};

export function normalizeExtension(fileName: string) {
  const index = fileName.lastIndexOf('.');
  return index < 0 ? '' : fileName.slice(index).toLowerCase();
}

export function defaultMimeType(extension: string) {
  return (
    {
      '.pdf': 'application/pdf',
      '.docx':
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.txt': 'text/plain',
      '.md': 'text/markdown',
    }[extension] ?? 'application/octet-stream'
  );
}
