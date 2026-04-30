/**
 * 文档异步处理主任务载荷。
 */
export interface DocumentProcessingJobPayload {
  documentId: string;
  kbId: string;
  processingVersion: number;
  triggerType: 'upload' | 'reparse';
  requestedBy: string;
  requestedAt: string;
}
