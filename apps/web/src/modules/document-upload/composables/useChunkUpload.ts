import { computed, reactive } from "vue";
import { ApiError } from "@/types/api";
import {
  cancelUpload,
  completeUpload,
  confirmUploadPart,
  getUploadStatus,
  initUpload,
  putSignedPart,
  signUploadPart,
} from "../api/upload.api";
import type {
  ChunkUploadState,
  PersistedUploadTaskSnapshot,
  UploadPartSnapshot,
} from "../types/upload";
import { DEFAULT_UPLOAD_CHUNK_SIZE } from "../utils/fileChunk";

const DEFAULT_PART_CONCURRENCY = 3;
const DEFAULT_RETRY_TIMES = 3;
const UPLOAD_TASK_STORAGE_KEY = "document-upload-task-v2";

/** 单文件 Multipart 上传编排；批量并发由 useUploadQueue 控制。 */
export function useChunkUpload() {
  let pauseRequested = false;

  const state = reactive<ChunkUploadState>({
    status: "queued",
    progress: 0,
    uploadedBytes: 0,
    totalBytes: 0,
    kbId: "",
    fileName: "",
    fileSha256: "",
    sessionId: null,
    documentId: null,
    uploadedParts: 0,
    totalParts: 0,
    partSize: DEFAULT_UPLOAD_CHUNK_SIZE,
    errorMessage: "",
  });

  const isUploading = computed(() =>
    ["hashing", "initializing", "uploading", "completing"].includes(
      state.status,
    ),
  );

  async function startUpload(options: {
    kbId: string;
    file: File;
    title?: string;
    onProgress?: (progress: number, uploadedBytes: number) => void;
    onSuccess?: (documentId: string | null) => void;
    onError?: (message: string) => void;
  }) {
    resetState();
    pauseRequested = false;
    state.status = "hashing";
    state.kbId = options.kbId;
    state.fileName = options.file.name;
    state.totalBytes = options.file.size;

    try {
      const fileSha256 = await computeFileHash(options.file);
      state.fileSha256 = fileSha256;
      state.status = "initializing";
      const initResult = await initUpload(options.kbId, {
        fileName: options.file.name,
        title: options.title,
        fileSize: options.file.size,
        mimeType: options.file.type || inferMimeType(options.file.name),
        clientSha256: fileSha256,
      });

      if (initResult.isInstantUploaded) {
        state.status = "instantCompleted";
        state.progress = 100;
        state.uploadedBytes = options.file.size;
        state.documentId = initResult.documentId;
        clearPersistedTask();
        options.onProgress?.(100, options.file.size);
        options.onSuccess?.(initResult.documentId);
        return initResult;
      }

      const sessionId = initResult.uploadId ?? initResult.sessionId;
      if (!sessionId) throw new Error("上传会话初始化失败");
      state.sessionId = sessionId;
      state.partSize = initResult.partSize ?? DEFAULT_UPLOAD_CHUNK_SIZE;
      state.totalParts = initResult.totalParts ?? Math.ceil(options.file.size / state.partSize);
      persistUploadTask({
        kbId: options.kbId,
        sessionId,
        fileName: options.file.name,
        fileSize: options.file.size,
        fileSha256,
        partSize: state.partSize,
        totalParts: state.totalParts,
        status: "uploading",
        recentError: null,
      });

      state.status = "uploading";
      await uploadPendingParts(options.file, options.kbId, sessionId, initResult.uploadedParts ?? [], options.onProgress);
      if (pauseRequested) {
        state.status = "paused";
        persistCurrentTask();
        return null;
      }

      state.status = "completing";
      persistCurrentTask();
      const completeResult = await completeUpload(options.kbId, sessionId);
      state.status = "completed";
      state.progress = 100;
      state.uploadedBytes = options.file.size;
      state.documentId = completeResult.documentId;
      clearPersistedTask();
      options.onProgress?.(100, options.file.size);
      options.onSuccess?.(completeResult.documentId);
      return completeResult;
    } catch (error) {
      state.status = "failed";
      state.errorMessage = resolveUploadErrorMessage(error);
      persistCurrentTask();
      options.onError?.(state.errorMessage);
      throw error;
    }
  }

  async function resumeUpload(options: Parameters<typeof startUpload>[0]) {
    return startUpload(options);
  }

  async function syncRemoteStatus(kbId: string, sessionId: string) {
    const remote = await getUploadStatus(kbId, sessionId);
    state.kbId = kbId;
    state.sessionId = sessionId;
    state.fileName = remote.fileName;
    state.totalBytes = Number(remote.fileSize);
    state.partSize = remote.partSize;
    state.totalParts = remote.totalParts;
    state.uploadedParts = remote.uploadedParts.length;
    state.uploadedBytes = Number(remote.uploadedBytes);
    state.progress = calculateProgress(state.uploadedBytes, state.totalBytes);
    state.documentId = remote.documentId;
    if (remote.status === "completed" && remote.documentId) {
      state.status = "completed";
      state.progress = 100;
    }
    return remote;
  }

  function pause() {
    if (state.status === "uploading") pauseRequested = true;
  }

  async function cancelCurrentUpload(kbId: string) {
    pauseRequested = true;
    if (state.sessionId) await cancelUpload(kbId, state.sessionId);
    state.status = "cancelled";
    clearPersistedTask();
  }

  function resetState() {
    state.status = "queued";
    state.progress = 0;
    state.uploadedBytes = 0;
    state.totalBytes = 0;
    state.kbId = "";
    state.fileName = "";
    state.fileSha256 = "";
    state.sessionId = null;
    state.documentId = null;
    state.uploadedParts = 0;
    state.totalParts = 0;
    state.partSize = DEFAULT_UPLOAD_CHUNK_SIZE;
    state.errorMessage = "";
  }

  function loadPersistedTask() {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(UPLOAD_TASK_STORAGE_KEY);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as PersistedUploadTaskSnapshot;
    } catch {
      window.localStorage.removeItem(UPLOAD_TASK_STORAGE_KEY);
      return null;
    }
  }

  async function uploadPendingParts(
    file: File,
    kbId: string,
    sessionId: string,
    uploadedParts: UploadPartSnapshot[],
    onProgress?: (progress: number, uploadedBytes: number) => void,
  ) {
    const uploaded = new Map(
      uploadedParts.map((part) => [part.partNumber, part.size ?? 0]),
    );
    const totalParts = state.totalParts;
    state.uploadedParts = uploaded.size;
    state.uploadedBytes = [...uploaded.values()].reduce((sum, size) => sum + size, 0);
    state.progress = calculateProgress(state.uploadedBytes, state.totalBytes);
    onProgress?.(state.progress, state.uploadedBytes);

    const pending = Array.from({ length: totalParts }, (_, index) => index + 1).filter(
      (partNumber) => !uploaded.has(partNumber),
    );
    let pointer = 0;
    const progressByPart = new Map<number, number>();

    const runWorker = async () => {
      while (pointer < pending.length && !pauseRequested) {
        const partNumber = pending[pointer++];
        if (!partNumber) return;
        const start = (partNumber - 1) * state.partSize;
        const blob = file.slice(start, Math.min(start + state.partSize, file.size));
        progressByPart.set(partNumber, 0);
        await uploadPartWithRetry(
          kbId,
          sessionId,
          partNumber,
          blob,
          (loaded) => {
            progressByPart.set(partNumber, loaded);
            const transient = [...progressByPart.values()].reduce((sum, size) => sum + size, 0);
            const progress = Math.min(
              99,
              Math.floor(((state.uploadedBytes + transient) / state.totalBytes) * 100),
            );
            state.progress = progress;
            onProgress?.(progress, state.uploadedBytes + transient);
          },
        );
        const confirmedSize = blob.size;
        state.uploadedBytes += confirmedSize;
        state.uploadedParts += 1;
        progressByPart.delete(partNumber);
        state.progress = calculateProgress(state.uploadedBytes, state.totalBytes);
        onProgress?.(state.progress, state.uploadedBytes);
        persistCurrentTask();
      }
    };

    await Promise.all(
      Array.from(
        { length: Math.min(DEFAULT_PART_CONCURRENCY, pending.length || 1) },
        () => runWorker(),
      ),
    );
  }

  async function uploadPartWithRetry(
    kbId: string,
    sessionId: string,
    partNumber: number,
    blob: Blob,
    onProgress: (loaded: number) => void,
  ) {
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= DEFAULT_RETRY_TIMES; attempt += 1) {
      try {
        const signed = await signUploadPart(kbId, sessionId, partNumber);
        const etag = await putSignedPart(signed.uploadUrl, blob, onProgress);
        await confirmUploadPart(kbId, sessionId, partNumber, { etag });
        return;
      } catch (error) {
        lastError = error;
        if (attempt < DEFAULT_RETRY_TIMES)
          await new Promise((resolve) => window.setTimeout(resolve, 2 ** attempt * 300));
      }
    }
    throw lastError ?? new Error("分片上传失败");
  }

  function computeFileHash(file: File) {
    return new Promise<string>((resolve, reject) => {
      const worker = new Worker(new URL("../workers/file-hash.worker.ts", import.meta.url), {
        type: "module",
      });
      worker.onmessage = (event: MessageEvent<{ success: boolean; fileHash?: string; errorMessage?: string }>) => {
        worker.terminate();
        if (event.data.success && event.data.fileHash) resolve(event.data.fileHash);
        else reject(new Error(event.data.errorMessage ?? "文件哈希计算失败"));
      };
      worker.onerror = (event) => {
        worker.terminate();
        reject(new Error(event.message || "文件哈希计算失败"));
      };
      worker.postMessage({ file });
    });
  }

  function persistCurrentTask() {
    if (!state.kbId || !state.fileName || typeof window === "undefined") return;
    persistUploadTask({
      kbId: state.kbId,
      sessionId: state.sessionId,
      fileName: state.fileName,
      fileSize: state.totalBytes,
      fileSha256: state.fileSha256,
      partSize: state.partSize,
      totalParts: state.totalParts,
      status: state.status,
      recentError: state.errorMessage || null,
    });
  }

  function persistUploadTask(snapshot: PersistedUploadTaskSnapshot) {
    window.localStorage.setItem(UPLOAD_TASK_STORAGE_KEY, JSON.stringify(snapshot));
  }

  function clearPersistedTask() {
    if (typeof window !== "undefined") window.localStorage.removeItem(UPLOAD_TASK_STORAGE_KEY);
  }

  function calculateProgress(uploadedBytes: number, totalBytes: number) {
    if (!totalBytes) return 0;
    return Math.min(99, Math.floor((uploadedBytes / totalBytes) * 100));
  }

  function resolveUploadErrorMessage(error: unknown) {
    if (error instanceof ApiError) return error.message;
    return error instanceof Error ? error.message : "上传失败，请稍后重试";
  }

  return {
    state,
    isUploading,
    startUpload,
    resumeUpload,
    pause,
    cancelCurrentUpload,
    resetState,
    loadPersistedTask,
    syncRemoteStatus,
  };
}

function inferMimeType(fileName: string) {
  const extension = fileName.slice(fileName.lastIndexOf(".")).toLowerCase();
  return {
    ".pdf": "application/pdf",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".txt": "text/plain",
    ".md": "text/markdown",
  }[extension] ?? "application/octet-stream";
}
