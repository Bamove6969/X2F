// Quotes and the Trade button (Task 18): BuyQuote (board BuyQuote.dc.html) and the seller quote. The
// API is stubbed with the board's example (src/fixtures/quoteBoard.ts) in the Task 3/4/5 shapes that
// src/screens/quote/api.ts reads (see test/quote-tripwires.test.ts).
import { expect, test, type Page } from '@playwright/test';
import { fiatCents } from '@x2f/trade';
import { BOARD_BUY_QUOTE as B } from '../src/fixtures/quoteBoard.js';
import { expectParity } from './parity.js';

interface Stub {
  signedIn: boolean;
  price: 'ok' | 'down';
  offers: unknown[];
  wallets: unknown[];
  /** What a take answers; by default a new trade, whose fiat total is locked as Task 5 does it. */
  take?: (body: { amountAtomic: string; walletId: string }) => { status: number; json: unknown };
}

interface Seen {
  takes: { offerId: string; amountAtomic: string; walletId: string }[];
  /** The fiat total each stubbed trade stores: fiatCents(amountAtomic, lockedRate) (OD-5). */
  storedFiatCents: bigint[];
}

const FIXED = { ...B.offer, id: 'offer-fixed', pricing: { mode: 'fixed', centsPerXmr: '34000' }, rate: '34000' };
const MIRA_BUYS = { ...B.offer, id: 'offer-mira', poster: { ...B.offer.poster, username: 'mira.k' } };

async function stubApi(page: Page, s: Stub): Promise<Seen> {
  const seen: Seen = { takes: [], storedFiatCents: [] };
  await page.route('**/v1/account/me', (r) =>
    s.signedIn ? r.fulfill({ json: { username: 'viewer_1', kind: 'trader' } }) : r.fulfill({ status: 401, json: { error: 'not-authenticated' } }),
  );
  await page.route('**/v1/methods?*', (r) =>
    r.fulfill({ json: { live: [{ id: B.method.id, name: B.method.name, group: 'Payment apps', giftCard: false, offers: 1, bestRate: B.marketCentsPerXmr }], all: [] } }),
  );
  await page.route('**/v1/price?*', (r) => {
    const currency = new URL(r.request().url()).searchParams.get('currency');
    return s.price === 'ok'
      ? r.fulfill({ json: { currency, centsPerXmr: B.marketCentsPerXmr, exponent: 2, at: new Date().toISOString(), usdCentsPerXmr: B.marketCentsPerXmr } })
      : r.fulfill({ status: 503, json: { error: 'price-unavailable' } });
  });
  await page.route('**/v1/offers?*', (r) => r.fulfill({ json: s.offers }));
  await page.route('**/v1/wallets', (r) => (s.signedIn ? r.fulfill({ json: s.wallets }) : r.fulfill({ status: 401, json: { error: 'not-authenticated' } })));
  await page.route('**/v1/offers/*/take', async (r) => {
    const offerId = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]!);
    const body = r.request().postDataJSON() as { amountAtomic: string; walletId: string };
    seen.takes.push({ offerId, ...body });
    if (s.take) {
      const a = s.take(body);
      return r.fulfill({ status: a.status, json: a.json });
    }
    seen.storedFiatCents.push(fiatCents(BigInt(body.amountAtomic), { currency: B.currency, centsPerXmr: BigInt(B.marketCentsPerXmr) }));
    return r.fulfill({ json: { code: B.code } });
  });
  return seen;
}

const base: Stub = { signedIn: true, price: 'ok', offers: [B.offer, FIXED], wallets: [...B.wallets] };
const BUY = `/buy/${B.method.id}/${B.offer.id}?currency=${B.currency}`;
const SELL = `/sell/${B.method.id}/${MIRA_BUYS.id}?currency=${B.currency}`;

const trade = (page: Page) => page.locator('[data-primary]');
const card = (page: Page) => page.locator('section[aria-label="What you get"]');

