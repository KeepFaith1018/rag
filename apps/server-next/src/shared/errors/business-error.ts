/**
 * 与传输协议无关的业务错误分类。
 * HTTP 边界会将分类映射为状态码，Worker 等非 HTTP 调用方也可以复用同一异常模型。
 */
export type ErrorKind =
  | 'validation'
  | 'unauthenticated'
  | 'forbidden'
  | 'not-found'
  | 'conflict'
  | 'rate-limit'
  | 'unavailable'
  | 'internal';

/**
 * 可预期业务失败的统一异常类型。
 *
 * code 供客户端进行稳定的程序化判断，message 是安全的对外文案，kind 描述错误语义。
 * 底层异常可通过 ErrorOptions.cause 保留，但不应直接返回给客户端。
 */
export class BusinessError extends Error {
  constructor(
    readonly code: number,
    message: string,
    readonly kind: ErrorKind,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'BusinessError';
  }
}
