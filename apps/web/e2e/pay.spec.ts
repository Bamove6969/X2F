// Task 23 end to end in Task 22's trade room at /trade/:code: BuyerPay (BuyerPay board, 390×844),
// the wide room (Desktop board, 1280×800), the confirm step, buyer cancel and the seller's
// waiting room, on a fixtures-mode build (e2e/fixtures-serve.ts) served with the real CSP. The
// API is stubbed with a tiny model of the trade rules; the escrow is the fixture build's recorder
// (src/fixtures/index.ts: window.__x2fEscrowCalls, window.__x2fSetFixtureEscrow), whose figures are
// the device's: every sum on screen is the device's (review 2026-10-27, I1).
import { expect, test, type Page, type Route } from '@playwright/test';
import type { FastifyInstance } from 'fastify';
import { PAY_NOW, PAY_SECURED, PAY_SECURING } from '../src/fixtures/payBoard.js';
import type { TradeView } from '../src/screens/trade/payTypes.js';
import { startFixtures } from './fixtures-serve.js';
import { expectParity } from './parity.js';
import { INSIDE } from './session.js';

const PORT = 4320;
const CODE = PAY_SECURING.code;
const ROOM = `http://127.0.0.1:${PORT}/trade/${CODE}`;

let server: FastifyInstance;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  server = await startFixtures(PORT, 'dist-fixtures-pay');
});
test.afterAll(async () => {
  await server?.close();
});
const SENTENCE = (fiat: string) => `I sent exactly ${fiat} by Zelle with the memo ${CODE}.`;
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
      // Owner Q12: only once the escrow is secured (10 of 10); before that the machine says too-early.
      if (v.state === 'securing') return refuse('too-early');
      if (v.state !== 'secured') return refuse('wrong-state');
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
  await page.route('**/v1/account/me', (r) => r.fulfill({ json: INSIDE }));
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

const escrowCalls = (page: Page) => page.evaluate(() => window.__x2fEscrowCalls ?? []);
const room = (page: Page) => page.locator('main[data-screen="trade"]');
const primary = (page: Page) => page.locator('[data-primary]').first();
const sheet = (page: Page) => page.getByRole('dialog');

/** The device's own figures for the board trade: 1.25 XMR at $330.00, $412.50 (and its deal). */
const DEVICE = { phase: 'ready' as const, amountAtomic: PAY_SECURED.amountAtomic, fiatCents: PAY_SECURED.fiatCents, deal: { poster: 'seller' as const, takeAmountAtomic: PAY_SECURED.amountAtomic } };

