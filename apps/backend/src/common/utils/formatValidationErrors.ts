import { ValidationError } from '@nestjs/common';

/**
 * 提取并拼接 class-validator 的错误消息，返回前端可直接展示的文本。
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  const messages: string[] = [];

  /**
   * 递归收集嵌套 DTO 中的所有约束错误消息。
   */
  const walk = (validationErrors: ValidationError[]) => {
    for (const error of validationErrors) {
      if (error.constraints) {
        messages.push(...Object.values(error.constraints));
      }

      // 兼容嵌套对象、数组元素等子级校验错误。
      if (error.children?.length) {
        walk(error.children);
      }
    }
  };

  walk(errors);

  return messages.length > 0 ? messages.join('；') : '请求参数校验失败';
}
