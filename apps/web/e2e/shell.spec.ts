import { expect, test, type Page } from '@playwright/test';
import { signedIn, signedOut } from './session.js';
import { expectPhoneLayout } from './phone.js';

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


// Job 3 (design review 8 Nov 2026, items 2 and 3): wide is the 240 px rail with logo D, never a
// stretched phone layout.
test('at 1440x900 the page sits beside a 240 px rail with logo D and is at most 720 px wide', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/sell');
  const rail = page.locator('[data-shell="desktop"] > nav.x2f-rail[aria-label="Main"]');
  await expect(rail).toBeVisible();
  const box = (await rail.boundingBox())!;
  expect([box.x, box.width]).toEqual([0, 240]);
  await expect(rail.getByRole('link', { name: 'X2F home' }).locator('svg.x2f-logo')).toBeVisible();
  await expect(rail.locator('a.x2f-rail__link')).toHaveText(['Trade', 'Post offer', 'Wallets', 'Profile', 'Settings', 'Help']);
  await expect(rail.locator('a[aria-current="page"]')).toHaveText('Trade');
  // The browse header does not repeat the logo beside the rail.
  await expect(page.locator('.x2f-browse__logo')).toBeHidden();
  const screen = (await page.locator('.x2f-browse').boundingBox())!;
  expect(screen.x).toBe(240 + 48);
  expect(screen.width).toBeLessThanOrEqual(720);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(1440);
});

test('at 1280x800 before login the logo is centred and there is no rail', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/login');
  await expect(page.locator('[data-shell="desktop"][data-wide-frame="centred"]')).toBeAttached();
  await expect(page.locator('nav.x2f-rail')).toHaveCount(0);
  const logo = (await page.locator('header.x2f-wide-top svg[role="img"][aria-label="X2F"]').boundingBox())!;
  expect(Math.abs(logo.x + logo.width / 2 - 640)).toBeLessThanOrEqual(1);
  expect(logo.height).toBe(32);
});

test('on a phone the browse header shows logo D where the letters X2F were, and no rail', async ({ page }) => {
  await page.goto('/sell');
  await expect(page.locator('.x2f-browse__logo svg[role="img"][aria-label="X2F"]')).toBeVisible();
  await expect(page.locator('nav.x2f-rail')).toHaveCount(0);
  await expect(page.locator('.x2f-bottom-nav')).toBeVisible();
});

// Review I3 and owner rule W-002 (News stays reachable after "Don't show me this again"): one Site
// news bell on every screen. On a phone it sits beside the logo in Buy/Sell's header; on wide the
// rail head carries it beside the logo (placement pending design, lead default 9 Nov) and Buy/Sell's
// header hides its own.
test('one Site news bell: in the browse header on a phone, in the rail head on wide (review I3, W-002)', async ({ page }) => {
  for (const path of ['/buy', '/sell']) {
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto(path);
    await expect(page.locator('.x2f-browse__header [data-part="news-bell"]')).toBeVisible();
    await expect(page.locator('[data-part="news-bell"]:visible')).toHaveCount(1);
    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.locator('[data-shell="desktop"]')).toBeAttached();
    // The rail's bell is the one; Buy/Sell's own header keeps it hidden there.
    await expect(page.locator('[data-part="news-bell"]:visible')).toHaveCount(1);
    await expect(page.locator('nav.x2f-rail .x2f-rail__head [data-part="news-bell"]')).toBeVisible();
    // Opened straight at wide width too, and a screen reader hears one bell, not two.
    await page.goto(path);
    await expect(page.locator('.x2f-browse__header')).toBeVisible();
    await expect(page.locator('[data-part="news-bell"]:visible')).toHaveCount(1);
    await expect(page.getByRole('link', { name: /^Site news/ })).toHaveCount(1);
  }
  // A wide screen with no browse header still has the bell, and it opens News.
  await page.goto('/wallets');
  const bell = page.locator('nav.x2f-rail [data-part="news-bell"]');
  await expect(bell).toBeVisible();
  await expect(page.getByRole('link', { name: /^Site news/ })).toHaveCount(1);
  await expect(bell).toHaveAttribute('href', '/news');
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

test('logged out, the first page is the front door: the Landing board, with no links to the screens behind it, on a phone and wide', async ({ page }) => {
  await signedOut(page);
  const market: string[] = [];
  page.on('request', (r) => {
    const path = new URL(r.url()).pathname;
    if (['/v1/methods', '/v1/offers', '/v1/price', '/v1/news'].includes(path)) market.push(path);
  });
  await page.goto('/');
  // Design review 2026-11-08 item 1: "/" is the Landing board (logo D, the slogan, the ways in).
  await expect(page).toHaveURL('/');
  await expect(page.locator('[data-screen="landing"]')).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveAccessibleName('X2F');
  await expect(page.getByText('You’ll need Fiat to believe it.')).toBeVisible();
  await expect(page.locator('nav:not([aria-label="Get in"])')).toHaveCount(0);
  await expect(page.locator('[data-part="landing-create"]')).toHaveAttribute('href', '/setup');
  await expect(page.locator('[data-part="landing-login"]')).toHaveAttribute('href', '/login');
  await expectPhoneLayout(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await expect(page.locator('[data-shell="desktop"]')).toBeAttached();
  await expect(page.locator('[data-screen="landing"]')).toHaveAttribute('data-wide', 'true');
  await expect(page.locator('nav:not([aria-label="Get in"])')).toHaveCount(0);
  // Wide: the two ways in side by side, and nothing scrolls sideways.
  const [create, login] = [await page.locator('[data-part="landing-create"]').boundingBox(), await page.locator('[data-part="landing-login"]').boundingBox()];
  expect(Math.abs(create!.y - login!.y)).toBeLessThan(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  // Log in carries where the visitor was going.
  await page.goto('/sell/ZELLE');
  await expect(page).toHaveURL('/?returnTo=%2Fsell%2FZELLE');
  await page.locator('[data-part="landing-login"]').click();
  await expect(page).toHaveURL('/login?returnTo=%2Fsell%2FZELLE');
  expect(market).toEqual([]);
});
