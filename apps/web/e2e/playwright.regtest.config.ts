import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

/**
 * Plan 3 Task 31: the end-to-end trades on regtest (*.e2e.spec.ts), against the whole stack that
 * regtest-setup.ts starts (stack.ts). Kept apart from playwright.config.ts, whose specs stub the
 * API per test and need no chain. Run under the test lock (regtest): one worker, one stack.
 */
const executablePath = process.env.X2F_CHROMIUM_PATH;

export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  // A trade on regtest: wallets made in the browser, the escrow set up over the relay, 12 blocks.
  timeout: 20 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  globalSetup: fileURLToPath(new URL('./regtest-setup.ts', import.meta.url)),
  outputDir: fileURLToPath(new URL('../../../.regtest/e2e-results', import.meta.url)),
  use: {
    colorScheme: 'dark',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', ...(executablePath ? { launchOptions: { executablePath } } : {}) } }],
});
