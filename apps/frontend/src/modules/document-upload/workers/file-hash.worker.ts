type FileHashWorkerRequest = {
  file: File;
};

type FileHashWorkerResponse =
  | {
      success: true;
      fileHash: string;
    }
  | {
      success: false;
      errorMessage: string;
    };

/**
 * 将 ArrayBuffer 转为十六进制字符串。
 */
function bufferToHex(buffer: ArrayBuffer) {
  return Array.from(new Uint8Array(buffer))
    .map((item) => item.toString(16).padStart(2, "0"))
    .join("");
}

self.onmessage = async (event: MessageEvent<FileHashWorkerRequest>) => {
  try {
    const file = event.data.file;
    const arrayBuffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", arrayBuffer);
    const response: FileHashWorkerResponse = {
      success: true,
      fileHash: bufferToHex(digest),
    };

    self.postMessage(response);
  } catch (error) {
    const response: FileHashWorkerResponse = {
      success: false,
      errorMessage: error instanceof Error ? error.message : "文件哈希计算失败",
    };

    self.postMessage(response);
  }
};

export {};
