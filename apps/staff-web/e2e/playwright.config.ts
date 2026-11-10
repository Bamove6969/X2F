import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

/**
 * Plan 4 Task 16: the staff app's Playwright specs. The production build is served by the staff
 * API's own serveStaffWeb with STAFF_CSP and the security headers (e2e/serve.ts), on `localhost`
 * (a WebAuthn relying party cannot be an IP address). The API is stubbed per test with page.route.
 */
export const PORT = 4318;
const repo = fileURLToPath(new URL('../../..', import.meta.url));
// As apps/web/e2e: a machine whose Chromium differs from Playwright's pinned build points at it.
const executablePath = process.env.X2F_CHROMIUM_PATH;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  // expectParity (apps/web/e2e/parity.ts) compares pixels itself; nothing writes a reference here.
  updateSnapshots: 'none',
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1280, height: 900 },
    colorScheme: 'dark',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', ...(executablePath ? { launchOptions: { executablePath } } : {}) } }],
  webServer: {
    command: 'npm run build -w @x2f/staff-web && npx tsx apps/staff-web/e2e/serve.ts',
    cwd: repo,
    url: `http://localhost:${PORT}/setup`,
    env: { X2F_E2E_PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
