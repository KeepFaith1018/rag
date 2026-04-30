import { ErrorCode}from "./errorCodeMap";
import { ErrorMessageMap}from "./errorMessageMap";

export class Result<T = any> {
  readonly success: boolean;
  readonly code: number;
  readonly message: string;
  readonly data?: T;

  private constructor(
    success: boolean,
    code: number,
    message: string,
    data?: T,
  ) {
    this.success = success;
    this.code = code;
    this.message = message;
    this.data = data;
  }

  /** 成功 */
  static success<T>(data: T): Result<T> {
    return new Result(true, 0, 'success', data);
  }

  /** 失败 */
  static error(code: ErrorCode, message?: string): Result<never> {
    return new Result(
      false,
      code,
      message ?? ErrorMessageMap[code] ?? 'error',
    );
  }
}
