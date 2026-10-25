// Playwright config for screen harnesses (*.harness.ts): the FIXTURES build (`vite build --mode
// fixtures`, VITE_FIXTURES=1, into dist-fixtures) served by the API's own serveWeb, so the real
// CSP and headers apply, on its own port. Harness specs stand in for a route that is not merged
// yet (Task 23's BuyerPay until Task 22's TradeRoom lands); the main config never runs them
// (it matches *.spec.ts only).
//   npx playwright test -c apps/web/e2e/harness.config.ts
import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

export const HARNESS_PORT = 4318;
const repo = fileURLToPath(new URL('../../..', import.meta.url));
const executablePath = process.env.X2F_CHROMIUM_PATH;

export default defineConfig({
  testDir: '.',
  testMatch: '*.harness.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: 'list',
  snapshotPathTemplate: `${repo}design/x2f-app/refs/{arg}{ext}`,
  updateSnapshots: 'none',
  use: {
    baseURL: `http://127.0.0.1:${HARNESS_PORT}`,
    viewport: { width: 390, height: 844 },
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', ...(executablePath ? { launchOptions: { executablePath } } : {}) } }],
  webServer: {
    command: 'npm run build -w @x2f/web -- --mode fixtures && npx tsx apps/web/e2e/serve.ts',
    cwd: repo,
    url: `http://127.0.0.1:${HARNESS_PORT}/`,
    env: { X2F_E2E_PORT: String(HARNESS_PORT), X2F_E2E_DIST: 'dist-fixtures', VITE_FIXTURES: '1' },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
