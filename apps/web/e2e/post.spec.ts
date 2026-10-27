// PostOffer (Task 21, board PostOffer.dc.html). The API is stubbed per test with page.route, in
// the shapes of Task 3 (GET /v1/methods, GET /v1/price, on the main line and checked against the
// parsers 2026-10-27) and the plan's Task 4 (POST /v1/offers, GET /v1/offers);
// apps/web/test/post-tripwires.test.ts fails when Task 4 lands so these stubs get checked against
// it. The method list is built from data/payment-methods.json with Task 3's own rule (a method with
// `legalReview` is unavailable and left out).
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
};

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const ME = { displayName: 'nightowl_44', kind: 'trader', level: 'full', termsCurrent: true };

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
  method: page.getByLabel('Payment method'),
  currency: page.getByLabel('Currency'),
  min: page.getByLabel('Smallest trade'),
  max: page.getByLabel('Largest trade'),
  terms: page.getByLabel('Your terms (optional)'),
  minTrades: page.getByLabel('Minimum completed trades'),
  fixed: page.getByLabel('Your price per XMR'),
  market: page.getByRole('radio', { name: 'Market ± %' }),
  fixedMode: page.getByRole('radio', { name: 'Fixed price per XMR' }),
  country: page.getByLabel('Country', { exact: true }),
  up: page.getByRole('button', { name: 'Raise margin by 0.1%' }),
  down: page.getByRole('button', { name: 'Lower margin by 0.1%' }),
  post: page.getByRole('button', { name: 'Post offer' }),
});

async function fillBoard(page: Page): Promise<void> {
  const x = f(page);
  await x.min.fill('$50');
  await x.max.fill('$2,000');
}

test('parity with PostOffer at 390x844', async ({ page }) => {
  // KNOWN_EXCEPTIONS.PostOffer (parity.ts): the board's "Bank transfer (ACH)" option is the catalog's
  // "ACH bank transfer (US)", and its "Custom method" option has no counterpart (P3-M3 suggests a
  // missing method from the browse screens). The board has no pricing choice yet (the plan's
  // controller step adds Market ± % / Fixed price per XMR to the canvas and re-captures PostOffer.png).
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
  for (const t of ['I want to', 'Your price', 'Who can trade with you', 'How others will see it']) await expect(page.getByText(t, { exact: true })).toBeVisible();
  await expect(f(page).market).toBeChecked();
  await expect(page.getByText('+0.5%', { exact: true })).toBeVisible();
  await expect(page.getByText('above market', { exact: true })).toBeVisible();
  await expect(
    page.getByText("Market $329.90 / XMR right now. Your price follows the market, so it's always $331.55 / XMR at today's rate.", { exact: true }),
  ).toBeVisible();
  const preview = page.getByRole('region', { name: 'Preview' });
  await expect(preview.getByText('Selling XMR via Zelle · USD · you', { exact: true })).toBeVisible();
  await expect(preview.getByText('$331.55 / XMR', { exact: true })).toBeVisible();
  await expect(preview.getByText('$50 – $2,000', { exact: true })).toBeVisible();
  await expect(page.getByText('You pay X2F 1% of each completed trade from your own ads. Taking an offer is free.', { exact: true })).toBeVisible();
  await expect(page.locator('[data-primary]')).toHaveCount(1);
  await expect(page.locator('[data-primary]')).toHaveText('Post offer');
  // Minimum completed trades, shown openly to takers.
  await expect(f(page).minTrades.locator('option')).toHaveText(['Anyone', '5+', '10+', '50+']);
  await f(page).minTrades.selectOption({ label: '10+' });
  await expect(preview.getByText('Selling XMR via Zelle · USD · you · 10+ completed trades', { exact: true })).toBeVisible();
});

