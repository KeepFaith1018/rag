import { Injectable, LoggerService, OnModuleDestroy } from '@nestjs/common';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { inspect } from 'node:util';
import { createLogger, format, Logger, transports } from 'winston';
import { RuntimeConfig } from '../config/runtime-config.service';
import { ExecutionContextStore } from './execution-context.service';

type WinstonLevel = 'error' | 'warn' | 'info' | 'debug' | 'verbose';

interface NormalizedLog {
  message: unknown;
  metadata: Record<string, unknown>;
}

/**
 * 应用统一日志服务。
 *
 * Winston 负责日志分发：Console transport 输出彩色文本，File transport 输出按日切换的
 * JSON 文件。这里仅负责适配 Nest LoggerService、合并执行上下文和规范化日志参数，不修改
 * 日志内容。
 */
@Injectable()
export class AppLogger implements LoggerService, OnModuleDestroy {
  private readonly logger: Logger;
  private readonly fileEnabled: boolean;
  private readonly includeStack: boolean;
  private readonly logDirectory: string;
  private readonly retentionDays: number;
  private currentFileDate = '';
  private dailyFileTransport?: transports.FileTransportInstance;

  constructor(
    config: RuntimeConfig,
    private readonly context: ExecutionContextStore,
  ) {
    const logging = config.logging;
    this.includeStack = logging.includeStack;
    this.fileEnabled = logging.fileEnabled;
    this.logDirectory = resolve(process.cwd(), logging.directory);
    this.retentionDays = logging.retentionDays;

    this.logger = createLogger({
      level: logging.level === 'silent' ? 'info' : logging.level,
      silent: logging.level === 'silent',
      transports: [
        new transports.Console({
          format: createConsoleFormat(),
        }),
      ],
    });

    if (this.fileEnabled) this.rotateDailyFile();
  }

  /**
   * 统一日志入口。普通对象参数会展开到 JSON 顶层，Nest 的字符串 context 和 error stack
   * 会分别记录为 context、stack，避免把参数无区分地塞进 details 数组。
   */
  private write(
    level: WinstonLevel,
    message: unknown,
    optionalParams: unknown[],
  ) {
    if (this.fileEnabled) this.rotateDailyFile();

    const normalized = normalizeLogArguments(
      level,
      message,
      optionalParams,
      this.includeStack,
    );
    this.logger.log({
      ...normalized.metadata,
      ...this.context.get(),
      level,
      message: normalized.message as string,
    });
  }

  /** 按服务器本地自然日切换文件，文件名示例：server-next-2026-09-10.log。 */
  private rotateDailyFile() {
    const date = localDateKey(new Date());
    if (date === this.currentFileDate) return;

    mkdirSync(this.logDirectory, { recursive: true });
    const next = new transports.File({
      filename: join(this.logDirectory, `server-next-${date}.log`),
      format: createFileFormat(),
    });
    const previous = this.dailyFileTransport;
    this.logger.add(next);
    this.dailyFileTransport = next;
    this.currentFileDate = date;
    if (previous) this.logger.remove(previous);
    this.cleanupOldFiles();
  }

  /** 只清理本 logger 产生的日期文件，不触碰目录中的其他文件。 */
  private cleanupOldFiles() {
    const files = readdirSync(this.logDirectory)
      .filter((name) => /^server-next-\d{4}-\d{2}-\d{2}\.log$/.test(name))
      .sort()
      .reverse();
    for (const file of files.slice(this.retentionDays)) {
      unlinkSync(join(this.logDirectory, file));
    }
  }

  log(message: unknown, ...optionalParams: unknown[]) {
    this.write('info', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]) {
    this.write('warn', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]) {
    this.write('error', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]) {
    this.write('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]) {
    this.write('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]) {
    this.write('error', message, optionalParams);
  }

  /**
   * 应用关闭时释放 Winston Transport，避免测试或优雅停机阶段残留打开的资源句柄。
   */
  onModuleDestroy() {
    this.logger.close();
  }
}

function createConsoleFormat() {
  return format.combine(
    format.timestamp({ format: 'YYYY/MM/DD hh:mm:ss' }),
    format.printf(
      ({ timestamp, level, message, context, stack, ...metadata }) => {
        const renderedMessage = renderMessage(message);
        const renderedMetadata = Object.keys(metadata).length
          ? ` ${inspect(metadata, { colors: false, depth: 5, compact: true })}`
          : '';
        const renderedContext =
          typeof context === 'string' ? ` [${context}]` : '';
        const renderedStack = typeof stack === 'string' ? `\n${stack}` : '';

        const renderedLevel = String(level).toUpperCase().padStart(7);
        return `${renderedContext} ${process.pid}  ${String(timestamp)} ${renderedLevel} ${renderedMessage}${renderedMetadata}${renderedStack}`;
      },
    ),
    // 放在 printf 之后，确保整行文本按日志级别着色，而不是只给等级字段着色。
    format.colorize({ all: true }),
  );
}

function createFileFormat() {
  return format.combine(format.timestamp(), format.json());
}

function normalizeLogArguments(
  level: WinstonLevel,
  message: unknown,
  optionalParams: unknown[],
  includeStack: boolean,
): NormalizedLog {
  const params = [...optionalParams];
  const metadata: Record<string, unknown> = {};
  let context: string | undefined;
  let stack: string | undefined;

  if (level === 'error') {
    const last = params.at(-1);
    if (typeof last === 'string') {
      if (params.length === 1) {
        if (looksLikeStack(last)) stack = last;
        else context = last;
        params.pop();
      } else {
        context = params.pop() as string;
        if (typeof params[0] === 'string' && looksLikeStack(params[0])) {
          stack = params.shift() as string;
        }
      }
    }
  } else {
    const last = params.at(-1);
    if (typeof last === 'string') context = params.pop() as string;
  }

  const extraValues: unknown[] = [];
  for (const param of params) {
    if (isRecord(param)) {
      Object.assign(metadata, serializeValue(param, includeStack));
    } else {
      extraValues.push(serializeValue(param, includeStack));
    }
  }

  if (extraValues.length === 1) metadata.details = extraValues[0];
  else if (extraValues.length > 1) metadata.details = extraValues;
  if (context) metadata.context = context;
  if (stack && includeStack) metadata.stack = stack;

  return {
    message: serializeValue(message, includeStack),
    metadata,
  };
}

function serializeValue(
  value: unknown,
  includeStack: boolean,
  seen = new WeakSet<object>(),
): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) {
    if (seen.has(value)) return '[Circular]';
    seen.add(value);
    const serialized: Record<string, unknown> = {
      name: value.name,
      message: value.message,
    };
    if (includeStack && value.stack) serialized.stack = value.stack;
    if (value.cause !== undefined)
      serialized.cause = serializeValue(value.cause, includeStack, seen);
    return serialized;
  }
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value))
    return value.map((item) => serializeValue(item, includeStack, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      serializeValue(item, includeStack, seen),
    ]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Error)
  );
}

function looksLikeStack(value: string) {
  return value.includes('\n    at ') || /^\w*Error(?::|\n)/.test(value);
}

function renderMessage(message: unknown) {
  return typeof message === 'string'
    ? message
    : inspect(message, { colors: false, depth: 5, compact: true });
}

function localDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
