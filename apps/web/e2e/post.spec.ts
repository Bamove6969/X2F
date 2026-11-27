// PostOffer (Task 21, board PostOffer.dc.html; J-16, Plan 3 Tasks 34/35: flexible offers). The API
// is stubbed per test with page.route, in the shapes of Task 3 (GET /v1/methods, GET /v1/price, on
// the main line and checked against the parsers 2026-10-27) and Task 4 (POST /v1/offers, GET
// /v1/offers; 201 { id }, 409 { error } refusals). J-16's POST body is `{ side, amountUnit,
// currencies: [{ currency, bands }], methods: [{ methodId, adjustBps, instructions }], terms }`
// (apps/web/src/screens/post/api.ts PostOfferBody); the form picks currencies and methods one at a
// time (chips with a Remove button, an "Add a …" picker), with one band per currency here. The
// method list is built from data/payment-methods.json with Task 3's own rule (a method with
// `legalReview` is unavailable and left out). GET /v1/currencies is not stubbed: without it the
// picker offers every list currency (currencyOptions with no list loaded).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import { boardBuyOffers } from '../src/fixtures/boards.js';
import { expectParity } from './parity.js';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));

type CatalogEntry = { id: string; name: string; group: string; legalReview?: string };
const CATALOG = (JSON.parse(readFileSync(`${ROOT}data/payment-methods.json`, 'utf8')) as { methods: CatalogEntry[] }).methods;
const GIFT = 'Gift cards & vouchers';
const ROWS = CATALOG.filter((m) => m.legalReview === undefined)
  .map((m) => ({ id: m.id, name: m.name, group: m.group, giftCard: m.group === GIFT, offers: 0, bestRate: null }))
  .sort((a, b) => a.name.localeCompare(b.name, 'en'));

const AT = '2026-10-24T12:00:00.000Z';
const PRICES: Record<string, { centsPerXmr: string; usdCentsPerXmr: string }> = {
  // The board's "Market $329.90 / XMR right now."
  USD: { centsPerXmr: '32990', usdCentsPerXmr: '32990' },
  EUR: { centsPerXmr: '30510', usdCentsPerXmr: '32990' },
  GBP: { centsPerXmr: '26530', usdCentsPerXmr: '32990' },
  CAD: { centsPerXmr: '45000', usdCentsPerXmr: '32990' },
};

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const ME = { tradeTag: 'nightowl_44', kind: 'trader', level: 'full', termsCurrent: true };

interface Stubs {
  signedIn?: boolean;
  price?: 'ok' | 'down';
  /** What POST /v1/offers answers. */
  post?: { status: number; body: unknown };
  /** What GET /v1/offers lists (the browse list a poster lands on). */
  offers?: unknown[];
  /** GET /v1/methods fails this many times before it answers. */
  methodsFailures?: number;
}

/** Stubs the API; returns the POST /v1/offers requests seen. */
async function stub(page: Page, o: Stubs = {}): Promise<Request[]> {
  const posts: Request[] = [];
  let methodsFailures = o.methodsFailures ?? 0;
  await page.route('**/v1/account/me', json(o.signedIn === false ? { error: 'not-authenticated' } : ME, o.signedIn === false ? 401 : 200));
  await page.route(/\/v1\/methods\?/, (r) => {
    if (methodsFailures > 0) {
      methodsFailures -= 1;
      return json({ error: 'internal' }, 500)(r);
    }
    return json({ live: [], all: ROWS })(r);
  });
  await page.route('**/v1/offers?*', json(o.offers ?? []));
  await page.route(/\/v1\/price\?/, (r) => {
    const currency = new URL(r.request().url()).searchParams.get('currency') ?? '';
    const p = PRICES[currency];
    if (o.price === 'down' || !p) return json({ error: 'price-unavailable' }, 503)(r);
    return json({ currency, ...p, exponent: 2, at: AT })(r);
  });
  await page.route('**/v1/offers', (r) => {
    if (r.request().method() !== 'POST') return r.fallback();
    posts.push(r.request());
    const signedOut = o.signedIn === false;
    const answer = signedOut ? { status: 401, body: { error: 'not-authenticated' } } : (o.post ?? { status: 201, body: { id: 'of_1' } });
    return json(answer.body, answer.status)(r);
  });
  return posts;
}