test('the margin steps by 0.1%', async ({ page }) => {
  await stub(page);
  await page.goto('/post?method=ZELLE');
  await f(page).up.click();
  await expect(page.getByText('+0.6%', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Preview' }).getByText('$331.88 / XMR', { exact: true })).toBeVisible();
  for (let i = 0; i < 7; i += 1) await f(page).down.click();
  await expect(page.getByText('-0.1%', { exact: true })).toBeVisible();
  await expect(page.getByText('below market', { exact: true })).toBeVisible();
});

test('a smallest trade above the largest is refused inline and nothing is posted', async ({ page }) => {
  const posts = await stub(page);
  await page.goto('/post?method=ZELLE');
  await f(page).min.fill('500');
  await f(page).max.fill('100');
  await f(page).post.click();
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
  await f(page).market.focus();
  await page.keyboard.press('ArrowDown');
  await expect(f(page).fixedMode).toBeChecked();
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
  await expect(f(page).method.locator('option', { hasText: 'Zelle' })).toHaveCount(1);
  await expect(page.getByText("The payment methods didn't load.", { exact: true })).toHaveCount(0);
});

test('Fixed shows the stale-price warning and posts pricing.mode = fixed', async ({ page }) => {
  const posts = await stub(page);
  await page.goto('/post?method=ZELLE');
  await expect(page.getByText('A fixed price goes stale when the market moves.')).toHaveCount(0);
  await f(page).fixedMode.check();
  await expect(page.getByText('A fixed price goes stale when the market moves.', { exact: true })).toBeVisible();
  await expect(f(page).up).toHaveCount(0);
  await f(page).fixed.fill('335');
  await fillBoard(page);
  await expect(page.getByRole('region', { name: 'Preview' }).getByText('$335.00 / XMR', { exact: true })).toBeVisible();
  await f(page).post.click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]!.postDataJSON()).toEqual({
    side: 'sell',
    methodId: 'ZELLE',
    currency: 'USD',
    pricing: { mode: 'fixed', centsPerXmr: '33500' },
    minFiatCents: '5000',
    maxFiatCents: '200000',
    minTrades: 0,
    terms: '',
  });
});

