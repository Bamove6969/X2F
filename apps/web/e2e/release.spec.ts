// SellerConfirm and Released (Task 24; boards SellerConfirm.dc.html and the released part of
// Review.dc.html). The API is stubbed per test with page.route in Task 6's TradeView shape and
// Task 24's /confirmations shape. Until Task 22's TradeRoom merges, /trade/:code is Task 24's
// Task 22's TradeRoom at /trade/:code, on a fixtures-mode build of the app (e2e/fixtures-serve.ts)
// served with the real CSP. The escrow is the fixture build's handle (src/fixtures/index.ts),
// seeded per test through window.__x2fFixtureEscrow (phase, accepted amount); it stands in for
// Task 12's runtime, which needs a relay, a node and a moderator. window.__x2fEscrowCalls lists
// the device actions the room asked for; window.__x2fEscrowFail refuses them.
//
// Plan 5 parts are not built and are left out of the board comparison: the smart proof card on
// SellerConfirm (section "Payment proof") and the rating cards on Review (everything after
// section "Trade complete", including the board's one primary "Submit rating", so Released has
// no primary until Plan 5). The confirm countdown ("1 h 52 min to confirm") is a masked
// [data-mask=clock] region the harness cannot match inline, so it is checked here directly.
import type { FastifyInstance } from 'fastify';
import { expect, test, type Locator, type Page, type Request, type Route } from '@playwright/test';
import { startFixtures } from './fixtures-serve.js';
import { boardTexts, boardViewport, missingTexts, reportPixels } from './parity.js';
import { PHONE_VIEWPORTS, expectPhoneLayout } from './phone.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const PORT = 4322;
const BASE = `http://127.0.0.1:${PORT}`;

let server: FastifyInstance;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  server = await startFixtures(PORT, 'dist-fixtures-release');
});
test.afterAll(async () => {
  await server?.close();
});

/**
 * Opens the trade at /trade/:code in the fixtures build. `extra` sets this device's escrow:
 * `&phase=<EscrowPhase>` (default ready) and `&escrow=fail` (every action refused). The device
 * accepts the board's 1.25 XMR / $412.50.
 */
async function open(page: Page, extra = '', o: { warned?: boolean } = {}): Promise<void> {
  const q = new URLSearchParams(extra.replace(/^&/, ''));
  const seed = { phase: q.get('phase') ?? 'ready', fail: q.get('escrow') === 'fail', warned: o.warned !== false, code: CODE };
  await page.addInitScript((f) => {
    window.__x2fFixtureEscrow = { phase: f.phase as 'ready', amountAtomic: '1250000000000', fiatCents: '41250' };
    window.__x2fEscrowFail = f.fail;
    // Task 38's release warning: by default the seller went past it already (its own test below).
    if (f.warned) localStorage.setItem(`x2f.warned.release.${f.code}`, '1');
  }, seed);
  await page.goto(`${BASE}/trade/${CODE}`);
}
const escrowCalls = (page: Page) => page.evaluate(() => window.__x2fEscrowCalls ?? []);
const TX = 'ab'.repeat(32);
const NOW = '2026-10-25T12:00:00.000Z';
const ME = { displayName: 'satoshi_ghost', kind: 'trader', level: 'full', termsCurrent: true };
/** Task 3's ZELLE profile (data/payment-method-profiles.json on wip/second-p3-t3) plus the display name. */
const ZELLE = {
  id: 'ZELLE',
  name: 'Zelle',
  whatItIs: 'Zelle: a US bank-to-bank instant transfer built into most US banking apps.',
  landsIn: "your bank account, checked in your bank's app",
  checkPrompt: "Open your bank's app and check that the payment arrived in your account.",
  arrival: 'instant',
  confirmWindowMin: 120,
  fields: [],
};

type View = Record<string, unknown>;