const f = (page: Page) => ({
  // J-16: methods are added one at a time from the picker; each picked one is a [data-part="method"] row.
  method: page.getByLabel('Add a payment method'),
  methodRow: (id: string) => page.locator(`[data-part="method"][data-method="${id}"]`),
  // J-16: the picked currencies are chips, each with its Remove button; "Add a currency" is the picker.
  currencyChip: (code: string) => page.getByRole('button', { name: `Remove ${code}` }),
  min: page.getByLabel('Smallest trade', { exact: true }),
  max: page.getByLabel('Largest trade', { exact: true }),
  terms: page.getByLabel('Your terms (optional)'),
  minTrades: page.getByRole('radiogroup', { name: 'Minimum completed trades' }),
  minTradesChoice: (name: string) => page.getByRole('radiogroup', { name: 'Minimum completed trades' }).getByRole('radio', { name, exact: true }),
  // Owner F1 (7 Nov): above or below the market, and the percentage typed in (at most 50%).
  above: page.getByRole('radio', { name: 'Above market' }),
  below: page.getByRole('radio', { name: 'Below market' }),
  margin: page.getByLabel('Percentage', { exact: true }),
  country: page.getByLabel('Country', { exact: true }),
  post: page.getByRole('button', { name: 'Post offer' }),
});

/** The board's sizes are in the currency: tap the currency on the Smallest trade switch (XMR is the default, owner 8 Nov). */
async function fillBoard(page: Page): Promise<void> {
  const x = f(page);
  await page.getByRole('radiogroup', { name: 'Smallest trade unit' }).locator('[data-unit="fiat"]').click();
  await x.min.fill('$50');
  await x.max.fill('$2,000');
}

test('parity with PostOffer at 390x844', async ({ page }) => {
  // KNOWN_EXCEPTIONS.PostOffer (parity.ts): the board's "Bank transfer (ACH)" option is the catalog's
  // "ACH bank transfer (US)". Its other options (Zelle, Cash App, Cash by mail, Custom method) are
  // catalog methods the picker offers. The board draws a ±0.1% stepper; the owner's F1 (7 Nov) is
  // above or below plus a typed percentage (KNOWN_EXCEPTIONS lists the stepper's marks). J-16: the
  // board's one Payment method select, Currency select, market line and "Who can trade with you"
  // are now the pickers, chips, a market line per currency and a per-band "Minimum completed
  // trades" (KNOWN_EXCEPTIONS, "board recapture pending").
  await stub(page);
  await page.goto('/post?method=ZELLE');
  await fillBoard(page);
  await expectParity(page, 'PostOffer');
});

