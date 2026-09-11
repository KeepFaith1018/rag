import { Injectable, LoggerService, OnModuleDestroy } from '@nestjs/common';
import { mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLogger, format, transports } from 'winston';
import { RuntimeConfig } from '../config/runtime-config.service';
import { ExecutionContextStore } from './execution-context.service';
import { redact } from './redact';

/**
 * 应用统一结构化日志服务。
 *
 * 该服务同时作为 Nest LoggerService 和业务日志入口，负责统一日志等级、JSON 格式、
 * 执行上下文关联与敏感信息脱敏。默认同时输出控制台和本地滚动文件。
 */
@Injectable()
export class AppLogger implements LoggerService, OnModuleDestroy {
  private readonly logger;
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
      format: format.combine(format.timestamp(), format.json()),
      transports: [new transports.Console()],
    });
    if (this.fileEnabled) this.rotateDailyFile();
  }

  /**
   * 所有日志等级共享同一写入边界，确保上下文字段和脱敏规则不会因调用入口不同而遗漏。
   * 非字符串 message 使用固定事件名，原始对象随 details 一同脱敏后写入。
   */
  private write(level: string, message: unknown, details: unknown[]) {
    if (this.fileEnabled) this.rotateDailyFile();
    this.logger.log(
      level,
      typeof message === 'string' ? String(redact(message)) : 'event',
      {
        ...this.context.get(),
        details: redact(
          [typeof message === 'string' ? undefined : message, ...details],
          new WeakSet<object>(),
          { includeStack: this.includeStack },
        ),
      },
    );
  }

  /** 按服务器本地自然日切换文件，文件名示例：server-next-2026-09-10.log。 */
  private rotateDailyFile() {
    const date = localDateKey(new Date());
    if (date === this.currentFileDate) return;

    mkdirSync(this.logDirectory, { recursive: true });
    const next = new transports.File({
      filename: join(this.logDirectory, `server-next-${date}.log`),
    });
    const previous = this.dailyFileTransport;
    this.logger.add(next);
    this.dailyFileTransport = next;
    this.currentFileDate = date;
    if (previous) {
      this.logger.remove(previous);
      previous.close?.();
    }
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
  log(message: unknown, ...details: unknown[]) {
    this.write('info', message, details);
  }
  warn(message: unknown, ...details: unknown[]) {
    this.write('warn', message, details);
  }
  error(message: unknown, ...details: unknown[]) {
    this.write('error', message, details);
  }
  debug(message: unknown, ...details: unknown[]) {
    this.write('debug', message, details);
  }
  verbose(message: unknown, ...details: unknown[]) {
    this.write('debug', message, details);
  }
  fatal(message: unknown, ...details: unknown[]) {
    this.write('error', message, details);
  }

  /**
   * 应用关闭时释放 Winston Transport，避免测试或优雅停机阶段残留打开的资源句柄。
   */
  onModuleDestroy() {
    this.logger.close();
  }
}

function localDateKey(date: Date) {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
