import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { getRequestId } from '@common/utils/requestId';
import { BusinessException } from '../exception/businessException';
import { Result } from '../utils/result';

@Catch()
/**
 * 全局异常过滤器
 * 统一处理业务异常、框架异常和未知异常，保证接口响应结构与日志结构一致。
 */
export class AllExceptionsFilter implements ExceptionFilter {
  @Inject(WINSTON_MODULE_PROVIDER)
  private readonly logger: Logger;

  /**
   * 捕获并处理应用运行时抛出的所有异常。
   */
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const requestMeta = this.buildRequestMeta(request);

    // 业务异常
    if (exception instanceof BusinessException) {
      const res = exception.getResponse() as { code: number; message: string };

      this.logger.warn('[BusinessException]', {
        ...requestMeta,
        code: res.code,
        message: res.message,
      });

      response
        .status(exception.getStatus())
        .json(Result.error(res.code, res.message));
      return;
    }

    //  HTTP 异常（参数校验、框架异常）
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const message = this.extractHttpExceptionMessage(exception);
      const errorCode = this.mapHttpStatusToErrorCode(status);
      const logPayload = {
        ...requestMeta,
        status,
        code: errorCode,
        message,
      };

      // 4xx 更偏向客户端请求问题，记录为 warn；5xx 才记录为 error。
      if (status >= 500) {
        this.logger.error('[HttpException]', logPayload);
      } else {
        this.logger.warn('[HttpException]', logPayload);
      }

      response.status(status).json(Result.error(errorCode, message));
      return;
    }

    // 未知异常兜底
    const errorMessage = this.extractUnknownExceptionMessage(exception);
    const errorStack = exception instanceof Error ? exception.stack : undefined;

    this.logger.error('[UnknownException]', {
      ...requestMeta,
      message: errorMessage,
      stack: errorStack,
    });

    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(Result.error(ErrorCode.INTERNAL_ERROR, '服务器内部错误'));
  }

  /**
   * 构建请求上下文，避免日志中重复拼接字符串。
   */
  private buildRequestMeta(request: Request) {
    return {
      requestId: getRequestId(request),
      method: request.method,
      url: request.originalUrl || request.url,
      ip: request.ip,
    };
  }

  /**
   * 提取 HttpException 中可读的错误消息。
   * 这里会兼容 class-validator 返回的 message 数组。
   */
  private extractHttpExceptionMessage(exception: HttpException): string {
    const response = exception.getResponse();

    if (typeof response === 'string') {
      return response;
    }

    if (typeof response === 'object' && response !== null) {
      const message = (response as Record<string, unknown>).message;

      if (Array.isArray(message)) {
        return message.join('；');
      }

      if (typeof message === 'string') {
        return message;
      }
    }

    return exception.message;
  }

  /**
   * 根据 HTTP 状态码映射统一业务错误码，便于前端稳定处理。
   */
  private mapHttpStatusToErrorCode(status: HttpStatus): ErrorCode {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return ErrorCode.PARAM_ERROR;
      case HttpStatus.UNAUTHORIZED:
        return ErrorCode.UNAUTHORIZED;
      case HttpStatus.FORBIDDEN:
        return ErrorCode.FORBIDDEN;
      case HttpStatus.NOT_FOUND:
        return ErrorCode.NOT_FOUND;
      case HttpStatus.SERVICE_UNAVAILABLE:
        return ErrorCode.SERVICE_UNAVAILABLE;
      default:
        return status >= HttpStatus.INTERNAL_SERVER_ERROR
          ? ErrorCode.INTERNAL_ERROR
          : ErrorCode.PARAM_ERROR;
    }
  }

  /**
   * 提取未知异常的安全日志消息，避免直接把非 Error 对象打成异常结构。
   */
  private extractUnknownExceptionMessage(exception: unknown): string {
    if (exception instanceof Error) {
      return exception.message;
    }

    if (typeof exception === 'string') {
      return exception;
    }

    try {
      return JSON.stringify(exception);
    } catch {
      return 'Unknown exception';
    }
  }
}
