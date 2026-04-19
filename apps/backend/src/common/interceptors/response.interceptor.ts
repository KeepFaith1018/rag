import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common'
import { Observable } from 'rxjs'
import { map } from 'rxjs/operators'
import { Result } from '@common/utils/result';
@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {

    return (
      next
        .handle()
        // 响应
        .pipe(
          map((data) => {
            // 用自定义Result.success包装返回结果
            return Result.success(data);
          }),
        )
    );
  }
}
