import type { Config } from 'jest';

const config: Config = {
  displayName: 'e2e',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/*.e2e.ts'],
  testTimeout: 90_000,
  maxWorkers: 1,
  transform: {
    '^.+\\.ts$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'commonjs',
          moduleResolution: 'node',
          target: 'es2022',
          esModuleInterop: true,
          strict: true,
          types: ['jest', 'node'],
        },
      },
    ],
  },
};

export default config;
