import { createHash, randomUUID } from 'node:crypto';

export const QUEUE_NAME = 'document-processing';

export function taskKey(runId: bigint | string, stage: string, scope: string) {
  return `run:${runId.toString()}:${stage}:${scope}`;
}

export function bullmqJobId(taskId: bigint | string, attemptNo: number) {
  return `task-${taskId.toString()}-attempt-${attemptNo}`;
}

export function dispatchEventKey(taskId: bigint | string, attemptNo: number) {
  return `dispatch-task-${taskId.toString()}-attempt-${attemptNo}`;
}

export function processingChannel(prefix: string, kbId: bigint | string) {
  return `${prefix}:${kbId.toString()}`;
}

export function runPrefix(documentId: bigint | string, runId: bigint | string) {
  return `documents/${documentId}/runs/${runId}/`;
}

export function executionPrefix(
  documentId: bigint | string,
  runId: bigint | string,
  taskId: bigint | string,
  executionVersion: number,
) {
  return `${runPrefix(documentId, runId)}tasks/${taskId}/executions/${executionVersion}/`;
}

export function stableExternalId(
  runId: bigint | string,
  chunkId: bigint | string,
) {
  return createHash('sha256')
    .update(`server-next:${runId}:${chunkId}`)
    .digest('hex');
}

/** RFC 4122 UUIDv5，避免引入仅用于 ID 生成的第二套运行时依赖。 */
export function uuidV5(runId: bigint | string, chunkId: bigint | string) {
  // RFC 4122 DNS namespace；服务名进入 name，namespace 始终是合法 16 字节 UUID。
  const namespace = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');
  const name = Buffer.from(
    `server-next-qdrant-points:${runId}:${chunkId}`,
    'utf8',
  );
  const digest = createHash('sha1').update(namespace).update(name).digest();
  digest[6] = (digest[6] & 0x0f) | 0x50;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = digest.subarray(0, 16).toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function newLockToken() {
  return randomUUID();
}
