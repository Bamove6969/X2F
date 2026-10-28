// SellerRefund and FinalAlert (Task 25, board SellerRefund.dc.html) in Task 22's trade room at
// /trade/:code, on a fixtures-mode build of the app (e2e/fixtures-serve.ts) served with the real
// CSP. The API is stubbed per test with page.route in Task 6's shapes; the escrow is the fixture
// build's recorder (src/fixtures/index.ts: window.__x2fEscrowCalls names the actions the room's
// handle was asked for, window.__x2fEscrowFail refuses them), standing in for Task 12's runtime,
// which needs a relay, a node and a moderator.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import type { TradeView } from '../src/api/trade.js';
import { startFixtures } from './fixtures-serve.js';
import { expectParity } from './parity.js';
import { BOARD, SERVER_NOW, buyerAlertView, sellerView } from './refundViews.js';

type RefundView = TradeView;
const PORT = 4319;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const REF = `${ROOT}design/x2f-app/refs/SellerRefund.png`;
const MIN = 60_000;
const CODE = encodeURIComponent(BOARD.code);

let server: FastifyInstance;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  server = await startFixtures(PORT, 'dist-fixtures-refund');
});
test.afterAll(async () => {
  await server?.close();
});

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const later = (iso: string, min: number) => new Date(Date.parse(iso) + min * MIN).toISOString();

/**
 * A small stand-in for the API's trade: GET returns `trade.view`; POST events applies extend and
 * request-refund the way the machine does (the unit tests check the screens against the real
 * machine; here only the wire matters). Returns the event bodies posted.
 */
async function stubTrade(page: Page, view: RefundView): Promise<{ trade: { view: RefundView }; posted: unknown[]; seen: number[] }> {
  const trade = { view };
  const posted: unknown[] = [];
  const seen: number[] = [];
  await page.route(`**/v1/trades/${CODE}`, (r) => json(trade.view)(r));
  await page.route(`**/v1/trades/${CODE}/events`, (r) => {
    const body = r.request().postDataJSON() as { type: string };
    posted.push(body);
    const v = trade.view;
    if (body.type === 'extend') trade.view = { ...v, extensions: v.extensions + 1, payBy: later(v.serverNow, 30), nextDeadline: later(v.serverNow, 30) };
    if (body.type === 'request-refund') trade.view = { ...v, state: 'refund_requested', finalAlertAt: v.serverNow, nextDeadline: later(v.serverNow, 15) };
    return json(trade.view)(r);
  });
  await page.route(`**/v1/trades/${CODE}/final-alert-seen`, (r) => {
    seen.push(1);
    return r.fulfill({ status: 204 });
  });
  await page.route('**/v1/nudges', json({}, 202));
  return { trade, posted, seen };
}

/**
 * Opens the trade room. The device's escrow is ready and accepts the board's amount; `fail`
 * starts with every escrow action refused (a relay that is down).
 */
async function open(page: Page, o: { fail?: boolean } = {}): Promise<void> {
  const board = sellerView();
  await page.addInitScript(
    ({ amountAtomic, fiatCents, fail }) => {
      window.__x2fFixtureEscrow = { phase: 'ready', amountAtomic, fiatCents };
      window.__x2fEscrowFail = fail;
      window.__x2fFixturePaidSheet = true;
    },
    { amountAtomic: board.amountAtomic, fiatCents: board.fiatCents, fail: o.fail === true },
  );
  await page.goto(`${BASE}/trade/${CODE}`);
}
const escrowCalls = (page: Page) => page.evaluate(() => window.__x2fEscrowCalls ?? []);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

/** The room loads the trade first: compare once its screen (with its one primary) is up. */
async function parity(page: Page, board: string, viewport?: '1280x800'): Promise<void> {
  await expect(page.locator('[data-primary]')).toHaveCount(1);
  await expectParity(page, board, viewport ? { viewport } : {});
}

test('parity with SellerRefund at 390x844', async ({ page }) => {
  // The board's header "Chat" link is rendered (it points at the room's chat anchor until Task
  // 20's chat screen lands; lead decision 2026-10-27).
  test.skip(!existsSync(REF), 'design/x2f-app/refs/SellerRefund.png is absent');
  await stubTrade(page, sellerView());
  await open(page);
  await parity(page, 'SellerRefund');
});

test('parity with SellerRefund at 1280x800, in the desktop shell', async ({ page }) => {
  await stubTrade(page, sellerView());
  await open(page);
  await parity(page, 'SellerRefund', '1280x800');
});

test('parity with the Desktop board at 1280x800', async ({ page }) => {
  // The Desktop board is the buyer's paying room (TradeTimeline, counterparty card, chat): Task
  // 23's, inside this room. Runs once Task 23's BuyerPay is here.
  const buyerPay = fileURLToPath(new URL('../src/screens/trade/BuyerPay.tsx', import.meta.url));
  test.skip(!existsSync(buyerPay), "needs Task 23's desktop trade room (BuyerPay)");
  await stubTrade(page, sellerView());
  await open(page);
  await parity(page, 'Desktop', '1280x800');
});