test.describe('BuyQuote', () => {
  test('matches the BuyQuote board', async ({ page }) => {
    await stubApi(page, base);
    await page.goto(`${BUY}&amount=${B.amount}`);
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    await expect(card(page)).toContainText('1.250000 XMR');
    await expectParity(page, 'BuyQuote');
  });

  test("a taker's quote never contains an X2F fee line or 1%, and has no Deposit row", async ({ page }) => {
    await stubApi(page, base);
    await page.goto(`${BUY}&amount=${B.amount}`);
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    await expect(card(page)).toContainText('$412.50 USD');
    await expect(card(page)).not.toContainText('X2F');
    await expect(page.locator('body')).not.toContainText('1%');
    await expect(page.locator('body')).not.toContainText(/deposit/i);
    await expect(card(page)).toContainText('about 0.0001 XMR, taken from the payout');
    // The only fee words are the board's footer: taking an offer is free.
    expect(((await page.locator('#root').innerText()).match(/X2F fee/g) ?? []).length).toBe(1);
  });

  test('a market offer is disabled with "Price unavailable right now" on a 503; a fixed-price offer still quotes', async ({ page }) => {
    await stubApi(page, { ...base, price: 'down' });
    await page.goto(`${BUY}&amount=${B.amount}`);
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    await expect(page.locator('#quote-amount-help')).toHaveText('Price unavailable right now');
    await expect(trade(page)).toBeDisabled();

    await page.goto(`/buy/${B.method.id}/${FIXED.id}?currency=USD&amount=340`);
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    await expect(card(page)).toContainText('$340.00 / XMR');
    await expect(card(page)).toContainText('1.000000 XMR');
    await expect(trade(page)).toBeEnabled();
  });

  test('Trade stays disabled until a usable wallet is picked', async ({ page }) => {
    await stubApi(page, { ...base, wallets: [B.wallets[0], { ...B.wallets[2], usable: false, usableFrom: '2099-01-01T00:00:00.000Z' }] });
    await page.goto(`${BUY}&amount=${B.amount}`);
    await expect(card(page)).toContainText('1.250000 XMR');
    await expect(trade(page)).toBeDisabled();
    await expect(page.getByRole('radio', { name: /Edge/ })).toHaveCount(0);
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    await expect(trade(page)).toBeEnabled();
  });

  test('with no wallets the primary goes to Add a wallet, and the take resumes after it', async ({ page }) => {
    const stub: Stub = { ...base, wallets: [] };
    const seen = await stubApi(page, stub);
    await page.goto(`${BUY}&amount=${B.amount}`);
    await expect(trade(page)).toHaveText('Add a wallet');
    await trade(page).click();
    await expect(page).toHaveURL(/\/wallets\?add=1&returnTo=/);
    const returnTo = new URL(page.url()).searchParams.get('returnTo')!;
    // Task 29's Add a wallet adds the first wallet (no confirm needed for a first wallet) and goes back.
    stub.wallets = [B.wallets[0]];
    await page.goto(returnTo);
    await expect(page).toHaveURL(`/trade/${B.code}`);
    expect(seen.takes).toEqual([{ offerId: B.offer.id, amountAtomic: '1250000000000', walletId: 'w-cake' }]);
  });

  test('logged out, Trade goes to /setup/terms, then /trade/<code> after a stubbed setup', async ({ page }) => {
    const stub: Stub = { ...base, signedIn: false, wallets: [] };
    const seen = await stubApi(page, stub);
    await page.goto(`${BUY}&amount=${B.amount}`);
    await expect(card(page)).toContainText('1.250000 XMR');
    await trade(page).click();
    await expect(page).toHaveURL(/\/setup\/terms\?returnTo=/);
    const returnTo = new URL(page.url()).searchParams.get('returnTo')!;
    expect(seen.takes).toHaveLength(0);
    // The stubbed setup: an account now exists with its first wallet, and setup ends on returnTo.
    stub.signedIn = true;
    stub.wallets = [B.wallets[0]];
    await page.goto(returnTo);
    await expect(page).toHaveURL(`/trade/${B.code}`);
    expect(seen.takes).toHaveLength(1);
  });

  test('a crafted resume link takes nothing: the quote is filled in and waits for a tap', async ({ page }) => {
    const seen = await stubApi(page, { ...base, wallets: [B.wallets[0]] });
    await page.goto(`${BUY}&amount=${B.amount}&unit=fiat&resume=${'a'.repeat(32)}`);
    await expect(card(page)).toContainText('1.250000 XMR');
    await expect(page.locator('#quote-amount')).toHaveValue(B.amount);
    await expect(page).not.toHaveURL(/resume=/);
    expect(seen.takes).toHaveLength(0);
    await expect(page).not.toHaveURL(/\/trade\//);
  });

  test("the quote's fiat total equals the fiatCents the trade stores (OD-5)", async ({ page }) => {
    const seen = await stubApi(page, base);
    await page.goto(`${BUY}&amount=777.77`);
    await page.getByRole('radio', { name: /Ledger/ }).check();
    const shown = (await card(page).locator('.x2f-quote__row--total .x2f-quote__mono').innerText()).trim();
    await trade(page).click();
    await expect(page).toHaveURL(`/trade/${B.code}`);
    expect(seen.storedFiatCents).toHaveLength(1);
    const stored = seen.storedFiatCents[0]!;
    expect(shown).toBe(`$${stored / 100n}.${(stored % 100n).toString().padStart(2, '0')} USD`);
    expect(shown).toBe('$777.77 USD');
  });

  test("an over-cap amount is refused with the caller's own stage only", async ({ page }) => {
    await stubApi(page, { ...base, take: () => ({ status: 409, json: { error: 'starter-limit', stage: 'starter', capUsdCents: '20000' } }) });
    await page.goto(`${BUY}&amount=${B.amount}`);
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    await trade(page).click();
    await expect(page.getByRole('alert')).toHaveText('Your account is on Starter limits up to $200 per trade. Try a smaller amount.');
    await expect(page.locator('body')).not.toContainText(/Building|Graduated/);
  });
});

test.describe('SellQuote', () => {
  test('Max, the funding and refund wallet, the same rows and no fee line', async ({ page }) => {
    const seen = await stubApi(page, { ...base, offers: [MIRA_BUYS] });
    await page.goto(SELL);
    await expect(page.getByText('Selling to mira.k')).toBeVisible();
    await page.getByRole('button', { name: 'Max' }).click();
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    await expect(card(page)).toContainText('4.545454 XMR');
    await expect(card(page)).toContainText('Refunds go back to it.');
    await expect(card(page)).not.toContainText('X2F');
    await expect(page.locator('body')).not.toContainText('1%');
    await expect(page.locator('body')).not.toContainText(/deposit/i);
    expect(await page.locator('[data-primary]').count()).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await trade(page).click();
    await expect(page).toHaveURL(`/trade/${B.code}`);
    expect(seen.takes[0]).toMatchObject({ offerId: MIRA_BUYS.id, amountAtomic: '4545454000000', walletId: 'w-cake' });
  });
});
