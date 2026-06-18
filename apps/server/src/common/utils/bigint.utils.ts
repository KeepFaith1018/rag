import { BusinessException } from '@common/exception/businessException';
import { ErrorCode } from '@common/utils/errorCodeMap';

/**
 * 将字符串安全转换为 bigint。
 *
 * 非法输入统一抛出 PARAM_ERROR 业务异常，
 * 避免原生 TypeError 泄露到前端。
 */
export function parseBigInt(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw new BusinessException(ErrorCode.PARAM_ERROR, {
      message: `无法解析 ID: ${value}`,
    });
  }
}
