// Sell browse (Task 16): /sell (Main board) and /sell/:methodId (SellOffers board). The API is
// stubbed with the boards' example data (src/fixtures/boards.ts) in the Task 3/4 shapes that
// src/screens/browse/api.ts reads (see test/browse-tripwire.test.ts).
import { readFileSync } from 'node:fs';
import { expect, test, type Page, type Request } from '@playwright/test';
import { BOARD_SELL_LIVE_USD, BOARD_SELL_OFFERS, boardSellOffers } from '../src/fixtures/boards.js';
import { expectParity } from './parity.js';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';

type Row = { id: string; name: string; group: string; giftCard: boolean; offers: number; bestRate: string | null };

const CATALOG = (
  JSON.parse(readFileSync(new URL('../../../data/payment-methods.json', import.meta.url), 'utf8')) as {
    methods: { id: string; name: string; group: string; giftCard?: boolean; legalReview?: string }[];
  }
).methods.filter((m) => !m.legalReview);

const EUR_LIVE: Row[] = [{ id: 'SEPA', name: 'SEPA', group: 'Bank transfers', giftCard: false, offers: 3, bestRate: '30500' }];

/** An EUR buyer on Zelle, so the EUR list differs from the USD one. */
const EUR_OFFER = {
  ...boardSellOffers()[0]!,
  id: 'offer-eur',
  poster: { ...boardSellOffers()[0]!.poster, username: 'euro_buyer' },
  rate: '30500',
};

interface Stub {
  signedIn?: boolean;
  offers?: (currency: string) => unknown[];
}

interface Seen {
  requests: Request[];
  suggestions: unknown[];
}

function methodLists(currency: string, sort: string): { live: Row[]; all: Row[] } {
  const live = [...(currency === 'USD' ? BOARD_SELL_LIVE_USD : currency === 'EUR' ? EUR_LIVE : [])] as Row[];
  if (sort === 'rate') live.sort((a, b) => Number(b.bestRate) - Number(a.bestRate) || a.name.localeCompare(b.name, 'en'));
  if (sort === 'az') live.sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const byId = new Map(live.map((r) => [r.id, r]));
  const all = CATALOG.map((m) => byId.get(m.id) ?? { id: m.id, name: m.name, group: m.group, giftCard: m.giftCard === true, offers: 0, bestRate: null }).sort(
    (a, b) => a.name.localeCompare(b.name, 'en'),
  );
  return { live, all };
}

async function stubApi(page: Page, o: Stub = {}): Promise<Seen> {
  const seen: Seen = { requests: [], suggestions: [] };
  page.on('request', (r) => {
    if (new URL(r.url()).pathname.startsWith('/v1/')) seen.requests.push(r);
  });
  await page.route('**/v1/account/me', (r) =>
    o.signedIn ? r.fulfill({ json: { username: 'viewer_1', kind: 'trader' } }) : r.fulfill({ status: 401, json: { error: 'unauthenticated' } }),
  );
  await page.route('**/v1/methods?*', (r) => {
    const q = new URL(r.request().url()).searchParams;
    return r.fulfill({ json: methodLists(q.get('currency') ?? '', q.get('sort') ?? 'buyers') });
  });
  await page.route('**/v1/price?*', (r) => {
    const currency = new URL(r.request().url()).searchParams.get('currency') ?? '';
    const centsPerXmr = currency === 'EUR' ? '30400' : BOARD_SELL_OFFERS.marketCentsPerXmr;
    return r.fulfill({ json: { currency, centsPerXmr, exponent: 2, at: new Date().toISOString() } });
  });
  await page.route('**/v1/offers?*', (r) => {
    const q = new URL(r.request().url()).searchParams;
    const currency = q.get('currency') ?? '';
    const list = o.offers ? o.offers(currency) : currency === 'USD' ? boardSellOffers() : currency === 'EUR' ? [EUR_OFFER] : [];
    return r.fulfill({ json: list });
  });
  await page.route('**/v1/method-suggestions', async (r) => {
    seen.suggestions.push(r.request().postDataJSON());
    return r.fulfill({ status: 202, json: {} });
  });
  return seen;
}

test.describe('/sell (Main board)', () => {
  test('matches the Main board: live buyers first, then every method A–Z', async ({ page }) => {
    await stubApi(page);
    await page.goto('/sell');
    const headings = page.locator('main h2');
    await expect(headings).toHaveText(['Buyers paying in USD', 'All payment methods']);
    const live = page.locator('section', { has: page.getByRole('heading', { name: 'Buyers paying in USD' }) }).locator('a');
    await expect(live.first()).toContainText('Zelle');
    await expect(live.first()).toContainText('34 buyers paying in USD · up to $331.20');
    const rest = page.locator('section', { has: page.getByRole('heading', { name: 'All payment methods' }) }).locator('a [data-part="name"]');
    const names = await rest.allTextContents();
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
    await expect(page.locator('section').first().locator('a').first()).toContainText('Cash by mail');
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

  test('logged out, the lists render and no browse request fails', async ({ page }) => {
    const seen = await stubApi(page, { signedIn: false });
    const failed: string[] = [];
    page.on('response', (r) => {
      const path = new URL(r.url()).pathname;
      if (path.startsWith('/v1/') && path !== '/v1/account/me' && r.status() >= 400) failed.push(`${r.status()} ${path}`);
    });
    await page.goto('/sell');
    await expect(page.locator('main a').first()).toBeVisible();
    await page.goto('/sell/ZELLE');
    await expect(page.locator('article')).toHaveCount(3);
    await expect(page.getByRole('button', { name: 'Trade with mira.k' })).toBeEnabled();
    expect(failed).toEqual([]);
    const paths = new Set(seen.requests.map((r) => new URL(r.url()).pathname));
    for (const p of ['/v1/methods', '/v1/offers', '/v1/price']) expect(paths.has(p), p).toBe(true);
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
      await expect(page.locator('main a').first()).toContainText('Zelle');
      await expectPhoneLayout(page);
      await expectParity(page, 'Main', { viewport, primary: false });
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
