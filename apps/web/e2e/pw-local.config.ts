import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

export const PORT = 4391;
const repo = fileURLToPath(new URL('../../..', import.meta.url));
// Machines whose preinstalled Chromium differs from this Playwright's pinned build point at it here
// (never `playwright install` on a shared machine).
const executablePath = process.env.X2F_CHROMIUM_PATH;

export default defineConfig({
  testDir: '.',
  testMatch: ['chat.spec.ts', 'block.spec.ts', 'quote.spec.ts'],
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  // list prints expectParity's "parity-pixels" lines; the HTML report (gitignored) keeps the
  // reference and page images it attaches on a difference.
  reporter: [['list'], ['html', { outputFolder: '../../../.scratch/pw-report', open: 'never' }]],
  // expectParity compares pixels itself (parity.ts) and never calls toHaveScreenshot, so no snapshot
  // path is configured. 'none' stays as a guard: nothing may ever write a reference except
  // tools/parity/capture-refs.ts.
  updateSnapshots: 'none',
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    viewport: { width: 390, height: 844 },
    // The night theme, as tools/parity/capture-refs.ts shoots the references.
    colorScheme: 'dark',
    serviceWorkers: 'block',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium', ...(executablePath ? { launchOptions: { executablePath } } : {}) } }],
  webServer: {
    // The production build, served by the API's own serveWeb (so the real CSP and headers apply).
    command: 'npm run build -w @x2f/web && npx tsx apps/web/e2e/serve.ts',
    cwd: repo,
    url: `http://127.0.0.1:${PORT}/`,
    env: { X2F_E2E_PORT: String(PORT) },
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
