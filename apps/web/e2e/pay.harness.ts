// Task 23 end to end: BuyerPay (BuyerPay board, 390×844), the wide room (Desktop board,
// 1280×800), the confirm step, buyer cancel and the seller's waiting room, in the fixtures build
// through the Task 23 harness (/__harness/pay/:code, standing in for Task 22's /trade/:code until
// it merges; the tripwire in test/pay-tripwires.test.ts moves this file then). The API is stubbed
// with a tiny model of the trade rules; the escrow is the harness's recording fake.
//   flock ~/x2f-comms/check.lock npx playwright test -c apps/web/e2e/harness.config.ts
import { expect, test, type Page, type Route } from '@playwright/test';
import { PAY_NOW, PAY_SECURED, PAY_SECURING } from '../src/fixtures/payBoard.js';
import type { TradeView } from '../src/screens/trade/payTypes.js';
import { expectParity } from './parity.js';

const CODE = PAY_SECURING.code;
const ROOM = `/__harness/pay/${CODE}`;
const SENTENCE = (fiat: string) => `I sent exactly ${fiat} via Zelle with ${CODE} in the memo`;
const at = (min: number) => new Date(Date.parse(PAY_NOW) + min * 60_000).toISOString();

interface Server {
  view: TradeView;
  posts: Record<string, unknown>[];
  /** Runs before the default rules; return a response to answer with it instead. */
  before?: (e: Record<string, unknown>, s: Server) => { status: number; json: unknown } | undefined;
}

/** The trade rules the screens rely on (packages/trade machine.ts), enough for these specs. */
function apply(s: Server, e: Record<string, unknown>): { status: number; json: unknown } {
  const v = s.view;
  const refuse = (code: string) => ({ status: 409, json: { error: code } });
  switch (e.type) {
    case 'mark-paid':
      if (v.role !== 'buyer') return refuse('wrong-party');
      if (v.state !== 'securing' && v.state !== 'secured') return refuse('wrong-state');
      if (e.fiatCents !== v.fiatCents) return refuse('total-changed');
      s.view = { ...v, state: 'paid', paidAt: PAY_NOW, confirmBy: at(120), cancelProposedBy: v.cancelProposedBy === 'seller' ? null : v.cancelProposedBy };
      break;
    case 'buyer-cancel':
      if (v.role !== 'buyer') return refuse('wrong-party');
      s.view = { ...v, state: 'settling', settling: 'buyer-cancel' };
      break;
    case 'propose-cancel':
      if (v.cancelProposedBy !== null) return refuse('wrong-state');
      s.view = { ...v, cancelProposedBy: v.role };
      break;
    case 'withdraw-cancel':
      if (v.cancelProposedBy !== v.role) return refuse('wrong-party');
      s.view = { ...v, cancelProposedBy: null };
      break;
    case 'accept-cancel':
      if (v.cancelProposedBy === null || v.cancelProposedBy === v.role) return refuse('wrong-party');
      s.view = { ...v, state: 'settling', settling: 'mutual-cancel', cancelProposedBy: null };
      break;
    default:
      return { status: 400, json: { error: 'event-not-allowed' } };
  }
  return { status: 200, json: s.view };
}

async function serve(page: Page, view: TradeView, before?: Server['before']): Promise<Server> {
  const s: Server = { view, posts: [], ...(before ? { before } : {}) };
  await page.route(/\/v1\/trades\/[^/]+(\/events)?$/, async (route: Route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const e = req.postDataJSON() as Record<string, unknown>;
      s.posts.push(e);
      const r = s.before?.(e, s) ?? apply(s, e);
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.json) });
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(s.view) });
  });
  return s;
}

const escrowCalls = (page: Page) => page.evaluate(() => window.__x2fPay?.calls ?? []);
const room = (page: Page) => page.locator('main[data-screen="trade"]');
const primary = (page: Page) => page.locator('[data-primary]').first();
const sheet = (page: Page) => page.getByRole('dialog');

