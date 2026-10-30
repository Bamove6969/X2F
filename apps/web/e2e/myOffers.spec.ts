// My offers (Plan 3 Task 36). The API is stubbed with page.route in the shapes of
// apps/api/src/offers/routes.ts (GET /v1/account/offers → MyOffer[]; POST /v1/account/offers/status
// → { status, results }), which apps/api/test/offersBulk.test.ts checks against the real routes.
// The behaviour follows Claude Design's MyOffers board (origin/wip/design-brief, not on the line
// yet: tripwire NEEDS_DESIGN_MYOFFERS), so the phone layout rule runs at both phone sizes but there
// is no expectParity until the board lands.
import { expect, test, type Page, type Route } from '@playwright/test';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';

const ME = { displayName: 'nightowl_44', kind: 'trader', level: 'full', termsCurrent: true };
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

type Offer = Record<string, unknown> & { id: string; status: 'live' | 'paused'; hidden?: string };

const OFFERS: Offer[] = [
  {
    id: A, side: 'sell', methodId: 'ZELLE', methodName: 'Zelle', currency: 'USD', rate: '33165',
    pricing: { mode: 'market', marginBps: 50 }, minFiatCents: '5000', maxFiatCents: '200000', minTrades: 0,
    status: 'live', createdAt: '2026-10-29T10:00:00.000Z',
  },
  {
    id: B, side: 'buy', methodId: 'REVOLUT', methodName: 'Revolut', currency: 'EUR', rate: '30000',
    pricing: { mode: 'fixed', centsPerXmr: '30000' }, minFiatCents: '1250', maxFiatCents: '50000', minTrades: 5,
    status: 'paused', createdAt: '2026-10-29T09:00:00.000Z',
  },
  {
    id: C, side: 'sell', methodId: 'WISE', methodName: 'Wise', currency: 'GBP', rate: '26530',
    pricing: { mode: 'market', marginBps: 0 }, minFiatCents: '2000', maxFiatCents: '90000', minTrades: 0,
    status: 'live', createdAt: '2026-10-29T08:00:00.000Z',
  },
];

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

interface Server {
  offers: Offer[];
  /** Turning on is refused with this code (a hold, a paused site), when set; offers that are already on are done, as the API answers. */
  refuseOn?: string;
  posts: unknown[];
}

/** A small fake of the two routes, with the API's rules: it keeps the statuses, so a reload shows what was saved. */
async function stub(page: Page, s: Server): Promise<void> {
  await page.route('**/v1/account/me', json(ME));
  await page.route('**/v1/account/offers', (r) => json(s.offers)(r));
  await page.route('**/v1/account/offers/status', (r) => {
    const body = r.request().postDataJSON() as { ids: string[]; status: 'live' | 'paused' };
    s.posts.push(body);
    const results = body.ids.map((id) => {
      const o = s.offers.find((x) => x.id === id);
      if (!o) return { id, refused: 'not-found' };
      // As routes.ts: an offer already in the asked status is done, before any guard (review M6).
      if (o.status === body.status) return { id, status: o.status };
      if (body.status === 'live' && s.refuseOn) return { id, status: o.status, refused: s.refuseOn };
      o.status = body.status;
      return { id, status: o.status };
    });
    return json({ status: body.status, results })(r);
  });
}

const fresh = (): Server => ({ offers: OFFERS.map((o) => ({ ...o })), posts: [] });
const row = (page: Page, id: string) => page.locator(`[data-offer="${id}"]`);
const sw = (page: Page, id: string) => row(page, id).getByRole('switch');
const tick = (page: Page, id: string) => row(page, id).getByRole('checkbox');

test('lists my offers with tick boxes and switches, at both phone sizes', async ({ page }) => {
  await stub(page, fresh());
  await page.goto('/profile/offers');
  await expect(page.getByRole('heading', { name: 'My offers' })).toBeVisible();
  await expect(page.getByText('2 of 3 offers on')).toBeVisible();
  await expect(page.locator('[data-part="offer"]')).toHaveCount(3);
  await expect(sw(page, A)).toHaveAttribute('aria-checked', 'true');
  await expect(sw(page, B)).toHaveAttribute('aria-checked', 'false');
  await expect(row(page, A)).toContainText('Selling XMR · USD');
  await expect(row(page, A)).toContainText('+0.5% · follows the market');
  await expect(row(page, A)).toContainText('$50 – $2,000 per trade');
  await expect(row(page, B)).toContainText('Off · hidden from everyone');
  // Review M2 and M3: the names carry the price and limits, and start with the switch's visible text.
  await expect(sw(page, A)).toHaveAccessibleName('On Selling XMR · USD Zelle +0.5% · follows the market $50 – $2,000 per trade');
  await expect(tick(page, A)).toHaveAccessibleName('Select Selling XMR · USD Zelle +0.5% · follows the market $50 – $2,000 per trade');
  for (const v of PHONE_VIEWPORTS) {
    await setPhone(page, v);
    await expectPhoneLayout(page);
  }
  // With the bar showing too.
  await page.getByRole('checkbox', { name: 'Select all' }).click();
  await expect(page.getByRole('region', { name: 'Selected offers' })).toBeVisible();
  for (const v of PHONE_VIEWPORTS) {
    await setPhone(page, v);
    await expectPhoneLayout(page);
  }
});

