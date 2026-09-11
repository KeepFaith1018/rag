import { computed, ref } from "vue";
import { useChunkUpload } from "./useChunkUpload";
import type { UploadLifecycleStatus } from "../types/upload";

export interface UploadQueueTask {
  id: string;
  kbId: string;
  fileName: string;
  fileSize: number;
  status: UploadLifecycleStatus;
  progress: number;
  uploadedBytes: number;
  sessionId: string | null;
  documentId: string | null;
  errorMessage: string;
}

const MAX_FILE_CONCURRENCY = 2;

/** 批量文件队列：文件并发 2，单文件内部 part 并发 3。 */
export function useUploadQueue() {
  const tasks = ref<UploadQueueTask[]>([]);
  const activeUploaders = new Map<string, ReturnType<typeof useChunkUpload>>();
  const runningCount = ref(0);
  let pumpScheduled = false;
  let completedHandler: (() => void) | undefined;

  const overallProgress = computed(() => {
    const total = tasks.value.reduce((sum, task) => sum + task.fileSize, 0);
    const uploaded = tasks.value.reduce((sum, task) => sum + task.uploadedBytes, 0);
    return total ? Math.min(100, Math.floor((uploaded / total) * 100)) : 0;
  });
  const isBusy = computed(() =>
    tasks.value.some((task) =>
      ["hashing", "initializing", "uploading", "completing"].includes(task.status),
    ),
  );

  function enqueue(files: FileList | File[], kbId: string) {
    const incoming = Array.from(files);
    const existing = new Set(
      tasks.value
        .filter((task) => task.status !== "cancelled")
        .map((task) => `${task.kbId}:${task.fileName}:${task.fileSize}`),
    );
    for (const file of incoming) {
      const key = `${kbId}:${file.name}:${file.size}`;
      if (existing.has(key)) continue;
      existing.add(key);
      tasks.value.push({
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        kbId,
        fileName: file.name,
        fileSize: file.size,
        status: "queued",
        progress: 0,
        uploadedBytes: 0,
        sessionId: null,
        documentId: null,
        errorMessage: "",
      });
      filesByTask.set(tasks.value.at(-1)!.id, file);
    }
    schedulePump();
  }

  function schedulePump() {
    if (pumpScheduled) return;
    pumpScheduled = true;
    queueMicrotask(() => {
      pumpScheduled = false;
      void pump();
    });
  }

  async function pump() {
    while (runningCount.value < MAX_FILE_CONCURRENCY) {
      const task = tasks.value.find((item) => item.status === "queued");
      if (!task) return;
      const file = filesByTask.get(task.id);
      if (!file) {
        task.status = "failed";
        task.errorMessage = "文件对象已丢失，请重新选择文件";
        continue;
      }
      runningCount.value += 1;
      task.status = "hashing";
      const uploader = useChunkUpload();
      activeUploaders.set(task.id, uploader);
      void runTask(task, file, uploader);
    }
  }

  async function runTask(
    task: UploadQueueTask,
    file: File,
    uploader: ReturnType<typeof useChunkUpload>,
  ) {
    try {
      const result = await uploader.startUpload({
        kbId: task.kbId,
        file,
        onProgress: (progress, uploadedBytes) => {
          task.progress = progress;
          task.uploadedBytes = uploadedBytes;
          task.sessionId = uploader.state.sessionId;
          task.status = uploader.state.status;
        },
        onSuccess: (documentId) => {
          task.documentId = documentId;
          task.uploadedBytes = task.fileSize;
          task.progress = 100;
          task.status = uploader.state.status;
          completedHandler?.();
          removeTask(task.id);
        },
        onError: (message) => {
          task.errorMessage = message;
          task.status = "failed";
        },
      });
      if (result === null && task.status !== "cancelled") task.status = "paused";
    } catch (error) {
      task.status = "failed";
      task.errorMessage = error instanceof Error ? error.message : "上传失败";
    } finally {
      runningCount.value -= 1;
      activeUploaders.delete(task.id);
      if (task.status === "hashing" || task.status === "initializing" || task.status === "uploading" || task.status === "completing") {
        task.status = "failed";
        task.errorMessage ||= "上传未完成";
      }
      schedulePump();
    }
  }

  function pauseAll() {
    for (const uploader of activeUploaders.values()) uploader.pause();
    for (const task of tasks.value) if (task.status === "queued") task.status = "paused";
  }

  function resumeAll() {
    for (const task of tasks.value) {
      if (task.status === "paused" || task.status === "failed") {
        task.status = "queued";
        task.errorMessage = "";
      }
    }
    schedulePump();
  }

  async function cancelTask(taskId: string) {
    const task = tasks.value.find((item) => item.id === taskId);
    if (!task) return;
    const uploader = activeUploaders.get(taskId);
    if (uploader) {
      try {
        await uploader.cancelCurrentUpload(task.kbId);
      } catch (error) {
        task.errorMessage = error instanceof Error ? error.message : "取消上传失败";
      }
    }
    task.status = "cancelled";
    task.errorMessage = "";
  }

  function retryTask(taskId: string) {
    const task = tasks.value.find((item) => item.id === taskId);
    if (!task || task.status !== "failed") return;
    task.status = "queued";
    task.errorMessage = "";
    schedulePump();
  }

  function clearCompleted() {
    const removed = new Set(
      tasks.value.filter((task) => ["completed", "instantCompleted", "cancelled"].includes(task.status)).map((task) => task.id),
    );
    for (const id of removed) removeTask(id);
  }

  function removeTask(taskId: string) {
    tasks.value = tasks.value.filter((task) => task.id !== taskId);
    filesByTask.delete(taskId);
  }

  function setCompletedHandler(handler: (() => void) | undefined) {
    completedHandler = handler;
  }

  const filesByTask = new Map<string, File>();

  return {
    tasks,
    overallProgress,
    isBusy,
    enqueue,
    pauseAll,
    resumeAll,
    cancelTask,
    retryTask,
    clearCompleted,
    setCompletedHandler,
  };
}
