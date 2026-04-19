import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common'
import { Request, Response } from 'express'
import { WINSTON_MODULE_PROVIDER } from 'nest-winston'
import { Logger } from 'winston'
import { Result } from '../utils/result'
import { BusinessException } from '../exception/businessException'
import { ErrorCode } from '@common/utils/errorCodeMap'

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  @Inject(WINSTON_MODULE_PROVIDER)
  private readonly logger: Logger

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp()
    const response = ctx.getResponse<Response>()
    const request = ctx.getRequest<Request>()

    // 业务异常
    if (exception instanceof BusinessException) {
      const res = exception.getResponse() as { code: number; message: string }

      this.logger.warn(
        `[BusinessException] ${request.method} ${request.url} - ${JSON.stringify(res)}`,
      )

      response
        .status(exception.getStatus())
        .json(Result.error(res.code, res.message))
      return
    }

    //  HTTP 异常（参数校验、框架异常）
    if (exception instanceof HttpException) {
      const status = exception.getStatus()
      const res = exception.getResponse()
      let message = exception.message

      if (typeof res === 'string') {
        message = res
      } else if (typeof res === 'object' && res !== null) {
        const msg = (res as Record<string, unknown>).message
        if (Array.isArray(msg)) {
          message = msg.join(', ')
        } else if (typeof msg === 'string') {
          message = msg
        }
      }

      this.logger.error(
        `[HttpException] ${request.method} ${request.url} - ${status} - ${message}`,
      )

      response
        .status(status)
        .json(Result.error(ErrorCode.PARAM_ERROR, message))
      return
    }

    // 未知异常兜底
    const error = exception as Error

    this.logger.error(
      `[UnknownException] ${request.method} ${request.url}`,
      error?.stack,
    )

    response
      .status(HttpStatus.INTERNAL_SERVER_ERROR)
      .json(Result.error(ErrorCode.INTERNAL_ERROR, '服务器内部错误'))
  }
}
