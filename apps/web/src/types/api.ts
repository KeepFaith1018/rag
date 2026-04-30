/**
 * API 查询参数类型。
 */
export type ApiQueryParams = Record<
  string,
  string | number | boolean | undefined | null
>;

/**
 * API 请求体类型。
 */
export type ApiRequestBody = BodyInit | object | unknown[] | null | undefined;

/**
 * 后端统一响应结构。
 */
export interface ApiResult<T> {
  success: boolean;
  code: number;
  message: string;
  data?: T;
}

/**
 * 前端请求配置。
 */
export interface ApiRequestOptions extends Omit<RequestInit, "body"> {
  url: string;
  params?: ApiQueryParams;
  body?: ApiRequestBody;
  skipAuth?: boolean;
  skipRefreshRetry?: boolean;
  _retry?: boolean;
}

/**
 * 统一 API 异常对象，便于页面按错误码处理。
 */
export class ApiError extends Error {
  code: number;
  status: number;
  details?: unknown;

  constructor(
    message: string,
    code: number,
    status: number,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}
