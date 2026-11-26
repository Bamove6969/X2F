// Plan 5 Task 6: the rating under Released (board Review.dc.html, the rating and "How's X2F
// doing?" cards), and the rate-first gate (spec 5.1, P5-A4): a trade completes, the next take is
// refused 409 review-pending, the trader rates it in the sheet, and the same take goes through to
// the new trade (a skip alone clears the gate and waits for a fresh tap: lead, 18 Nov).
//
// The API is stubbed per test with page.route in the shapes of Task 3 (GET/POST
// /v1/trades/:code/review, /review/skip, GET /v1/reviews/pending), Task 4 (POST /v1/feedback),
// Plan 3 Task 6's TradeView and Task 5's take, on a fixtures-mode build (e2e/fixtures-serve.ts,
// the escrow stand-in that release.spec.ts uses too) served with the real CSP.
//
// Board parity of the rating card: the board's texts inside its "Rate satoshi_ghost" section and
// its footer, except the blind-reveal line "Shown to them only after they rate you too.", which
// the owner's 2026-11-02 ruling made untrue (R-007, no blind reveal; KNOWN_EXCEPTIONS.Review in
// parity.ts; lead question in the report).
import type { FastifyInstance } from 'fastify';
import { expect, test, type Page, type Route } from '@playwright/test';
import { BOARD_BUY_QUOTE as B } from '../src/fixtures/quoteBoard.js';
import { startFixtures } from './fixtures-serve.js';
import { boardTexts, missingTexts } from './parity.js';
import { INSIDE } from './session.js';

const PORT = 4331;
const BASE = `http://127.0.0.1:${PORT}`;
/** The trade that just completed (the Review board's: satoshi_ghost sold to this buyer). */
const OLD = 'H8N4-2PQX-7KRT-3MWV';
/** The trade the next take opens (the quote board's code). */
const NEW = B.code;
const NOW = '2026-10-25T12:00:00.000Z';
const TX = 'ab'.repeat(32);

let server: FastifyInstance;
test.beforeAll(async () => {
  test.setTimeout(240_000);
  server = await startFixtures(PORT, 'dist-fixtures-review');
});
test.afterAll(async () => {
  await server?.close();
});

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

/** The buyer's released view in Task 6's TradeView shape (the Review board: 1.25 XMR from satoshi_ghost). */
function released(code: string): Record<string, unknown> {
  return {
    code,
    role: 'buyer',
    poster: 'buyer',
    state: 'released',
    counterparty: { displayName: 'satoshi_ghost', completedTrades: 40, online: true, lastSeenAt: NOW, typicalMinutes: null, positivePct: null, badges: [] },
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
    txHash: TX,
    takenAt: '2026-10-25T10:00:00.000Z',
    setupBy: null,
    fundBy: null,
    fundingSeenAt: '2026-10-25T10:05:00.000Z',
    fundStartedAt: null,
    securedAt: '2026-10-25T10:25:00.000Z',
    payBy: '2026-10-25T11:55:00.000Z',
    paidAt: '2026-10-25T11:52:00.000Z',
    confirmBy: null,
    confirmWindowMin: 120,
    settleBy: null,
    pausedAt: null,
    closedAt: NOW,
    cancelConfirmedAt: null,
    cancelConfirmableAt: null,
    sellerNudgedAt: null,
    nextDeadline: null,
    serverNow: NOW,
  };
}

interface Seen {
  reviews: unknown[];
  skips: string[];
  feedback: unknown[];
  takes: unknown[];
}

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Stubs the API as the server behaves: OLD is released and not yet rated by this buyer, so the
 * gate counts it (pending list, take refused) until a review or a skip for it arrives.
 */
