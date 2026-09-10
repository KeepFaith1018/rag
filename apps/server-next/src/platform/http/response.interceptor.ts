import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  SetMetadata,
  StreamableFile,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { map } from 'rxjs';
import { toJsonValue } from '../../shared/serialization';
import { success } from './api-result';

const RAW_RESPONSE = 'http.raw-response';

/**
 * 标记 Controller 或处理方法跳过统一成功响应包装。
 *
 * 适用于 SSE、自定义协议或已自行控制响应结构的端点；普通文件下载无需标记，
 * ResponseInterceptor 会自动识别 StreamableFile。
 */
export const RawResponse = () => SetMetadata(RAW_RESPONSE, true);

/**
 * 将普通 Controller 返回值转换为统一成功响应，并在输出边界完成 JSON 安全序列化。
 */
@Injectable()
export class ResponseInterceptor implements NestInterceptor<unknown, unknown> {
  constructor(private readonly reflector: Reflector) {}
  intercept(context: ExecutionContext, next: CallHandler<unknown>) {
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE, [
      context.getHandler(),
      context.getClass(),
    ]);
    /**
     * `undefined` 被规范化为 `null`，使无返回值接口也具有稳定的 data 字段；原始响应和
     * 文件流保持原值，避免破坏流式协议或二进制内容。
     */
    return next
      .handle()
      .pipe(
        map((value) =>
          raw || value instanceof StreamableFile
            ? value
            : success(toJsonValue(value ?? null)),
        ),
      );
  }
}
