import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@x2f/escrow',
    include: ['test/**/*.test.ts'],
    globalSetup: ['../../tools/regtest/global-setup.ts'],
    testTimeout: 600_000,
    hookTimeout: 600_000,
    fileParallelism: false,
  },
});