test('the board copy and the default market price', async ({ page }) => {
  await stub(page);
  await page.goto('/post?method=ZELLE');
  await fillBoard(page);
  await expect(page.getByRole('heading', { name: 'Post an offer' })).toBeVisible();
  // J-16: the trade rule is per band, "Minimum completed trades" (the board's "Who can trade with you" section is gone).
  for (const t of ['I want to', 'Your price', 'Minimum completed trades', 'How others will see it']) await expect(page.getByText(t, { exact: true })).toBeVisible();
  await expect(f(page).above).toBeChecked();
  await expect(f(page).margin).toHaveValue('0.5');
  // Design final call (10 Nov 2026): "0.5% above market", the figure in mono then the words (ui/margin.ts);
  // J-16: the price at your margin follows on the band's readout.
  await expect(page.locator('[data-part="margin-reads"]')).toHaveText('0.5% above market · $331.55 / XMR');
  await expect(page.getByText('0.5%', { exact: true })).toBeVisible();
  await expect(page.getByText('above market', { exact: true })).toBeVisible();
  // J-16: each currency's card carries its market line.
  await expect(page.getByText('Market $329.90 / XMR right now. Your prices follow the market.', { exact: true })).toBeVisible();
  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(preview.getByText('Selling XMR via Zelle · USD · you', { exact: true })).toBeVisible();
  await expect(preview.getByText('$331.55 / XMR', { exact: true })).toBeVisible();
  // Owner #11 (8 Nov): the preview shows the trade sizes in both units, the typed one exact.
  await expect(preview.locator('[data-part="preview-fiat"]')).toHaveText('$50 – $2,000 USD');
  await expect(preview.locator('[data-part="preview-xmr"]')).toHaveText(/^≈ 0\.\d{6} – 6\.\d{6} XMR$/);
  await expect(page.getByText('You pay X2F 1% of each completed trade from your own ads. Taking an offer is free.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-primary]')).toHaveCount(1);
  await expect(page.locator('[data-primary]')).toHaveText('Post offer');
  // Minimum completed trades, shown openly to takers: a fixed choice (owner, 8 Nov), No minimum by default.
  await expect(f(page).minTrades.getByRole('radio')).toHaveText(['No minimum', '5', '10', '25', '50']);
  await expect(f(page).minTradesChoice('No minimum')).toBeChecked();
  await f(page).minTradesChoice('25').click();
  await expect(f(page).minTradesChoice('25')).toBeChecked();
  await expect(preview.getByText('Selling XMR via Zelle · USD · you · 25+ completed trades', { exact: true })).toBeVisible();
});

test('the margin is typed, above or below the market (owner F1)', async ({ page }) => {
  await stub(page);
  await page.goto('/post?method=ZELLE');
  const preview = page.getByRole('region', { name: 'Preview' });
  await f(page).margin.fill('0.6');
  await expect(page.locator('[data-part="margin-reads"]')).toHaveText('0.6% above market · $331.88 / XMR');
  await expect(preview.getByText('$331.88 / XMR', { exact: true })).toBeVisible();
  await f(page).below.check();
  await f(page).margin.fill('0.1');
  await expect(page.locator('[data-part="margin-reads"]')).toHaveText('0.1% below market · $329.57 / XMR');
  await expect(page.getByText('below market', { exact: true })).toBeVisible();
  await f(page).margin.fill('12.25');
  await expect(page.locator('[data-part="margin-reads"]')).toHaveText('12.25% below market · $289.49 / XMR');
  await expect(preview.getByText('$289.49 / XMR', { exact: true })).toBeVisible();
});

test('50% above or below the market posts; 50.01% either way is refused inline and nothing is posted (owner F1)', async ({ page }) => {
  const posts = await stub(page);
  await page.goto('/post?method=ZELLE');
  await fillBoard(page);
  const preview = page.getByRole('region', { name: 'Preview' });
  for (const side of ['above', 'below'] as const) {
    await f(page)[side].check();
    await f(page).margin.fill('50.01');
    await expect(preview.getByText('Set your percentage', { exact: true })).toBeVisible();
    // Owner demo note #219: Post offer is disabled; the box's problem shows once it is left.
    await expect(f(page).post).toBeDisabled();
    await f(page).margin.blur();
    await expect(page.getByText('Enter a percentage from 0 to 50, like 0.5.', { exact: true })).toBeVisible();
    await expect(f(page).margin).toHaveAttribute('aria-invalid', 'true');
    await expect(f(page).margin).toHaveAccessibleDescription('Enter a percentage from 0 to 50, like 0.5.');
  }
  expect(posts).toHaveLength(0);
  await f(page).above.check();
  await f(page).margin.fill('50');
  // $329.90 × 1.5 = $494.85.
  await expect(preview.getByText('$494.85 / XMR', { exact: true })).toBeVisible();
  await expect(f(page).post).toBeEnabled();
  await f(page).post.click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]!.postDataJSON()).toMatchObject({ currencies: [{ currency: 'USD', bands: [{ marginBps: 5000 }] }] });
  await page.goto('/post?method=ZELLE');
  await fillBoard(page);
  await f(page).below.check();
  await f(page).margin.fill('50');
  await expect(preview.getByText('$164.95 / XMR', { exact: true })).toBeVisible();
  await f(page).post.click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1]!.postDataJSON()).toMatchObject({ currencies: [{ currency: 'USD', bands: [{ marginBps: -5000 }] }] });
});

