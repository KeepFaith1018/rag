import { Injectable, LoggerService, OnModuleDestroy } from '@nestjs/common';
import { createLogger, format, transports } from 'winston';
import { RuntimeConfig } from '../config/runtime-config.service';
import { ExecutionContextStore } from './execution-context.service';
import { redact } from './redact';

/**
 * 应用统一结构化日志服务。
 *
 * 该服务同时作为 Nest LoggerService 和业务日志入口，负责统一日志等级、JSON 格式、
 * 执行上下文关联与敏感信息脱敏。部署环境应从标准输出采集日志。
 */
@Injectable()
export class AppLogger implements LoggerService, OnModuleDestroy {
  private readonly logger;
  constructor(
    config: RuntimeConfig,
    private readonly context: ExecutionContextStore,
  ) {
    this.logger = createLogger({
      level: config.logLevel === 'silent' ? 'info' : config.logLevel,
      silent: config.logLevel === 'silent',
      format: format.combine(format.timestamp(), format.json()),
      transports: [new transports.Console()],
    });
  }

  /**
   * 所有日志等级共享同一写入边界，确保上下文字段和脱敏规则不会因调用入口不同而遗漏。
   * 非字符串 message 使用固定事件名，原始对象随 details 一同脱敏后写入。
   */
  private write(level: string, message: unknown, details: unknown[]) {
    this.logger.log(
      level,
      typeof message === 'string' ? String(redact(message)) : 'event',
      {
        ...this.context.get(),
        details: redact([
          typeof message === 'string' ? undefined : message,
          ...details,
        ]),
      },
    );
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
