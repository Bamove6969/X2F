// Buy browse (Task 17): /buy (BuyMain board) and /buy/:methodId (BuyOffers board), the Task 16
// components with side="buy". The API is stubbed with the boards' example data
// (src/fixtures/boards.ts) in the Task 3/4 shapes that src/screens/browse/api.ts reads (see
// test/browse-tripwire.test.ts). A buyer browses sell ads, so every list call says side=sell.
import { expect, test, type Page } from '@playwright/test';
import { BOARD_BUY_LIVE_USD, BOARD_BUY_OFFERS, boardBuyOffers } from '../src/fixtures/boards.js';
import { CATALOG, stubBrowseApi } from './browse-stub.js';
import { expectParity } from './parity.js';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';

/** The API as the BuyMain and BuyOffers boards show it; `offers` replaces the board's cards. */
function stub(page: Page, o: { signedIn?: boolean; offers?: () => unknown[] } = {}) {
  return stubBrowseApi(page, {
    ...(o.signedIn === undefined ? {} : { signedIn: o.signedIn }),
    live: { USD: BOARD_BUY_LIVE_USD },
    offers: o.offers ?? ((currency) => (currency === 'USD' ? boardBuyOffers() : [])),
    market: { USD: BOARD_BUY_OFFERS.marketCentsPerXmr },
  });
}

