// Quotes and the Trade button (Task 18): BuyQuote (board BuyQuote.dc.html) and the seller quote. The
// API is stubbed with the board's example (src/fixtures/quoteBoard.ts) in the Task 3/4/5 shapes that
// src/screens/quote/api.ts reads (all on the line now).
import { expect, test, type Page } from '@playwright/test';
import { fiatCents } from '@x2f/trade';
import { BOARD_BUY_QUOTE as B } from '../src/fixtures/quoteBoard.js';
import { expectParity } from './parity.js';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';

/** The take body as Task 5 reads it (Revision 2026-10-27): the amount, the wallet and the quoted rate and total. */
interface TakeBody {
  amountAtomic: string;
  walletId: string;
  centsPerXmr: string;
  fiatCents: string;
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
}

interface Seen {
  takes: ({ offerId: string } & TakeBody)[];
  /** The fiat total each stubbed trade stores: fiatCents(amountAtomic, lockedRate) (OD-5). */
  storedFiatCents: bigint[];
  /** Each POST /v1/wallets body from Task 29's Add a wallet. */
  walletPosts: unknown[];
}

const FIXED = { ...B.offer, id: 'offer-fixed', pricing: { mode: 'fixed', centsPerXmr: '34000' }, rate: '34000' };
const MIRA_BUYS = { ...B.offer, id: 'offer-mira', poster: { ...B.offer.poster, displayName: 'mira.k' } };

