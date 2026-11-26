// Plan 4 Task 29: while the emergency stop is on (Task 8, GET /v1/site `tradingPaused`), every offer
// list (Main, BuyMain, SellOffers, BuyOffers) is hidden behind the maintenance message, with links to
// News and the owner's community links; the quote's Trade and Post offer's button are off. The API
// side (nothing listed, takes and posts refused 409 trading-paused, the community links in
// GET /v1/site) is apps/api/test/site.test.ts. GET /v1/site is stubbed here; the browse API with the
// boards' data (browse-stub.ts), as the browse specs do.
import { expect, test, type Page } from '@playwright/test';
import { BOARD_SELL_LIVE_USD, BOARD_SELL_OFFERS, boardSellOffers } from '../src/fixtures/boards.js';
import { BOARD_BUY_QUOTE as Q } from '../src/fixtures/quoteBoard.js';
import { stubBrowseApi } from './browse-stub.js';
import { expectParity } from './parity.js';
import { INSIDE } from './session.js';

const OFF = { banner: null, tradingPaused: false, maintenance: null, plannedMaintenance: null, communityLinks: { matrix: null, telegram: null } };
const MATRIX = 'https://matrix.to/#/#x2f:matrix.org';
const TELEGRAM = 'https://t.me/x2f_news';
const STOP_TEXT =
  "Unscheduled but necessary maintenance. We'll be back as soon as possible. Check the News section, or join our Matrix or Telegram, where the channel topic has the latest information and you can ask questions.";

/** GET /v1/site as the API answers a signed-in trader; `state.paused` can be flipped mid-test. */
async function site(page: Page, state: { paused: boolean; links?: { matrix: string | null; telegram: string | null } }): Promise<void> {
  await page.route('**/v1/site', (r) =>
    r.fulfill({ json: { ...OFF, tradingPaused: state.paused, communityLinks: state.links ?? { matrix: MATRIX, telegram: TELEGRAM } }, headers: { 'cache-control': 'no-store' } }),
  );
}

function browse(page: Page) {
  return stubBrowseApi(page, {
    live: { USD: BOARD_SELL_LIVE_USD },
    // The API lists nothing during a stop; the stub sends the cards anyway, so hiding them is the app's.
    offers: (currency) => (currency === 'USD' ? boardSellOffers() : []),
    market: { USD: BOARD_SELL_OFFERS.marketCentsPerXmr },
  });
}

const stopped = (page: Page) => page.locator('[data-part="trading-stopped"]');

/** The BuyQuote board's offer, price and wallets, as quote.spec.ts stubs them (src/fixtures/quoteBoard.ts). */
async function quoteApi(page: Page): Promise<void> {
  await page.addInitScript(() => window.localStorage.setItem('x2f.courtesy-sheet.off', '1'));
  await page.route('**/v1/account/me', (r) => r.fulfill({ json: { tradeTag: 'viewer_1', ...INSIDE, methods: ['pgp'] } }));
  await page.route('**/v1/methods?*', (r) =>
    r.fulfill({ json: { live: [{ id: Q.method.id, name: Q.method.name, group: 'Payment apps', giftCard: false, offers: 1, bestRate: Q.marketCentsPerXmr }], all: [] } }),
  );
  await page.route('**/v1/price?*', (r) => {
    const currency = new URL(r.request().url()).searchParams.get('currency');
    return r.fulfill({ json: { currency, centsPerXmr: Q.marketCentsPerXmr, exponent: 2, at: new Date().toISOString(), usdCentsPerXmr: Q.marketCentsPerXmr } });
  });
  await page.route('**/v1/offers?*', (r) => r.fulfill({ json: [Q.offer] }));
  await page.route('**/v1/wallets', (r) => r.fulfill({ json: Q.wallets }));
  await page.route('**/v1/wallets/rule', (r) => r.fulfill({ json: { firstWallet: false, strongMethods: [], password: 'immediate', waitHours: 24 } }));
  await page.route('**/v1/account/liens/preview?*', (r) => r.fulfill({ json: { lienRecoveryAtomic: '0' } }));
  await page.route('**/v1/news', (r) => r.fulfill({ json: { items: [], serverNow: new Date().toISOString() } }));
}

