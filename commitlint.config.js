module.exports = {
  extends: ['@commitlint/config-conventional'],
  rules: {
    'type-enum': [
      2,
      'always',
      [
        'feat',     // 新功能
        'fix',      // 修复bug
        'docs',     // 文档变更
        'style',    // 代码格式（不影响功能）
        'refactor', // 重构（既不是feat也不是fix）
        'perf',     // 性能优化
        'test',     // 测试
        'build',    // 构建系统或外部依赖变更
        'ci',       // CI配置
        'chore',    // 其他变更（不修改src/test）
        'revert',   // 回退
      ],
    ],
    'type-case': [2, 'always', 'lower-case'],
    'type-empty': [2, 'never'],  // 不允许空type
    'subject-empty': [2, 'never'], // 不允许空subject
    'subject-full-stop': [2, 'never', '.'], // subject不以句号结尾
    'header-max-length': [2, 'always', 100],
  },
};
