import { randomUUID } from 'node:crypto';
import { Request, Response } from 'express';

export const REQUEST_ID_HEADER = 'x-request-id';

export type RequestWithRequestId = Request & {
  requestId?: string;
};

/**
 * 为当前请求解析并设置 requestId。
 * 优先复用上游网关透传的 `x-request-id`，否则由服务端生成一个新的 UUID。
 */
export function bindRequestId(
  request: Request,
  response: Response,
): string {
  const incomingRequestId = request.headers[REQUEST_ID_HEADER];
  const requestId =
    typeof incomingRequestId === 'string' && incomingRequestId.trim()
      ? incomingRequestId.trim()
      : randomUUID();

  (request as RequestWithRequestId).requestId = requestId;
  response.setHeader(REQUEST_ID_HEADER, requestId);

  return requestId;
}

/**
 * 获取当前请求上的 requestId。
 */
export function getRequestId(request: Request): string | undefined {
  return (request as RequestWithRequestId).requestId;
}
