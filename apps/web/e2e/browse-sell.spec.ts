// Sell browse (Task 16): /sell (Main board) and /sell/:methodId (SellOffers board). The API is
// stubbed with the boards' example data (src/fixtures/boards.ts) in the Task 3/4 shapes that
// src/screens/browse/api.ts reads (see test/browse-tripwire.test.ts).
import { expect, test, type Page } from '@playwright/test';
import { BOARD_SELL_LIVE_USD, BOARD_SELL_OFFERS, boardSellOffers } from '../src/fixtures/boards.js';
import { CATALOG, stubBrowseApi, type Row } from './browse-stub.js';
import { expectParity } from './parity.js';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';

const EUR_LIVE: Row[] = [{ id: 'SEPA', name: 'SEPA', group: 'Bank transfers', giftCard: false, offers: 3, bestRate: '30500' }];

/** An EUR buyer on Zelle, so the EUR list differs from the USD one. */
const EUR_OFFER = {
  ...boardSellOffers()[0]!,
  id: 'offer-eur',
  poster: { ...boardSellOffers()[0]!.poster, displayName: 'euro_buyer' },
  rate: '30500',
};

/** The API as the Main and SellOffers boards show it (plus an EUR market); `offers` replaces the cards. */
function stubApi(page: Page, o: { signedIn?: boolean; offers?: (currency: string) => unknown[] } = {}) {
  return stubBrowseApi(page, {
    ...(o.signedIn === undefined ? {} : { signedIn: o.signedIn }),
    live: { USD: BOARD_SELL_LIVE_USD, EUR: EUR_LIVE },
    offers: o.offers ?? ((currency) => (currency === 'USD' ? boardSellOffers() : currency === 'EUR' ? [EUR_OFFER] : [])),
    market: { USD: BOARD_SELL_OFFERS.marketCentsPerXmr, EUR: '30400' },
  });
}