test('the board copy, the warning before the tap, one primary and no CSP violations', async ({ page }) => {
  const csp: string[] = [];
  page.on('console', (m) => {
    if (/content security policy/i.test(m.text())) csp.push(m.text());
  });
  await stubTrade(page, sellerView());
  await open(page);
  await expect(page.getByRole('heading', { name: "mira.k didn't mark the payment in time" })).toBeVisible();
  for (const t of [
    'Payment window ended',
    'Your 1.25 XMR is still safe in escrow. You can take it back, or give mira.k more time.',
    'If you cancel',
    'mira.k gets a final alert and 15 minutes to say they already paid.',
    'If they stay silent, your 1.25 XMR comes back to your wallet automatically. No moderator needed.',
    'If they say they paid, a moderator checks both sides before anything moves.',
    "Check your bank account first. If mira.k's Zelle payment did arrive, release instead of cancelling.",
  ]) {
    await expect(page.getByText(t, { exact: true })).toBeVisible();
  }
  const warning = page.getByText(/^Even after your refund, mira\.k can still open a dispute/);
  await expect(warning).toBeVisible();
  await expect(page.locator('[data-primary]')).toHaveCount(1);
  await expect(page.locator('[data-primary]')).toHaveText('Cancel & get refund');
  await expect(button(page, 'Give 30 more min')).toBeVisible();
  await expect(button(page, 'Nudge mira.k')).toBeVisible();
  const transforms = await page.locator('[data-username]').evaluateAll((els) => els.map((e) => getComputedStyle(e).textTransform));
  expect(transforms.length).toBeGreaterThan(0);
  for (const t of transforms) expect(t).toBe('none');
  expect(csp).toEqual([]);
});

test('Give 30 more min twice, then it is gone', async ({ page }) => {
  const s = await stubTrade(page, sellerView());
  await open(page);
  for (let n = 1; n <= 2; n += 1) {
    await button(page, 'Give 30 more min').click();
    // The window is open again: the room leaves SellerRefund (seller × secured before payBy is
    // Task 23's waiting room; until it lands, the plain status card), so nothing can be cancelled.
    await expect(page.locator('.x2f-trade-status[data-trade-state="secured"]')).toBeVisible();
    await expect(button(page, 'Give 30 more min')).toHaveCount(0);
    await expect(button(page, 'Cancel & get refund')).toHaveCount(0);
    expect(s.trade.view.extensions).toBe(n);
    // The 30 minutes pass on the server; the room re-reads the trade.
    s.trade.view = { ...s.trade.view, serverNow: later(s.trade.view.payBy!, 1) };
    await page.reload();
    await expect(button(page, 'Cancel & get refund')).toBeEnabled();
  }
  await expect(button(page, 'Give 30 more min')).toHaveCount(0);
  await expect(button(page, 'Nudge mira.k')).toBeVisible();
  expect(s.posted).toEqual([{ type: 'extend' }, { type: 'extend' }]);
});

test('each extension sends the extend signal once', async ({ page }) => {
  await stubTrade(page, sellerView());
  await open(page);
  await button(page, 'Give 30 more min').click();
  await expect(button(page, 'Give 30 more min')).toHaveCount(0);
  expect(await escrowCalls(page)).toEqual(['signal:trade.extend']);
});

