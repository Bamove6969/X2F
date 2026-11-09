import { expect, test, type Page } from '@playwright/test';

// J-04 (owner G19, 7 Nov; register W-004): maintenance is planned or unplanned, never "emergency"
// to a trader; the message (up to 500 characters) is in a big bright banner; a planned maintenance
// is announced ahead with its start and end. GET /v1/site is stubbed here; the API side is
// apps/api/test/site.test.ts.

async function site(page: Page, body: unknown): Promise<void> {
  await page.route('**/v1/site', (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'cache-control': 'no-store' }, body: JSON.stringify(body) }));
}

const OFF = { banner: null, tradingPaused: false, maintenance: null, plannedMaintenance: null };
// The dark theme's caution token (theme/tokens.css), the banner's fill.
const CAUTION = 'rgb(242, 193, 78)';

test('a planned maintenance announced ahead shows its start, end and message in the big bright banner on the trader screens', async ({ page }) => {
  const violations: string[] = [];
  page.on('console', (m) => {
    if (/content security policy/i.test(m.text())) violations.push(m.text());
  });
  await site(page, { ...OFF, plannedMaintenance: { startsAt: '2026-11-10T12:00:00.000Z', endsAt: '2026-11-10T14:00:00.000Z', message: 'Database upgrade. Trades pause while it runs.' } });
  await page.goto('/sell');
  const box = page.locator('[data-part="planned-maintenance"]');
  await expect(box).toBeVisible();
  await expect(box).toContainText('Planned maintenance');
  await expect(box.locator('[data-part="planned-when"]')).toHaveText('From 10 Nov 2026, 12:00 UTC to 10 Nov 2026, 14:00 UTC');
  await expect(box.locator('[data-part="planned-message"]')).toHaveText('Database upgrade. Trades pause while it runs.');
  expect(await box.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(CAUTION);
  // The browse screen itself still works under the banner.
  await expect(page.locator('nav[aria-label="Main"]')).toBeAttached();
  expect(violations).toEqual([]);
});

test('no plan, no banner', async ({ page }) => {
  await site(page, OFF);
  await page.goto('/sell');
  await expect(page.locator('nav[aria-label="Main"]')).toBeAttached();
  await expect(page.locator('[data-part="planned-maintenance"]')).toHaveCount(0);
});

test('unplanned maintenance replaces the app: "Unplanned maintenance", the 500-character message in the big bright banner, the best guess; never "emergency"', async ({ page }) => {
  const message = `A database fault. ${'x'.repeat(482)}`;
  expect(message.length).toBe(500);
  await site(page, { ...OFF, maintenance: { kind: 'unplanned', message, since: '2026-11-09T12:00:00.000Z', backBy: '2026-11-09T15:00:00.000Z' } });
  await page.goto('/sell');
  const screen = page.locator('[data-screen="maintenance"]');
  await expect(screen).toBeVisible();
  await expect(screen).toContainText('Unplanned maintenance');
  const banner = screen.locator('[data-part="maintenance-banner"]');
  await expect(banner.locator('[data-part="maintenance-message"]')).toHaveText(message);
  await expect(banner.locator('[data-part="maintenance-back-by"]')).toHaveText('Our best guess: back by 9 Nov 2026, 15:00 UTC');
  expect(await banner.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(CAUTION);
  // The whole message fits the phone width: no sideways scroll.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await expect(page.locator('body')).not.toContainText(/emergency/i);
});

test('a kind the app does not know reads as unplanned, never emergency', async ({ page }) => {
  await site(page, { ...OFF, maintenance: { kind: 'emergency', message: null, since: null, backBy: null } });
  await page.goto('/sell');
  await expect(page.locator('[data-screen="maintenance"]')).toContainText('Unplanned maintenance');
  await expect(page.locator('body')).not.toContainText(/emergency/i);
});