async function open(page: Page, view: TradeView, before?: Server['before']): Promise<Server> {
  const s = await serve(page, view, before);
  await page.goto(ROOM);
  await expect(room(page)).toHaveAttribute('data-trade-state', view.state);
  return s;
}

test.describe('parity', () => {
  test('BuyerPay board at 390x844: securing, 3 of 10', async ({ page }) => {
    await open(page, PAY_SECURING);
    await expect(page.getByText('3 of 10', { exact: true })).toBeVisible();
    await expectParity(page, 'BuyerPay');
  });

  test('Desktop board at 1280x800: escrow secured, the timeline, the counterparty and the chat', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page, PAY_SECURED);
    await expect(page.locator('[data-layout="wide"]')).toBeVisible();
    await expect(page.locator('ol[aria-label="Trade progress"] li').nth(1)).toHaveText('You pay · 1 h 2 min left');
    await expectParity(page, 'Desktop');
  });
});

test.describe("I've paid", () => {
  test('unticked, Yes does nothing; Not yet leaves the trade secured', async ({ page }) => {
    const s = await open(page, PAY_SECURED);
    await primary(page).click();
    await expect(sheet(page)).toContainText(SENTENCE('$412.50'));
    await expect(sheet(page)).toContainText('Sending without proof makes disputes harder.');
    await expect(page.getByRole('button', { name: "Yes, I've paid" })).toBeDisabled();
    await page.getByRole('button', { name: "Yes, I've paid" }).click({ force: true });
    await page.getByRole('button', { name: 'Not yet' }).click();
    await expect(sheet(page)).toHaveCount(0);
    expect(s.posts).toEqual([]);
    expect(await escrowCalls(page)).toEqual([]);
    await page.reload();
    await expect(room(page)).toHaveAttribute('data-trade-state', 'secured');
  });

  test('Yes posts the total shown, sends trade.paid, and "Marked as paid" waits for the ack', async ({ page }) => {
    const s = await open(page, PAY_SECURED);
    await primary(page).click();
    await page.getByText(SENTENCE('$412.50')).click();
    await page.getByRole('button', { name: "Yes, I've paid" }).click();
    await expect(room(page)).toHaveAttribute('data-trade-state', 'paid');
    expect(s.posts).toEqual([{ type: 'mark-paid', fiatCents: '41250' }]);
    expect(await escrowCalls(page)).toEqual(['markPaid(41250)']);
    await expect(primary(page)).toHaveText('Marking as paid…');
    await page.evaluate(() => window.__x2fPay!.ack());
    await expect(primary(page)).toHaveText('Marked as paid');
  });

  test('the trade grows while the sheet is open: total-changed, no signal, still secured, the new total asked', async ({ page }) => {
    const grownView = { ...PAY_SECURED, amountAtomic: '1312500000000', fiatCents: '43313', grown: { at: at(-1), fromAtomic: PAY_SECURED.amountAtomic, fromFiatCents: PAY_SECURED.fiatCents } };
    const s = await open(page, PAY_SECURED, (e, srv) => {
      // Extra XMR landed just before the tap: the server's trade grew.
      if (e.type === 'mark-paid' && srv.view.fiatCents === PAY_SECURED.fiatCents) srv.view = grownView;
      return undefined;
    });
    await primary(page).click();
    await page.getByText(SENTENCE('$412.50')).click();
    await page.getByRole('button', { name: "Yes, I've paid" }).click();
    await expect(sheet(page)).toContainText('Trade grew to 1.312500 XMR, you now pay $433.13');
    await expect(sheet(page)).toContainText(SENTENCE('$433.13'));
    await expect(sheet(page).getByRole('checkbox')).not.toBeChecked();
    expect(s.posts).toEqual([{ type: 'mark-paid', fiatCents: '41250' }]);
    expect(await escrowCalls(page)).toEqual([]);
    await expect(room(page)).toHaveAttribute('data-trade-state', 'secured');
    await page.getByText(SENTENCE('$433.13')).click();
    await page.getByRole('button', { name: "Yes, I've paid" }).click();
    await expect(room(page)).toHaveAttribute('data-trade-state', 'paid');
    expect(s.posts[1]).toEqual({ type: 'mark-paid', fiatCents: '43313' });
    expect(await escrowCalls(page)).toEqual(['markPaid(43313)']);
  });

  test('the countdown follows the server clock with the device clock 10 min ahead (Review Focus 3)', async ({ page }) => {
    await page.clock.install({ time: new Date(Date.parse(PAY_NOW) + 10 * 60_000) });
    await open(page, PAY_SECURED);
    await expect(page.getByRole('timer')).toHaveText('1 h 2 min');
  });
});

