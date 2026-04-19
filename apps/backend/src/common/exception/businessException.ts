import { HttpException, HttpStatus } from '@nestjs/common'
import { ErrorCode } from '@common/utils/errorCodeMap'
import { ErrorMessageMap } from '@common/utils/errorMessageMap'
import { ErrorCodeHttpStatusMap } from '@common/utils/errorCodeHttpMap'

export class BusinessException extends HttpException {
  readonly code: ErrorCode

  constructor(
    code: ErrorCode,
    message?: string,
    httpStatus?: HttpStatus,
  ) {
    super(
      {
        code,
        message: message ?? ErrorMessageMap[code],
      },
      httpStatus ?? ErrorCodeHttpStatusMap[code] ?? HttpStatus.BAD_REQUEST,
    )
    this.code = code
  }
}
