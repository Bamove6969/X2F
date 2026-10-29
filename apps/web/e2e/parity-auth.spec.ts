// Phone checks for the Task 30 log-in screens, /login and /login/backup. No board shows these
// screens: SetupLogin and SetupBackup are the sign-up steps ("Step 2 of 5", "Add a backup way to
// log in"), so their copy is not compared here (lead decision 2026-10-26; "Login and Login/backup
// boards missing" is a design to-do for the owner). What expectParity blocks on besides copy is
// still checked, at both phone sizes: exactly one visible primary action, no sideways scroll, and
// no text-transform on a username.
import { expect, test, type Page, type Route } from '@playwright/test';

const PHONES = ['390x844', '360x800'] as const;

const signedOut = (r: Route) => r.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'not-authenticated' }) });

async function expectStructure(page: Page): Promise<void> {
  const primaries = await page
    .locator('[data-primary]')
    .evaluateAll((els) => els.filter((e) => e.checkVisibility({ visibilityProperty: true, opacityProperty: true })).length);
  expect(primaries, 'exactly one visible [data-primary]').toBe(1);
  const scroll = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
  expect(scroll.wide, 'no horizontal scroll').toBeLessThanOrEqual(scroll.view);
  const transformed = await page.locator('[data-username]').evaluateAll((els) => els.filter((e) => getComputedStyle(e).textTransform !== 'none').length);
  expect(transformed, 'no text-transform on [data-username]').toBe(0);
}

for (const v of PHONES) {
  const [width, height] = v.split('x').map(Number) as [number, number];

  test(`/login on a ${v} phone: one primary action, no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route('**/v1/account/me', signedOut);
    await page.goto('/login');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Log in');
    await expectStructure(page);
  });

  test(`/login/backup on a ${v} phone: one primary action, no sideways scroll`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.route('**/v1/account/me', signedOut);
    await page.goto('/login/backup');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Use a backup');
    await expectStructure(page);
  });
}