test.describe('cancel', () => {
  test("before I've paid, one tap cancels: buyer-cancel, then the escrow's refund with trade.cancel", async ({ page }) => {
    const s = await open(page, PAY_SECURED);
    await page.getByRole('button', { name: 'Cancel trade' }).click();
    await expect(room(page)).toHaveAttribute('data-trade-state', 'settling');
    await expect(sheet(page)).toHaveCount(0);
    expect(s.posts).toEqual([{ type: 'buyer-cancel' }]);
    expect(await escrowCalls(page)).toEqual(['buyerCancel']);
  });

  test("after I've paid, the warning first, and nothing until it is confirmed", async ({ page }) => {
    const s = await open(page, { ...PAY_SECURED, state: 'paid', paidAt: at(-5), confirmBy: at(115) });
    await page.getByRole('button', { name: 'Cancel trade' }).click();
    await expect(sheet(page)).toContainText(
      "Only cancel if your payment was never sent or was returned. Scammers try to talk buyers into cancelling after they've paid.",
    );
    expect(s.posts).toEqual([]);
    await page.getByRole('button', { name: 'Keep the trade' }).click();
    await expect(sheet(page)).toHaveCount(0);
    expect(s.posts).toEqual([]);
    await page.getByRole('button', { name: 'Cancel trade' }).click();
    await sheet(page).getByRole('button', { name: 'Cancel trade' }).click();
    await expect(room(page)).toHaveAttribute('data-trade-state', 'settling');
    expect(s.posts).toEqual([{ type: 'buyer-cancel' }]);
    expect(await escrowCalls(page)).toEqual(['buyerCancel']);
  });

  test("the seller's funded room has no cancel-alone control; Propose cancel gives the buyer an accept card", async ({ page }) => {
    const seller: TradeView = { ...PAY_SECURED, role: 'seller', counterparty: { ...PAY_SECURED.counterparty, displayName: 'mira.k' } };
    const s = await open(page, seller);
    await expect(page.getByText('Waiting for mira.k to pay')).toBeVisible();
    await expect(page.getByRole('button', { name: /^Cancel/ })).toHaveCount(0);
    await page.getByRole('button', { name: 'Propose cancel' }).click();
    await expect(page.getByText('You proposed cancelling. Waiting for mira.k.')).toBeVisible();
    expect(s.posts).toEqual([{ type: 'propose-cancel' }]);
    expect(await escrowCalls(page)).toEqual([]);
    // The buyer's side of the same proposal.
    s.view = { ...PAY_SECURED, cancelProposedBy: 'seller' };
    await page.reload();
    await expect(page.getByText('satoshi_ghost proposed cancelling this trade.')).toBeVisible();
    await page.getByRole('button', { name: 'Accept' }).click();
    await expect(room(page)).toHaveAttribute('data-trade-state', 'settling');
    expect(s.posts.at(-1)).toEqual({ type: 'accept-cancel' });
    expect(await escrowCalls(page)).toEqual(['proposeCancelSign']);
  });
});

