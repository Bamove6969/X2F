// Quotes and the Trade button (Task 18): BuyQuote (board BuyQuote.dc.html) and the seller quote. The
// API is stubbed with the board's example (src/fixtures/quoteBoard.ts) in the Task 3/4/5 shapes that
// src/screens/quote/api.ts reads (all on the line now).
import { expect, test, type Page } from '@playwright/test';
import { fiatCents } from '@x2f/trade';
import { BOARD_BUY_QUOTE as B } from '../src/fixtures/quoteBoard.js';
import { expectParity } from './parity.js';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';
import { INSIDE, screenStatus } from './session.js';

/**
 * The take body as Task 5 reads it (Revision 2026-10-27): the amount, the wallet and the quoted rate
 * and total; J-16 adds the currency and the payment method the quote was in (the buyer picks both).
 */
interface TakeBody {
  amountAtomic: string;
  walletId: string;
  centsPerXmr: string;
  fiatCents: string;
  methodId: string;
  currency: string;
  lienRecoveryAtomic?: string;
}

interface Stub {
  signedIn: boolean;
  price: 'ok' | 'down';
  /** The market rate now (the board's $330.00 by default); a test moves it to see a price-changed refusal. */
  rate?: string;
  offers: unknown[];
  wallets: unknown[];
  /**
   * What a take answers; by default as Task 5 does it: a new trade locking the quoted rate when it
   * is the market rate now (margin 0), else 409 price-changed.
   */
  take?: (body: TakeBody) => { status: number; json: unknown };
  /** Owner demo note #6: the account's rating on GET /v1/account/me (absent: an older API build). */
  securityRating?: 'weak' | 'medium' | 'high';
  /** Review B1: what GET /v1/account/liens/preview answers (the buyer's lien recovery); '0' by default. */
  lienRecovery?: string;
}

interface Seen {
  takes: ({ offerId: string } & TakeBody)[];
  /** The fiat total each stubbed trade stores: fiatCents(amountAtomic, lockedRate) (OD-5). */
  storedFiatCents: bigint[];
  /** Each POST /v1/wallets body from Task 29's Add a wallet. */
  walletPosts: unknown[];
}

/** 50% above the market, the furthest an offer goes (owner F1); there are no fixed-price offers (owner Q1). */
const ABOVE = { ...B.offer, id: 'offer-above', pricing: { mode: 'market', marginBps: 5000 }, rate: '49500' };
const MIRA_BUYS = { ...B.offer, id: 'offer-mira', poster: { ...B.offer.poster, tradeTag: 'mira.k' } };