test('posting a sell ad returns to the list where buyers see it, with the offer visible', async ({ page }) => {
  // The Buy list (Task 17) reads GET /v1/offers?side=sell; the stub lists the new offer under the poster's name.
  const [satoshi] = boardBuyOffers();
  const mine = { ...satoshi!, id: 'of_1', poster: { ...satoshi!.poster, username: ME.displayName }, pricing: { mode: 'market', marginBps: 50 }, rate: '33155', minTrades: 5 };
  const posts = await stub(page, { offers: [mine] });
  await page.goto('/post?method=ZELLE');
  await fillBoard(page);
  await f(page).terms.fill('Put the trade number in the memo.');
  await f(page).minTrades.selectOption({ label: '5+' });
  await f(page).post.click();
  await expect(page).toHaveURL(/\/buy\/ZELLE\?currency=USD$/);
  await expect(page.locator('article')).toHaveCount(1);
  await expect(page.locator('article [data-username]').first()).toHaveText('nightowl_44');
  expect(posts[0]!.postDataJSON()).toMatchObject({ pricing: { mode: 'market', marginBps: 50 }, minTrades: 5, terms: 'Put the trade number in the memo.' });
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

test('SBP and the other methods awaiting legal review are absent from the picker', async ({ page }) => {
  await stub(page);
  await page.goto('/post?method=SBP');
  await expect(f(page).method.locator('option', { hasText: 'Zelle' })).toHaveCount(1);
  const options = await f(page).method.locator('option').allTextContents();
  expect(options).toContain('Zelle');
  for (const name of ['SBP — Faster Payments System (Russia)', 'Mir card', 'YooMoney']) expect(options).not.toContain(name);
  await expect(f(page).method).toHaveValue('');
});

test('a held user sees the API refusal as text', async ({ page }) => {
  await stub(page, { post: { status: 409, body: { error: 'trading-hold' } } });
  await page.goto('/post?method=ZELLE');
  await fillBoard(page);
  await f(page).post.click();
  await expect(page.getByRole('alert')).toHaveText(/trading hold/);
  await expect(page).toHaveURL(/\/post/);
});

test('an account with no wallet lands on Add a wallet and returns to the filled form', async ({ page }) => {
  await stub(page, { post: { status: 409, body: { error: 'no-wallet' } } });
  await page.goto('/post?method=ZELLE');
  await page.getByRole('radio', { name: 'Buy XMR' }).click();
  await fillBoard(page);
  await f(page).terms.fill('Cash only.');
  await f(page).post.click();
  await expect(page).toHaveURL(/\/wallets\?add=1&returnTo=/);
  const back = new URL(page.url()).searchParams.get('returnTo')!;
  expect(back.startsWith('/post')).toBe(true);
  await page.goto(back);
  await expect(page.getByRole('radio', { name: 'Buy XMR' })).toBeChecked();
  await expect(f(page).method).toHaveValue('ZELLE');
  await expect(f(page).min).toHaveValue('$50');
  await expect(f(page).max).toHaveValue('$2,000');
  await expect(f(page).terms).toHaveValue('Cash only.');
});

test('logged out, Post offer goes to setup and comes back with the form intact', async ({ page }) => {
  const posts = await stub(page, { signedIn: false });
  await page.goto('/post?method=ZELLE&currency=GBP');
  await f(page).fixedMode.check();
  await f(page).fixed.fill('270');
  await fillBoard(page);
  await f(page).post.click();
  await expect(page).toHaveURL(/\/setup\?returnTo=/);
  expect(posts.length).toBeLessThanOrEqual(1);
  const back = new URL(page.url()).searchParams.get('returnTo')!;
  expect(back.startsWith('/post')).toBe(true);
  await page.goto(back);
  await expect(f(page).currency).toHaveValue('GBP');
  await expect(f(page).fixedMode).toBeChecked();
  await expect(f(page).fixed).toHaveValue('270');
  await expect(f(page).min).toHaveValue('$50');
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
  await f(page).method.selectOption('AMAZON_GIFT_CARD');
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
  await f(page).post.click();
  await expect(page.getByText("Choose the card's country.", { exact: true })).toBeVisible();
  await expect(f(page).country).toHaveAttribute('aria-invalid', 'true');
  expect(posts).toHaveLength(0);
  await f(page).country.selectOption({ label: 'United States' });
  await f(page).post.click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]!.postDataJSON()).toMatchObject({ methodId: 'AMAZON_GIFT_CARD', country: 'US' });
  // Back on a plain method the field goes, and the country is not sent.
  await page.goto('/post?method=ZELLE');
  await expect(f(page).country).toHaveCount(0);
});

test('a fixed price far from the market gets a caution line, and one 50% off is refused', async ({ page }) => {
  const posts = await stub(page);
  await page.goto('/post?method=ZELLE');
  await f(page).fixedMode.check();
  await fillBoard(page);
  await f(page).fixed.fill('290');
  await expect(page.getByText('Caution: that is 12.1% below the market price', { exact: true })).toBeVisible();
  await f(page).fixed.fill('335');
  await expect(page.getByText(/^Caution:/)).toHaveCount(0);
  await f(page).fixed.fill('160');
  await f(page).post.click();
  await expect(page.getByText('Check your price: the market is $329.90 / XMR', { exact: true })).toBeVisible();
  await expect(f(page).fixed).toHaveAttribute('aria-invalid', 'true');
  expect(posts).toHaveLength(0);
  await f(page).fixed.fill('290');
  await f(page).post.click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]!.postDataJSON()).toMatchObject({ pricing: { mode: 'fixed', centsPerXmr: '29000' } });
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
    await f(page).fixedMode.check();
    await f(page).fixed.fill('250');
    await fillBoard(page);
    await expect(f(page).country).toBeVisible();
    await expectPhoneLayout(page);
    await expect(f(page).post).toBeInViewport({ ratio: 1 });
    // Typed fields are 16 px; the board's "Minimum completed trades" select is 15 px.
    const typed = await page.locator('input, textarea').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
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
