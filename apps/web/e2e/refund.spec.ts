// SellerRefund and FinalAlert (Task 25, board SellerRefund.dc.html). TradeRoom (Task 22) is not on
// the main line yet, so these drive the screens through the e2e screen harness (harness/main.tsx),
// built from the same sources and served with the real CSP. The API is stubbed per test with
// page.route in Task 6's shapes; the escrow is the harness recorder (window.__escrowCalls).
// TRIPWIRE NEEDS_TASK_22 (test/refund-tripwires.test.ts): once TradeRoom lands, drive /trade/:code.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Route } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import type { RefundView } from '../src/screens/trade/refundSlot.js';
import { startHarness } from './harness/serve.js';
import { BOARD, SERVER_NOW, buyerAlertView, sellerView } from './harness/refundViews.js';

const PORT = 4319;
const BASE = `http://127.0.0.1:${PORT}`;
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const HARNESS = fileURLToPath(new URL('./parity.ts', import.meta.url));
const REF = `${ROOT}design/x2f-app/refs/SellerRefund.png`;
const MIN = 60_000;
const CODE = encodeURIComponent(BOARD.code);

let server: FastifyInstance;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  server = await startHarness(PORT);
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

const open = (page: Page, screen: 'seller-refund' | 'final-alert', extra = '') => page.goto(`${BASE}/?screen=${screen}&code=${CODE}${extra}`);
const escrowCalls = (page: Page) => page.evaluate(() => window.__escrowCalls ?? []);
const button = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

type ExpectParity = (page: Page, board: string, o?: { viewport?: '390x844' | '1280x800' }) => Promise<void>;
async function parity(page: Page, board: string, viewport?: '1280x800'): Promise<void> {
  const path = './parity.js';
  const { expectParity } = (await import(path)) as { expectParity: ExpectParity };
  await expectParity(page, board, viewport ? { viewport } : {});
}

test('parity with SellerRefund at 390x844', async ({ page }) => {
  // TRIPWIRE (Task 15): the parity harness and the board references are not on the main line yet.
  // This skips until both are present. When it first runs: the board's header "Chat" link is
  // Task 20's (chat) and is not in the screen yet; add it to KNOWN_EXCEPTIONS or wire the link.
  const why = !existsSync(HARNESS) ? 'Task 15 parity harness (apps/web/e2e/parity.ts) is not on this branch yet' : !existsSync(REF) ? 'design/x2f-app/refs/SellerRefund.png is absent' : null;
  test.skip(why !== null, why ?? '');
  await stubTrade(page, sellerView());
  await open(page, 'seller-refund');
  await parity(page, 'SellerRefund');
});

test('parity with the Desktop board at 1280x800', async ({ page }) => {
  // TRIPWIRE (Tasks 15, 22, 23): the desktop trade room (TradeTimeline, counterparty card, chat) is
  // Task 23's, inside Task 22's TradeRoom. Runs once all three are here.
  const room = fileURLToPath(new URL('../src/screens/trade/TradeRoom.tsx', import.meta.url));
  test.skip(!existsSync(HARNESS) || !existsSync(room), 'needs the Task 15 parity harness and Task 22/23 desktop trade room');
  await stubTrade(page, sellerView());
  await page.goto(`${BASE}/trade/${CODE}`);
  await parity(page, 'Desktop', '1280x800');
});

test('the board copy, the warning before the tap, one primary and no CSP violations', async ({ page }) => {
  const csp: string[] = [];
  page.on('console', (m) => {
    if (/content security policy/i.test(m.text())) csp.push(m.text());
  });
  await stubTrade(page, sellerView());
  await open(page, 'seller-refund');
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
  await open(page, 'seller-refund');
  for (let n = 1; n <= 2; n += 1) {
    await button(page, 'Give 30 more min').click();
    // The window is open again: no more time to give, and no refund until it ends.
    await expect(button(page, 'Give 30 more min')).toHaveCount(0);
    await expect(button(page, 'Cancel & get refund')).toBeDisabled();
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
  await open(page, 'seller-refund');
  await button(page, 'Give 30 more min').click();
  await expect(button(page, 'Give 30 more min')).toHaveCount(0);
  expect(await escrowCalls(page)).toEqual(['signal:trade.extend']);
});

test('Cancel & get refund sends exactly one event, one signal and one tx set', async ({ page }) => {
  const s = await stubTrade(page, sellerView());
  await open(page, 'seller-refund');
  await button(page, 'Cancel & get refund').dblclick();
  await expect(page.getByText('Final alert sent', { exact: true })).toBeVisible();
  await expect(page.getByRole('timer')).toHaveText(/^1[45]:\d\d$/);
  expect(s.posted).toEqual([{ type: 'request-refund' }]);
  expect(await escrowCalls(page)).toEqual(['signal:trade.refund-request', 'build-refund']);
});

test('a refused request-refund sends no signal and no tx set', async ({ page }) => {
  await stubTrade(page, sellerView());
  await page.route(`**/v1/trades/${CODE}/events`, json({ error: 'too-early' }, 409));
  await open(page, 'seller-refund');
  await button(page, 'Cancel & get refund').click();
  await expect(page.getByRole('alert')).toHaveText('That did not work. Try again.');
  expect(await escrowCalls(page)).toEqual([]);
});

test('before payBy by the server clock nothing can be cancelled, with the device clock 10 min ahead', async ({ page }) => {
  await page.clock.install({ time: new Date(Date.parse(SERVER_NOW) + 10 * MIN) });
  const s = await stubTrade(page, sellerView({ payBy: later(SERVER_NOW, 3), nextDeadline: later(SERVER_NOW, 3) }));
  await open(page, 'seller-refund');
  await expect(button(page, 'Cancel & get refund')).toBeDisabled();
  await expect(button(page, 'Give 30 more min')).toHaveCount(0);
  await page.clock.runFor(4 * MIN);
  await expect(button(page, 'Cancel & get refund')).toBeEnabled();
  expect(s.posted).toEqual([]);
});

test('Nudge mira.k nudges by public name with the trade as context', async ({ page }) => {
  await stubTrade(page, sellerView());
  const nudge = page.waitForRequest('**/v1/nudges');
  await open(page, 'seller-refund');
  await button(page, 'Nudge mira.k').click();
  expect((await nudge).postDataJSON()).toEqual({ to: 'mira.k', context: BOARD.code });
  await expect(page.getByRole('status')).toHaveText('Nudge sent.');
});

test('the buyer sees FinalAlert with the server-clock countdown, the device clock 10 min ahead', async ({ page }) => {
  await page.clock.install({ time: new Date(Date.parse(SERVER_NOW) + 10 * MIN) });
  const s = await stubTrade(page, buyerAlertView());
  await open(page, 'final-alert');
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
  await open(page, 'final-alert');
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
      await open(page, which);
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