async function stubApi(page: Page, s: Stub): Promise<Seen> {
  const seen: Seen = { takes: [], storedFiatCents: [], walletPosts: [] };
  // These flows are about the take and the room it opens: the courtesy sheet over the room (T-039,
  // quote/courtesy.ts; design 10 Nov: the first time the room opens) is ticked off, as after "Don't show
  // this again". Its own tests are in test/tradeRoom.test.tsx.
  await page.addInitScript(() => window.localStorage.setItem('x2f.courtesy-sheet.off', '1'));
  await page.route('**/v1/account/me', (r) =>
    s.signedIn
      ? r.fulfill({ json: { tradeTag: 'viewer_1', ...INSIDE, methods: ['pgp'], ...(s.securityRating ? { securityRating: s.securityRating } : {}) } })
      : r.fulfill({ status: 401, json: { error: 'not-authenticated' } }),
  );
  await page.route('**/v1/methods?*', (r) =>
    r.fulfill({ json: { live: [{ id: B.method.id, name: B.method.name, group: 'Payment apps', giftCard: false, offers: 1, bestRate: B.marketCentsPerXmr }], all: [] } }),
  );
  await page.route('**/v1/price?*', (r) => {
    const currency = new URL(r.request().url()).searchParams.get('currency');
    return s.price === 'ok'
      ? r.fulfill({ json: { currency, centsPerXmr: s.rate ?? B.marketCentsPerXmr, exponent: 2, at: new Date().toISOString(), usdCentsPerXmr: s.rate ?? B.marketCentsPerXmr } })
      : r.fulfill({ status: 503, json: { error: 'price-unavailable' } });
  });
  await page.route('**/v1/offers?*', (r) => r.fulfill({ json: s.offers }));
  await page.route('**/v1/wallets', (r) => {
    if (!s.signedIn) return r.fulfill({ status: 401, json: { error: 'not-authenticated' } });
    if (r.request().method() !== 'POST') return r.fulfill({ json: s.wallets });
    // Task 29's Add a wallet; the stub adds them usable at once, as a first wallet is (spec 6.3).
    const posted = r.request().postDataJSON() as { wallets: { app: string; label: string; address: string }[] } | { app: string; label: string; address: string; oneTime?: boolean };
    seen.walletPosts.push(posted);
    if (!('wallets' in posted)) {
      // Owner demo note #6: the quote's new-address sheet adds one wallet; the stub makes it usable at once.
      const one = { ...posted, id: 'w-inline', addressEnd: posted.address.slice(-6), usableFrom: '2026-10-01T00:00:00.000Z', usable: true, oneTime: posted.oneTime === true };
      s.wallets = [...s.wallets, one];
      return r.fulfill({ status: 201, json: one });
    }
    const body = posted;
    const added = body.wallets.map((w, i) => ({ ...w, id: `w-new-${i}`, addressEnd: w.address.slice(-6), usableFrom: '2026-10-01T00:00:00.000Z', usable: true }));
    s.wallets = [...s.wallets, ...added];
    return r.fulfill({ status: 201, json: added });
  });
  await page.route('**/v1/wallets/rule', (r) =>
    r.fulfill({ json: { firstWallet: s.wallets.length === 0, strongMethods: ['pgp'] } }),
  );
  await page.route('**/v1/account/liens/preview?*', (r) => r.fulfill({ json: { lienRecoveryAtomic: s.lienRecovery ?? '0' } }));
  await page.route('**/v1/offers/*/take', async (r) => {
    const offerId = decodeURIComponent(new URL(r.request().url()).pathname.split('/')[3]!);
    const body = r.request().postDataJSON() as TakeBody;
    seen.takes.push({ offerId, ...body });
    if (s.take) {
      const a = s.take(body);
      return r.fulfill({ status: a.status, json: a.json });
    }
    const rate = s.rate ?? B.marketCentsPerXmr;
    if (body.centsPerXmr !== rate) return r.fulfill({ status: 409, json: { error: 'price-changed' } });
    seen.storedFiatCents.push(fiatCents(BigInt(body.amountAtomic), { currency: B.currency, centsPerXmr: BigInt(rate) }));
    return r.fulfill({ json: { code: B.code, centsPerXmr: body.centsPerXmr, fiatCents: body.fiatCents, maxFiatCents: B.offer.maxFiatCents } });
  });
  return seen;
}

