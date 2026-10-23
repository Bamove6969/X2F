import { defineConfig } from 'vitest/config';

/**
 * Flows that need Plan 2 Tasks 10-12 (login-method policy and listing, account overview and
 * Terms, wallets) while those are not yet on the main line. They type-check against this client
 * now; whoever merges Tasks 10-12 and this task together removes this exclusion so they run.
 */
const NEEDS_TASKS_10_TO_12 = ['test/flows-t10-t12.test.ts'];

export default defineConfig({
  test: {
    name: '@x2f/auth-client',
    include: ['test/**/*.test.ts'],
    exclude: NEEDS_TASKS_10_TO_12,
    // The end-to-end flows run a real `buildApi` on Postgres, from the API's own harness.
    globalSetup: ['../../apps/api/test/setup/postgres.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
