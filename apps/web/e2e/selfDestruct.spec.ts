// Plan 7 Task 3: the self-destruct line in the trade room (`TradeView.deleteAt`) and this device's
// copies going once the date passes. Task 22's room at /trade/:code on a fixtures-mode build
// (e2e/fixtures-serve.ts) with the real CSP; the API is stubbed with page.route. No board yet for
// the line (test/privacy-tripwire.test.ts NEEDS_DESIGN_SELFDESTRUCT), so there is no expectParity:
// the phone layout rule still applies.
import type { FastifyInstance } from 'fastify';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { TradeView } from '../src/api/trade.js';
import { startFixtures } from './fixtures-serve.js';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';
import { BOARD, SERVER_NOW, sellerView } from './refundViews.js';

const PORT = 4323;
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = encodeURIComponent(BOARD.code);
const DAY = 86_400_000;
const iso = (ms: number) => new Date(Date.parse(SERVER_NOW) + ms).toISOString();

let server: FastifyInstance;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  server = await startFixtures(PORT, 'dist-fixtures-selfdestruct');
});
test.afterAll(async () => {
  await server?.close();
});

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/** A released trade (closed a day ago) as the seller sees it; `serverNow` is the board's. */
const released = (over: Partial<TradeView> = {}): TradeView =>
  sellerView({ state: 'released', settling: 'release', txHash: 'ab'.repeat(32), closedAt: iso(-DAY), nextDeadline: null, payBy: null, ...over });

async function open(page: Page, view: TradeView): Promise<void> {
  await page.route('**/v1/**', json({ error: 'not-found' }, 404));
  await page.route('**/v1/account/me', json({ displayName: BOARD.seller, kind: 'trader', level: 'full', termsCurrent: true }));
  await page.route(`**/v1/trades/${CODE}`, json(view));
  await page.addInitScript(() => {
    window.__x2fFixtureEscrow = { phase: 'ready', amountAtomic: '1250000000000', fiatCents: '41250' };
  });
  await page.goto(`${BASE}/trade/${CODE}`);
}

const line = (page: Page) => page.locator('[data-part="self-destruct"]');
const stored = (page: Page) => page.evaluate(() => window.localStorage.getItem('x2f.deleteAt'));

test('a closed trade shows the server\'s self-destruct date, and this device remembers it', async ({ page }) => {
  const deleteAt = iso(29 * DAY);
  await open(page, released({ deleteAt }));
  await expect(line(page)).toHaveText(/^This trade self-destructs on .+\.$/);
  await expect(line(page).locator('time')).toHaveAttribute('datetime', deleteAt);
  expect(JSON.parse((await stored(page))!)).toEqual({ [BOARD.code]: deleteAt });
});

test('a disputed trade says why it is kept longer', async ({ page }) => {
  await open(page, released({ deleteAt: iso(80 * DAY), dispute: { by: 'buyer', at: iso(-10 * DAY) } }));
  await expect(line(page)).toHaveText(/^Kept until .+ because a dispute was opened\.$/);
});

test('an open trade shows no date', async ({ page }) => {
  await open(page, sellerView({ deleteAt: null }));
  await expect(page.locator('main[data-screen="trade"]')).toBeVisible();
  await expect(line(page)).toHaveCount(0);
  expect(await stored(page)).toBeNull();
});

test('once the date passes, the trade is gone from the room and from this device', async ({ page }) => {
  await page.addInitScript((code) => window.localStorage.setItem(`x2f.fund.funded.${code}`, '1'), BOARD.code);
  // Due 2 seconds after the server's now, by the server clock.
  await open(page, released({ deleteAt: iso(2_000) }));
  await expect(line(page)).toBeVisible();
  await expect(page.locator('[data-part="self-destructed"]')).toBeVisible({ timeout: 10_000 });
  await expect(line(page)).toHaveCount(0);
  expect(await stored(page)).toBeNull();
  expect(await page.evaluate((code) => window.localStorage.getItem(`x2f.fund.funded.${code}`), BOARD.code)).toBeNull();
});

for (const viewport of PHONE_VIEWPORTS) {
  test(`phone layout at ${viewport}`, async ({ page }) => {
    await open(page, released({ deleteAt: iso(29 * DAY), dispute: { by: 'buyer', at: iso(-10 * DAY) } }));
    await setPhone(page, viewport);
    await expect(line(page)).toBeVisible();
    await expectPhoneLayout(page);
  });
}