/** The board trade in Task 6's TradeView shape: satoshi_ghost sells 1.25 XMR to mira.k for $412.50 via Zelle. */
function view(over: View = {}): View {
  return {
    code: CODE,
    role: 'seller',
    poster: 'seller',
    state: 'paid',
    counterparty: { displayName: 'mira.k', completedTrades: 3, online: true, lastSeenAt: NOW, typicalMinutes: null, positivePct: null, badges: [] },
    methodId: 'ZELLE',
    profile: ZELLE,
    amountAtomic: '1250000000000',
    fiatCents: '41250',
    lockedRate: { currency: 'USD', centsPerXmr: '33000' },
    maxFiatCents: '100000',
    grown: null,
    receivedAtomic: '1262500000000',
    confirmations: 12,
    releasable: true,
    releasableEtaMin: 0,
    funding: null,
    fee: { atomic: '12500000000' },
    extensions: 0,
    cancelProposedBy: null,
    settling: null,
    dispute: null,
    txHash: null,
    takenAt: '2026-10-25T10:00:00.000Z',
    setupBy: null,
    fundBy: null,
    fundingSeenAt: '2026-10-25T10:05:00.000Z',
    fundStartedAt: null,
    securedAt: '2026-10-25T10:25:00.000Z',
    payBy: '2026-10-25T11:55:00.000Z',
    paidAt: '2026-10-25T11:52:00.000Z',
    confirmBy: '2026-10-25T13:52:00.000Z',
    confirmWindowMin: 120,
    settleBy: null,
    pausedAt: null,
    closedAt: null,
    cancelConfirmedAt: null,
    cancelConfirmableAt: null,
    sellerNudgedAt: null,
    nextDeadline: '2026-10-25T13:52:00.000Z',
    serverNow: NOW,
    ...over,
  };
}

/** The buyer's released view (Review board: mira.k bought on their own ad from satoshi_ghost). */
const BUYER_RELEASED = (over: View = {}) =>
  view({
    role: 'buyer',
    poster: 'buyer',
    state: 'released',
    txHash: TX,
    closedAt: NOW,
    confirmBy: null,
    counterparty: { displayName: 'satoshi_ghost', completedTrades: 40, online: true, lastSeenAt: NOW, typicalMinutes: null, positivePct: null, badges: [] },
    ...over,
  });

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface Stubs {
  trade: View;
  /** What POST /events answers (default: the trade moved to settling for a release). */
  posted?: { status: number; body: unknown };
  confirmations?: unknown;
}

/** Stubs the API; returns the POST /events requests seen. */
async function stub(page: Page, o: Stubs): Promise<Request[]> {
  const posts: Request[] = [];
  let current = o.trade;
  await page.route('**/v1/account/me', json(ME));
  await page.route(`**/v1/trades/${CODE}/confirmations`, json(o.confirmations ?? { confirmations: 1, target: 10, payoutEnd: 'k3Fz' }));
  await page.route(`**/v1/trades/${CODE}/events`, (r) => {
    posts.push(r.request());
    const a = o.posted ?? { status: 200, body: view({ state: 'settling', settling: 'release', settleBy: '2026-10-25T12:15:00.000Z' }) };
    if (a.status === 200) current = a.body as View;
    return json(a.body, a.status)(r);
  });
  await page.route(`**/v1/trades/${CODE}`, (r) => json(current)(r));
  return posts;
}

const hold = (page: Page) => page.locator('button[data-primary]');

/**
 * Holds the release with one finger for `ms`, through CDP touch events (Chromium makes the
 * pointer events from them, as on a phone; Android's long-press context menu comes at about
 * 500 ms, so a 1.7 s hold also checks that it does not cancel the hold).
 */
async function touchHoldFor(page: Page, ms: number): Promise<void> {
  // A finger can only press what is on screen: on a 320x568 phone the hold sits below the fold.
  await hold(page).evaluate((el) => el.scrollIntoView({ block: 'center' }));
  const b = (await hold(page).boundingBox())!;
  const point = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}
const box = (page: Page) => page.getByRole('checkbox');

