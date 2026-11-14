import { expect, test, type Page, type Route } from '@playwright/test';
import { signedIn } from './session.js';

// C-021 (owner p11-33, 9 Nov): when a device becomes active again it syncs first, before the
// person can act. In the real build: back online (or back from the background) on a screen whose
// actions change state, "Updating…" shows and its controls are held while GET /v1/site and the
// screen's own reads (Post offer: its methods, prices and currencies) are read again; the page
// stays readable; a failed read lets go and says so, with Try again. src/session/syncFirst.ts,
// src/ui/SyncGate.tsx.

const OFF = { banner: null, tradingPaused: false, maintenance: null, plannedMaintenance: null };

/** Answers GET /v1/site; while `hold` is set, the answer waits for `release()`; `fail` answers 500. */
async function site(page: Page) {
  const s = { hold: false, fail: false, release: () => undefined as void };
  await page.route('**/v1/site', async (r: Route) => {
    if (s.hold) await new Promise<void>((res) => (s.release = res));
    if (s.fail) await r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal' }) });
    else await r.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(OFF) });
  });
  return s;
}

/** Post offer's own reads; counts the method list's reads (it is read again on resume, review S1). */
async function stubPost(page: Page) {
  const n = { methods: 0 };
  await page.route(/\/v1\/methods\?/, (r) => {
    n.methods++;
    return r.fulfill({ json: { live: [], all: [] } });
  });
  await page.route('**/v1/offers?*', (r) => r.fulfill({ json: [] }));
  await page.route(/\/v1\/price\?/, (r) => r.fulfill({ status: 404, json: { error: 'not-found' } }));
  await page.route('**/v1/currencies', (r) => r.fulfill({ json: { currencies: [] } }));
  return n;
}

test('back online on Post offer: "Updating…" and held controls until the site is read again; the page stays readable', async ({ page }) => {
  const s = await site(page);
  await signedIn(page);
  const n = await stubPost(page);
  await page.goto('/post');
  await expect(page.locator('main')).toBeVisible();
  await expect(page.locator('[data-part="sync-gate"]')).toHaveCount(0);
  await expect.poll(() => n.methods).toBeGreaterThan(0);
  const methodsBefore = n.methods;
  // Review S2: the live region is on the page, empty, before the sync; "Updating…" goes into it.
  const live = page.locator('[role="status"][data-part="sync-live"]');
  await expect(live).toHaveCount(1);
  await expect(live).toHaveText('');
  s.hold = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const status = live.locator('[data-part="sync-gate"]');
  await expect(status).toHaveText('Updating…');
  await expect(page.locator('main')).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByRole('button', { name: 'Post offer', exact: true })).toHaveAttribute('aria-disabled', 'true');
  // Review S1: the screen's own data is read again, not only the site.
  await expect.poll(() => n.methods).toBe(methodsBefore + 1);
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-sync-held'))).toBe(true);
  // Reading never waits: the screen is still on show under it.
  await expect(page.locator('main')).toBeVisible();
  // No sideways scroll at phone width with the banner up.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  s.hold = false;
  s.release();
  await expect(status).toHaveCount(0);
  // Every read answered: ready, not stale.
  await expect(page.locator('[data-part="sync-stale"]')).toHaveCount(0);
  await expect(live).toHaveText('');
  await expect(page.locator('main')).not.toHaveAttribute('aria-busy', 'true');
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-sync-held'))).toBe(false);
});

test('a failed sync lets go and says the page may be out of date; Try again syncs again', async ({ page }) => {
  const s = await site(page);
  await signedIn(page);
  await stubPost(page);
  await page.goto('/post');
  await expect(page.locator('main')).toBeVisible();
  s.fail = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  const stale = page.locator('[data-part="sync-stale"]');
  await expect(stale).toContainText("Couldn't update just now. What you see may be out of date.");
  expect(await page.evaluate(() => document.documentElement.hasAttribute('data-sync-held'))).toBe(false);
  s.fail = false;
  await stale.getByRole('button', { name: 'Try again' }).click();
  await expect(stale).toHaveCount(0);
});

test('a screen whose actions change nothing (the news) shows no gate', async ({ page }) => {
  const s = await site(page);
  await signedIn(page);
  await page.route('**/v1/news*', (r) => r.fulfill({ json: [] }));
  await page.goto('/news');
  s.hold = true;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await page.waitForTimeout(300);
  await expect(page.locator('[data-part="sync-gate"]')).toHaveCount(0);
  s.hold = false;
  s.release();
});