async function open(page: Page, view: TradeView, before?: Server['before']): Promise<Server> {
  const s = await serve(page, view, before);
  await page.addInitScript((e) => {
    window.__x2fFixtureEscrow = e;
  }, DEVICE);
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

  test('CancelRequest board at 390x844: "Cancelling is final" over the secured pay step (owner G56)', async ({ page }) => {
    await open(page, PAY_SECURED);
    await page.getByRole('button', { name: 'Cancel trade' }).click();
    await expect(page.getByRole('dialog', { name: 'Cancelling is final' })).toBeVisible();
    await expectParity(page, 'CancelRequest');
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
    await expect(sheet(page)).toContainText("After this you can't cancel the trade. If something goes wrong, open a dispute.");
    await expect(page.getByRole('button', { name: 'Yes, mark as paid' })).toBeDisabled();
    await page.getByRole('button', { name: 'Yes, mark as paid' }).click({ force: true });
    await page.getByRole('button', { name: 'Not yet' }).click();
    await expect(sheet(page)).toHaveCount(0);
    expect(s.posts).toEqual([]);
    expect(await escrowCalls(page)).toEqual([]);
    await page.reload();
    await expect(room(page)).toHaveAttribute('data-trade-state', 'secured');
  });

  test('Yes posts the device total, sends trade.paid, and shows "Marked as paid" once the device recorded it', async ({ page }) => {
    const s = await open(page, PAY_SECURED);
    await primary(page).click();
    await page.getByText(SENTENCE('$412.50')).click();
    await page.getByRole('button', { name: 'Yes, mark as paid' }).click();
    await expect(room(page)).toHaveAttribute('data-trade-state', 'paid');
    expect(s.posts).toEqual([{ type: 'mark-paid', fiatCents: '41250' }]);
    expect(await escrowCalls(page)).toEqual(['paid:41250']);
    await expect(primary(page)).toHaveText('Marked as paid');
  });

  test('an API amount outside the device range: no total, I\'ve paid disabled, nothing posted (review I1)', async ({ page }) => {
    const s = await open(page, { ...PAY_SECURED, amountAtomic: '3030272727272', fiatCents: '99999' });
    // This device accepts no amount: the API's is above its own size.
    await page.evaluate(() => window.__x2fSetFixtureEscrow!({ refusal: 'amount-out-of-range', amountAtomic: null, fiatCents: null }));
    await expect(primary(page)).toBeDisabled();
    await expect(page.locator('[data-pay-block]')).toContainText("Don't send any money yet");
    await expect(page.getByText('$999.99')).toHaveCount(0);
    expect(s.posts).toEqual([]);
  });

  test('paid on the server but never recorded on this device (a reload): Finish sends only trade.paid (review I2)', async ({ page }) => {
    const s = await open(page, { ...PAY_SECURED, state: 'paid', paidAt: at(-1), confirmBy: at(119) });
    await page.evaluate(() => window.__x2fSetFixtureEscrow!({ refusal: 'amount-unknown' }));
    await expect(page.getByText("Your device hasn't recorded your payment. Tap to finish.")).toBeVisible();
    await primary(page).click();
    await expect(primary(page)).toHaveText('Marked as paid');
    expect(await escrowCalls(page)).toEqual(['paid:41250']);
    expect(s.posts).toEqual([]);
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
    await page.getByRole('button', { name: 'Yes, mark as paid' }).click();
    // Refused (total-changed) and re-read: the API's $433.13 is not this device's yet, so no sum is asked.
    await expect(sheet(page).locator('[data-pay-block="amount-differs"]')).toBeVisible();
    // This device's own reading grew too (Task 12 follows its own funds()).
    await page.evaluate(() => window.__x2fSetFixtureEscrow!({ amountAtomic: '1312500000000', fiatCents: '43313' }));
    await expect(sheet(page)).toContainText('Trade grew to 1.312500 XMR, you now pay $433.13');
    await expect(sheet(page)).toContainText(SENTENCE('$433.13'));
    await expect(sheet(page).getByRole('checkbox')).not.toBeChecked();
    expect(s.posts).toEqual([{ type: 'mark-paid', fiatCents: '41250' }]);
    expect(await escrowCalls(page)).toEqual([]);
    await expect(room(page)).toHaveAttribute('data-trade-state', 'secured');
    await page.getByText(SENTENCE('$433.13')).click();
    await page.getByRole('button', { name: 'Yes, mark as paid' }).click();
    await expect(room(page)).toHaveAttribute('data-trade-state', 'paid');
    expect(s.posts[1]).toEqual({ type: 'mark-paid', fiatCents: '43313' });
    expect(await escrowCalls(page)).toEqual(['paid:43313']);
  });

  test('the countdown follows the server clock with the device clock 10 min ahead (Review Focus 3)', async ({ page }) => {
    await page.clock.install({ time: new Date(Date.parse(PAY_NOW) + 10 * 60_000) });
    await open(page, PAY_SECURED);
    await expect(page.getByRole('timer')).toHaveText('1 h 2 min');
  });
});

test.describe('cancel', () => {
  test("before I've paid, Cancel trade asks once (Cancelling is final), then buyer-cancel and the escrow's refund with trade.cancel", async ({ page }) => {
    const s = await open(page, PAY_SECURED);
    await page.getByRole('button', { name: 'Cancel trade' }).click();
    // Owner G56 / g67: the one warning, before anything is sent.
    const final = page.getByRole('dialog', { name: 'Cancelling is final' });
    await expect(final).toBeVisible();
    await expect(final).toContainText(
      "The 1.250000 XMR goes back to satoshi_ghost and this trade closes. Don't send any money after you cancel. If you've already paid, don't cancel: tap I've paid instead.",
    );
    await expect(final.getByRole('button', { name: 'Keep trading' })).toBeFocused();
    expect(s.posts).toEqual([]);
    await final.getByRole('button', { name: 'Keep trading' }).click();
    await expect(final).toHaveCount(0);
    expect(s.posts).toEqual([]);
    await page.getByRole('button', { name: 'Cancel trade' }).click();
    await final.getByRole('button', { name: 'Cancel trade' }).click();
    await expect(room(page)).toHaveAttribute('data-trade-state', 'settling');
    await expect(sheet(page)).toHaveCount(0);
    expect(s.posts).toEqual([{ type: 'buyer-cancel' }]);
    expect(await escrowCalls(page)).toEqual(['buyer-cancel']);
  });

  test("after I've paid there is no cancel at all (Revision 2026-10-29b)", async ({ page }) => {
    const s = await open(page, { ...PAY_SECURED, state: 'paid', paidAt: at(-5), confirmBy: at(115) });
    await expect(primary(page)).toHaveText(/Marked as paid|Marking as paid/);
    await expect(page.getByRole('button', { name: 'Cancel trade' })).toHaveCount(0);
    await expect(page.getByText('Only cancel if your payment was never sent')).toHaveCount(0);
    expect(s.posts).toEqual([]);
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
    expect(await escrowCalls(page)).toEqual(['propose-cancel-sign']);
  });
});

