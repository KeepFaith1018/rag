import { ValidationError, ValidationPipe } from '@nestjs/common';
import { BusinessError } from '../../shared/errors/business-error';
import { ErrorCode } from '../../shared/errors/error-code';

/**
 * 将 class-validator 的树形错误结构展开为面向调用方的属性路径列表。
 *
 * 这里只暴露“哪个字段不合法”，不返回校验规则、目标对象和原始字段值，避免敏感输入
 * 被反射到响应或日志中。
 */
function messages(errors: ValidationError[], parent = ''): string[] {
  return errors.flatMap((error) => {
    const path = parent ? `${parent}.${error.property}` : error.property;
    return [
      ...Object.values(error.constraints ?? {}).map(() => `${path} 参数不合法`),
      ...messages(error.children ?? [], path),
    ];
  });
}

/**
 * 创建全局 DTO 校验管道。
 *
 * 未声明字段会被直接拒绝；所有校验失败统一转换为参数类 BusinessError，最终由全局异常
 * 过滤器输出 `400 / 40000` 响应。
 */
export function createValidationPipe() {
  return new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
    exceptionFactory: (errors) =>
      new BusinessError(
        ErrorCode.PARAM_ERROR,
        [...new Set(messages(errors))].join('；'),
        'validation',
      ),
  });
}
