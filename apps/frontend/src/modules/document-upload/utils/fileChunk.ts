import type { FileChunkItem } from "../types/upload";

/**
 * 默认分片大小：5MB。
 */
export const DEFAULT_UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024;

/**
 * 按固定分片大小切分文件，供后续分片上传使用。
 */
export function splitFileIntoChunks(
  file: File,
  chunkSize = DEFAULT_UPLOAD_CHUNK_SIZE,
): FileChunkItem[] {
  const chunks: FileChunkItem[] = [];
  let start = 0;
  let index = 0;

  while (start < file.size) {
    const end = Math.min(start + chunkSize, file.size);
    const blob = file.slice(start, end);

    chunks.push({
      index,
      start,
      end,
      size: end - start,
      blob,
    });

    start = end;
    index += 1;
  }

  return chunks;
}
