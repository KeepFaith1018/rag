/**
 * API 成功响应契约。判别字段 success 为 true，业务成功码固定为 0。
 */
export interface ApiSuccess<T> {
  success: true;
  code: 0;
  message: string;
  data: T;
}

/**
 * API 失败响应契约。失败响应不携带 data，避免调用方误用部分结果。
 */
export interface ApiFailure {
  success: false;
  code: number;
  message: string;
}

/**
 * 创建统一成功响应；实际包装由 ResponseInterceptor 在 HTTP 边界完成。
 */
export function success<T>(data: T): ApiSuccess<T> {
  return { success: true, code: 0, message: '成功', data };
}

/**
 * 创建统一失败响应；异常过滤器负责决定业务错误码和对外消息。
 */
export function failure(code: number, message: string): ApiFailure {
  return { success: false, code, message };
}
