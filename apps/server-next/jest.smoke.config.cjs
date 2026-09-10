module.exports = {
  ...require('./jest.e2e.config.cjs'),
  testMatch: ['<rootDir>/test/e2e/**/smoke.e2e.spec.ts'],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
};