/** Holds the release for `ms` with the mouse (pointer events, as the board's hold). */
async function holdFor(page: Page, ms: number): Promise<void> {
  await hold(page).hover();
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

/**
 * Board parity for a screen with parts owned by a later plan: the blocking checks of expectParity
 * (primaries, no horizontal scroll, no text-transform on usernames, the board copy) on the board's
 * texts minus `without` (texts inside that board selector) or only `within`, then the reported
 * pixel diff.
 */
async function partialParity(
  page: Page,
  board: string,
  o: { without?: string; within?: string; primaries: number; skip?: string[]; masks?: Locator[] },
): Promise<void> {
  const viewport = boardViewport(board);
  const [width, height] = viewport.split('x').map(Number) as [number, number];
  await page.setViewportSize({ width, height });
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))));
  const failures: string[] = [];
  const primaries = await page
    .locator('[data-primary]')
    .evaluateAll((els) => els.filter((e) => e.checkVisibility({ visibilityProperty: true, opacityProperty: true })).length);
  if (primaries !== o.primaries) failures.push(`expected ${o.primaries} [data-primary], found ${primaries}`);
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (scroll > 0) failures.push(`horizontal scroll of ${scroll} px`);
  const transformed = await page
    .locator('[data-username]')
    .evaluateAll((els) => els.filter((e) => getComputedStyle(e).textTransform !== 'none').map((e) => e.textContent ?? ''));
  for (const name of transformed) failures.push(`text-transform on [data-username] "${name}"`);

  let texts = await boardTexts(page, board, o.within ? { within: o.within } : {});
  if (o.without) {
    const later = new Set(await boardTexts(page, board, { within: o.without }));
    texts = texts.filter((t) => !later.has(t));
  }
  texts = texts.filter((t) => !(o.skip ?? []).includes(t));
  if (texts.length === 0) failures.push('no board texts read');
  for (const t of await missingTexts(page, texts, o.masks ?? [])) failures.push(`board copy missing: "${t}"`);
  await reportPixels(page, board, viewport, o.masks ?? [], `${new URL('../../../design/x2f-app/refs', import.meta.url).pathname}`);
  expect(failures, `parity with ${board}`).toEqual([]);
}