test('"Releasable in N min" at 10 confirmations before unlock (P3-I4)', async ({ page }) => {
  await open(page, { ...PAY_SECURING, confirmations: 10, releasableEtaMin: 2 });
  await expect(page.getByText('Releasable in 2 min', { exact: true })).toBeVisible();
  await expect(page.getByText('Securing escrow', { exact: true })).toHaveCount(0);
});

// Mobile ready at launch (spec, owner 2026-10-25): every screen is tested at phone sizes, the
// three Task 22's room names (360×640, 390×844, 430×932).
const PHONES = [
  { width: 360, height: 640 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
] as const;

/** Elements whose box pokes out past the viewport's left or right edge. */
function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0 || el.closest('.x2f-visually-hidden')) continue;
      if (r.left < -0.5 || r.right > vw + 0.5) out.push(`${el.tagName.toLowerCase()}.${el.className} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    }
    return out;
  });
}

/**
 * Controls under 44 px tall. Exempt: the method name in "Trade <code> · Zelle", a button inside a
 * line of text (WCAG 2.5.8 inline exception, the UI kit's TradeHeader), and a checkbox inside its
 * label, whose whole row is the target (the label itself is checked).
 */
function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('body button, body a, body label, body input:not([type="file"])')) {
      if (el.matches('.x2f-method-name, .x2f-visually-hidden, label input[type="checkbox"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 - 0.5) out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim() || el.getAttribute('aria-label')}" ${Math.round(r.height)} px`);
    }
    return out;
  });
}

async function expectFitsPhone(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await overflowing(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
}

test.describe('phone sizes', () => {
  test.use({ hasTouch: true, isMobile: true });

  for (const vp of PHONES) {
    test(`BuyerPay at ${vp.width}x${vp.height}: securing and secured fit; I've paid goes through by tapping`, async ({ page }) => {
      await page.setViewportSize(vp);
      const s = await open(page, PAY_SECURING);
      await expectFitsPhone(page);
      await primary(page).scrollIntoViewIfNeeded();
      await expect(primary(page)).toBeInViewport({ ratio: 1 });
      s.view = PAY_SECURED;
      await page.reload();
      await expect(room(page)).toHaveAttribute('data-trade-state', 'secured');
      await expectFitsPhone(page);
      await primary(page).scrollIntoViewIfNeeded();
      await primary(page).tap();
      await expect(sheet(page)).toBeVisible();
      await expectFitsPhone(page);
      await page.getByText(SENTENCE('$412.50')).tap();
      const yes = page.getByRole('button', { name: "Yes, I've paid" });
      await yes.scrollIntoViewIfNeeded();
      await expect(yes).toBeInViewport({ ratio: 1 });
      await yes.tap();
      await expect(room(page)).toHaveAttribute('data-trade-state', 'paid');
      expect(s.posts).toEqual([{ type: 'mark-paid', fiatCents: '41250' }]);
      await expectFitsPhone(page);
    });

    test(`the warned cancel and the seller's room at ${vp.width}x${vp.height} fit`, async ({ page }) => {
      await page.setViewportSize(vp);
      const s = await open(page, { ...PAY_SECURED, state: 'paid', paidAt: at(-5), confirmBy: at(115) });
      await page.getByRole('button', { name: 'Cancel trade' }).tap();
      await expect(sheet(page)).toBeVisible();
      await expectFitsPhone(page);
      await page.getByRole('button', { name: 'Keep the trade' }).tap();
      s.view = { ...PAY_SECURED, role: 'seller', counterparty: { ...PAY_SECURED.counterparty, displayName: 'mira.k' } };
      await page.reload();
      await expect(page.getByText('Waiting for mira.k to pay')).toBeVisible();
      await expectFitsPhone(page);
      await page.getByRole('button', { name: 'Propose cancel' }).tap();
      await expect(page.getByText('You proposed cancelling. Waiting for mira.k.')).toBeVisible();
      await expectFitsPhone(page);
    });
  }
});
