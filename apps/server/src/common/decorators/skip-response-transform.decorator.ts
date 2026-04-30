import { SetMetadata } from '@nestjs/common';

export const SKIP_RESPONSE_TRANSFORM = 'skipResponseTransform';

/**
 * 标记 Controller 方法跳过 ResponseInterceptor 的统一包装。
 * 用于 SSE 流式接口等需要直接控制响应输出的场景。
 */
export const SkipResponseTransform = () =>
  SetMetadata(SKIP_RESPONSE_TRANSFORM, true);