test.describe('SellerConfirm', () => {
  test('parity with the SellerConfirm board at 390x844 (the Plan 5 proof card left out)', async ({ page }) => {
    await stub(page, { trade: view() });
    await open(page);
    await box(page).check();
    await partialParity(page, 'SellerConfirm', {
      without: 'section[aria-label="Payment proof"]',
      primaries: 1,
      skip: ['1 h 52 min to confirm', '1 h 52 min'],
    });
    // The masked countdown, checked directly: the server's 1 h 52 min, in the board's sentence.
    await expect(page.getByRole('timer')).toHaveText('1 h 52 min');
    await expect(page.getByRole('button', { name: /to confirm$/ })).toHaveText('1 h 52 min to confirm');
  });

  test('the release warning (Task 38, board Warn-Release) opens only on "Payment received" (the hold); the release waits for "It\'s in my account", once per trade', async ({ page }) => {
    const posts = await stub(page, { trade: view() });
    await open(page, '', { warned: false });
    const warn = page.getByRole('alertdialog');
    await expect(warn).toHaveCount(0);
    await box(page).check();
    await expect(warn).toHaveCount(0);
    await holdFor(page, 1700);
    await expect(warn).toBeVisible();
    await expect(warn).toContainText('Before you release');
    await expect(warn).toContainText('Is the $412.50 really in your account?');
    await expect(warn).toContainText('Only release once the money is really in your account.');
    await expect(warn).toContainText('Check your own bank or Zelle app, not a screenshot. Screenshots can be faked.');
    await expect(warn).toContainText("Once released, the 1.250000 XMR (about $412.50) goes to mira.k and can't be taken back.");
    await page.getByRole('button', { name: "I'll check again" }).click();
    await expect(warn).toHaveCount(0);
    expect(posts).toHaveLength(0);
    await expect(hold(page)).toBeEnabled();
    await holdFor(page, 1700);
    await expect(warn).toBeVisible();
    await page.getByRole('button', { name: "It's in my account" }).click();
    await expect(warn).toHaveCount(0);
    await expect.poll(() => posts.map((p) => (p.postDataJSON() as { type: string }).type)).toEqual(['release-started']);
  });

  test('release is locked until the box is ticked, and while the escrow is not releasable', async ({ page }) => {
    const posts = await stub(page, { trade: view({ releasable: false, releasableEtaMin: 12 }) });
    await open(page);
    await expect(hold(page)).toBeDisabled();
    await expect(page.getByText('Tick the box above to unlock this release button.', { exact: true })).toBeVisible();
    await box(page).check();
    await expect(hold(page)).toBeDisabled();
    await expect(hold(page)).toContainText('Releasable in 12 min');
    await holdFor(page, 1700);
    expect(posts).toHaveLength(0);
  });

  test('a ticked box and a full hold post release-started once and show the released look', async ({ page }) => {
    const posts = await stub(page, { trade: view() });
    await open(page);
    await box(page).check();
    await expect(hold(page)).toBeEnabled();
    await expect(page.getByText('Press and hold for 1.5 seconds. Once released, the XMR can’t be taken back.', { exact: true })).toBeVisible();
    await expect(hold(page)).toHaveAccessibleName('Press and hold for 1.5 seconds to release 1.250000 XMR to mira.k');
    // Letting go early releases nothing.
    await holdFor(page, 700);
    expect(posts).toHaveLength(0);
    await holdFor(page, 1700);
    await expect(hold(page)).toHaveAttribute('data-done', 'true');
    expect(posts).toHaveLength(1);
    expect(posts[0]!.method()).toBe('POST');
    expect(posts[0]!.postDataJSON()).toEqual({ type: 'release-started' });
    await expect(hold(page)).toContainText('1.250000 XMR is on its way to mira.k');
    await expect(page.getByText('Both signatures sent. mira.k will be asked to rate the trade.', { exact: true })).toBeVisible();
    // The POST first, then this device's signature (Task 12's release action), once.
    expect(await escrowCalls(page)).toEqual(['release']);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(hold(page)).toBeDisabled();
  });

  test('when the device could not sign, says so and "Finish the release on this device" signs it (I1)', async ({ page }) => {
    const posts = await stub(page, { trade: view() });
    await open(page, '&escrow=fail');
    await box(page).check();
    await holdFor(page, 1700);
    await expect(page.getByRole('alert')).toHaveText('The release didn’t finish on this device. Keep this page open.');
    await expect(hold(page)).not.toHaveAttribute('data-done', 'true');
    await expect(page.getByText('Both signatures sent', { exact: false })).toHaveCount(0);
    await page.evaluate(() => (window.__x2fEscrowFail = false));
    await page.getByRole('button', { name: 'Finish the release on this device' }).click();
    await expect(hold(page)).toHaveAttribute('data-done', 'true');
    expect(posts).toHaveLength(1);
    expect(await escrowCalls(page)).toEqual(['release', 'release']);
  });

  test('opened in settling after THIS device asked (reload after the POST): signs once without a new hold (I1)', async ({ page }) => {
    const posts = await stub(page, { trade: view({ state: 'settling', settling: 'release', settleBy: '2026-10-25T12:15:00.000Z' }) });
    // The marker SellerConfirm writes before release-started (release/marker.ts), as a reload finds it.
    await page.addInitScript((code) => localStorage.setItem(`x2f.release-asked:${code}`, String(Date.now())), CODE);
    await open(page);
    await expect(hold(page)).toHaveAttribute('data-done', 'true');
    expect(await escrowCalls(page)).toEqual(['release']);
    expect(posts).toHaveLength(0);
  });

  test('opened in settling that this device never asked for: signs nothing until the box and the hold (round 2 I1)', async ({ page }) => {
    const posts = await stub(page, { trade: view({ state: 'settling', settling: 'release', settleBy: '2026-10-25T12:15:00.000Z' }) });
    await open(page);
    await expect(page.getByText('X2F shows a release under way that wasn’t started on this device. Check your bank account first.', { exact: true })).toBeVisible();
    await page.waitForTimeout(500);
    expect(await escrowCalls(page)).toEqual([]);
    await expect(hold(page)).toBeDisabled();
    await box(page).check();
    await expect(hold(page)).toBeEnabled();
    await holdFor(page, 1700);
    await expect(hold(page)).toHaveAttribute('data-done', 'true');
    expect(await escrowCalls(page)).toEqual(['release']);
    expect(posts).toHaveLength(0);
  });

  test('opened in settling while the device is still signing: says so, not "Both signatures sent" (I1)', async ({ page }) => {
    await stub(page, { trade: view({ state: 'settling', settling: 'release', settleBy: '2026-10-25T12:15:00.000Z' }) });
    await open(page, '&phase=signing');
    await expect(page.getByText('Signing the release on this device. Keep this page open.', { exact: true })).toBeVisible();
    await expect(hold(page)).not.toHaveAttribute('data-done', 'true');
    expect(await escrowCalls(page)).toEqual([]);
  });

  test('a refused release-started signs nothing and the seller can hold again', async ({ page }) => {
    const posts = await stub(page, { trade: view(), posted: { status: 409, body: { error: 'not-releasable' } } });
    await open(page);
    await box(page).check();
    await holdFor(page, 1700);
    await expect(page.getByRole('alert')).toHaveText('The release didn’t start. Try again.');
    await expect(hold(page)).toBeEnabled();
    await holdFor(page, 1700);
    await expect.poll(() => posts.length).toBe(2);
  });

  test("wide (1280x800): SellerConfirm's Chat opens the chat sheet (Task 20 round-2 review I2)", async ({ page }) => {
    await stub(page, { trade: view() });
    await page.setViewportSize({ width: 1280, height: 800 });
    await open(page);
    await expect(page.locator('html')).toHaveAttribute('data-fold', 'wide');
    await page.locator('[data-chat-link]').click();
    expect(new URL(page.url()).hash).toBe('#chat');
    await expect(page.getByRole('dialog', { name: 'Chat with mira.k' }).locator('#msg')).toBeVisible();
  });

  test('"Payment not received" says to check first before the confirm window ends, then goes to the dispute screen', async ({ page }) => {
    await stub(page, { trade: view() });
    await open(page);
    await page.getByRole('button', { name: 'Payment not received' }).click();
    await expect(page.locator('[data-not-received]')).toContainText("If the money still isn't there at");
    await expect(page).toHaveURL(`${BASE}/trade/${CODE}`);
    await stub(page, { trade: view({ confirmBy: new Date(Date.parse(NOW) - 60_000).toISOString() }) });
    await page.reload();
    await page.getByRole('link', { name: 'Payment not received' }).click();
    await expect(page).toHaveURL(`${BASE}/trade/${CODE}/dispute`);
  });
});