test.describe('/buy (BuyMain board)', () => {
  test('matches the BuyMain board: live sellers first, then every method A–Z', async ({ page }) => {
    const seen = await stub(page);
    await page.goto('/buy');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('How do you want to pay?');
    await expect(page.getByRole('tab', { name: 'Buy' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('main h2')).toHaveText(['Sellers taking USD', 'All payment methods']);
    const live = page.locator('section', { has: page.getByRole('heading', { name: 'Sellers taking USD' }) }).locator('a');
    await expect(live.first()).toContainText('Zelle');
    await expect(live.first()).toContainText('29 sellers taking USD · from $330.00');
    await expect(live.first()).toHaveAttribute('href', '/buy/ZELLE?currency=USD');
    const names = await page.locator('section', { has: page.getByRole('heading', { name: 'All payment methods' }) }).locator('a [data-part="name"]').allTextContents();
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
    await expect(page.getByRole('searchbox', { name: 'Search payment methods' })).toHaveAttribute('placeholder', `Search ${CATALOG.length} payment methods`);
    await expect(page.getByRole('radio', { name: 'Most sellers' })).toHaveAttribute('aria-checked', 'true');
    for (const r of seen.requests.filter((r) => new URL(r.url()).pathname === '/v1/methods')) expect(new URL(r.url()).searchParams.get('side')).toBe('sell');
    await expectParity(page, 'BuyMain');
  });

  test('Best rate on BuyMain asks the API for the lowest-first order', async ({ page }) => {
    const seen = await stub(page);
    await page.goto('/buy');
    await page.getByRole('radio', { name: 'Best rate' }).click();
    await expect.poll(() => seen.requests.some((r) => /\/v1\/methods\?.*side=sell.*sort=rate/.test(r.url()))).toBe(true);
    await expect(page.locator('section').first().locator('a').first()).toContainText('Zelle');
  });

  test('a search hit list under Best rate puts the lowest rate first', async ({ page }) => {
    await stub(page);
    await page.goto('/buy');
    await page.getByRole('radio', { name: 'Best rate' }).click();
    await page.getByRole('searchbox', { name: 'Search payment methods' }).fill('wire');
    await expect(page.locator('main h2')).toHaveText(['2 matches']);
    await expect(page.locator('main a [data-part="name"]')).toHaveText(['International wire (SWIFT)', 'Domestic wire transfer (US)']);
  });

  test('the Sell tab goes to /sell in the same currency', async ({ page }) => {
    await stub(page);
    await page.goto('/buy?currency=EUR');
    await page.getByRole('tab', { name: 'Sell' }).click();
    await expect(page).toHaveURL(/\/sell\?currency=EUR$/);
    await page.getByRole('tab', { name: 'Buy' }).click();
    await expect(page).toHaveURL(/\/buy\?currency=EUR$/);
  });
});

test.describe('/buy/:methodId (BuyOffers board)', () => {
  test('matches the BuyOffers board', async ({ page }) => {
    const seen = await stub(page);
    await page.goto('/buy/ZELLE');
    await expect(page.locator('article')).toHaveCount(3);
    await expect(page.getByText('Buy XMR via Zelle')).toBeVisible();
    await expect(page.getByText('29 sellers · USD')).toBeVisible();
    await expect(page.locator('[data-primary]')).toHaveAttribute('aria-label', 'Trade with satoshi_ghost');
    await expect(page.getByRole('button', { name: 'Trade with lowtide_rx' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nudge kettle.moss' })).toBeVisible();
    await expect(page.getByText('Releases in ~8 min')).toBeVisible();
    await expect(page.getByText('You pay no X2F fee when you take an offer.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Back to payment methods' })).toHaveAttribute('href', '/buy?currency=USD');
    const calls = seen.requests.filter((r) => new URL(r.url()).pathname === '/v1/offers');
    expect(calls.length).toBeGreaterThan(0);
    for (const r of calls) expect(new URL(r.url()).searchParams.get('side')).toBe('sell');
    await expectParity(page, 'BuyOffers');
  });

  test('offers sort by Best price ascending, whatever order they arrive in', async ({ page }) => {
    const [satoshi, kettle, lowtide] = boardBuyOffers();
    const seen = await stub(page, { offers: () => [lowtide, satoshi, kettle] });
    await page.goto('/buy/ZELLE');
    await expect(page.getByRole('radio', { name: 'Best price' })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('article [data-part="rate"]')).toHaveText(['$330.00', '$331.50', '$333.00']);
    expect(seen.requests.some((r) => /\/v1\/offers\?.*sort=best/.test(r.url()))).toBe(true);
    // The one orange Trade is on the first offer that can be taken.
    await expect(page.locator('[data-primary]')).toHaveAttribute('aria-label', 'Trade with satoshi_ghost');
  });

  test('Online now and Most trades ask the API for their order', async ({ page }) => {
    const seen = await stub(page);
    await page.goto('/buy/ZELLE');
    await page.getByRole('radio', { name: 'Most trades' }).click();
    await expect(page.getByRole('radio', { name: 'Most trades' })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => seen.requests.some((r) => /\/v1\/offers\?.*sort=trades/.test(r.url()))).toBe(true);
    await page.getByRole('radio', { name: 'Online now' }).click();
    await expect.poll(() => seen.requests.some((r) => /\/v1\/offers\?.*sort=online/.test(r.url()))).toBe(true);
  });

  test('a fixed-price offer shows its difference from the market price', async ({ page }) => {
    await stub(page);
    await page.goto('/buy/ZELLE');
    const satoshi = page.locator('article', { has: page.locator('[data-username]', { hasText: 'satoshi_ghost' }) });
    await expect(satoshi).toContainText('$0.10 above market');
  });

  test('starter limits on the buy side: greyed "Opens at …" cards, New from the API stage', async ({ page }) => {
    const [satoshi, kettle, lowtide] = boardBuyOffers();
    await stub(page, {
      signedIn: true,
      offers: () => [
        { ...satoshi!, opensAt: 'building' },
        { ...kettle!, poster: { ...kettle!.poster, online: true }, opensAt: 'graduated' },
        lowtide,
      ],
    });
    await page.goto('/buy/ZELLE');
    const building = page.locator('article[data-opens-at="building"]');
    await expect(building).toContainText('Opens at Building');
    await expect(building).toHaveAttribute('aria-disabled', 'true');
    await expect(building.getByRole('button', { name: /Trade/ })).toHaveCount(0);
    const graduated = page.locator('article[data-opens-at="graduated"]');
    await expect(graduated).toContainText('Opens at Graduated');
    await expect(graduated.getByRole('button', { name: /Trade/ })).toHaveCount(0);
    // The only takeable offer carries the one orange Trade.
    await expect(page.locator('[data-primary]')).toHaveAttribute('aria-label', 'Trade with lowtide_rx');
    // lowtide_rx is 'building' per the API: New, in the caution tone.
    const lowtideCard = page.locator('article', { has: page.locator('[data-username]', { hasText: 'lowtide_rx' }) });
    await expect(lowtideCard.locator('.x2f-badge', { hasText: 'New' })).toHaveAttribute('data-tone', 'caution');
    // satoshi_ghost is 'graduated': no New, whatever else is greyed.
    await expect(building.locator('.x2f-badge', { hasText: 'New' })).toHaveCount(0);
  });

  test('logged out, the buy lists render and no browse request fails', async ({ page }) => {
    const seen = await stub(page, { signedIn: false });
    const failed: string[] = [];
    page.on('response', (r) => {
      const path = new URL(r.url()).pathname;
      if (path.startsWith('/v1/') && path !== '/v1/account/me' && r.status() >= 400) failed.push(`${r.status()} ${path}`);
    });
    await page.goto('/buy');
    await expect(page.locator('main a').first()).toBeVisible();
    await page.goto('/buy/ZELLE');
    await expect(page.locator('article')).toHaveCount(3);
    expect(failed).toEqual([]);
    const paths = new Set(seen.requests.map((r) => new URL(r.url()).pathname));
    for (const p of ['/v1/methods', '/v1/offers', '/v1/price']) expect(paths.has(p), p).toBe(true);
  });
});

// Phone sizes (spec "Mobile ready at launch"): both boards at 390x844 and 360x800.
for (const viewport of PHONE_VIEWPORTS) {
  test.describe(`buy browse on a ${viewport} phone`, () => {
    test.beforeEach(async ({ page }) => {
      await setPhone(page, viewport);
    });

    test('BuyMain: parity and phone layout', async ({ page }) => {
      await stub(page);
      await page.goto('/buy');
      await expect(page.locator('main a').first()).toContainText('Zelle');
      await expectPhoneLayout(page);
      await expectParity(page, 'BuyMain', { viewport });
    });

    test('BuyOffers: parity and phone layout', async ({ page }) => {
      await stub(page);
      await page.goto('/buy/ZELLE');
      await expect(page.locator('article')).toHaveCount(3);
      await expectPhoneLayout(page);
      await expectParity(page, 'BuyOffers', { viewport });
    });

    test('BuyOffers with greyed starter-limit offers and the badge popover open: phone layout', async ({ page }) => {
      const [satoshi, kettle, lowtide] = boardBuyOffers();
      await stub(page, { signedIn: true, offers: () => [satoshi, { ...kettle!, opensAt: 'building' }, { ...lowtide!, opensAt: 'graduated' }] });
      await page.goto('/buy/ZELLE');
      await expect(page.locator('article[data-opens-at="graduated"]')).toContainText('Opens at Graduated');
      await page.getByRole('button', { name: 'Show all 4 badges' }).click();
      await expect(page.getByRole('tooltip')).toBeVisible();
      await expectPhoneLayout(page);
    });
  });
}
