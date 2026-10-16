import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'regtest',
    include: ['*.test.ts'],
    globalSetup: ['./global-setup.ts'],
    testTimeout: 180_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
