import { configDefaults, defineConfig } from 'vitest/config';

/**
 * Flows that need Plan 2 Tasks 11 and 12 (account overview and Terms, wallets) while those are not
 * yet on the main line. They type-check against this client now; a tripwire in flows.test.ts fails
 * once those routes exist, and then this exclusion goes so they run.
 */
const NEEDS_TASKS_11_12 = ['test/flows-t11-t12.test.ts'];

export default defineConfig({
  test: {
    name: '@x2f/auth-client',
    include: ['test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, ...NEEDS_TASKS_11_12],
    // The end-to-end flows run a real `buildApi` on Postgres, from the API's own harness.
    globalSetup: ['../../apps/api/test/setup/postgres.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