async function stub(page: Page, o: { completedTrades?: number } = {}): Promise<Seen> {
  const seen: Seen = { reviews: [], skips: [], feedback: [], takes: [] };
  let done = false;
  await page.addInitScript(() => {
    window.localStorage.setItem('x2f.courtesy-sheet.off', '1');
    window.__x2fFixtureEscrow = { phase: 'ready', amountAtomic: '1250000000000', fiatCents: '41250' };
  });
  await page.route('**/v1/account/me', json({ displayName: 'mira.k', ...INSIDE, methods: ['pgp'], completedTrades: o.completedTrades ?? 1 }));
  // OLD's room.
  await page.route(`**/v1/trades/${OLD}`, json(released(OLD)));
  await page.route(`**/v1/trades/${OLD}/confirmations`, json({ confirmations: 1, target: 10, payoutEnd: 'k3Fz' }));
  await page.route(`**/v1/trades/${OLD}/review`, (r) => {
    if (r.request().method() === 'POST') {
      if (done) return json({ error: 'review-exists' }, 409)(r);
      seen.reviews.push(r.request().postDataJSON());
      done = true;
      return r.fulfill({ status: 201, body: '' });
    }
    return json({ reviewable: !done, mine: null, theirs: null, skipped: false, held: false })(r);
  });
  await page.route(`**/v1/trades/${OLD}/review/skip`, (r) => {
    seen.skips.push(OLD);
    done = true;
    return r.fulfill({ status: 204, body: '' });
  });
  await page.route('**/v1/reviews/pending', (r) =>
    json({ trades: done ? [] : [{ code: OLD, counterparty: 'satoshi_ghost', reviewableSince: NOW }] })(r),
  );
  await page.route('**/v1/feedback', (r) => {
    seen.feedback.push(r.request().postDataJSON());
    return json({}, 202)(r);
  });
  // The quote (BuyQuote board) and its take.
  await page.route('**/v1/methods?*', json({ live: [{ id: B.method.id, name: B.method.name, group: 'Payment apps', giftCard: false, offers: 1, bestRate: B.marketCentsPerXmr }], all: [] }));
  await page.route('**/v1/price?*', (r) => {
    const currency = new URL(r.request().url()).searchParams.get('currency');
    return json({ currency, centsPerXmr: B.marketCentsPerXmr, exponent: 2, at: new Date().toISOString(), usdCentsPerXmr: B.marketCentsPerXmr })(r);
  });
  await page.route('**/v1/offers?*', json([B.offer]));
  await page.route('**/v1/wallets', json([...B.wallets]));
  await page.route('**/v1/wallets/rule', json({ firstWallet: false, strongMethods: [], password: 'immediate', waitHours: 24 }));
  await page.route('**/v1/account/liens/preview?*', json({ lienRecoveryAtomic: '0' }));
  await page.route('**/v1/offers/*/take', (r) => {
    const body = r.request().postDataJSON() as { centsPerXmr: string; fiatCents: string };
    seen.takes.push(body);
    if (!done) return json({ error: 'review-pending' }, 409)(r);
    return json({ code: NEW, centsPerXmr: body.centsPerXmr, fiatCents: body.fiatCents, maxFiatCents: B.offer.maxFiatCents })(r);
  });
  return seen;
}

const BUY = `/buy/${B.method.id}/${B.offer.id}?currency=${B.currency}&amount=${B.amount}`;
const ratingCard = (page: Page) => page.locator('section[aria-label="Rate satoshi_ghost"]');

async function noSideScroll(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
}