async function stubApi(page: Page, s: Stub): Promise<Seen> {
  const seen: Seen = { takes: [], storedFiatCents: [], walletPosts: [] };
  await page.route('**/v1/account/me', (r) =>
    s.signedIn ? r.fulfill({ json: { displayName: 'viewer_1', kind: 'trader', methods: ['pgp'] } }) : r.fulfill({ status: 401, json: { error: 'not-authenticated' } }),
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
    const body = r.request().postDataJSON() as { wallets: { app: string; label: string; address: string }[] };
    seen.walletPosts.push(body);
    const added = body.wallets.map((w, i) => ({ ...w, id: `w-new-${i}`, addressEnd: w.address.slice(-6), usableFrom: '2026-10-01T00:00:00.000Z', usable: true }));
    s.wallets = [...s.wallets, ...added];
    return r.fulfill({ status: 201, json: added });
  });
  await page.route('**/v1/wallets/rule', (r) =>
    r.fulfill({ json: { firstWallet: s.wallets.length === 0, strongMethods: [], password: 'immediate', waitHours: 24 } }),
  );
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
    return r.fulfill({ json: { code: B.code, centsPerXmr: body.centsPerXmr, fiatCents: body.fiatCents } });
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
    await expect(page.getByRole('status')).toHaveText("You're back. Check the total, then tap Trade.");
    expect(seen.walletPosts).toEqual([{ wallets: [{ app: 'cake', label: 'Cake Wallet', address: B.wallets[0].address }] }]);
    await expect(page.getByRole('radio', { name: /Cake Wallet/ })).toBeChecked();
    await expect(page).not.toHaveURL(/resume=/);
    expect(seen.takes).toHaveLength(0);
    await trade(page).click();
    await expect(page).toHaveURL(`/trade/${B.code}`);
    expect(seen.takes).toEqual([{ offerId: B.offer.id, amountAtomic: '1250000000000', walletId: 'w-new-0', centsPerXmr: B.marketCentsPerXmr, fiatCents: '41250' }]);
  });

  test("logged out, Trade goes to setup; Welcome's Start trading comes back in the same tab and the quote is shown again at the price now, never taken silently", async ({ page }) => {
    const stub: Stub = { ...base, signedIn: false, wallets: [] };
    const seen = await stubApi(page, stub);
    await page.goto(`${BUY}&amount=${B.amount}`);
    await expect(card(page)).toContainText('1.250000 XMR');
    await trade(page).click();
    // Setup starts on the Terms (Task 28), with this quote and a pending-take nonce as returnTo.
    await expect(page).toHaveURL(/\/setup\?returnTo=/);
    await expect(page.locator('[data-screen="setup-terms"]')).toBeVisible();
    const returnTo = new URL(page.url()).searchParams.get('returnTo')!;
    expect(new URL(returnTo, 'http://x').searchParams.get('resume')).toMatch(/^[0-9a-f]{32}$/);
    expect(seen.takes).toHaveLength(0);
    // The steps in between are setup.spec's: here an account now exists with its first wallet, and
    // the person is on Welcome in this same tab (the marker lives in this tab's sessionStorage).
    // Setup took a while and the feed moved: the quote the person comes back to shows the rate now.
    stub.signedIn = true;
    stub.wallets = [B.wallets[0]];
    stub.rate = '34000';
    await page.goto(`/setup/welcome?returnTo=${encodeURIComponent(returnTo)}`);
    await page.click('[data-part="start-trading"]');
    await expect(page).toHaveURL(/\/buy\//);
    await expect(page.getByRole('status')).toHaveText("You're back. Check the total, then tap Trade.");
    await expect(card(page)).toContainText('$340.00 / XMR');
    await expect(card(page)).toContainText('$412.50 USD');
    expect(seen.takes).toHaveLength(0);
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
    // $412.50 at $340.00 is 1.213235294117 XMR, shown in full: the figure is what is sent (M5).
    await expect(card(page)).toContainText('1.213235294117 XMR');
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

// The offer's bands carried over from the offers screen (owner 2026-11-08: "a reminder of what the
// buyers bands (Ranges) are ... where it clips").
const bands = (page: Page) => page.locator('section[aria-label="Price bands"]');
const marked = (page: Page) => bands(page).locator('[data-part="band"][aria-current="true"]');
const clip = (page: Page) => bands(page).locator('[data-part="band-clip"]');

test.describe("the offer's bands on the quote", () => {
  test('from the offers screen to the quote: the same range and price, the band marked, and where it clips as the amount changes', async ({ page }) => {
    await stubApi(page, base);
    await page.goto(`/buy/${B.method.id}?currency=${B.currency}`);
    const offerCard = page.locator('article.x2f-offer').first();
    const range = (await offerCard.locator('.x2f-offer__range').innerText()).trim();
    const price = (await offerCard.locator('.x2f-offer__margin').innerText()).trim();
    await offerCard.getByRole('button', { name: `Trade with ${B.offer.poster.displayName}` }).click();
    await expect(page).toHaveURL(new RegExp(`/buy/${B.method.id}/${B.offer.id}`));

    // A small card right under "What you get".
    await expect(bands(page)).toBeVisible();
    expect(await card(page).evaluate((el) => el.nextElementSibling?.getAttribute('aria-label'))).toBe('Price bands');
    await expect(bands(page).locator('[data-part="band-range"]')).toHaveText([range]);
    await expect(bands(page).locator('[data-part="band-price"]')).toHaveText([price]);
    await expect(marked(page)).toHaveCount(0);
    await expect(clip(page)).toHaveText('$50 – $1,500 per trade.');

    const amount = page.locator('#quote-amount');
    await amount.fill('412.50');
    await expect(marked(page)).toHaveCount(1);
    await expect(marked(page)).toContainText('Your amount');
    await expect(clip(page)).toHaveText('Up to $1,500 at this price, the largest trade.');
    await amount.fill('49.99');
    await expect(marked(page)).toHaveCount(0);
    await expect(clip(page)).toHaveText('Your amount is below $50, the smallest trade.');
    await amount.fill('50');
    await expect(marked(page)).toHaveCount(1);
    await amount.fill('1500');
    await expect(marked(page)).toHaveCount(1);
    await amount.fill('1500.01');
    await expect(marked(page)).toHaveCount(0);
    await expect(clip(page)).toHaveText('Your amount is above $1,500, the largest trade.');
  });

  test('SellQuote: Max sits in the top band, at its clip', async ({ page }) => {
    await stubApi(page, { ...base, offers: [MIRA_BUYS] });
    await page.goto(SELL);
    await page.getByRole('button', { name: 'Max' }).click();
    await expect(marked(page)).toHaveCount(1);
    await expect(clip(page)).toHaveText('Up to $1,500 at this price, the largest trade.');
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
      await page.getByRole('radio', { name: /Cake Wallet/ }).check();
      await expect(card(page)).toContainText('1.250000 XMR');
      await expect(card(page)).toContainText('$412.50 USD');
      // The bands card fits the phone too (expectFitsPhone checks every element), its band marked.
      await expect(marked(page)).toHaveCount(1);
      await expect(page.locator('#quote-amount')).toBeInViewport();
      await expectFitsPhone(page);
      await trade(page).tap();
      await expect(page).toHaveURL(`/trade/${B.code}`);
      expect(seen.takes).toEqual([{ offerId: B.offer.id, amountAtomic: '1250000000000', walletId: 'w-cake', centsPerXmr: B.marketCentsPerXmr, fiatCents: '41250' }]);
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
