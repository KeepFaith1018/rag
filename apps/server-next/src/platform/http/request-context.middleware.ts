import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { AppLogger } from '../observability/app-logger.service';
import { ExecutionContextStore } from '../observability/execution-context.service';

/**
 * 为每个 HTTP 请求建立可追踪的执行上下文，并在响应结束时记录访问日志。
 *
 * 外部 requestId 只有满足受限字符集和长度要求时才会被信任，否则生成新的 UUID，
 * 防止攻击者通过响应头或结构化日志注入任意内容。
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  constructor(
    private readonly context: ExecutionContextStore,
    private readonly logger: AppLogger,
  ) {}
  use(request: Request, response: Response, next: NextFunction) {
    const incoming = request.get('x-request-id');
    const requestId =
      incoming && /^[a-zA-Z0-9_-]{1,64}$/.test(incoming)
        ? incoming
        : randomUUID();
    response.setHeader('x-request-id', requestId);
    const start = performance.now();
    /**
     * 监听 finish 而不是仅记录 Controller 正常返回，因此成功响应和由异常过滤器生成的
     * 失败响应都会产生一条包含最终 HTTP 状态与耗时的访问日志。
     *
     * 日志有意不包含 query、body、headers 和任意 URL token，避免凭证及隐私数据泄漏。
     */
    response.once('finish', () =>
      this.logger.log('HTTP request', {
        requestId,
        method: request.method,
        status: response.statusCode,
        durationMs: Math.round(performance.now() - start),
      }),
    );
    /**
     * AsyncLocalStorage 必须包裹 next 调用，后续 Guard、Pipe、Controller、Interceptor 和
     * ExceptionFilter 才能从同一异步调用链读取 requestId。
     */
    this.context.run({ requestId }, next);
  }
}