test('Select all only ticks; the bar turns the ticked offers on or off; a reload shows what was saved', async ({ page }) => {
  const s = fresh();
  await stub(page, s);
  await page.goto('/profile/offers');
  await sw(page, B).click();
  await expect(sw(page, B)).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('status')).toHaveText('1 offer turned on.');
  expect(s.posts.at(-1)).toEqual({ ids: [B], status: 'live' });

  await page.getByRole('checkbox', { name: 'Select all' }).click();
  await expect(page.getByRole('region', { name: 'Selected offers' })).toContainText('3 selected');
  expect(s.posts).toHaveLength(1);
  await page.getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByRole('status')).toHaveText('3 offers turned off.');
  expect(s.posts.at(-1)).toEqual({ ids: [A, B, C], status: 'paused' });
  for (const id of [A, B, C]) await expect(sw(page, id)).toHaveAttribute('aria-checked', 'false');
  await expect(page.getByRole('region', { name: 'Selected offers' })).toHaveCount(0);

  // Turned-off offers stay off across a reload.
  await page.reload();
  for (const id of [A, B, C]) await expect(sw(page, id)).toHaveAttribute('aria-checked', 'false');

  await tick(page, A).click();
  await tick(page, C).click();
  await expect(page.getByRole('checkbox', { name: 'Select all' })).toHaveAttribute('aria-checked', 'mixed');
  await page.getByRole('button', { name: 'Turn on' }).click();
  expect(s.posts.at(-1)).toEqual({ ids: [A, C], status: 'live' });
  await page.reload();
  await expect(sw(page, A)).toHaveAttribute('aria-checked', 'true');
  await expect(sw(page, B)).toHaveAttribute('aria-checked', 'false');
  await expect(sw(page, C)).toHaveAttribute('aria-checked', 'true');
});

test('turning on while held: the paused offers stay off and say why; the one already on is done', async ({ page }) => {
  const s = fresh();
  s.refuseOn = 'trading-hold';
  s.offers[0]!.hidden = 'trading-hold';
  await stub(page, s);
  await page.goto('/profile/offers');
  // Review M4: the On offer says it is hidden.
  await expect(row(page, A)).toContainText('On, hidden while your account has a trading hold');
  await sw(page, C).click(); // turning off works under a hold
  await expect(sw(page, C)).toHaveAttribute('aria-checked', 'false');
  await page.getByRole('checkbox', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Turn on' }).click();
  // The hold opens the shared CantDoThat popup with its feedback link (Plan 5 Task 21).
  const pop = page.getByRole('dialog');
  await expect(pop).toContainText("Your account has a trading hold while a dispute is open, so your offers stay off until it's resolved.");
  await expect(pop.getByRole('link', { name: 'feedback' })).toHaveAttribute('href', '/feedback?from=trading-hold');
  await pop.getByRole('button', { name: 'OK' }).click();
  await expect(pop).toHaveCount(0);
  await expect(page.locator('[data-part="summary"]')).toHaveText('1 offer turned on. 2 offers stayed as they were; each one says why below.');
  await expect(sw(page, A)).toHaveAttribute('aria-checked', 'true');
  for (const id of [B, C]) {
    await expect(sw(page, id)).toHaveAttribute('aria-checked', 'false');
    await expect(row(page, id)).toContainText('trading hold');
    await expect(sw(page, id)).toHaveAccessibleDescription(/trading hold/);
  }
  for (const v of PHONE_VIEWPORTS) {
    await setPhone(page, v);
    await expectPhoneLayout(page);
  }
});

test('PostOffer links to My offers; an empty list still offers Post an offer', async ({ page }) => {
  const s = fresh();
  s.offers = [];
  await stub(page, s);
  await page.route(/\/v1\/methods\?/, json({ live: [], all: [] }));
  await page.route(/\/v1\/price\?/, json({ error: 'price-unavailable' }, 503));
  await page.goto('/post');
  await page.getByRole('link', { name: 'My offers' }).click();
  await expect(page).toHaveURL(/\/profile\/offers$/);
  await expect(page.getByText('You have no offers yet.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Post an offer' })).toHaveAttribute('href', '/post');
});