test.describe('the emergency stop on the offer lists', () => {
  for (const path of ['/sell', '/buy']) {
    test(`${path}: the message with News, Matrix and Telegram, and no list`, async ({ page }) => {
      await site(page, { paused: true });
      await browse(page);
      await page.goto(path);
      await expect(stopped(page)).toHaveText(STOP_TEXT);
      await expect(stopped(page).getByRole('link', { name: 'News section' })).toHaveAttribute('href', '/news');
      for (const [name, href] of [['Matrix', MATRIX], ['Telegram', TELEGRAM]] as const) {
        const link = stopped(page).getByRole('link', { name });
        await expect(link).toHaveAttribute('href', href);
        await expect(link).toHaveAttribute('target', '_blank');
        await expect(link).toHaveAttribute('rel', 'noreferrer noopener');
      }
      await expect(page.locator('main h2')).toHaveCount(0);
      await expect(page.locator('main a.x2f-method')).toHaveCount(0);
      // No horizontal scroll at phone width.
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(page.viewportSize()!.width);
    });
  }

  test('/sell/:methodId: no offer cards and no Trade, the message instead of "no offers"', async ({ page }) => {
    await site(page, { paused: true });
    await browse(page);
    await page.goto('/sell/ZELLE');
    await expect(stopped(page)).toBeVisible();
    await expect(page.locator('article')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Trade with/ })).toHaveCount(0);
    await expect(page.locator('[data-primary]')).toHaveCount(0);
  });

  test('a link left unset is left out of the sentence', async ({ page }) => {
    await site(page, { paused: true, links: { matrix: null, telegram: TELEGRAM } });
    await browse(page);
    await page.goto('/sell');
    await expect(stopped(page)).toHaveText(
      "Unscheduled but necessary maintenance. We'll be back as soon as possible. Check the News section, or join our Telegram, where the channel topic has the latest information and you can ask questions.",
    );
    await expect(stopped(page).getByRole('link', { name: 'Matrix' })).toHaveCount(0);
  });

  test('neither link set: News only', async ({ page }) => {
    await site(page, { paused: true, links: { matrix: null, telegram: null } });
    await browse(page);
    await page.goto('/sell');
    await expect(stopped(page)).toHaveText("Unscheduled but necessary maintenance. We'll be back as soon as possible. Check the News section.");
  });

  test('the News link opens News', async ({ page }) => {
    await site(page, { paused: true });
    await browse(page);
    await page.goto('/sell');
    await stopped(page).getByRole('link', { name: 'News section' }).click();
    await expect(page).toHaveURL(/\/news$/);
  });

  test('the quote: Trade works with the stop off, and is off with the message while it is on', async ({ page }) => {
    const state = { paused: false };
    await site(page, state);
    await quoteApi(page);
    const path = `/buy/${Q.method.id}/${Q.offer.id}?currency=${Q.currency}&amount=${Q.amount}`;
    await page.goto(path);
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    const trade = page.getByRole('button', { name: 'Trade', exact: true });
    await expect(trade).toBeEnabled();
    await expect(stopped(page)).toHaveCount(0);
    state.paused = true;
    await page.reload();
    await page.getByRole('radio', { name: /Cake Wallet/ }).check();
    await expect(stopped(page)).toBeVisible();
    await expect(trade).toBeDisabled();
  });

  test('Post offer: the message, and the Post offer button is off', async ({ page }) => {
    await site(page, { paused: true });
    await browse(page);
    await page.goto('/post');
    await expect(stopped(page)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Post offer', exact: true })).toBeDisabled();
  });

  test('with the stop off, the lists return (and match the boards)', async ({ page }) => {
    const state = { paused: true };
    await site(page, state);
    await browse(page);
    await page.goto('/sell');
    await expect(stopped(page)).toBeVisible();
    state.paused = false;
    // The shell reads the site again on resume (C-021) and on its poll; a reload is the same read.
    await page.reload();
    await expect(stopped(page)).toHaveCount(0);
    await expect(page.locator('main h2')).toHaveText(['Buyers paying in USD', 'All payment methods']);
    await expectParity(page, 'Main', { primary: false });
    await page.goto('/sell/ZELLE');
    await expect(page.locator('article')).toHaveCount(3);
    await expect(stopped(page)).toHaveCount(0);
    await expectParity(page, 'SellOffers');
  });
});