test.describe('Released', () => {
  test('parity with the released part of the Review board at 390x844 (poster buyer; rating cards are Plan 5)', async ({ page }) => {
    await stub(page, { trade: BUYER_RELEASED() });
    await open(page);
    await expect(page.getByText('1 of 10', { exact: true })).toBeVisible();
    await partialParity(page, 'Review', { within: 'section[aria-label="Trade complete"]', primaries: 0 });
  });

  test('the poster buyer sees the fee row above You receive; the taker buyer sees no fee anywhere', async ({ page }) => {
    await stub(page, { trade: BUYER_RELEASED() });
    await open(page);
    const sums = page.getByRole('definition');
    await expect(page.getByText('X2F fee (1%, your ad)', { exact: true })).toBeVisible();
    await expect(sums).toHaveText(['1.250000 XMR', '−0.012500 XMR', '1.237500 XMR']);
    await expect(page.getByRole('term')).toHaveText(['Trade amount', 'X2F fee (1%, your ad)', 'You receive']);

    const taker = await page.context().newPage();
    await stub(taker, { trade: BUYER_RELEASED({ poster: 'seller', fee: undefined }) });
    await open(taker);
    await expect(taker.getByRole('heading', { level: 1 })).toHaveText('1.250000 XMR is yours');
    await expect(taker.getByText('1 of 10', { exact: true })).toBeVisible();
    // Only the poster sees the X2F fee; the network-fee note (Minor 4) is every buyer's.
    expect(await taker.locator('#root').innerText()).not.toMatch(/X2F fee|1%/i);
    await expect(taker.getByRole('definition')).toHaveCount(0);
  });

  test('the seller\'s released screen names the buyer and never the buyer\'s payout ending', async ({ page }) => {
    await stub(page, { trade: view({ state: 'released', txHash: TX, closedAt: NOW }), confirmations: { confirmations: 3, target: 10 } });
    await open(page);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('1.250000 XMR is on its way to mira.k');
    await expect(page.getByText('3 of 10', { exact: true })).toBeVisible();
    await expect(page.getByRole('term')).toHaveText(['Trade amount', 'X2F fee (1%, your ad)', 'You sent']);
    expect(await page.locator('#root').innerText()).not.toContain('…');
  });

  test('a buyer in the room while the release settles gets the count once it is released, without a reload (I2)', async ({ page }) => {
    const trade = { current: BUYER_RELEASED({ state: 'settling', settling: 'release', txHash: null, closedAt: null }) };
    await page.route('**/v1/account/me', json(ME));
    await page.route(`**/v1/trades/${CODE}/confirmations`, json({ confirmations: 2, target: 10, payoutEnd: 'k3Fz' }));
    await page.route(`**/v1/trades/${CODE}`, (r) => json(trade.current)(r));
    await open(page, '&phase=signing');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('satoshi_ghost released 1.250000 XMR to you');
    await expect(page.getByText('Your device is adding its signature. Keep this page open.', { exact: true })).toBeVisible();
    await expect(page.getByText('Checking…', { exact: true })).toBeVisible();
    trade.current = BUYER_RELEASED();
    // The room reads the trade every 15 s (POLL_MS) without a live event; the same Released stays mounted.
    await expect(page.getByText('2 of 10', { exact: true })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('1.237500 XMR is yours');
    await expect(page.locator('.x2f-released__where')).toContainText('ending …k3Fz');
  });

  test('the explorer link opens the tx with no referrer and no opener', async ({ page }) => {
    await stub(page, { trade: BUYER_RELEASED() });
    await open(page);
    const link = page.getByRole('link', { name: 'View on the Monero blockchain' });
    await expect(link).toHaveAttribute('rel', 'noreferrer noopener');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('href', `https://xmrchain.net/tx/${TX}`);
    await expect(
      page.getByText('Opens a public block explorer. It shows the transaction and its confirmations, never the amount or who received it.', { exact: true }),
    ).toBeVisible();
  });
});

// Mobile ready at launch (spec, owner 2026-10-25): every screen at the main line's PHONE_VIEWPORTS
// (e2e/phone.ts: 390x844, 360x800), plus a small phone (320 wide) and a large one (430) as extras.
const PHONES = [...PHONE_VIEWPORTS, '320x568', '430x932']
  .map((v) => v.split('x').map(Number) as [number, number])
  .map(([width, height]) => ({ width, height }));

/** Elements whose box pokes out past the viewport's left or right edge. */
async function overflowing(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('#root *')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.left < -0.5 || r.right > vw + 0.5) out.push(`${el.tagName.toLowerCase()}.${el.className} [${Math.round(r.left)}..${Math.round(r.right)}]`);
    }
    return out;
  });
}

