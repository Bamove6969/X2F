import { defineConfig } from 'vitest/config';

/**
 * Plan 4 Task 12 (NEEDS_REGTEST_TX_PROOF): the API tests that need a real chain (monerod regtest,
 * fetched by the regtest global setup, as the escrow's and the moderation's). Kept apart from the
 * hermetic suite (vitest.config.ts), which leaves test/regtest out.
 */
export default defineConfig({
  test: {
    name: '@x2f/api-regtest',
    include: ['test/regtest/**/*.test.ts'],
    globalSetup: ['../../tools/regtest/global-setup.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