test.describe('/sell (Main board)', () => {
  test('matches the Main board: live buyers first (one card with a method picker), then every method A–Z', async ({ page }) => {
    await stubApi(page);
    await page.goto('/sell');
    const headings = page.locator('main h2');
    await expect(headings).toHaveText(['Buyers paying in USD', 'All payment methods']);
    const live = page.locator('section', { has: page.getByRole('heading', { name: 'Buyers paying in USD' }) });
    await expect(live.getByRole('button', { name: 'Payment method: Zelle' })).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(live.locator('a')).toHaveCount(1);
    await expect(live.getByRole('link', { name: 'Zelle 34 buyers paying in USD · up to $331.20' })).toHaveAttribute('href', '/sell/ZELLE?currency=USD');
    // The methods with no buyers are folded into one row until opened (design review 8 Nov, item 7).
    const all = page.locator('section', { has: page.getByRole('heading', { name: 'All payment methods' }) });
    const rest = all.locator('a [data-part="name"]');
    await expect(rest).toHaveCount(0);
    const toggle = all.getByRole('button', { name: /more payment methods/ });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toContainText('No USD buyers right now · post an offer');
    expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(rest.first()).toBeVisible();
    const names = await rest.allTextContents();
    expect(names.length).toBeGreaterThan(50);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'en')));
    expect(names).not.toContain('Zelle');
    await expect(page.getByRole('searchbox', { name: 'Search payment methods' })).toHaveAttribute('placeholder', `Search ${CATALOG.length} payment methods`);
    // Main has no primary action (only the tab bar), so the page carries no [data-primary].
    await expectParity(page, 'Main', { primary: false });
    await expect(page.locator('nav [data-primary]')).toHaveCount(0);
  });

  test('Sort asks the API for the chosen order', async ({ page }) => {
    const seen = await stubApi(page);
    await page.goto('/sell');
    await expect(page.getByRole('radio', { name: 'Most buyers' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Best rate' }).click();
    await expect(page.getByRole('radio', { name: 'Best rate' })).toHaveAttribute('aria-checked', 'true');
    await expect.poll(() => seen.requests.some((r) => /\/v1\/methods\?.*sort=rate/.test(r.url()))).toBe(true);
    await expect(page.locator('section').first().getByRole('button', { name: 'Payment method: Cash by mail' })).toBeVisible();
  });

  test('the live card is a picker of every method with buyers in the currency; picking one changes the card and its offers', async ({ page }) => {
    await stubApi(page);
    await page.goto('/sell');
    const pick = page.getByRole('button', { name: 'Payment method: Zelle' });
    await expect(pick).toHaveAttribute('aria-expanded', 'false');
    await pick.click();
    await expect(pick).toHaveAttribute('aria-expanded', 'true');
    const sheet = page.getByRole('dialog', { name: 'Buyers paying in USD' });
    const options = sheet.getByRole('radiogroup', { name: 'Buyers paying in USD' }).getByRole('radio');
    await expect(options).toHaveCount(BOARD_SELL_LIVE_USD.length);
    await expect(sheet.getByRole('radio', { name: 'Zelle' })).toBeChecked();
    await expect(sheet.locator('[data-part="method-option"]').nth(1)).toHaveText('Cash App27 buyers paying in USD · up to $332.10');
    // Every option is a 44 px+ tap target.
    for (const box of await sheet.locator('[data-part="method-option"]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) expect(box).toBeGreaterThanOrEqual(44);
    await sheet.getByRole('radio', { name: 'Cash App' }).click();
    await expect(sheet).toHaveCount(0);
    const card = page.getByRole('link', { name: 'Cash App 27 buyers paying in USD · up to $332.10' });
    await expect(card).toHaveAttribute('href', '/sell/CASH_APP?currency=USD');
    await expect(page.getByRole('button', { name: 'Payment method: Cash App' })).toBeFocused();
    // The methods with no buyers stay listed under All payment methods; the picked one is not there.
    await expect(page.locator('section', { has: page.getByRole('heading', { name: 'All payment methods' }) }).getByText('Cash App', { exact: true })).toHaveCount(0);
    await card.click();
    await expect(page).toHaveURL(/\/sell\/CASH_APP\?currency=USD$/);
  });

  test('the method picker works from the keyboard: arrows move the choice, Enter closes on it, Escape closes', async ({ page }) => {
    await stubApi(page);
    await page.goto('/sell');
    const pick = page.getByRole('button', { name: 'Payment method: Zelle' });
    await pick.focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: 'Buyers paying in USD' });
    // The sheet opens with focus already on the checked radio: no Tab past Close first.
    await expect(sheet.getByRole('radio', { name: 'Zelle' })).toBeFocused();
    await page.keyboard.press('ArrowDown');
    await expect(sheet.getByRole('radio', { name: 'Cash App' })).toBeChecked();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('ArrowDown');
    await expect(sheet.getByRole('radio', { name: 'Cash by mail' })).toBeChecked();
    await page.keyboard.press('Enter');
    await expect(sheet).toHaveCount(0);
    const now = page.getByRole('button', { name: 'Payment method: Cash by mail' });
    await expect(now).toBeFocused();
    await expect(page.getByRole('link', { name: /^Cash by mail 21 buyers paying in USD/ })).toHaveAttribute('href', '/sell/PAY_BY_MAIL?currency=USD');
    await page.keyboard.press('Space');
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(now).toBeFocused();
  });

  test('with one method with buyers, the picker still opens and lists it', async ({ page }) => {
    await stubApi(page);
    await page.goto('/sell?currency=EUR');
    await page.getByRole('button', { name: 'Payment method: SEPA' }).click();
    const sheet = page.getByRole('dialog', { name: 'Buyers paying in EUR' });
    await expect(sheet.getByRole('radio')).toHaveCount(1);
    await expect(sheet.getByRole('radio', { name: 'SEPA' })).toBeChecked();
  });

  test('on the Desktop layout the picker opens as a centred dialog', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await stubApi(page);
    await page.goto('/sell');
    await page.getByRole('button', { name: 'Payment method: Zelle' }).click();
    const box = (await page.getByRole('dialog', { name: 'Buyers paying in USD' }).boundingBox())!;
    expect(box.width).toBe(520);
    expect(Math.abs(box.x + box.width / 2 - 640)).toBeLessThan(2);
  });

  test('a search with no match shows the board copy, and "Suggest it" posts a suggestion', async ({ page }) => {
    const seen = await stubApi(page, { signedIn: true });
    await page.goto('/sell');
    await page.getByRole('searchbox', { name: 'Search payment methods' }).fill('Kuda Pay');
    await expect(page.getByText('No method called "Kuda Pay" yet. You can post an offer with a custom payment method.')).toBeVisible();
    await page.getByRole('button', { name: 'Suggest it' }).click();
    const sheet = page.getByRole('dialog', { name: 'Suggest a payment method' });
    await expect(sheet.getByRole('textbox', { name: 'Payment method name' })).toHaveValue('Kuda Pay');
    await sheet.getByRole('button', { name: 'Send suggestion' }).click();
    await expect(sheet.getByText('Thanks. We will look at adding Kuda Pay. Until then, you can post an offer with a custom payment method.')).toBeVisible();
    expect(seen.suggestions).toEqual([{ name: 'Kuda Pay' }]);
  });

  test('a search with matches shows "N matches"', async ({ page }) => {
    await stubApi(page);
    await page.goto('/sell');
    await page.getByRole('searchbox', { name: 'Search payment methods' }).fill('cash');
    await expect(page.locator('main h2')).toHaveText([/^\d+ matches$/]);
    await expect(page.locator('main a').first()).toContainText('Cash');
  });
});

