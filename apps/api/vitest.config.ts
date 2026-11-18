import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@x2f/api',
    include: ['test/**/*.test.ts'],
    // The chain tests are their own project (vitest.regtest.config.ts).
    exclude: ['test/regtest/**', '**/node_modules/**'],
    globalSetup: ['./test/setup/postgres.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
