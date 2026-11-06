import { expect, test, type Page } from '@playwright/test';

declare global {
  interface Window {
    __cspViolations?: string[];
  }
}

/** Records CSP violations from the first script on, and every request that leaves the page's origin. */
async function watch(page: Page, origin: string): Promise<{ violations: string[]; foreign: string[] }> {
  const violations: string[] = [];
  const foreign: string[] = [];
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__cspViolations?.push(`${e.effectiveDirective} ${e.blockedURI}`);
    });
  });
  page.on('console', (m) => {
    if (/content security policy/i.test(m.text())) violations.push(m.text());
  });
  page.on('request', (r) => {
    if (new URL(r.url()).origin !== origin) foreign.push(r.url());
  });
  return { violations, foreign };
}

test('/sell loads with zero CSP violations and zero requests to other origins', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin;
  const seen = await watch(page, origin);
  const res = await page.goto('/sell');
  expect(res?.status()).toBe(200);
  expect(res?.headers()['content-security-policy']).toContain("default-src 'none'");
  await expect(page.locator('#root > *').first()).toBeAttached();
  // The phone layout has the bottom nav.
  await expect(page.locator('nav[aria-label="Main"]')).toBeAttached();
  // Every face the boards use loads from this origin under font-src 'self'.
  const loaded = await page.evaluate(async () => {
    const faces = ['700 24px "Familjen Grotesk"', '400 16px "Atkinson Hyperlegible Next"', '500 16px "Atkinson Hyperlegible Mono"'];
    const results = await Promise.all(faces.map((f) => document.fonts.load(f, 'X2F 1.250000')));
    return results.map((r) => r.length);
  });
  expect(loaded.every((n) => n > 0)).toBe(true);
  await page.waitForLoadState('networkidle');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(14, 17, 22)');
  expect(await page.evaluate(() => window.__cspViolations)).toEqual([]);
  expect(seen.violations).toEqual([]);
  expect(seen.foreign).toEqual([]);
});

test('at 1024 px and wider the desktop shell replaces the bottom nav', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/sell');
  await expect(page.locator('[data-shell="desktop"]')).toBeAttached();
  await expect(page.locator('[data-shell="phone"]')).toHaveCount(0);
});

test('Buy and Sell show one Site news bell on the phone and on the Desktop layout (review I3)', async ({ page }) => {
  for (const path of ['/buy', '/sell']) {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(path);
    await expect(page.locator('.x2f-browse__header')).toBeVisible();
    await expect(page.locator('[data-part="news-bell"]:visible')).toHaveCount(1);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('[data-shell="desktop"]')).toBeAttached();
    // The desktop header's bell is the one; Buy/Sell's own header keeps it hidden there.
    await expect(page.locator('[data-part="news-bell"]:visible')).toHaveCount(1);
    await expect(page.locator('.x2f-desktop__header [data-part="news-bell"]')).toBeVisible();
  }
});

test('a terms-required answer sends the page to /terms with returnTo', async ({ page }) => {
  await page.route('**/v1/account/me', (r) => r.fulfill({ status: 403, json: { error: 'terms-required', version: '2026-10-17' } }));
  await page.goto('/sell?currency=EUR');
  await expect(page).toHaveURL(/\/terms\?returnTo=%2Fsell%3Fcurrency%3DEUR$/);
});

test('a no-wallet answer sends the page to /wallets?add=1 with returnTo', async ({ page }) => {
  await page.route('**/v1/account/me', (r) => r.fulfill({ status: 409, json: { error: 'no-wallet' } }));
  await page.goto('/buy');
  await expect(page).toHaveURL(/\/wallets\?add=1&returnTo=%2Fbuy$/);
});