test.describe("owner Q12: no payment details and no I've paid before the escrow is secured", () => {
  test("securing: the details are a locked card, I've paid is closed and says why, nothing is posted; Task 38's pay warning never opens", async ({ page }) => {
    const s = await open(page, PAY_SECURING);
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByText('[SELLER ZELLE ID]')).toHaveCount(0);
    await expect(page.getByText('Send exactly', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Payment details', { exact: true })).toBeVisible();
    await expect(page.getByText('They appear when the escrow is secured, in about 14 min.', { exact: true })).toBeVisible();
    await expect(primary(page)).toHaveText("I've paid");
    await expect(primary(page)).toBeDisabled();
    await expect(page.locator('[data-pay-block="not-secured"]')).toHaveText('Opens once the escrow is secured.');
    await expect(primary(page)).toHaveAttribute('aria-describedby', (await page.locator('[data-pay-block="not-secured"]').getAttribute('id'))!);
    await primary(page).click({ force: true });
    await expect(sheet(page)).toHaveCount(0);
    expect(s.posts).toEqual([]);
    expect(await escrowCalls(page)).toEqual([]);
  });

  test("secured: the details show and I've paid goes straight to the confirm sheet", async ({ page }) => {
    await open(page, PAY_SECURED);
    await expect(page.getByText('[SELLER ZELLE ID]')).toBeVisible();
    await primary(page).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(sheet(page)).toContainText('Mark this trade as paid?');
  });

  test('a stale secured screen whose mark-paid the server refuses as too-early is re-read: the sheet closes, still securing, nothing signalled', async ({ page }) => {
    const s = await open(page, PAY_SECURED, (e, srv) => {
      // The server never saw the escrow secured (another node's view, a reorg): the machine says too-early.
      if (e.type === 'mark-paid') {
        srv.view = PAY_SECURING;
        return { status: 409, json: { error: 'too-early' } };
      }
      return undefined;
    });
    await primary(page).click();
    await page.getByText(SENTENCE('$412.50')).click();
    await page.getByRole('button', { name: 'Yes, mark as paid' }).click();
    await expect(room(page)).toHaveAttribute('data-trade-state', 'securing');
    await expect(sheet(page)).toHaveCount(0);
    await expect(primary(page)).toBeDisabled();
    expect(s.posts).toEqual([{ type: 'mark-paid', fiatCents: '41250' }]);
    expect(await escrowCalls(page)).toEqual([]);
  });
});

test('"Releasable in N min" at 10 confirmations before unlock (P3-I4)', async ({ page }) => {
  await open(page, { ...PAY_SECURING, confirmations: 10, releasableEtaMin: 2 });
  await expect(page.getByText('Releasable in 2 min', { exact: true })).toBeVisible();
  await expect(page.getByText('Securing escrow', { exact: true })).toHaveCount(0);
  await expect(primary(page)).toBeDisabled();
  await expect(page.getByText('[SELLER ZELLE ID]')).toHaveCount(0);
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
      await expect(primary(page)).toBeDisabled();
      s.view = PAY_SECURED;
      await page.reload();
      await expect(room(page)).toHaveAttribute('data-trade-state', 'secured');
      await expectFitsPhone(page);
      await primary(page).scrollIntoViewIfNeeded();
      await primary(page).tap();
      await expect(sheet(page)).toBeVisible();
      await expectFitsPhone(page);
      await page.getByText(SENTENCE('$412.50')).tap();
      const yes = page.getByRole('button', { name: 'Yes, mark as paid' });
      await yes.scrollIntoViewIfNeeded();
      await expect(yes).toBeInViewport({ ratio: 1 });
      await yes.tap();
      await expect(room(page)).toHaveAttribute('data-trade-state', 'paid');
      expect(s.posts).toEqual([{ type: 'mark-paid', fiatCents: '41250' }]);
      await expectFitsPhone(page);
    });

    test(`the locked pay screen and the seller's room at ${vp.width}x${vp.height} fit`, async ({ page }) => {
      await page.setViewportSize(vp);
      const s = await open(page, PAY_SECURING);
      await expect(page.locator('[data-pay-block="not-secured"]')).toBeVisible();
      await expectFitsPhone(page);
      await page.getByRole('button', { name: 'Cancel trade' }).tap();
      const final = page.getByRole('dialog', { name: 'Cancelling is final' });
      await expect(final).toBeVisible();
      await expectFitsPhone(page);
      await expect(final.getByRole('button', { name: 'Cancel trade' })).toBeInViewport({ ratio: 1 });
      await final.getByRole('button', { name: 'Keep trading' }).tap();
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
