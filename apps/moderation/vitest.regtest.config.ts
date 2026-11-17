import { defineConfig } from 'vitest/config';

/**
 * Plan 4 Task 14: the moderation tests that need a real chain (monerod regtest, fetched by the
 * regtest global setup, as packages/escrow's). Kept apart from the hermetic suite (vitest.config.ts).
 */
export default defineConfig({
  test: {
    name: '@x2f/moderation-regtest',
    include: ['test/regtest/**/*.test.ts'],
    globalSetup: ['../../tools/regtest/global-setup.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
