module.exports = {
  ...require('./jest.config.cjs'),
  setupFiles: ['<rootDir>/test/support/real-test-setup.ts'],
  testMatch: ['<rootDir>/test/e2e/**/*.e2e.spec.ts'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/test/e2e/smoke.e2e.spec.ts',
  ],
  testTimeout: 30000,
};
