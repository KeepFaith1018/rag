import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
} from '@nestjs/common';
import { Response } from 'express';
import { BusinessError, ErrorKind } from '../../shared/errors/business-error';
import { ErrorCode } from '../../shared/errors/error-code';
import { RuntimeConfig } from '../config/runtime-config.service';
import { AppLogger } from '../observability/app-logger.service';
import { failure } from './api-result';

/**
 * 业务错误类别到 HTTP 状态的唯一边界映射。
 * 业务服务只表达错误语义，具体 HTTP 响应由过滤器统一生成。
 */
const statusByKind: Record<ErrorKind, number> = {
  validation: 400,
  unauthenticated: 401,
  forbidden: 403,
  'not-found': 404,
  conflict: 409,
  'rate-limit': 429,
  unavailable: 503,
  internal: 500,
};

/**
 * Nest 框架异常的安全对外映射。
 *
 * 不直接透传 HttpException 内部消息，避免框架、代理或第三方组件把实现细节及敏感数据
 * 暴露给客户端。未列出的 4xx 归一为参数错误，未列出的 5xx 归一为内部错误。
 */
const httpErrors: Record<number, [number, string]> = {
  400: [ErrorCode.PARAM_ERROR, '请求参数错误'],
  401: [ErrorCode.UNAUTHORIZED, '请先登录'],
  403: [ErrorCode.FORBIDDEN, '无权访问'],
  404: [ErrorCode.NOT_FOUND, '资源不存在'],
  409: [40900, '操作冲突'],
  413: [ErrorCode.PARAM_ERROR, '请求内容过大'],
  429: [ErrorCode.RATE_LIMITED, '请求过于频繁'],
  503: [ErrorCode.SERVICE_UNAVAILABLE, '服务暂不可用'],
};

/**
 * HTTP 全局兜底异常过滤器。
 *
 * 统一处理业务异常、Nest HTTP 异常和未知异常，同时保证失败响应结构及日志等级一致。
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(
    private readonly logger: AppLogger,
    private readonly config: RuntimeConfig,
  ) {}

  /**
   * 5xx 以 error 级别记录，其余客户端或业务拒绝以 warn 级别记录。未知异常不会向客户端
   * 透传原始消息，防止连接地址、凭证及内部堆栈泄漏。
   */
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    let status = 500;
    let code: number = ErrorCode.INTERNAL_ERROR;
    let message = '服务器内部错误';
    if (exception instanceof BusinessError) {
      status = statusByKind[exception.kind];
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      [code, message] = httpErrors[status] ?? [
        status >= 500 ? ErrorCode.INTERNAL_ERROR : ErrorCode.PARAM_ERROR,
        status >= 500 ? '服务器内部错误' : '请求失败',
      ];
    }
    const metadata = {
      status,
      code,
      errorType: exception instanceof Error ? exception.name : 'unknown',
    };
    const diagnostics =
      status >= 500 && this.config.logging.includeStack
        ? {
            stack: exception instanceof Error ? exception.stack : undefined,
            causeMessage:
              exception instanceof Error && exception.cause instanceof Error
                ? exception.cause.message
                : undefined,
            causeStack:
              exception instanceof Error && exception.cause instanceof Error
                ? exception.cause.stack
                : undefined,
          }
        : {};
    if (status >= 500)
      this.logger.error('Request failed', { ...metadata, ...diagnostics });
    else this.logger.warn('Request rejected', metadata);
    /**
     * 流式适配器在响应头发送后拥有自己的错误协议，此时不能再追加 JSON 错误体，否则会
     * 产生损坏的 SSE/文件流或触发 headers already sent 异常。
     */
    if (response.headersSent) {
      response.end();
      return;
    }
    response.status(status).json(failure(code, message));
  }
}
