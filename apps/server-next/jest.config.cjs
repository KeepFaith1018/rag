module.exports = {
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/test/support/setup.ts'],
  testMatch: [
    '<rootDir>/test/unit/**/*.unit.spec.ts',
    '<rootDir>/test/contract/**/*.contract.spec.ts',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  modulePathIgnorePatterns: ['<rootDir>/dist/'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }] },
  moduleNameMapper: {
    '^@app/(.*)$': '<rootDir>/src/$1',
    '^@platform/(.*)$': '<rootDir>/src/platform/$1',
    '^@shared/(.*)$': '<rootDir>/src/shared/$1',
  },
};
