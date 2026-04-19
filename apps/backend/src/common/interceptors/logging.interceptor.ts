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

export class LoggingInterceptor implements NestInterceptor {
  @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger;

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const req = context.switchToHttp().getRequest<Request>()

    const { method, url } = req
    const body: unknown = req.body
    const start = Date.now()

    return next.handle().pipe(
      tap(() => {
        const time = Date.now() - start
        this.logger.info(
          `${method} ${url} - ${time}ms`,
          { body },
        )
      }),
    )
  }
}
