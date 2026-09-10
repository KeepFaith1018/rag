module.exports = {
  ...require('./jest.config.cjs'),
  setupFiles: ['<rootDir>/test/support/real-test-setup.ts'],
  testMatch: ['<rootDir>/test/integration/**/*.integration.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  testTimeout: 15000,
};
