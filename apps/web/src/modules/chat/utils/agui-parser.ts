import type { AguiEvent } from "@/modules/chat/types/stream";

/**
 * 将增量 SSE buffer 拆成完整行和剩余未完成内容。
 */
export function splitSSEBuffer(buffer: string): {
  lines: string[];
  rest: string;
} {
  const lines = buffer.split("\n");
  const rest = lines.pop() || "";
  return { lines, rest };
}

/**
 * 解析单行 SSE data，返回 AG-UI 事件。
 */
export function parseSSELine(line: string): AguiEvent | null {
  if (!line.startsWith("data: ")) return null;

  const json = line.slice(6);
  if (json === "[DONE]") return null;

  try {
    const obj = JSON.parse(json) as Record<string, unknown>;
    if (obj && typeof obj === "object" && "type" in obj) {
      return obj as unknown as AguiEvent;
    }
    return null;
  } catch {
    return null;
  }
}
