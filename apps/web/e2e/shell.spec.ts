import { expect, test, type Page } from '@playwright/test';
import { signedIn, signedOut } from './session.js';

// The shell's screens are behind the front door (owner, 8 Nov 2026): a signed-in, set-up trader
// unless a test says otherwise (a later page.route wins).
test.beforeEach(async ({ page }) => {
  await signedIn(page);
});

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

test('a terms-required answer sends the page to /terms with returnTo', async ({ page }) => {
  await page.route('**/v1/account/me', (r) => r.fulfill({ status: 403, json: { error: 'terms-required', version: '2026-10-17' } }));
  await page.goto('/sell?currency=EUR');
  await expect(page).toHaveURL(/\/terms\?returnTo=%2Fsell%3Fcurrency%3DEUR$/);
});

test('a no-wallet answer sends the page to /wallets?add=1 with returnTo', async ({ page }) => {
  await page.route('**/v1/methods?*', (r) => r.fulfill({ status: 409, json: { error: 'no-wallet' } }));
  await page.goto('/buy');
  await expect(page).toHaveURL(/\/wallets\?add=1&returnTo=%2Fbuy$/);
});

test('logged out, the first page is the front door: the login, with no links to the screens behind it, on a phone and wide', async ({ page }) => {
  await signedOut(page);
  const market: string[] = [];
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (['/v1/methods', '/v1/offers', '/v1/price', '/v1/news'].includes(path)) market.push(path);
  });
  await page.goto('/');
  await expect(page).toHaveURL('/login?returnTo=%2Fsell');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Log in');
  await expect(page.locator('nav')).toHaveCount(0);
  await expect(page.locator('[data-part="create-account"]')).toHaveAttribute('href', '/setup?returnTo=%2Fsell');
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('[data-shell="desktop"]')).toBeAttached();
  await expect(page.locator('nav')).toHaveCount(0);
  expect(market).toEqual([]);
});