test('under Released: the board\'s rating card, one primary; Submit is disabled until a star', async ({ page }) => {
  await stub(page);
  await page.goto(`${BASE}/trade/${OLD}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('1.237500 XMR is yours');
  await expect(ratingCard(page)).toBeVisible();
  // Board parity (copy): the rating section and its footer, without the blind-reveal line.
  // (KNOWN_EXCEPTIONS.Review in parity.ts leaves out the blind-reveal line.)
  const texts = await boardTexts(page, 'Review', { within: 'section[aria-label="Rate satoshi_ghost"]' });
  expect(texts).toEqual(expect.arrayContaining(['How was trading with satoshi_ghost?', 'One-line note (optional)']));
  expect(await missingTexts(page, [...texts, 'Submit rating', 'Neutral, skip details'], [])).toEqual([]);
  await expect(page.locator('[data-primary]')).toHaveCount(1);
  await expect(page.locator('[data-primary]')).toHaveText('Submit rating');
  await expect(page.locator('[data-primary]')).toBeDisabled();
  // A buyer rates a seller: "Fast release", never "Fast payment" (P5-A7).
  await expect(ratingCard(page).getByRole('button', { name: 'Fast release' })).toBeVisible();
  await expect(ratingCard(page).getByRole('button', { name: 'Fast payment' })).toHaveCount(0);
  await noSideScroll(page);
});

test('rating under Released saves it, then "How\'s X2F doing?" (1st trade) sends exactly mood and note', async ({ page }) => {
  const seen = await stub(page, { completedTrades: 1 });
  await page.goto(`${BASE}/trade/${OLD}`);
  await expect(ratingCard(page)).toBeVisible();
  // Not before the rating is saved.
  await expect(page.getByRole('region', { name: "How's X2F doing?" })).toHaveCount(0);
  await ratingCard(page).getByRole('radio', { name: '5 stars' }).click();
  await ratingCard(page).getByRole('button', { name: 'Fast release' }).click();
  await ratingCard(page).getByLabel('One-line note (optional)').fill('Smooth trade');
  await page.getByRole('button', { name: 'Submit rating' }).click();
  await expect(page.getByRole('region', { name: 'Rating saved' })).toHaveText('Rating saved. satoshi_ghost can see it now.');
  expect(seen.reviews).toEqual([{ neutral: false, stars: 5, phrases: ['Fast release'], tradeBadges: [], note: 'Smooth trade' }]);
  const fb = page.getByRole('region', { name: "How's X2F doing?" });
  await expect(fb).toBeVisible();
  await fb.getByRole('radio', { name: 'Great' }).click();
  await page.getByRole('button', { name: 'Send feedback' }).click();
  await expect(page.locator('[data-part="feedback-sent"]')).toBeVisible();
  expect(seen.feedback).toHaveLength(1);
  expect(Object.keys(seen.feedback[0] as object).sort()).toEqual(['mood', 'note']);
  expect(seen.feedback[0]).toEqual({ mood: 'great', note: '' });
});

test('on the 2nd completed trade there is no feedback card after the rating', async ({ page }) => {
  await stub(page, { completedTrades: 2 });
  await page.goto(`${BASE}/trade/${OLD}`);
  await page.getByRole('button', { name: 'Neutral, skip details' }).click();
  await expect(page.getByRole('region', { name: 'Rating saved' })).toBeVisible();
  await page.waitForTimeout(300);
  await expect(page.getByRole('region', { name: "How's X2F doing?" })).toHaveCount(0);
});

test('the gate: the trade completes, the next take is refused, the trader rates it, and the take goes through', async ({ page }) => {
  const seen = await stub(page);
  // The trade completed: Released, left without rating.
  await page.goto(`${BASE}/trade/${OLD}`);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('1.237500 XMR is yours');
  await expect(ratingCard(page)).toBeVisible();

  // The next take.
  await page.goto(`${BASE}${BUY}`);
  await page.getByRole('radio', { name: /Cake Wallet/ }).check();
  await page.locator('[data-primary]').click();
  const sheet = page.getByRole('dialog', { name: 'Rate your last trade to continue' });
  await expect(sheet).toBeVisible();
  expect(seen.takes).toHaveLength(1);
  await expect(page).not.toHaveURL(/\/trade\//);
  await expect(sheet.locator('[data-part="rate-first-body"]')).toHaveText(
    'Each completed trade needs a rating, or a tap on Skip review, before your next trade starts.',
  );
  await expect(sheet.getByRole('heading', { name: 'How was trading with satoshi_ghost?' })).toBeVisible();
  await expect(sheet.getByRole('link', { name: 'feedback' })).toHaveAttribute('href', '/feedback?from=review-pending');
  await noSideScroll(page);

  // Rating it clears the gate and the same take goes again, at the quote shown.
  await sheet.getByRole('radio', { name: '4 stars' }).click();
  await sheet.getByRole('button', { name: 'Submit rating' }).click();
  await expect(page).toHaveURL(`${BASE}/trade/${NEW}`);
  expect(seen.reviews).toEqual([{ neutral: false, stars: 4, phrases: [], tradeBadges: [] }]);
  expect(seen.takes).toHaveLength(2);
  expect(seen.takes[1]).toEqual(seen.takes[0]);
});

test('the gate: Skip review clears it too but takes nothing by itself (lead, 18 Nov), and closing the sheet leaves the reason on the quote', async ({ page }) => {
  const seen = await stub(page);
  await page.goto(`${BASE}${BUY}`);
  await page.getByRole('radio', { name: /Cake Wallet/ }).check();
  await page.locator('[data-primary]').click();
  const sheet = page.getByRole('dialog', { name: 'Rate your last trade to continue' });
  await expect(sheet).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveCount(0);
  await expect(page.getByRole('alert')).toHaveText('Rate your last trade, or skip rating it, before you start a new one.');

  await page.locator('[data-primary]').click();
  await expect(sheet).toBeVisible();
  await sheet.getByRole('button', { name: 'Skip review' }).click();
  await expect(sheet).toHaveCount(0);
  expect(seen.skips).toEqual([OLD]);
  expect(seen.reviews).toEqual([]);
  // A skip alone clears the gate but takes nothing: the person taps Trade again.
  expect(seen.takes).toHaveLength(2);
  await expect(page.getByText('Rate your last trade, or skip rating it, before you start a new one.')).toHaveCount(0);
  await page.locator('[data-primary]').click();
  await expect(page).toHaveURL(`${BASE}/trade/${NEW}`);
  expect(seen.takes).toHaveLength(3);
  expect(seen.takes[2]).toEqual(seen.takes[0]);
});
