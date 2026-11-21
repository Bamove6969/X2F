import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

/**
 * Plan 4 Task 21: the end-to-end dispute flows on regtest (*.e2e.spec.ts here), against the whole
 * stack with its staff side that regtest-setup.ts starts (tools/regtest/e2e/stack.ts with
 * staffStack.ts). Kept apart from playwright.config.ts, whose specs stub the staff API per test.
 * Run under the test lock (regtest): one worker, one stack. Staff pages are on the staff origin's
 * TLS front (a self-signed certificate: staffKit.staffPage sets ignoreHTTPSErrors).
 */
const executablePath = process.env.X2F_CHROMIUM_PATH;

export default defineConfig({
  testDir: '.',
  testMatch: '*.e2e.spec.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: true,
  retries: 0,
  // A dispute on regtest: a whole trade, a ruling, its payout and 12 blocks.
  timeout: 30 * 60_000,
  expect: { timeout: 30_000 },
  reporter: [['list']],
  globalSetup: fileURLToPath(new URL('./regtest-setup.ts', import.meta.url)),
  outputDir: fileURLToPath(new URL('../../../.regtest/e2e-staff-results', import.meta.url)),
  use: {
    colorScheme: 'dark',
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    actionTimeout: 30_000,
    navigationTimeout: 60_000,
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', ...(executablePath ? { launchOptions: { executablePath } } : {}) } }],
});
