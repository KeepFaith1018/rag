import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '@common/utils/errorCodeMap';
import { ErrorMessageMap } from '@common/utils/errorMessageMap';
import { ErrorCodeHttpStatusMap } from '@common/utils/errorCodeHttpMap';

export type BusinessExceptionLogLevel = 'warn' | 'error';

export type BusinessExceptionOptions = {
  message?: string;
  httpStatus?: HttpStatus;
  cause?: unknown;
  context?: Record<string, unknown>;
  logLevel?: BusinessExceptionLogLevel;
};

function isBusinessExceptionOptions(
  value: string | BusinessExceptionOptions | undefined,
): value is BusinessExceptionOptions {
  return typeof value === 'object' && value !== null;
}

function normalizeOptions(
  messageOrOptions?: string | BusinessExceptionOptions,
  httpStatus?: HttpStatus,
): BusinessExceptionOptions {
  if (isBusinessExceptionOptions(messageOrOptions)) {
    return messageOrOptions;
  }

  return {
    message: messageOrOptions,
    httpStatus,
  };
}

function resolveLogLevel(httpStatus: HttpStatus): BusinessExceptionLogLevel {
  return httpStatus >= HttpStatus.INTERNAL_SERVER_ERROR ? 'error' : 'warn';
}

/**
 * 统一业务异常模型。
 * 在保留业务错误码与对外消息的同时，允许携带底层 cause 和日志上下文。
 */
export class BusinessException extends HttpException {
  readonly code: ErrorCode;
  override readonly cause: unknown;
  readonly context?: Record<string, unknown>;
  readonly logLevel: BusinessExceptionLogLevel;

  constructor(code: ErrorCode);
  constructor(code: ErrorCode, message?: string, httpStatus?: HttpStatus);
  constructor(code: ErrorCode, options?: BusinessExceptionOptions);
  constructor(
    code: ErrorCode,
    messageOrOptions?: string | BusinessExceptionOptions,
    httpStatus?: HttpStatus,
  ) {
    const options = normalizeOptions(messageOrOptions, httpStatus);
    const resolvedHttpStatus =
      options.httpStatus ??
      ErrorCodeHttpStatusMap[code] ??
      HttpStatus.BAD_REQUEST;

    super(
      {
        code,
        message: options.message ?? ErrorMessageMap[code],
      },
      resolvedHttpStatus,
    );

    this.code = code;
    this.cause = options.cause;
    this.context = options.context;
    this.logLevel = options.logLevel ?? resolveLogLevel(resolvedHttpStatus);
  }
}

/**
 * 将未知异常包装为业务异常；如果本身已是业务异常，则直接透传。
 */
export function wrapBusinessException(
  error: unknown,
  code: ErrorCode,
  options: Omit<BusinessExceptionOptions, 'cause'> = {},
) {
  if (error instanceof BusinessException) {
    return error;
  }

  return new BusinessException(code, {
    ...options,
    cause: error,
  });
}