/** Tap targets under 44 px tall (the header's method name included: 44 px since the shared fix, 2026-10-28). */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('#root button, #root a, #root label')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 - 0.5) out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim() || el.getAttribute('aria-label')}" ${Math.round(r.height)} px`);
    }
    return out;
  });
}

/** The main line's expectPhoneLayout, then Task 24's stricter checks (44 px targets, nothing past either edge). */
async function expectFitsPhone(page: Page, onScreen: Locator): Promise<void> {
  await expectPhoneLayout(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(await overflowing(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  // Centred, not "if needed": Chromium's nearest-edge scroll can leave the last pixel row of a
  // control at the bottom edge just outside a 568 px viewport.
  await onScreen.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await expect(onScreen).toBeInViewport({ ratio: 1 });
}

test.describe('phone sizes', () => {
  test.use({ hasTouch: true, isMobile: true });

  for (const vp of PHONES) {
    test(`SellerConfirm at ${vp.width}x${vp.height}: fits, every control tappable, the box ticks by tapping and the hold releases`, async ({ page }) => {
      await page.setViewportSize(vp);
      const posts = await stub(page, { trade: view() });
      await open(page);
      await expect(page.locator('h1')).toHaveText('Check your bank account for $412.50 sent via Zelle');
      await expectFitsPhone(page, hold(page));
      await page.getByText('I checked my bank account myself and the $412.50 from Zelle is there.', { exact: true }).tap();
      await expect(box(page)).toBeChecked();
      await expect(hold(page)).toBeEnabled();
      await holdFor(page, 1700);
      await expect.poll(() => posts.length).toBe(1);
      await expect(hold(page)).toHaveAttribute('data-done', 'true');
      await expectFitsPhone(page, hold(page));
    });

    test(`SellerConfirm at ${vp.width}x${vp.height}: a touch hold of 1.7 s releases, 0.7 s does not (Minor 8)`, async ({ page }) => {
      await page.setViewportSize(vp);
      const posts = await stub(page, { trade: view() });
      await open(page);
      await page.getByText('I checked my bank account myself and the $412.50 from Zelle is there.', { exact: true }).tap();
      await expect(hold(page)).toBeEnabled();
      await touchHoldFor(page, 700);
      await page.waitForTimeout(300);
      expect(posts).toHaveLength(0);
      await expect(hold(page)).not.toHaveAttribute('data-done', 'true');
      await touchHoldFor(page, 1700);
      await expect.poll(() => posts.length).toBe(1);
      await expect(hold(page)).toHaveAttribute('data-done', 'true');
      expect(await escrowCalls(page)).toEqual(['release']);
    });

    test(`SellerConfirm at ${vp.width}x${vp.height} with a 20-character display name: the hold's lines are not clipped`, async ({ page }) => {
      await page.setViewportSize(vp);
      const long = 'abcdefghij_klmnopqrs';
      await stub(page, { trade: view({ counterparty: { displayName: long, completedTrades: 0, online: true, lastSeenAt: NOW, typicalMinutes: null, positivePct: null, badges: [] } }) });
      await open(page);
      await expect(hold(page)).toContainText(`Hold to release 1.250000 XMR to ${long}`);
      const clipped = await hold(page).evaluate((b) => [...b.children].some((c) => c.scrollWidth > c.clientWidth || c.getBoundingClientRect().bottom > b.getBoundingClientRect().bottom + 0.5));
      expect(clipped).toBe(false);
      await expectFitsPhone(page, hold(page));
    });

    test(`Released (poster buyer) at ${vp.width}x${vp.height}: fits, the fee rows and the explorer link on screen`, async ({ page }) => {
      await page.setViewportSize(vp);
      await stub(page, { trade: BUYER_RELEASED() });
      await open(page);
      await expect(page.getByText('1 of 10', { exact: true })).toBeVisible();
      await expect(page.getByRole('term')).toHaveCount(3);
      await expectFitsPhone(page, page.getByRole('link', { name: 'View on the Monero blockchain' }));
    });

    test(`Released (seller) at ${vp.width}x${vp.height}: fits`, async ({ page }) => {
      await page.setViewportSize(vp);
      await stub(page, { trade: view({ state: 'released', txHash: TX, closedAt: NOW }), confirmations: { confirmations: 10, target: 10 } });
      await open(page);
      await expect(page.getByText('10 of 10', { exact: true })).toBeVisible();
      await expectFitsPhone(page, page.getByRole('link', { name: 'View on the Monero blockchain' }));
    });
  }
});
