import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@x2f/auth-client',
    include: ['test/**/*.test.ts'],
    // The end-to-end flows run a real `buildApi` on Postgres, from the API's own harness.
    globalSetup: ['../../apps/api/test/setup/postgres.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
