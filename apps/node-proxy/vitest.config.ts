import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: '@x2f/node-proxy',
    include: ['test/**/*.test.ts'],
    // wallet.test.ts runs real monero-ts wallets against a regtest monerod.
    globalSetup: ['../../tools/regtest/global-setup.ts'],
    testTimeout: 30_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
