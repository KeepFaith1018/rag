import {
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Inject,
} from '@nestjs/common';
import { Request } from 'express'
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Observable } from 'rxjs';
import {  tap } from 'rxjs/operators';
import { Logger } from 'winston';
import { getRequestId } from '@common/utils/requestId';

/**
 * 请求日志拦截器
 * 统一记录请求耗时与基础上下文，便于通过 requestId 追踪单次请求。
 */
export class LoggingInterceptor implements NestInterceptor {
  @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger;

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>()

    const { method, url } = req
    const body: unknown = req.body
    const requestId = getRequestId(req)
    const start = Date.now()

    return next.handle().pipe(
      tap(() => {
        const time = Date.now() - start
        this.logger.info('[RequestCompleted]', {
          requestId,
          method,
          url,
          durationMs: time,
          body,
        })
      }),
    )
  }
}