const base: Stub = { signedIn: true, price: 'ok', offers: [B.offer, ABOVE], wallets: [...B.wallets] };
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

  // Job 3 (design review 8 Nov 2026, item 2; SellQuote-Wide): beside the rail the quote is two
  // columns, 560 and 360, and Trade is in view without scrolling, never a 1300 px wide field.
  test('at 1440x900 the quote is two columns beside the rail and Trade is above the fold', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await stubApi(page, base);
    await page.goto(`${BUY}&amount=${B.amount}`);
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    await expect(card(page)).toContainText('1.250000 XMR');
    await expect(page.locator('nav.x2f-rail .x2f-rail__page')).toHaveText('Your quote');
    const main = (await page.locator('.x2f-quote__main').boundingBox())!;
    const amount = (await page.locator('.x2f-quote__box').boundingBox())!;
    const button = (await trade(page).boundingBox())!;
    expect([main.x, main.width]).toEqual([240 + 48, 560]);
    expect(amount.width).toBeLessThanOrEqual(560);
    expect(button.x).toBe(240 + 48 + 560 + 24);
    expect(button.width).toBe(360);
    expect(button.y + button.height).toBeLessThanOrEqual(900);
    expect(await page.evaluate(() => [window.scrollY, document.documentElement.scrollWidth])).toEqual([0, 1440]);
  });

  // Review I1 (8 Nov 2026): wide starts at 1000 px but the rail plus two columns needs 1280.
  test('at 1024x768 the quote does not scroll sideways and Trade is there', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await stubApi(page, base);
    await page.goto(`${BUY}&amount=${B.amount}`);
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    await expect(card(page)).toContainText('1.250000 XMR');
    await expect(trade(page)).toBeVisible();
    const button = (await trade(page).boundingBox())!;
    expect(button.x + button.width).toBeLessThanOrEqual(1024);
    expect(await page.evaluate(() => document.scrollingElement!.scrollWidth)).toBe(1024);
  });

  test("a taker's quote never contains an X2F fee line or 1%, and has no Deposit row", async ({ page }) => {
    await stubApi(page, base);
    await page.goto(`${BUY}&amount=${B.amount}`);
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    await expect(card(page)).toContainText('$412.50 USD');
    await expect(card(page)).not.toContainText('X2F');
    await expect(page.locator('body')).not.toContainText('1%');
    await expect(page.locator('body')).not.toContainText(/deposit/i);
    await expect(card(page)).toContainText('about 0.00005 XMR for your payout, taken from it');
    // The only fee words are the board's footer: taking an offer is free.
    expect(((await page.locator('#root').innerText()).match(/X2F fee/g) ?? []).length).toBe(1);
  });

  test('on a 503 every offer, at any margin, is disabled with "Price unavailable right now" (no fixed price, owner Q1)', async ({ page }) => {
    await stubApi(page, { ...base, price: 'down' });
    for (const url of [`${BUY}&amount=${B.amount}`, `/buy/${B.method.id}/${ABOVE.id}?currency=USD&amount=495`]) {
      await page.goto(url);
      await page.getByRole('radio', { name: /Cake Wallet/ }).check();
      await expect(page.locator('#quote-amount-help')).toHaveText('Price unavailable right now');
      await expect(trade(page)).toBeDisabled();
    }
  });

  test('an offer 50% above the market quotes at its own rate (owner F1)', async ({ page }) => {
    await stubApi(page, base);
    await page.goto(`/buy/${B.method.id}/${ABOVE.id}?currency=USD&amount=495`);
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    await expect(card(page)).toContainText('$495.00 / XMR');
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

  test('with no wallets the primary goes to Add a wallet; back from it the quote is shown again with the new wallet picked, and a tap takes', async ({ page }) => {
    const stub: Stub = { ...base, wallets: [] };
    const seen = await stubApi(page, stub);
    await page.goto(`${BUY}&amount=${B.amount}`);
    await expect(trade(page)).toHaveText('Add a wallet');
    await trade(page).click();
    await expect(page).toHaveURL(/\/wallets\?add=1&returnTo=/);
    // Task 29's Add a wallet: a first wallet needs no confirm and works at once, so saving it goes
    // straight back to returnTo, in this tab (the pending-take marker is per tab).
    const popup = page.getByRole('dialog', { name: 'Before you add a wallet' });
    await popup.getByRole('button', { name: 'Continue' }).click();
    await page.getByLabel('Name', { exact: true }).fill('Cake Wallet');
    await page.getByLabel(/Receive address/).fill(B.wallets[0].address);
    await page.getByRole('button', { name: 'Save wallet' }).click();
    await expect(screenStatus(page)).toHaveText("You're back. Check the total, then tap Trade.");
    expect(seen.walletPosts).toEqual([{ wallets: [{ app: 'cake', label: 'Cake Wallet', address: B.wallets[0].address }] }]);
    await expect(page.getByRole('radio', { name: /Cake Wallet/ })).toBeChecked();
    await expect(page).not.toHaveURL(/resume=/);
    expect(seen.takes).toHaveLength(0);
    await trade(page).click();
    await expect(page).toHaveURL(`/trade/${B.code}`);
    expect(seen.takes).toEqual([
      { offerId: B.offer.id, amountAtomic: '1250000000000', walletId: 'w-new-0', centsPerXmr: B.marketCentsPerXmr, fiatCents: '41250', methodId: B.method.id, currency: B.currency, lienRecoveryAtomic: '0' },
    ]);
  });

  test("logged out, the quote never opens: the Landing board keeps it as returnTo; Create account starts setup with it, and Welcome's Start trading comes back to the quote at the price now, never taken silently (owner, 8 Nov 2026)", async ({ page }) => {
    const stub: Stub = { ...base, signedIn: false, wallets: [] };
    const seen = await stubApi(page, stub);
    const offerCalls: string[] = [];
    page.on('request', (r) => {
      const path = new URL(r.url()).pathname;
      if (path === '/v1/offers' || path === '/v1/price') offerCalls.push(path);
    });
    const quote = `${BUY}&amount=${B.amount}`;
    await page.goto(quote);
    // The front door (design review 2026-11-08 item 1): the Landing board, nothing of the quote.
    await expect(page).toHaveURL(`/?returnTo=${encodeURIComponent(quote)}`);
    await expect(page.locator('[data-screen="landing"]')).toBeVisible();
    await expect(card(page)).toHaveCount(0);
    expect(offerCalls).toEqual([]);
    // Create account starts setup on the Terms, with the quote as returnTo.
    await page.locator('[data-part="landing-create"]').click();
    await expect(page).toHaveURL(`/setup?returnTo=${encodeURIComponent(quote)}`);
    await expect(page.locator('[data-screen="setup-terms"]')).toBeVisible();
    expect(offerCalls).toEqual([]);
    expect(seen.takes).toHaveLength(0);
    // The steps in between are setup.spec's: here an account now exists with its first wallet, and
    // the person is on Welcome in this same tab. Setup took a while and the feed moved: the quote
    // the person comes back to shows the rate now.
    stub.signedIn = true;
    stub.wallets = [B.wallets[0]];
    stub.rate = '34000';
    await page.goto(`/setup/welcome?returnTo=${encodeURIComponent(quote)}`);
    await page.click('[data-part="start-trading"]');
    await expect(page).toHaveURL(/\/buy\//);
    await expect(card(page)).toContainText('$340.00 / XMR');
    await expect(card(page)).toContainText('$412.50 USD');
    expect(seen.takes).toHaveLength(0);
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    await trade(page).click();
    await expect(page).toHaveURL(`/trade/${B.code}`);
    expect(seen.takes).toHaveLength(1);
    expect(seen.takes[0]).toMatchObject({ centsPerXmr: '34000', fiatCents: '41250' });
  });

  test("the rate the person sees is the rate that locks: a stale rate is refused price-changed, the quote re-quotes, and the fresh tap locks the new one", async ({ page }) => {
    const stub: Stub = { ...base };
    const seen = await stubApi(page, stub);
    await page.goto(`${BUY}&amount=${B.amount}`);
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    await expect(card(page)).toContainText('$330.00 / XMR');
    // The feed moves between the quote's last poll and the tap.
    stub.rate = '34000';
    await trade(page).click();
    await expect(page.getByRole('alert')).toHaveText('The price moved. Check the new total and tap Trade again.');
    await expect(page).not.toHaveURL(/\/trade\//);
    expect(seen.takes).toHaveLength(1);
    expect(seen.takes[0]!.centsPerXmr).toBe('33000');
    expect(seen.storedFiatCents).toHaveLength(0);
    await expect(card(page)).toContainText('$340.00 / XMR');
    // $412.50 at $340.00 is 1.213235294117 XMR. The buyer sends no XMR, so "You receive" shows the
    // boards' 6 places (design review 8 Nov item 4); the take still carries the exact amount.
    await expect(card(page)).toContainText('1.213235 XMR');
    await expect(card(page)).not.toContainText('1.213235294117');
    await expect(card(page)).toContainText('$412.50 USD');
    await trade(page).click();
    await expect(page).toHaveURL(`/trade/${B.code}`);
    expect(seen.takes[1]).toMatchObject({ centsPerXmr: '34000', fiatCents: '41250' });
    expect(seen.storedFiatCents).toEqual([41_250n]);
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

  test("the take hands the trade room the device's own record of the quote shown, stored in this tab before navigating", async ({ page }) => {
    const seen = await stubApi(page, base);
    await page.goto(`${BUY}&amount=${B.amount}`);
    await page.getByRole('radio', { name: /Ledger/ }).check();
    await expect(card(page)).toContainText('1.250000 XMR');
    await trade(page).click();
    await expect(page).toHaveURL(`/trade/${B.code}`);
    // What the room reads after a reload (history state is gone): the taker's role, the picked
    // wallet's full address and the deal as the quote showed it (Task 12's ConfirmedTrade).
    const stored = await page.evaluate((key) => sessionStorage.getItem(key), `x2f.confirmed:${B.code}`);
    expect(JSON.parse(stored ?? 'null')).toEqual({
      role: 'buyer',
      ownAddress: B.wallets[1].address,
      deal: { poster: 'seller', takeAmountAtomic: seen.takes[0]!.amountAtomic, currency: 'USD', centsPerXmr: B.marketCentsPerXmr, maxFiatCents: B.offer.maxFiatCents },
    });
    expect(seen.takes[0]!.amountAtomic).toBe('1250000000000');
  });

  test('review B1: a buyer who owes after a dispute sees what this purchase pays to the person they owe before Trade, and the take carries it', async ({ page }) => {
    const seen = await stubApi(page, {
      ...base,
      lienRecovery: '500000000000',
      take: (body) => ({ status: 200, json: { code: B.code, centsPerXmr: body.centsPerXmr, fiatCents: body.fiatCents, maxFiatCents: B.offer.maxFiatCents, lienRecoveryAtomic: '500000000000' } }),
    });
    await page.goto(`${BUY}&amount=${B.amount}`);
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    await expect(page.locator('[data-part="lien-recovery"]')).toContainText('0.5');
    await expect(page.locator('[data-part="lien-recovery-note"]')).toContainText('Tapping Trade agrees to this.');
    await trade(page).click();
    await expect(page).toHaveURL(new RegExp(`/trade/${B.code}`));
    expect(seen.takes[0]).toMatchObject({ lienRecoveryAtomic: '500000000000' });
  });

  test("an over-cap amount is refused with the caller's own stage only", async ({ page }) => {
    await stubApi(page, { ...base, take: () => ({ status: 409, json: { error: 'starter-limit', stage: 'starter', capUsdCents: '20000' } }) });
    await page.goto(`${BUY}&amount=${B.amount}`);
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    await trade(page).click();
    // CantDoThat: the message is the dialog's description (C11 review N1, not also an alert).
    await expect(page.getByRole('dialog')).toHaveAccessibleDescription('Your account is on Starter limits up to $200 per trade. Try a smaller amount.');
    await expect(page.locator('body')).not.toContainText(/Building|Graduated/);
  });
});

test.describe('the payout address for this trade (owner demo note #6)', () => {
  const rule = (page: Page) => page.locator('[data-part="address-rule"]');

  test('a highly secure account adds a named address for this trade only, right on the quote, and the take pays to it', async ({ page }) => {
    const seen = await stubApi(page, { ...base, securityRating: 'high' });
    await page.goto(`${BUY}&amount=${B.amount}`);
    await expect(rule(page)).toContainText('If you buy with X2F, which wallet address should the XMR be sent to?');
    await expect(rule(page)).toContainText('Your account is rated highly secure');
    await expect(page.locator('[data-part="address-tip"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Add another wallet' })).toHaveCount(0);
    await page.getByRole('button', { name: 'Add a new address' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add a new address' });
    await sheet.getByLabel('Name', { exact: true }).fill('Rent money');
    await sheet.getByLabel('Monero address').fill('4BoardRentAddressd41MnQ');
    await expect(sheet.getByRole('radio', { name: /This trade only/ })).toBeChecked();
    await sheet.getByRole('button', { name: 'Save address' }).click();
    await expect(sheet).toHaveCount(0);
    expect(seen.walletPosts).toEqual([{ app: 'other', label: 'Rent money', address: '4BoardRentAddressd41MnQ', oneTime: true }]);
    await expect(page.getByRole('radio', { name: /Rent money/ })).toBeChecked();
    await expect(page.locator('.x2f-quote__wallet', { hasText: 'Rent money' })).toContainText('One trade only');
    await trade(page).click();
    await expect(page).toHaveURL(`/trade/${B.code}`);
    expect(seen.takes.map((t) => t.walletId)).toEqual(['w-inline']);
  });

  // Passwords and 24-hour holds are gone (owner, 26 Nov 2026): every account confirms with a key, so
  // an address added on the quote works at once. The sheet says so from the wallets rule, and an
  // address kept for future trades is picked for this one straight away.
  test('a new address kept for future trades works at once: the sheet says a key confirm makes it work now, and it is picked for this trade', async ({ page }) => {
    const seen = await stubApi(page, { ...base, securityRating: 'high' });
    await page.goto(`${BUY}&amount=${B.amount}`);
    await page.getByRole('button', { name: 'Add a new address' }).click();
    const sheet = page.getByRole('dialog', { name: 'Add a new address' });
    await expect(sheet).toContainText('Confirm with a PGP key and they work at once.');
    await expect(sheet).not.toContainText('24 hours');
    await sheet.getByLabel('Name', { exact: true }).fill('Savings');
    await sheet.getByLabel('Monero address').fill('4BoardSavingsAddressd41MnQ');
    await sheet.getByRole('radio', { name: /Future trades too/ }).check();
    await sheet.getByRole('button', { name: 'Save address' }).click();
    await expect(sheet).toHaveCount(0);
    expect(seen.walletPosts).toEqual([{ app: 'other', label: 'Savings', address: '4BoardSavingsAddressd41MnQ', oneTime: false }]);
    await expect(page.getByRole('radio', { name: /Savings/ })).toBeChecked();
    await expect(page.locator('.x2f-quote__wallet', { hasText: 'Savings' })).not.toContainText('One trade only');
    await expect(page.locator('[data-part="new-address-waits"]')).toHaveCount(0);
    await trade(page).click();
    await expect(page).toHaveURL(`/trade/${B.code}`);
    expect(seen.takes.map((t) => t.walletId)).toEqual(['w-inline']);
  });

  test('a medium account gets no inline add; the "?" opens why, by keyboard too, with the two ways forward (owner, 17 Nov)', async ({ page }) => {
    await stubApi(page, { ...base, securityRating: 'medium' });
    await page.goto(`${BUY}&amount=${B.amount}`);
    await expect(rule(page)).toContainText('rated medium');
    await expect(page.getByRole('button', { name: 'Add a new address', exact: true })).toHaveCount(0);
    const tip = page.getByRole('button', { name: 'Why is there no option to add a new address here?' });
    await tip.focus();
    await page.keyboard.press('Enter');
    await expect(tip).toHaveAttribute('aria-expanded', 'true');
    const panel = page.locator('[data-part="address-tip-panel"]');
    await expect(panel).toContainText('security rating');
    await expect(panel.getByRole('link', { name: /Your wallets/ })).toHaveAttribute('href', /^\/wallets\?add=1/);
    await expect(panel.getByRole('link', { name: /login method/ })).toHaveAttribute('href', '/settings/security');
    await page.keyboard.press('Escape');
    await expect(tip).toHaveAttribute('aria-expanded', 'false');
    await expect(tip).toBeFocused();
  });

  test('the default wallet is picked first, and another can be picked instead (owner, 17 Nov)', async ({ page }) => {
    const wallets = B.wallets.map((w) => ({ ...w, isDefault: w.id === 'w-ledger' }));
    const seen = await stubApi(page, { ...base, wallets, securityRating: 'weak' });
    await page.goto(`${BUY}&amount=${B.amount}`);
    await expect(page.getByRole('radio', { name: /Ledger/ })).toBeChecked();
    await expect(page.locator('.x2f-quote__wallet', { hasText: 'Ledger' })).toContainText('Default');
    await expect(trade(page)).toBeEnabled();
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    await trade(page).click();
    await expect(page).toHaveURL(`/trade/${B.code}`);
    expect(seen.takes.map((t) => t.walletId)).toEqual(['w-cake']);
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
    expect(seen.takes[0]).toMatchObject({ offerId: MIRA_BUYS.id, amountAtomic: '4545454000000', walletId: 'w-cake', methodId: B.method.id, currency: B.currency });
  });
});

// "This offer's bands" (BuyQuote board, canvas v142; owner 2026-11-08 #4, #11): the offer's bands
// carried over from the offers screen, the amount's band ringed, live, and the markup switch.
const bands = (page: Page) => page.locator('section[data-part="offer-bands"]');
const marked = (page: Page) => bands(page).locator('[data-part="band"][aria-current="true"]');
const clip = (page: Page) => bands(page).locator('[data-part="band-clip"]');

test.describe("the offer's bands on the quote", () => {
  test('from the offers screen to the quote: the same range, the band ringed live as the amount changes', async ({ page }) => {
    await stubApi(page, base);
    await page.goto(`/buy/${B.method.id}?currency=${B.currency}`);
    const offerCard = page.locator('article.x2f-offer').first();
    // Batch 2's card has a row per unit; the poster's own (fiat here) is the band's range.
    const range = (await offerCard.locator('[data-part="range-fiat"] .x2f-offer__figures').innerText()).trim();
    await offerCard.getByRole('button', { name: `Trade with ${B.offer.poster.tradeTag}` }).click();
    await expect(page).toHaveURL(new RegExp(`/buy/${B.method.id}/${B.offer.id}`));

    // Right under "What you get".
    await expect(bands(page)).toBeVisible();
    await expect(page.getByRole('heading', { name: "This offer's bands" })).toBeVisible();
    expect(await card(page).evaluate((el) => el.nextElementSibling?.getAttribute('data-part'))).toBe('offer-bands');
    await expect(bands(page).locator('[data-part="band-range"]')).toHaveText([range]);
    await expect(bands(page).locator('[data-part="band-rate"]')).toHaveText(['$330.00']);
    await expect(marked(page)).toHaveCount(0);
    // One band: the rate never changes with the amount, so no clip line.
    await expect(clip(page)).toHaveCount(0);

    const amount = page.locator('#quote-amount');
    await amount.fill('412.50');
    await expect(marked(page)).toHaveCount(1);
    await expect(marked(page)).toContainText('Your amount');
    await amount.fill('49.99');
    await expect(marked(page)).toHaveCount(0);
    await amount.fill('50');
    await expect(marked(page)).toHaveCount(1);
    await amount.fill('1500.01');
    await expect(marked(page)).toHaveCount(0);
    // Max fills the largest trade, which is inside the top band.
    await page.getByRole('button', { name: 'Max' }).click();
    await expect(amount).toHaveValue('1500.00');
    await expect(marked(page)).toHaveCount(1);
  });

  test('With markup / Without: the XMR at the band price or at the market rate, with the freshness line', async ({ page }) => {
    const MARKED_UP = { ...B.offer, pricing: { mode: 'market', marginBps: 250 }, rate: '33825' };
    await stubApi(page, { ...base, offers: [MARKED_UP] });
    await page.goto(`${BUY}&amount=${B.amount}`);
    const xmr = bands(page).locator('[data-part="band-xmr"]');
    const withMarkup = bands(page).getByRole('radio', { name: 'With markup' });
    await expect(withMarkup).toHaveAttribute('aria-checked', 'true');
    await expect(bands(page).locator('[data-part="band-markup"]')).toHaveText(['2.5% above market']);
    await expect(bands(page).locator('[data-part="band-rate"]')).toHaveText(['$338.25']);
    await expect(xmr).toHaveText(['≈ 0.147819 – 4.434589']);
    await expect(bands(page).locator('[data-part="band-updated"]')).toHaveCount(0);
    await bands(page).getByRole('radio', { name: 'Without' }).click();
    await expect(withMarkup).toHaveAttribute('aria-checked', 'false');
    await expect(bands(page).locator('[data-part="band-rate"]')).toHaveText(['$330.00']);
    await expect(xmr).toHaveText(['≈ 0.151515 – 4.545454']);
    await expect(bands(page).locator('[data-part="band-updated"]')).toContainText(/Market rate · updated \d\d:\d\d UTC/);
    await expect(bands(page).locator('[data-part="band-range"]')).toHaveText(['$50 – $1,500']);
  });
});

// Mobile ready at launch (spec, owner 2026-10-25): every screen is tested at phone sizes. The rule's
// two sizes (PHONE_VIEWPORTS: the boards' 390x844 and a small Android phone, 360x800) run the shared
// layout check and BuyQuote parity; a few more widths, from an iPhone SE (320) to a large phone (430),
// check that both quotes fit, keep every control on screen and big enough to tap, and that a take
// still goes through by tapping.
const EXTRA_PHONES = [
  { width: 320, height: 568 },
  { width: 412, height: 915 },
  { width: 430, height: 932 },
] as const;

const PHONES = [...PHONE_VIEWPORTS.map((v) => ({ width: Number(v.split('x')[0]), height: Number(v.split('x')[1]) })), ...EXTRA_PHONES];

/** Elements whose box pokes out past the viewport's left or right edge (sideways clipping). */
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

/** Controls a thumb must hit that are under 44 px tall (the screen's own minimum, above phone.ts's MIN_TAP). */
async function smallTargets(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('#root button, #root a, #root label.x2f-quote__wallet, #root input:not([type="radio"])')) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      if (r.height < 44 - 0.5) out.push(`${el.tagName.toLowerCase()} "${(el.textContent ?? '').trim() || el.getAttribute('aria-label')}" ${Math.round(r.height)} px`);
    }
    return out;
  });
}

async function expectFitsPhone(page: Page): Promise<void> {
  await expectPhoneLayout(page);
  expect(await overflowing(page)).toEqual([]);
  expect(await smallTargets(page)).toEqual([]);
  // The one primary can be scrolled to and then sits wholly on screen.
  await trade(page).scrollIntoViewIfNeeded();
  await expect(trade(page)).toBeInViewport({ ratio: 1 });
}

// The rule's sizes: BuyQuote parity (the board is 390x844; at 360x800 the pixel report says the sizes
// differ, which is expected) and the shared phone layout check, for both quote states.
for (const viewport of PHONE_VIEWPORTS) {
  test.describe(`quotes on a ${viewport} phone`, () => {
    test.beforeEach(async ({ page }) => {
      await setPhone(page, viewport);
    });

    test('BuyQuote: parity and phone layout', async ({ page }) => {
      await stubApi(page, base);
      await page.goto(`${BUY}&amount=${B.amount}`);
      await page.getByRole('radio', { name: /Cake Wallet/ }).check();
      await expect(card(page)).toContainText('1.250000 XMR');
      await expectPhoneLayout(page);
      await expectParity(page, 'BuyQuote', { viewport });
    });

    test('BuyQuote with no wallet (Add a wallet) and "Price unavailable right now": phone layout', async ({ page }) => {
      await stubApi(page, { ...base, price: 'down', wallets: [] });
      await page.goto(`${BUY}&amount=${B.amount}`);
      await expect(page.locator('#quote-amount-help')).toHaveText('Price unavailable right now');
      await expect(trade(page)).toHaveText('Add a wallet');
      await expectPhoneLayout(page);
    });

    test('SellQuote after Max with a wallet picked: phone layout', async ({ page }) => {
      await stubApi(page, { ...base, offers: [MIRA_BUYS] });
      await page.goto(SELL);
      await page.getByRole('button', { name: 'Max' }).click();
      await page.getByRole('radio', { name: /Cake Wallet/ }).check();
      await expect(card(page)).toContainText('4.545454 XMR');
      await expectPhoneLayout(page);
    });

    // Design review 8 Nov item 4: the figure overflowed the card at 12 places, and the wallet group
    // was missing for a trader with no wallet yet. (It was written as a logged-out quote; since the
    // front door, owner 8 Nov, a logged-out visitor never sees a quote: the test at line 208 above.)
    test('BuyQuote with no wallet yet at $50: 6 places, the wallet group, phone layout', async ({ page }) => {
      await stubApi(page, { ...base, wallets: [] });
      await page.goto(`${BUY}&amount=50`);
      await expect(card(page)).toContainText('0.151515 XMR');
      await expect(page.getByRole('group', { name: 'Which wallet gets paid?' })).toBeVisible();
      await expectPhoneLayout(page);
    });

    test('SellQuote with a 12-place exact amount: shown in full and it fits', async ({ page }) => {
      await stubApi(page, { ...base, offers: [MIRA_BUYS] });
      await page.goto(SELL);
      await page.getByRole('radio', { name: /Cake Wallet/ }).check();
      await page.locator('#quote-amount').fill('1.151515151515');
      await expect(card(page)).toContainText('1.151515151515 XMR');
      await expectPhoneLayout(page);
    });
  });
}

test.describe('phone sizes: fit and a take by tapping', () => {
  // A real phone: touch input and the mobile viewport meta tag are honoured.
  test.use({ hasTouch: true, isMobile: true });

  for (const vp of PHONES) {
    test(`BuyQuote at ${vp.width}x${vp.height}: fits, every control tappable, Trade takes`, async ({ page }) => {
      await page.setViewportSize(vp);
      const seen = await stubApi(page, base);
      await page.goto(`${BUY}&amount=${B.amount}`);
      // The amount is on screen when the quote opens, on every phone.
      await expect(page.locator('#quote-amount')).toBeInViewport();
      await page.getByRole('radio', { name: /Cake Wallet/ }).tap();
      await expect(page.getByRole('radio', { name: /Cake Wallet/ })).toBeChecked();
      await expect(card(page)).toContainText('1.250000 XMR');
      await expect(card(page)).toContainText('$412.50 USD');
      // The bands card fits the phone too (expectFitsPhone checks every element), its band marked.
      await expect(marked(page)).toHaveCount(1);
      // After the pick the amount can be scrolled back to and then sits wholly on screen. (On a
      // 320x568 phone the payout question and its rule above the wallets, owner note #6, put the
      // amount and the wallets more than one screen apart, so tapping a wallet scrolls the amount off.)
      await page.locator('#quote-amount').scrollIntoViewIfNeeded();
      await expect(page.locator('#quote-amount')).toBeInViewport({ ratio: 1 });
      await expectFitsPhone(page);
      await trade(page).tap();
      await expect(page).toHaveURL(`/trade/${B.code}`);
      expect(seen.takes).toEqual([
        { offerId: B.offer.id, amountAtomic: '1250000000000', walletId: 'w-cake', centsPerXmr: B.marketCentsPerXmr, fiatCents: '41250', methodId: B.method.id, currency: B.currency, lienRecoveryAtomic: '0' },
      ]);
    });

    test(`BuyQuote at ${vp.width}x${vp.height} with no wallet and "Price unavailable right now" still fits`, async ({ page }) => {
      await page.setViewportSize(vp);
      await stubApi(page, { ...base, price: 'down', wallets: [] });
      await page.goto(`${BUY}&amount=${B.amount}`);
      await expect(page.locator('#quote-amount-help')).toHaveText('Price unavailable right now');
      await expectFitsPhone(page);
    });

    test(`SellQuote at ${vp.width}x${vp.height}: fits, Max and the wallet are tappable, Trade takes`, async ({ page }) => {
      await page.setViewportSize(vp);
      const seen = await stubApi(page, { ...base, offers: [MIRA_BUYS] });
      await page.goto(SELL);
      await page.getByRole('button', { name: 'Max' }).tap();
      await page.getByRole('radio', { name: /Cake Wallet/ }).tap();
      await expect(card(page)).toContainText('4.545454 XMR');
      await expectFitsPhone(page);
      await trade(page).tap();
      await expect(page).toHaveURL(`/trade/${B.code}`);
      expect(seen.takes[0]).toMatchObject({ offerId: MIRA_BUYS.id, amountAtomic: '4545454000000', walletId: 'w-cake' });
    });
  }
});