test.describe('Task 16 review fixes', () => {
  test('switching currency never shows the old rows under the new currency', async ({ page }) => {
    await stubApi(page);
    let release: () => void = () => {};
    const held = new Promise<void>((r) => (release = r));
    await page.route('**/v1/methods?*currency=EUR*', async (r) => {
      await held;
      await r.fallback();
    });
    await page.goto('/sell');
    await expect(page.locator('main a').first()).toContainText('34 buyers paying in USD');
    await page.getByRole('radiogroup', { name: 'Currency' }).getByRole('radio', { name: 'EUR' }).click();
    await expect(page.getByRole('radio', { name: 'EUR' })).toHaveAttribute('aria-checked', 'true');
    // While the EUR list is on its way, nothing reads "EUR" with the USD numbers.
    await expect(page.getByText(/paying in EUR/)).toHaveCount(0);
    await expect(page.locator('main h2')).toHaveCount(0);
    release();
    await expect(page.locator('main a').first()).toContainText('3 buyers paying in EUR · up to €305.00');
  });

  test('a method list the app cannot read says so and logs the error, unlike a network failure', async ({ page }) => {
    await stubApi(page);
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.route('**/v1/methods?*', (r) => r.fulfill({ json: { live: 'nope', all: [] } }));
    await page.goto('/sell');
    await expect(page.getByText('This version of X2F could not read the payment methods. Reload the page to get the latest version.')).toBeVisible();
    expect(errors.some((e) => /unexpected API shape at methods\.live/.test(e))).toBe(true);
  });

  test('an offer list the app cannot read says so and logs the error', async ({ page }) => {
    await stubApi(page, { offers: () => [{ id: 'x' }] });
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    await page.goto('/sell/ZELLE');
    await expect(page.getByText('This version of X2F could not read the offers. Reload the page to get the latest version.')).toBeVisible();
    await expect(page.getByText('Offers could not be loaded right now. Try again in a moment.')).toHaveCount(0);
    expect(errors.some((e) => /unexpected API shape at offers\[0\]/.test(e))).toBe(true);
  });

  test('a method id from the URL is never printed', async ({ page }) => {
    await stubApi(page);
    await page.goto('/sell/Zelle%20support%20555-0100');
    await expect(page.getByText('This payment method is not available.')).toBeVisible();
    await expect(page.locator('.x2f-browse__head-title')).toHaveText('Sell XMR');
    expect(await page.locator('body').innerText()).not.toContain('555-0100');
  });

  test('every chip group is a radio group with arrow keys (Main sort, currency, offer sort)', async ({ page }) => {
    await stubApi(page);
    await page.goto('/sell');
    const sort = page.getByRole('radiogroup', { name: 'Sort' });
    await sort.getByRole('radio', { name: 'Most buyers' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(sort.getByRole('radio', { name: 'Best rate' })).toHaveAttribute('aria-checked', 'true');
    await expect(sort.getByRole('radio', { name: 'Best rate' })).toBeFocused();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    // Wraps from the first to the last.
    await expect(sort.getByRole('radio', { name: 'A–Z' })).toHaveAttribute('aria-checked', 'true');
    // Only the checked radio is in the tab order.
    await expect(sort.getByRole('radio', { name: 'A–Z' })).toHaveAttribute('tabindex', '0');
    await expect(sort.getByRole('radio', { name: 'Best rate' })).toHaveAttribute('tabindex', '-1');
    const currency = page.getByRole('radiogroup', { name: 'Currency' });
    await currency.getByRole('radio', { name: 'USD' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page).toHaveURL(/currency=EUR/);
    await expect(currency.getByRole('radio', { name: 'EUR' })).toBeFocused();

    await page.goto('/sell/ZELLE');
    const offerSort = page.getByRole('radiogroup', { name: 'Sort' });
    await expect(offerSort.getByRole('radio', { name: 'Best price' })).toHaveAttribute('aria-checked', 'true');
    await offerSort.getByRole('radio', { name: 'Best price' }).focus();
    await page.keyboard.press('ArrowDown');
    await expect(offerSort.getByRole('radio', { name: 'Online now' })).toHaveAttribute('aria-checked', 'true');
  });
});

test.describe('/sell/:methodId (SellOffers board)', () => {
  test('matches the SellOffers board', async ({ page }) => {
    await stubApi(page);
    await page.goto('/sell/ZELLE');
    await expect(page.locator('article')).toHaveCount(3);
    // Only the first takeable card carries the orange Trade.
    await expect(page.locator('[data-primary]')).toHaveAttribute('aria-label', 'Trade with mira.k');
    await expect(page.getByRole('button', { name: 'Trade with first_trade_ty' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Nudge nightowl_44' })).toBeVisible();
    await expect(page.getByText('New', { exact: true })).toBeVisible();
    await expectParity(page, 'SellOffers');
  });

  test('EUR shows only EUR offers', async ({ page }) => {
    const seen = await stubApi(page);
    await page.goto('/sell');
    await page.getByRole('radiogroup', { name: 'Currency' }).getByRole('radio', { name: 'EUR' }).click();
    await expect(page).toHaveURL(/\/sell\?currency=EUR$/);
    await expect(page.locator('main h2').first()).toHaveText('Buyers paying in EUR');
    await page.getByRole('link', { name: /^SEPA 3 buyers/ }).click();
    await expect(page).toHaveURL(/\/sell\/SEPA\?currency=EUR$/);
    // The click leaves the mouse where the SEPA link was; on the list, the card's "+3" badges button
    // can render under it, and a mouse hover opens the badge tooltip, which names the poster again
    // (a second [data-username]). Park the mouse off the cards so the card is read as it rests.
    await page.mouse.move(0, 0);
    await expect(page.getByRole('tooltip')).toHaveCount(0);
    await expect(page.locator('article')).toHaveCount(1);
    await expect(page.locator('article [data-username]')).toHaveText(['euro_buyer']);
    await expect(page.locator('article')).toContainText('€305.00');
    await expect(page.getByText('€304.00')).toBeVisible();
    const offerCalls = seen.requests.filter((r) => new URL(r.url()).pathname === '/v1/offers');
    expect(offerCalls.length).toBeGreaterThan(0);
    for (const r of offerCalls) {
      const q = new URL(r.url()).searchParams;
      expect(q.get('currency')).toBe('EUR');
      expect(q.get('side')).toBe('buy');
      expect(q.get('method')).toBe('SEPA');
    }
  });

  test('logged out, the lists never open: the front door (the Landing board) takes the visitor, keeping the path (owner, 8 Nov 2026)', async ({ page }) => {
    const seen = await stubApi(page, { signedIn: false });
    await page.goto('/sell');
    await expect(page).toHaveURL(/\/\?returnTo=%2Fsell$/);
    await expect(page.locator('[data-screen="landing"]')).toBeVisible();
    await page.goto('/sell/ZELLE');
    await expect(page).toHaveURL(/\/\?returnTo=%2Fsell%2FZELLE$/);
    await expect(page.locator('article')).toHaveCount(0);
    expect(await page.locator('body').innerText()).not.toContain('mira.k');
    const paths = new Set(seen.requests.map((r) => new URL(r.url()).pathname));
    for (const p of ['/v1/methods', '/v1/offers', '/v1/price']) expect(paths.has(p), p).toBe(false);
  });

  test('starter limits: an offer the viewer cannot take yet is greyed with "Opens at Building"', async ({ page }) => {
    const [mira, nightowl, first] = boardSellOffers();
    await stubApi(page, {
      signedIn: true,
      offers: () => [mira, { ...first!, opensAt: 'building' }, { ...nightowl!, poster: { ...nightowl!.poster, online: true }, opensAt: 'graduated' }],
    });
    await page.goto('/sell/ZELLE');
    const closed = page.locator('article[data-opens-at="building"]');
    await expect(closed).toContainText('Opens at Building');
    await expect(closed.getByRole('button', { name: /Trade/ })).toHaveCount(0);
    await expect(closed).toHaveAttribute('aria-disabled', 'true');
    await expect(page.locator('article[data-opens-at="graduated"]')).toContainText('Opens at Graduated');
    await expect(page.locator('article[data-opens-at="graduated"]').getByRole('button', { name: /Trade/ })).toHaveCount(0);
    // An offer with no opensAt is normal.
    const open = page.locator('article', { has: page.locator('[data-username]', { hasText: 'mira.k' }) });
    await expect(open).not.toHaveAttribute('data-opens-at', /.*/);
    await expect(open.getByRole('button', { name: 'Trade with mira.k' })).toBeEnabled();
    // The greyed card uses the muted ink token, no new colour.
    const color = await closed.locator('[data-part="rate"]').evaluate((e) => getComputedStyle(e).color);
    const muted = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.setProperty('color', 'var(--x2f-ink-muted)');
      document.body.append(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    expect(color).toBe(muted);
  });
});

// Phone sizes (spec "Mobile ready at launch"): both boards at the board's 390x844 and a small
// Android 360x800, with no sideways scroll, nothing cut off and every control tappable.
for (const viewport of PHONE_VIEWPORTS) {
  test.describe(`sell browse on a ${viewport} phone`, () => {
    test.beforeEach(async ({ page }) => {
      await setPhone(page, viewport);
    });

    test('Main: parity and phone layout', async ({ page }) => {
      await stubApi(page);
      await page.goto('/sell');
      await expect(page.getByRole('button', { name: 'Payment method: Zelle' })).toBeVisible();
      await expectPhoneLayout(page);
      await expectParity(page, 'Main', { viewport, primary: false });
    });

    test('Main with the method picker open: a bottom sheet, phone layout', async ({ page }) => {
      await stubApi(page);
      await page.goto('/sell');
      await page.getByRole('button', { name: 'Payment method: Zelle' }).click();
      const sheet = page.getByRole('dialog', { name: 'Buyers paying in USD' });
      await expect(sheet.getByRole('radio')).toHaveCount(BOARD_SELL_LIVE_USD.length);
      const box = (await sheet.boundingBox())!;
      const vh = page.viewportSize()!.height;
      expect(Math.abs(box.y + box.height - vh)).toBeLessThan(2);
      await expectPhoneLayout(page);
    });

    test('Main with a search that has no match: phone layout', async ({ page }) => {
      await stubApi(page);
      await page.goto('/sell');
      await page.getByRole('searchbox', { name: 'Search payment methods' }).fill('Kuda Pay');
      await expect(page.getByRole('button', { name: 'Suggest it' })).toBeVisible();
      await expectPhoneLayout(page);
    });

    test('SellOffers: parity and phone layout', async ({ page }) => {
      await stubApi(page);
      await page.goto('/sell/ZELLE');
      await expect(page.locator('article')).toHaveCount(3);
      await expectPhoneLayout(page);
      await expectParity(page, 'SellOffers', { viewport });
    });

    test('SellOffers with greyed starter-limit offers and the badge popover open: phone layout', async ({ page }) => {
      const [mira, nightowl, first] = boardSellOffers();
      await stubApi(page, { signedIn: true, offers: () => [mira, { ...first!, opensAt: 'building' }, { ...nightowl!, opensAt: 'graduated' }] });
      await page.goto('/sell/ZELLE');
      await expect(page.locator('article[data-opens-at="building"]')).toContainText('Opens at Building');
      await page.getByRole('button', { name: 'Show all 5 badges' }).click();
      await expect(page.getByRole('tooltip')).toBeVisible();
      // The username in the popover title keeps its case.
      await expect(page.getByRole('tooltip').locator('[data-username]')).toHaveCSS('text-transform', 'none');
      await expectPhoneLayout(page);
    });
  });
}