test('Cancel & get refund sends exactly one event, one signal and one tx set', async ({ page }) => {
  const s = await stubTrade(page, sellerView());
  await open(page);
  await button(page, 'Cancel & get refund').dblclick();
  await expect(page.getByText('Final alert sent', { exact: true })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText(/^1[45]:\d\d$/);
  expect(s.posted).toEqual([{ type: 'request-refund' }]);
  expect(await escrowCalls(page)).toEqual(['signal:trade.refund-request', 'build-refund']);
});

test('the relay is down at the tap: the final-alert view resumes the run, Retry finishes the tx set once the relay is back (review I1)', async ({ page }) => {
  const s = await stubTrade(page, sellerView());
  await open(page, { fail: true });
  await button(page, 'Cancel & get refund').click();
  // The API accepted request-refund, so the seller sees the final alert running; the signal failed
  // and the resume failed again, so the seller is told and offered Retry. No tx set was built.
  await expect(page.getByText('Final alert sent', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveText('That did not work. Try again.');
  await expect(button(page, 'Retry')).toBeVisible();
  expect(s.posted).toEqual([{ type: 'request-refund' }]);
  expect(await escrowCalls(page)).toEqual(['signal:trade.refund-request', 'signal:trade.refund-request']);
  // The relay is back.
  await page.evaluate(() => {
    window.__x2fEscrowFail = false;
  });
  await button(page, 'Retry').click();
  await expect(button(page, 'Retry')).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('timer')).toHaveText(/^1[45]:\d\d$/);
  expect(s.posted).toEqual([{ type: 'request-refund' }]);
  expect(await escrowCalls(page)).toEqual(['signal:trade.refund-request', 'signal:trade.refund-request', 'signal:trade.refund-request', 'build-refund']);
});

test('a refused request-refund sends no signal and no tx set', async ({ page }) => {
  await stubTrade(page, sellerView());
  await page.route(`**/v1/trades/${CODE}/events`, json({ error: 'too-early' }, 409));
  await open(page);
  await button(page, 'Cancel & get refund').click();
  await expect(page.getByRole('alert')).toHaveText('That did not work. Try again.');
  expect(await escrowCalls(page)).toEqual([]);
});

test('before payBy by the server clock nothing can be cancelled, with the device clock 10 min ahead', async ({ page }) => {
  await page.clock.install({ time: new Date(Date.parse(SERVER_NOW) + 10 * MIN) });
  const s = await stubTrade(page, sellerView({ payBy: later(SERVER_NOW, 3), nextDeadline: later(SERVER_NOW, 3) }));
  await open(page);
  // Before payBy the room shows no refund screen at all (Task 23's waiting room, or until it lands
  // the plain status card), though the device clock is already past payBy.
  await expect(page.locator('.x2f-trade-status[data-trade-state="secured"]')).toBeVisible();
  await expect(button(page, 'Cancel & get refund')).toHaveCount(0);
  await expect(button(page, 'Give 30 more min')).toHaveCount(0);
  // payBy passes on the server; the room re-reads the trade at its next deadline.
  s.trade.view = { ...s.trade.view, serverNow: later(SERVER_NOW, 4) };
  await page.clock.runFor(4 * MIN);
  await expect(button(page, 'Cancel & get refund')).toBeEnabled();
  expect(s.posted).toEqual([]);
});

test('Nudge mira.k nudges by public name with the trade as context', async ({ page }) => {
  await stubTrade(page, sellerView());
  const nudge = page.waitForRequest('**/v1/nudges');
  await open(page);
  await button(page, 'Nudge mira.k').click();
  expect((await nudge).postDataJSON()).toEqual({ to: 'mira.k', context: BOARD.code });
  await expect(page.getByRole('status')).toHaveText('Nudge sent.');
});

test('the buyer sees FinalAlert with the server-clock countdown, the device clock 10 min ahead', async ({ page }) => {
  await page.clock.install({ time: new Date(Date.parse(SERVER_NOW) + 10 * MIN) });
  const s = await stubTrade(page, buyerAlertView());
  await open(page);
  await expect(page.getByText("The seller is cancelling. If you already paid, tap I've paid now.", { exact: true })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText('15:00');
  await expect(page.locator('[data-primary]')).toHaveCount(1);
  await expect(page.locator('[data-primary]')).toHaveText("I've paid");
  await page.clock.runFor(61_000);
  await expect(page.getByRole('timer')).toHaveText('13:59');
  await expect.poll(() => s.seen.length).toBe(1);
  await button(page, "I've paid").click();
  await expect(page.getByRole('dialog', { name: 'Paid sheet stand-in' })).toBeVisible();
});

test("after 15 minutes I've paid is closed", async ({ page }) => {
  await page.clock.install({ time: new Date(Date.parse(SERVER_NOW) + 14 * MIN + 58_000) });
  await stubTrade(page, buyerAlertView({ serverNow: later(SERVER_NOW, 14) }));
  await open(page);
  await expect(button(page, "I've paid")).toBeEnabled();
  await page.clock.runFor(63_000);
  await expect(button(page, "I've paid")).toBeDisabled();
  await expect(page.getByText('The 15 minutes have passed.', { exact: true })).toBeVisible();
});

// Phone sizes (spec "Mobile ready at launch", owner 2026-10-25): a small Android, the boards'
// 390x844 and a large phone. The actions stay on screen, nothing scrolls sideways, the board's
// main line of text is 16 px and every button is at least 44 px tall.
for (const [width, height] of [
  [360, 640],
  [390, 844],
  [430, 932],
] as const) {
  for (const which of ['seller-refund', 'final-alert'] as const) {
    test(`${which} fits a ${width}x${height} phone`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await stubTrade(page, which === 'seller-refund' ? sellerView() : buyerAlertView());
      await open(page);
      const primary = page.locator('[data-primary]');
      await expect(primary).toHaveCount(1);
      await expect(primary).toBeInViewport({ ratio: 1 });
      if (which === 'seller-refund') {
        await expect(button(page, 'Give 30 more min')).toBeInViewport({ ratio: 1 });
        await expect(button(page, 'Nudge mira.k')).toBeInViewport({ ratio: 1 });
        // The warning is reachable by scrolling the body, above the actions.
        const warning = page.getByText(/^Even after your refund/);
        await warning.scrollIntoViewIfNeeded();
        await expect(warning).toBeInViewport();
        await expect(primary).toBeInViewport({ ratio: 1 });
        const lead = await page.locator('.x2f-refund__lead').evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
        expect(lead).toBeGreaterThanOrEqual(16);
      } else {
        await expect(page.getByRole('timer')).toBeInViewport();
      }
      const scroll = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
      expect(scroll.wide).toBeLessThanOrEqual(scroll.view);
      // The header's method name is an inline text button (Task 14's TradeHeader), not an action.
      const heights = await page.locator('button:visible:not(.x2f-method-name)').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      for (const h of heights) expect(h).toBeGreaterThanOrEqual(44);
    });
  }
}
