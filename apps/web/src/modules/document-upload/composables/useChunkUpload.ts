import { computed, reactive } from "vue";
import { ApiError } from "@/types/api";
import {
  cancelChunkUpload,
  completeChunkUpload,
  getUploadStatus,
  initChunkUpload,
  uploadChunk,
} from "../api/upload.api";
import type {
  ChunkUploadState,
  FileChunkItem,
  PersistedUploadTaskSnapshot,
} from "../types/upload";
import {
  DEFAULT_UPLOAD_CHUNK_SIZE,
  splitFileIntoChunks,
} from "../utils/fileChunk";

const DEFAULT_CONCURRENCY = 3;
const DEFAULT_CHUNK_RETRY_TIMES = 3;
const UPLOAD_TASK_STORAGE_KEY = "document-upload-task";

/**
 * 文档分片上传组合式逻辑。
 */
export function useChunkUpload() {
  let pauseRequested = false;

  const state = reactive<ChunkUploadState>({
    status: "idle",
    progress: 0,
    kbId: "",
    fileName: "",
    fileHash: "",
    uploadId: null,
    documentId: null,
    uploadedChunks: [],
    totalChunks: 0,
    chunkSize: 0,
    errorMessage: "",
  });

  const isUploading = computed(
    () =>
      state.status === "hashing" ||
      state.status === "initializing" ||
      state.status === "uploading" ||
      state.status === "merging",
  );

  /**
   * 启动单个文件的完整上传流程。
   */
  async function startUpload(options: {
    kbId: string;
    file: File;
    title?: string;
    chunkSize?: number;
    onProgress?: (progress: number) => void;
    onSuccess?: (documentId: string | null) => void;
    onError?: (message: string) => void;
  }) {
    const chunkSize = options.chunkSize || DEFAULT_UPLOAD_CHUNK_SIZE;
    const chunks = splitFileIntoChunks(options.file, chunkSize);

    resetState();
    pauseRequested = false;
    state.kbId = options.kbId;
    state.fileName = options.file.name;
    state.totalChunks = chunks.length;
    state.chunkSize = chunkSize;
    state.status = "hashing";

    try {
      const fileHash = await computeFileHash(options.file);
      state.fileHash = fileHash;
      state.status = "initializing";

      const initResult = await initChunkUpload(options.kbId, {
        fileName: options.file.name,
        title: options.title,
        fileSize: options.file.size,
        mimeType: options.file.type || undefined,
        fileHash,
        chunkSize,
        totalChunks: chunks.length,
      });

      state.uploadId = initResult.uploadId;
      state.documentId = initResult.documentId;
      state.uploadedChunks = [...initResult.uploadedChunks];
      state.progress = calculateProgress(
        initResult.uploadedChunks.length,
        chunks.length,
      );

      if (initResult.isInstantUploaded) {
        state.progress = 100;
        state.status = "instantCompleted";
        clearPersistedTask();
        options.onSuccess?.(initResult.documentId);
        return initResult;
      }

      if (!initResult.uploadId) {
        throw new Error("上传会话初始化失败");
      }

      persistUploadTask({
        kbId: options.kbId,
        fileName: options.file.name,
        fileHash,
        uploadId: initResult.uploadId,
        totalChunks: chunks.length,
        chunkSize,
        title: options.title,
      });

      state.status = "uploading";
      await uploadPendingChunks(
        options.kbId,
        initResult.uploadId,
        chunks,
        new Set(initResult.uploadedChunks),
        options.onProgress,
      );

      if (pauseRequested) {
        state.status = "paused";
        return null;
      }

      state.status = "merging";
      const statusSnapshot = await getUploadStatus(
        options.kbId,
        initResult.uploadId,
      );
      const completeResult = await completeChunkUpload(
        options.kbId,
        initResult.uploadId,
        {
          fileHash,
          totalChunks: statusSnapshot.totalChunks,
        },
      );

      state.documentId = completeResult.documentId;
      state.progress = 100;
      state.status = "completed";
      clearPersistedTask();
      options.onProgress?.(100);
      options.onSuccess?.(completeResult.documentId);

      return completeResult;
    } catch (error) {
      state.status = "failed";
      state.errorMessage = resolveUploadErrorMessage(error);
      options.onError?.(state.errorMessage);
      throw error;
    }
  }

  /**
   * 基于已有上传快照恢复上传流程。
   * 该方法只负责能力层恢复，页面层后续可自行决定何时触发。
   */
  async function resumeUpload(options: {
    kbId: string;
    file: File;
    snapshot?: PersistedUploadTaskSnapshot | null;
    title?: string;
    onProgress?: (progress: number) => void;
    onSuccess?: (documentId: string | null) => void;
    onError?: (message: string) => void;
  }) {
    const snapshot = options.snapshot ?? loadPersistedTask();
    if (!snapshot) {
      return startUpload(options);
    }

    if (snapshot.kbId !== options.kbId) {
      throw new Error("上传任务所属知识库不匹配，无法恢复");
    }
    if (snapshot.fileName !== options.file.name) {
      throw new Error("当前文件与上传快照不匹配，无法恢复");
    }

    resetState();
    pauseRequested = false;
    state.kbId = options.kbId;
    state.fileName = options.file.name;
    state.chunkSize = snapshot.chunkSize;
    state.totalChunks = snapshot.totalChunks;
    state.status = "hashing";

    try {
      const fileHash = await computeFileHash(options.file);
      if (fileHash !== snapshot.fileHash) {
        throw new Error("当前文件内容与上传快照不一致，无法恢复上传");
      }

      state.fileHash = fileHash;
      state.uploadId = snapshot.uploadId;
      const chunks = splitFileIntoChunks(options.file, snapshot.chunkSize);
      const remoteStatus = await syncRemoteStatus(options.kbId, snapshot.uploadId);

      if (remoteStatus.documentId && remoteStatus.status === "merged") {
        state.documentId = remoteStatus.documentId;
        state.progress = 100;
        state.status = "completed";
        clearPersistedTask();
        options.onSuccess?.(remoteStatus.documentId);
        return {
          kbId: options.kbId,
          uploadId: snapshot.uploadId,
          documentId: remoteStatus.documentId,
          status: "uploaded",
          isInstantUploaded: false,
        };
      }

      state.status = "uploading";
      await uploadPendingChunks(
        options.kbId,
        snapshot.uploadId,
        chunks,
        new Set(remoteStatus.uploadedChunks),
        options.onProgress,
      );

      if (pauseRequested) {
        state.status = "paused";
        return null;
      }

      state.status = "merging";
      const completeResult = await completeChunkUpload(
        options.kbId,
        snapshot.uploadId,
        {
          fileHash,
          totalChunks: remoteStatus.totalChunks,
        },
      );

      state.documentId = completeResult.documentId;
      state.progress = 100;
      state.status = "completed";
      clearPersistedTask();
      options.onProgress?.(100);
      options.onSuccess?.(completeResult.documentId);

      return completeResult;
    } catch (error) {
      state.status = "failed";
      state.errorMessage = resolveUploadErrorMessage(error);
      options.onError?.(state.errorMessage);
      throw error;
    }
  }

  /**
   * 恢复本地缓存的上传任务快照，供页面刷新后继续联调。
   */
  function loadPersistedTask() {
    if (typeof window === "undefined") {
      return null;
    }

    const rawValue = window.sessionStorage.getItem(UPLOAD_TASK_STORAGE_KEY);
    if (!rawValue) {
      return null;
    }

    try {
      return JSON.parse(rawValue) as PersistedUploadTaskSnapshot;
    } catch {
      window.sessionStorage.removeItem(UPLOAD_TASK_STORAGE_KEY);
      return null;
    }
  }

  /**
   * 主动拉取服务端上传状态，并回填到本地状态快照。
   */
  async function syncRemoteStatus(kbId: string, uploadId: string) {
    const remoteStatus = await getUploadStatus(kbId, uploadId);

    state.kbId = kbId;
    state.uploadId = remoteStatus.uploadId;
    state.documentId = remoteStatus.documentId;
    state.uploadedChunks = [...remoteStatus.uploadedChunks];
    state.totalChunks = remoteStatus.totalChunks;
    state.chunkSize = remoteStatus.chunkSize;
    state.progress = calculateProgress(
      remoteStatus.uploadedChunks.length,
      remoteStatus.totalChunks,
    );

    if (remoteStatus.status === "merged" && remoteStatus.documentId) {
      state.status = "completed";
      state.progress = 100;
    }

    return remoteStatus;
  }

  /**
   * 请求暂停当前上传流程；当前轮分片完成后会在本地进入 paused 状态。
   */
  function pause() {
    if (state.status === "uploading") {
      pauseRequested = true;
    }
  }

  /**
   * 取消当前上传会话并重置本地状态。
   */
  async function cancelCurrentUpload(kbId: string) {
    if (state.uploadId) {
      await cancelChunkUpload(kbId, state.uploadId);
    }

    resetState();
  }

  const cancel = cancelCurrentUpload;

  /**
   * 清空当前上传状态。
   */
  function resetState() {
    state.status = "idle";
    state.progress = 0;
    state.kbId = "";
    state.fileName = "";
    state.fileHash = "";
    state.uploadId = null;
    state.documentId = null;
    state.uploadedChunks = [];
    state.totalChunks = 0;
    state.chunkSize = 0;
    state.errorMessage = "";
  }

  /**
   * 在 Worker 中计算完整文件哈希，避免阻塞主线程。
   */
  function computeFileHash(file: File) {
    return new Promise<string>((resolve, reject) => {
      const worker = new Worker(
        new URL("../workers/file-hash.worker.ts", import.meta.url),
        {
          type: "module",
        },
      );

      worker.onmessage = (
        event: MessageEvent<
          | {
              success: true;
              fileHash: string;
            }
          | {
              success: false;
              errorMessage: string;
            }
        >,
      ) => {
        const payload = event.data;
        worker.terminate();

        if (payload.success) {
          resolve(payload.fileHash);
          return;
        }

        reject(new Error(payload.errorMessage));
      };

      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(event.message || "文件哈希计算失败"));
      };

      worker.postMessage({ file });
    });
  }

  /**
   * 并发上传缺失分片，首版使用固定并发数控制请求数量。
   */
  async function uploadPendingChunks(
    kbId: string,
    uploadId: string,
    chunks: FileChunkItem[],
    uploadedChunkSet: Set<number>,
    onProgress?: (progress: number) => void,
  ) {
    const pendingChunks = chunks.filter(
      (item) => !uploadedChunkSet.has(item.index),
    );

    let pointer = 0;
    let completedCount = uploadedChunkSet.size;

    const runWorker = async () => {
      while (pointer < pendingChunks.length && !pauseRequested) {
        const currentChunk = pendingChunks[pointer];
        if (!currentChunk) break;
        pointer += 1;

        await uploadChunkWithRetry(kbId, uploadId, currentChunk);

        completedCount += 1;
        state.uploadedChunks = [
          ...state.uploadedChunks,
          currentChunk.index,
        ].sort((left, right) => left - right);
        state.progress = calculateProgress(completedCount, chunks.length);
        onProgress?.(state.progress);
      }
    };

    const workers = Array.from(
      { length: Math.min(DEFAULT_CONCURRENCY, pendingChunks.length || 1) },
      () => runWorker(),
    );

    await Promise.all(workers);
  }

  /**
   * 对单个分片执行有限次数重试，并在失败后向服务端重新对齐状态。
   */
  async function uploadChunkWithRetry(
    kbId: string,
    uploadId: string,
    chunk: FileChunkItem,
  ) {
    let lastError: unknown = null;

    for (let attempt = 1; attempt <= DEFAULT_CHUNK_RETRY_TIMES; attempt += 1) {
      try {
        await uploadChunk(kbId, uploadId, {
          chunkIndex: chunk.index,
          file: chunk.blob,
          fileName: `${state.fileName}.part`,
        });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < DEFAULT_CHUNK_RETRY_TIMES) {
          await syncRemoteStatus(kbId, uploadId);
        }
      }
    }

    throw lastError;
  }

  /**
   * 将上传进度统一换算为 0-99 的过程值，避免与服务端合并阶段混淆。
   */
  function calculateProgress(completedCount: number, totalChunks: number) {
    if (!totalChunks) {
      return 0;
    }

    return Math.min(99, Math.floor((completedCount / totalChunks) * 100));
  }

  /**
   * 将当前上传任务快照写入 sessionStorage，便于刷新后恢复联调。
   */
  function persistUploadTask(snapshot: PersistedUploadTaskSnapshot) {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.setItem(
      UPLOAD_TASK_STORAGE_KEY,
      JSON.stringify(snapshot),
    );
  }

  /**
   * 清理上传任务快照。
   */
  function clearPersistedTask() {
    if (typeof window === "undefined") {
      return;
    }

    window.sessionStorage.removeItem(UPLOAD_TASK_STORAGE_KEY);
  }

  /**
   * 将上传相关异常统一收敛为可展示文案。
   */
  function resolveUploadErrorMessage(error: unknown) {
    if (error instanceof ApiError) {
      return error.message;
    }
    if (error instanceof Error) {
      return error.message;
    }

    return "上传失败，请稍后重试";
  }

  return {
    state,
    isUploading,
    startUpload,
    resumeUpload,
    pause,
    cancelCurrentUpload,
    cancel,
    resetState,
    loadPersistedTask,
    syncRemoteStatus,
  };
}
