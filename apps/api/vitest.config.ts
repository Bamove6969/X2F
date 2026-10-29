import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@x2f/api',
    include: ['test/**/*.test.ts'],
    globalSetup: ['./test/setup/postgres.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
