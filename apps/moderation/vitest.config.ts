import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@x2f/moderation',
    include: ['test/**/*.test.ts'],
    // The real-chain tests run in their own project (vitest.regtest.config.ts).
    exclude: [...configDefaults.exclude, 'test/regtest/**'],
    globalSetup: ['./test/setup/postgres.ts'],
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
