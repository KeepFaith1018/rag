import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['dist/**', 'prisma/generated/**', '*.cjs', '*.mjs'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  prettier,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.jest },
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-imports': ['error', { patterns: ['**/server/src/**', '@common/*'] }],
    },
  },
  {
    files: ['src/platform/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['**/modules/**', '**/server/src/**', '@common/*'] }] },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: { 'no-restricted-imports': ['error', { patterns: ['@nestjs/*', '@prisma/*', '**/platform/**', '**/modules/**', '**/server/src/**'] }] },
  },
);
