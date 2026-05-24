import { ValidationError } from '@nestjs/common';

/** class-validator 属性名 → 中文映射 */
const PROPERTY_ZH: Record<string, string> = {
  sortBy: '排序方式',
  ownership: '归属视图',
  visibility: '可见性',
  keyword: '搜索关键词',
  page: '页码',
  pageSize: '每页条数',
  email: '邮箱',
  password: '密码',
  name: '名称',
  role: '角色',
  status: '状态',
  type: '类型',
  title: '标题',
  code: '验证码',
  username: '用户名',
  description: '描述',
  inviteCode: '邀请码',
  modelName: '模型名称',
  modelType: '模型类型',
};

/** class-validator 英文错误模板 → 中文翻译 */
const MESSAGE_PATTERNS: Array<[RegExp, string]> = [
  [/must be one of the following values: (.+)/, '取值必须为: $1'],
  [/must be a string/, '必须为字符串'],
  [/must be an integer number/, '必须为整数'],
  [/must be a valid email/, '邮箱格式不正确'],
  [/must not be less than (\d+)/, '不能小于 $1'],
  [/must not be greater than (\d+)/, '不能大于 $1'],
  [/should not be empty/, '不能为空'],
  [/must be longer than or equal to (\d+) characters/, '不能少于 $1 个字符'],
  [/must be shorter than or equal to (\d+) characters/, '不能超过 $1 个字符'],
  [/must be a number conforming to the specified constraints/, '必须为有效数字'],
];

/**
 * 将 class-validator 的英文错误消息翻译为中文，并拼接供前端直接展示。
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  const messages: string[] = [];

  const walk = (validationErrors: ValidationError[], parentProperty?: string) => {
    for (const error of validationErrors) {
      const property = PROPERTY_ZH[error.property] ?? error.property;
      const prefix = parentProperty
        ? `${parentProperty}.${property}`
        : property;

      if (error.constraints) {
        for (const rawMessage of Object.values(error.constraints)) {
          const translated = translateMessage(rawMessage);
          messages.push(`${prefix} ${translated}`);
        }
      }

      if (error.children?.length) {
        walk(error.children, prefix);
      }
    }
  };

  walk(errors);

  return messages.length > 0 ? messages.join('；') : '请求参数校验失败';
}

/** 将单条 class-validator 错误消息翻译为中文 */
function translateMessage(raw: string): string {
  for (const [pattern, template] of MESSAGE_PATTERNS) {
    if (pattern.test(raw)) {
      return raw.replace(pattern, template);
    }
  }
  return raw;
}
