import { BusinessError } from './errors/business-error';
import { ErrorCode } from './errors/error-code';

/**
 * 将 HTTP 路径或认证载荷中的十进制 ID 转换为数据库使用的 bigint。
 *
 * 仅接受 MySQL BIGINT 有符号正整数范围，避免宽松的 BigInt 转换接受符号、空白或
 * 超出数据库字段上限的值。
 */
export function parseId(value: string): bigint {
  if (!/^[1-9]\d{0,18}$/.test(value) || BigInt(value) > 9223372036854775807n) {
    throw new BusinessError(
      ErrorCode.PARAM_ERROR,
      'ID 格式不正确',
      'validation',
    );
  }
  return BigInt(value);
}
