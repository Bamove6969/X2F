// Board parity for the Task 30 screens (plan: boards SetupLogin and SetupBackup, reused). Task 15's
// parity harness (apps/web/e2e/parity.ts) and its reference PNGs (design/x2f-app/refs/) are not on
// this branch yet, so each test SKIPS with the reason until both are present. The harness is loaded
// by a computed path so this file type-checks without it. When it lands: the Setup boards carry
// sign-up copy ("Step 2 of 5" ...) that a login screen does not show, so the lead adds those lines
// to the harness's KNOWN_EXCEPTIONS (or masks) when wiring these.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, type Locator, type Page, type Route } from '@playwright/test';

const HARNESS = fileURLToPath(new URL('./parity.ts', import.meta.url));
const REFS = fileURLToPath(new URL('../../../design/x2f-app/refs/', import.meta.url));

type ExpectParity = (page: Page, board: string, o?: { masks?: Locator[]; viewport?: '390x844' | '1280x800' }) => Promise<void>;

function missing(board: string): string | null {
  if (!existsSync(HARNESS)) return 'Task 15 parity harness (apps/web/e2e/parity.ts) is not on this branch yet';
  if (!existsSync(`${REFS}${board}.png`)) return `reference design/x2f-app/refs/${board}.png is absent`;
  return null;
}

async function harness(): Promise<ExpectParity> {
  const path = './parity.js';
  const mod = (await import(path)) as { expectParity: ExpectParity };
  return mod.expectParity;
}

const signedOut = (r: Route) => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'not-authenticated' }) });

for (const viewport of ['390x844', '1280x800'] as const) {
  test(`/login matches SetupLogin at ${viewport}`, async ({ page }) => {
    const why = missing('SetupLogin');
    test.skip(why !== null, why ?? '');
    await page.route('**/v1/account/me', signedOut);
    await page.goto('/login');
    await (await harness())(page, 'SetupLogin', { viewport });
  });

  test(`/login/backup matches SetupBackup at ${viewport}`, async ({ page }) => {
    const why = missing('SetupBackup');
    test.skip(why !== null, why ?? '');
    await page.route('**/v1/account/me', signedOut);
    await page.goto('/login/backup');
    await (await harness())(page, 'SetupBackup', { viewport });
  });
}
