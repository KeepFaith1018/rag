import { appendFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Nest 容器尚未完成装配时的兜底启动日志。
 * 此阶段 AppLogger 可能还不可用，因此直接写入与正式日志相同的日文件。
 */
export function writeStartupFailure(message: string, error?: unknown) {
  try {
    const directory = resolve(
      process.cwd(),
      process.env.LOG_DIRECTORY || 'logs',
    );
    mkdirSync(directory, { recursive: true });
    const date = localDateKey(new Date());
    const payload: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level: 'error',
      message,
    };
    if (shouldIncludeStack() && error instanceof Error) {
      payload.stack = error.stack;
      if (error.cause instanceof Error) payload.causeStack = error.cause.stack;
    }
    appendFileSync(
      join(directory, `server-next-${date}.log`),
      `${JSON.stringify(payload)}\n`,
    );
  } catch {
    // 启动失败时不能因日志目录不可写而覆盖原始退出原因。
  }
}

export function shouldIncludeStack() {
  if (process.env.NODE_ENV === 'production') return false;
  const configured = process.env.LOG_INCLUDE_STACK;
  if (configured !== undefined) return configured === 'true';
  return process.env.NODE_ENV === 'development';
}

function localDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