test('a smallest trade above the largest is refused inline and nothing is posted', async ({ page }) => {
  const posts = await stub(page);
  await page.goto('/post?method=ZELLE');
  await f(page).min.fill('500');
  await f(page).max.fill('100');
  // Owner demo note #219: Post offer is disabled; the smallest box, left already, says why.
  await expect(f(page).post).toBeDisabled();
  await expect(page.getByText("The smallest trade can't be more than the largest.", { exact: true })).toBeVisible();
  await expect(f(page).min).toHaveAttribute('aria-invalid', 'true');
  // The error describes the field; it is no part of the field's name.
  await expect(f(page).min).toHaveAccessibleName('Smallest trade');
  await expect(f(page).min).toHaveAccessibleDescription("The smallest trade can't be more than the largest.");
  expect(posts).toHaveLength(0);
});

test('I want to and Your price are radio groups the arrow keys move through', async ({ page }) => {
  await stub(page);
  await page.goto('/post?method=ZELLE');
  const sell = page.getByRole('radio', { name: 'Sell XMR' });
  const buy = page.getByRole('radio', { name: 'Buy XMR' });
  await expect(page.getByRole('radiogroup', { name: 'I want to' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Your price' })).toBeVisible();
  await sell.focus();
  await page.keyboard.press('ArrowRight');
  await expect(buy).toBeChecked();
  await expect(buy).toBeFocused();
  await expect(page.getByRole('region', { name: 'Preview' }).getByText(/^Buying XMR via Zelle/)).toBeVisible();
  await buy.press('ArrowLeft');
  await expect(sell).toBeChecked();
  await f(page).above.focus();
  await page.keyboard.press('ArrowDown');
  await expect(f(page).below).toBeChecked();
});

test('Close returns to where the poster came from: Buy from the buy side, Sell otherwise', async ({ page }) => {
  await stub(page);
  await page.goto('/buy');
  await page.getByRole('link', { name: 'Post offer' }).click();
  await expect(page).toHaveURL(/\/post$/);
  await page.getByRole('link', { name: 'Close' }).click();
  await expect(page).toHaveURL(/\/buy$/);
  await page.goto('/post?method=ZELLE');
  await page.getByRole('link', { name: 'Close' }).click();
  await expect(page).toHaveURL(/\/sell$/);
});

test('when the methods do not load, the form says so and Retry loads them', async ({ page }) => {
  await stub(page, { methodsFailures: 1 });
  await page.goto('/post?method=ZELLE');
  await expect(page.getByText("The payment methods didn't load.", { exact: true })).toBeVisible();
  await expect(f(page).method).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry' }).click();
  // Zelle (from ?method=ZELLE) is on the offer, so the picker offers the rest of the catalog.
  await expect(f(page).methodRow('ZELLE')).toBeVisible();
  await expect(f(page).method.locator('option', { hasText: 'PayPal' })).toHaveCount(1);
  await expect(f(page).method.locator('option', { hasText: 'Zelle' })).toHaveCount(0);
  await expect(page.getByText("The payment methods didn't load.", { exact: true })).toHaveCount(0);
});

test('there is no fixed price (owner Q1): no Fixed choice, no price box, no stale-price line; it posts a market margin', async ({ page }) => {
  const posts = await stub(page);
  await page.goto('/post?method=ZELLE');
  await expect(page.getByRole('radio', { name: 'Fixed price per XMR' })).toHaveCount(0);
  await expect(page.getByRole('radio', { name: 'Market ± %' })).toHaveCount(0);
  await expect(page.getByLabel('Your price per XMR')).toHaveCount(0);
  await expect(page.getByText(/fixed price/i)).toHaveCount(0);
  await expect(page.getByRole('radiogroup', { name: 'Your price' }).getByRole('radio')).toHaveText(['Above market', 'Below market']);
  await f(page).below.check();
  await f(page).margin.fill('1.5');
  await fillBoard(page);
  // $329.90 × 0.985 = $324.95.
  await expect(page.getByRole('region', { name: 'Preview' }).getByText('$324.95 / XMR', { exact: true })).toBeVisible();
  await f(page).post.click();
  await expect.poll(() => posts.length).toBe(1);
  // J-16's body: the currency's one band in whole units (O-018), the method with no price change and no instructions.
  expect(posts[0]!.postDataJSON()).toEqual({
    side: 'sell',
    amountUnit: 'fiat',
    currencies: [{ currency: 'USD', bands: [{ min: '50', max: '2000', marginBps: -150, minTrades: null }] }],
    methods: [{ methodId: 'ZELLE', adjustBps: 0, instructions: '' }],
    terms: '',
  });
});

test('posting a sell ad returns to the list where buyers see it, with the offer visible', async ({ page }) => {
  // The Buy list (Task 17) reads GET /v1/offers?side=sell; the stub lists the new offer under the poster's name.
  const [satoshi] = boardBuyOffers();
  const mine = { ...satoshi!, id: 'of_1', poster: { ...satoshi!.poster, tradeTag: ME.tradeTag }, pricing: { mode: 'market', marginBps: 50 }, rate: '33155', minTrades: 5 };
  const posts = await stub(page, { offers: [mine] });
  await page.goto('/post?method=ZELLE');
  await fillBoard(page);
  await f(page).terms.fill('Put the trade number in the memo.');
  await f(page).minTradesChoice('5').click();
  await f(page).post.click();
  await expect(page).toHaveURL(/\/buy\/ZELLE\?currency=USD$/);
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article [data-username]').first()).toHaveText('nightowl_44');
  expect(posts[0]!.postDataJSON()).toMatchObject({ currencies: [{ currency: 'USD', bands: [{ marginBps: 50, minTrades: 5 }] }], terms: 'Put the trade number in the memo.' });
  expect(posts[0]!.postDataJSON()).not.toHaveProperty('country');
  // The draft is cleared once posted: a new /post starts empty.
  await page.goto('/post');
  await expect(f(page).min).toHaveValue('');
});

test('a buy ad goes to the Sell list', async ({ page }) => {
  await stub(page);
  await page.goto('/post?method=ZELLE&currency=EUR');
  await page.getByRole('radio', { name: 'Buy XMR' }).click();
  await fillBoard(page);
  await f(page).post.click();
  await expect(page).toHaveURL(/\/sell\/ZELLE\?currency=EUR$/);
});

test('SBP, Mir and YooMoney (removed, owner 12 Nov: Russian anything is banned) are absent from the picker', async ({ page }) => {
  await stub(page);
  await page.goto('/post?method=SBP');
  await expect(f(page).method.locator('option', { hasText: 'Zelle' })).toHaveCount(1);
  const options = await f(page).method.locator('option').allTextContents();
  expect(options).toContain('Zelle');
  for (const name of ['SBP — Faster Payments System (Russia)', 'Mir card', 'YooMoney']) expect(options).not.toContain(name);
  await expect(f(page).method).toHaveValue('');
  // ?method=SBP put nothing on the offer: a method off the list is never kept (J-16).
  // owner 12 Nov: Russian anything is banned, so these names are out of the catalog itself.
  await expect(page.locator('[data-part="method"]')).toHaveCount(0);
});

test('a held user sees the API refusal as text', async ({ page }) => {
  await stub(page, { post: { status: 409, body: { error: 'trading-hold' } } });
  await page.goto('/post?method=ZELLE');
  await fillBoard(page);
  await f(page).post.click();
  // CantDoThat: the message is the dialog's description (C11 review N1, not also an alert).
  await expect(page.getByRole('dialog')).toHaveAccessibleDescription(/trading hold/);
  await expect(page).toHaveURL(/\/post/);
});

test('the offer cap refusal says the number the API sent (cap-dispute review M2, Q31: { buy, sell } are owner settings)', async ({ page }) => {
  await stub(page, { post: { status: 409, body: { error: 'too-many-offers', buy: 5, sell: 5 } } });
  await page.goto('/post?method=ZELLE');
  await fillBoard(page);
  await f(page).post.click();
  await expect(page.getByRole('dialog')).toHaveAccessibleDescription(/^Sorry, you're limited to 5 offers per side: 5 buying and 5 selling\. /);
  await expect(page).toHaveURL(/\/post/);
});

test('an account with no wallet lands on Add a wallet and returns to the filled form', async ({ page }) => {
  await stub(page, { post: { status: 409, body: { error: 'no-wallet' } } });
  await page.goto('/post?method=ZELLE');
  await page.getByRole('radio', { name: 'Buy XMR' }).click();
  await fillBoard(page);
  await f(page).below.check();
  await f(page).margin.fill('2.7');
  await f(page).terms.fill('Cash only.');
  await f(page).post.click();
  await expect(page).toHaveURL(/\/wallets\?add=1&returnTo=/);
  const back = new URL(page.url()).searchParams.get('returnTo')!;
  expect(back.startsWith('/post')).toBe(true);
  await page.goto(back);
  await expect(page.getByRole('radio', { name: 'Buy XMR' })).toBeChecked();
  await expect(f(page).methodRow('ZELLE')).toBeVisible();
  await expect(f(page).min).toHaveValue('$50');
  await expect(f(page).max).toHaveValue('$2,000');
  // The pricing comes back too (J-02: below/above market and the percentage; was checked on the
  // logged-out flow, which the front door closed).
  await expect(f(page).below).toBeChecked();
  await expect(f(page).margin).toHaveValue('2.7');
  await expect(f(page).terms).toHaveValue('Cash only.');
});

test('logged out, Post offer never opens: the front door (the Landing board) takes the visitor, keeping the form address (owner, 8 Nov 2026)', async ({ page }) => {
  const posts = await stub(page, { signedIn: false });
  await page.goto('/post?method=ZELLE&currency=GBP');
  await expect(page).toHaveURL(`/?returnTo=${encodeURIComponent('/post?method=ZELLE&currency=GBP')}`);
  await expect(f(page).post).toHaveCount(0);
  expect(posts).toEqual([]);
});

test('another currency shows the local price and its US-dollar value (spec 11.6)', async ({ page }) => {
  await stub(page);
  await page.goto('/post?method=SEPA&currency=EUR');
  await expect(page.getByText(/^Market €305\.10 \/ XMR \(about \$329\.90\) right now\./)).toBeVisible();
  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(preview.getByText('€306.63 / XMR', { exact: true })).toBeVisible();
  await expect(preview.getByText('about $331.55 / XMR', { exact: true })).toBeVisible();
});

test('with the price feed down, the form says so and a market offer can still be posted', async ({ page }) => {
  const posts = await stub(page, { price: 'down' });
  await page.goto('/post?method=ZELLE');
  // Under Your price, and in the preview instead of a price.
  await expect(page.getByText('Price unavailable right now.', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('region', { name: 'Preview' }).getByText('Price unavailable right now.', { exact: true })).toBeVisible();
  await expect(page.getByText(/^Market \S+ \/ XMR/)).toHaveCount(0);
  await fillBoard(page);
  await f(page).post.click();
  await expect.poll(() => posts.length).toBe(1);
});

test('a gift-card method shows the one bold warning (owner, 2026-10-21)', async ({ page }) => {
  await stub(page);
  await page.goto('/post?method=ZELLE');
  const warning = page.getByText('When trading Monero for gift cards, you accept all risks and responsibilities that come with gift cards. Buyer beware.', { exact: true });
  await expect(warning).toHaveCount(0);
  // J-16: the picker adds a method to the offer (Zelle stays); any gift-card method makes it a gift-card offer.
  await f(page).method.selectOption('AMAZON_GIFT_CARD');
  await expect(f(page).methodRow('AMAZON_GIFT_CARD')).toBeVisible();
  await expect(warning).toBeVisible();
});

test("a gift-card offer needs the card's country and sends it as `country` (Revision 2026-10-21)", async ({ page }) => {
  const posts = await stub(page);
  await page.goto('/post?method=ZELLE');
  // Never for a method that is not a gift card.
  await expect(f(page).country).toHaveCount(0);
  await f(page).method.selectOption('AMAZON_GIFT_CARD');
  await expect(f(page).country).toBeVisible();
  await fillBoard(page);
  // Owner demo note #219: Post offer is disabled until the country is chosen; leaving the box says why.
  await expect(f(page).post).toBeDisabled();
  await expect(page.locator('[data-part="post-missing"]')).toHaveText("To post this offer, finish the card's country, the gift card terms.");
  await f(page).country.focus();
  await f(page).country.blur();
  await expect(page.getByText("Choose the card's country.", { exact: true })).toBeVisible();
  await expect(f(page).country).toHaveAttribute('aria-invalid', 'true');
  expect(posts).toHaveLength(0);
  await f(page).country.selectOption({ label: 'United States' });
  // J-17 (F13): the poster's side's gift-card terms, each ticked first (a sell ad's poster checks the card).
  const terms = page.locator('[data-part="gift-card-terms"] input[type="checkbox"]');
  await expect(terms).toHaveCount(3);
  await expect(f(page).post).toBeDisabled();
  await expect(page.getByText('Tick each gift card term to post.', { exact: true })).toBeVisible();
  expect(posts).toHaveLength(0);
  for (const box of await terms.all()) await box.check();
  await expect(f(page).post).toBeEnabled();
  await f(page).post.click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]!.postDataJSON()).toMatchObject({ methods: [{ methodId: 'ZELLE' }, { methodId: 'AMAZON_GIFT_CARD' }], country: 'US', giftCardTerms: 'gift-card-terms-unsigned-1' });
  // Back on a plain method the field goes, and the country is not sent.
  await page.goto('/post?method=ZELLE');
  await expect(f(page).country).toHaveCount(0);
});

// Phone sizes (spec "Mobile ready at launch", owner 2026-10-25): the harness's viewports and layout
// rule (no sideways scroll, nothing past the sides, every control big enough to tap). Post offer
// stays on the screen while the form scrolls, and text inputs are at least 16 px (so phones don't
// zoom into them).
for (const viewport of PHONE_VIEWPORTS) {
  test(`at ${viewport} the form fits the phone`, async ({ page }) => {
    await setPhone(page, viewport);
    await stub(page);
    await page.goto('/post?method=AMAZON_GIFT_CARD&currency=EUR');
    await f(page).below.check();
    await f(page).margin.fill('2.5');
    await fillBoard(page);
    await expect(f(page).country).toBeVisible();
    await expectPhoneLayout(page);
    await expect(f(page).post).toBeInViewport({ ratio: 1 });
    // Typed fields are 16 px; the board's "Minimum completed trades" select is 15 px. Tick boxes and
    // radios take no typing (the gift-card terms' boxes, J-17), so phones don't zoom into them.
    const typed = await page.locator('input:not([type=checkbox]):not([type=radio]), textarea').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
    expect(typed.length).toBeGreaterThan(0);
    for (const s of typed) expect(s).toBeGreaterThanOrEqual(16);
    const selects = await page.locator('select').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
    for (const s of selects) expect(s).toBeGreaterThanOrEqual(15);
    await page.getByRole('region', { name: 'Preview' }).scrollIntoViewIfNeeded();
    await expect(page.getByText('You pay X2F 1% of each completed trade from your own ads. Taking an offer is free.', { exact: true })).toBeInViewport();
    await expect(f(page).post).toBeInViewport({ ratio: 1 });
    await expectPhoneLayout(page);
  });
}

test('trade size in XMR by default: one switch per box, both boxes switch together, both units in the preview (owner, 8 Nov)', async ({ page }) => {
  const posts = await stub(page);
  await page.goto('/post?method=ZELLE&currency=CAD');
  const smallest = page.getByRole('radiogroup', { name: 'Smallest trade unit' });
  const largest = page.getByRole('radiogroup', { name: 'Largest trade unit' });
  await expect(smallest.getByRole('radio')).toHaveText(['XMR', 'CAD']);
  await expect(smallest.getByRole('radio', { name: 'XMR' })).toBeChecked();
  await expect(largest.getByRole('radio', { name: 'XMR' })).toBeChecked();
  // The chosen unit is bold Monero orange, the other smaller and muted.
  const [chosen, other] = await Promise.all(
    [smallest.getByRole('radio', { name: 'XMR' }), smallest.getByRole('radio', { name: 'CAD' })].map((l) =>
      l.evaluate((el) => ({ weight: getComputedStyle(el).fontWeight, size: parseFloat(getComputedStyle(el).fontSize), color: getComputedStyle(el).color })),
    ),
  );
  // DM Mono's heaviest face is 500 (owner 16 Nov fonts D): heavier than the other's 400, no faked bold.
  expect(Number(chosen!.weight)).toBeGreaterThanOrEqual(500);
  expect(Number(chosen!.weight)).toBeGreaterThan(Number(other!.weight));
  expect(chosen!.size).toBeGreaterThan(other!.size);
  expect(chosen!.color).not.toBe(other!.color);

  await f(page).min.fill('0.5');
  await f(page).max.fill('25');
  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(page.getByText('One unit for the whole offer. Traders see both, converted at your price.', { exact: true })).toBeVisible();
  await expect(preview.locator('[data-part="preview-xmr"]')).toHaveText('0.500000 – 25.000000 XMR');
  await expect(preview.locator('[data-part="preview-fiat"]')).toHaveText(/^≈ CA\$[\d,.]+ – CA\$[\d,.]+ CAD$/);
  await expect(page.locator('[data-part="other-unit"]').first()).toHaveText(/^≈ CA\$[\d,.]+ at your price \(0\.5% above market\)$/);

  // Tapping the currency on the Largest box moves both boxes, and converts what was typed at your
  // price (review H1): "0.5" is never re-read as CA$0.50.
  await largest.getByRole('radio', { name: 'CAD' }).click();
  await expect(smallest.getByRole('radio', { name: 'CAD' })).toBeChecked();
  await expect(f(page).min).not.toHaveValue('0.5');
  await expect(f(page).min).toHaveValue(/^\d+(\.\d{1,2})?$/);
  await smallest.getByRole('radio', { name: 'XMR' }).click();
  await expect(largest.getByRole('radio', { name: 'XMR' })).toBeChecked();
  await f(page).min.fill('0.5');
  await f(page).max.fill('25');

  await f(page).post.click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]!.postDataJSON()).toMatchObject({ side: 'sell', amountUnit: 'xmr', currencies: [{ currency: 'CAD', bands: [{ min: '500000000000', max: '25000000000000' }] }] });
  expect(posts[0]!.postDataJSON()).not.toHaveProperty('minFiatCents');
});
