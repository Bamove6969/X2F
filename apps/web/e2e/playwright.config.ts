import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';

export const PORT = 4317;
const repo = fileURLToPath(new URL('../../..', import.meta.url));
// Machines whose preinstalled Chromium differs from this Playwright's pinned build point at it here
// (never `playwright install` on a shared machine).
const executablePath = process.env.X2F_CHROMIUM_PATH;

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  // list prints expectParity's "parity-pixels" lines; the HTML report (gitignored) keeps the
  // reference and page images it attaches on a difference.
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
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
    // Every spec opens on a device that has already seen the welcome screen (owner, 12 Nov 2026: the
    // first visit to /sell goes to /welcome once per device); tour.spec.ts and setup.spec.ts's
    // first-device journey start from a new device. Both origins the specs open: 127.0.0.1 (baseURL)
    // and localhost (team.spec, for WebAuthn), as localStorage is per origin (review 12 Nov, B5).
    // A context a spec makes itself (browser.newContext) is a new device: it gets none of this.
    storageState: {
      cookies: [],
      origins: [`http://127.0.0.1:${PORT}`, `http://localhost:${PORT}`].map((origin) => ({ origin, localStorage: [{ name: 'x2f.welcome.seen', value: '1' }] })),
    },
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
