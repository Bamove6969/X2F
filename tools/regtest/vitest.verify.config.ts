import { defineConfig } from 'vitest/config';

// Offline project: no globalSetup, so these tests never touch the network.
export default defineConfig({
  test: { name: 'regtest-verify', include: ['verify-release.test.ts'], testTimeout: 60_000 },
});
