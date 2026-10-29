// Task 27's slots in Task 22's trade room at /trade/:code (a fixtures-mode build served with the
// real CSP, e2e/fixtures-serve.ts): both traders in `disputed` see the dispute room or ruling
// (loaded from GET …/dispute; the room owns the trade view), and the buyer in `refunded` sees why
// the XMR went back to the seller, with the 90-day "Open a dispute" (spec 2.3; owner 2026-10-29).
// The API is stubbed per test with page.route in Task 6's shapes (e2e/refundViews.ts).
import { expect, test, type Page, type Route } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import type { TradeView } from '../src/api/trade.js';
import { startFixtures } from './fixtures-serve.js';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';
import { BOARD, SERVER_NOW, sellerView } from './refundViews.js';

const PORT = 4321;
const BASE = `http://127.0.0.1:${PORT}`;
const CODE = encodeURIComponent(BOARD.code);
const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const at = (ms: number) => new Date(Date.parse(SERVER_NOW) + ms).toISOString();

let server: FastifyInstance;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  server = await startFixtures(PORT, 'dist-fixtures-dispute-room');
});
test.afterAll(async () => {
  await server?.close();
});

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

async function openRoom(page: Page, view: TradeView, dispute: unknown = null): Promise<string[]> {
  const urls: string[] = [];
  page.on('request', (r) => {
    if (r.url().includes('/v1/')) urls.push(new URL(r.url()).pathname);
  });
  await page.route(`**/v1/trades/${CODE}`, json(view));
  await page.route(`**/v1/trades/${CODE}/dispute`, dispute === null ? json({ error: 'not-found' }, 404) : json(dispute));
  await page.addInitScript(
    ({ amountAtomic, fiatCents }) => {
      window.__x2fFixtureEscrow = { phase: 'ready', amountAtomic, fiatCents };
    },
    { amountAtomic: view.amountAtomic, fiatCents: view.fiatCents },
  );
  await page.goto(`${BASE}/trade/${CODE}`);
  return urls;
}

const buyerRefunded = (over: Partial<TradeView> = {}) =>
  sellerView({ role: 'buyer', state: 'refunded', settling: 'auto-refund', closedAt: at(-2 * DAY), txHash: 'ab'.repeat(32), ...over });

test('the buyer\'s refunded trade says the payment time ran out and offers "Open a dispute"', async ({ page }) => {
  await openRoom(page, buyerRefunded());
  await expect(page.getByRole('heading', { name: 'The payment time ran out' })).toBeVisible();
  await expect(page.getByText('the seller cancelled and all the XMR went back to them', { exact: false })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open a dispute' })).toHaveAttribute('href', `/trade/${CODE}/dispute`);
});

test('a refund decided by a dispute says so and links to the dispute, not a new one', async ({ page }) => {
  await openRoom(page, buyerRefunded({ settling: 'mutual-cancel', dispute: { by: 'buyer', at: at(-5 * DAY) } }));
  await expect(page.getByRole('heading', { name: 'Refunded by the dispute decision' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Go to the dispute' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open a dispute' })).toHaveCount(0);
});

test('a disputed trade shows the dispute room inside the trade room, from GET …/dispute', async ({ page }) => {
  const dispute = {
    openedBy: 'buyer',
    reason: 'paid',
    openedAt: at(-60 * MIN),
    afterRefund: false,
    dueAt: null,
    status: 'open',
    moderator: null,
    ruling: null,
    appeal: null,
    serverNow: SERVER_NOW,
  };
  const urls = await openRoom(page, sellerView({ state: 'disputed', dispute: { by: 'buyer', at: at(-60 * MIN) } }), dispute);
  await expect(page.getByText('In dispute').first()).toBeVisible();
  await expect(page.locator('[data-username]').first()).toHaveText(BOARD.buyer);
  expect(urls).toContain(`/v1/trades/${BOARD.code}/dispute`);
});

for (const viewport of PHONE_VIEWPORTS) {
  test(`the buyer's refunded view fits a ${viewport} phone`, async ({ page }) => {
    await openRoom(page, buyerRefunded());
    await setPhone(page, viewport);
    await expect(page.getByRole('heading', { name: 'The payment time ran out' })).toBeVisible();
    await expectPhoneLayout(page);
    const a = page.getByRole('link', { name: 'Open a dispute' });
    await a.scrollIntoViewIfNeeded();
    await expect(a).toBeInViewport({ ratio: 1 });
  });
}
