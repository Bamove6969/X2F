// My offers (Plan 3 Task 36). The API is stubbed with page.route in the shapes of
// apps/api/src/offers/routes.ts (GET /v1/account/offers → MyOffer[]; POST /v1/account/offers/status
// → { status, results }), which apps/api/test/offersBulk.test.ts checks against the real routes.
// No board yet (tripwire NEEDS_DESIGN_MYOFFERS): the phone layout rule runs at both phone sizes,
// but there is no expectParity until the board lands.
import { expect, test, type Page, type Route } from '@playwright/test';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';

const ME = { displayName: 'nightowl_44', kind: 'trader', level: 'full', termsCurrent: true };
const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

type Offer = Record<string, unknown> & { id: string; status: 'live' | 'paused' };

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
  /** Turning on is refused with this code for every offer (a hold, a paused site), when set. */
  refuseOn?: string;
  posts: unknown[];
}

/** A small fake of the two routes: it keeps the statuses, so a reload shows what was saved. */
async function stub(page: Page, s: Server): Promise<void> {
  await page.route('**/v1/account/me', json(ME));
  await page.route('**/v1/account/offers', (r) => json(s.offers)(r));
  await page.route('**/v1/account/offers/status', (r) => {
    const body = r.request().postDataJSON() as { ids: string[] | 'all'; status: 'live' | 'paused' };
    s.posts.push(body);
    const ids = body.ids === 'all' ? s.offers.map((o) => o.id) : body.ids;
    const results = ids.map((id) => {
      const o = s.offers.find((x) => x.id === id);
      if (!o) return { id, refused: 'not-found' };
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

test('lists my offers with their switches, at both phone sizes', async ({ page }) => {
  await stub(page, fresh());
  await page.goto('/profile/offers');
  await expect(page.getByRole('heading', { name: 'My offers' })).toBeVisible();
  await expect(page.locator('[data-part="offer"]')).toHaveCount(3);
  await expect(sw(page, A)).toHaveAttribute('aria-checked', 'true');
  await expect(sw(page, B)).toHaveAttribute('aria-checked', 'false');
  await expect(row(page, A)).toContainText('Sell · Zelle · USD');
  await expect(row(page, A)).toContainText('Market +0.5% · $331.65 / XMR · $50 to $2,000');
  await expect(sw(page, A)).toHaveAccessibleName('Sell · Zelle · USD');
  for (const v of PHONE_VIEWPORTS) {
    await setPhone(page, v);
    await expectPhoneLayout(page);
  }
});

test('the switches and Select all round-trip: a reload shows what was saved', async ({ page }) => {
  const s = fresh();
  await stub(page, s);
  await page.goto('/profile/offers');
  await sw(page, B).click();
  await expect(sw(page, B)).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('status')).toHaveText('1 offer turned on.');
  expect(s.posts.at(-1)).toEqual({ ids: [B], status: 'live' });

  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Turn off' }).click();
  await expect(page.getByRole('status')).toHaveText('3 offers turned off.');
  expect(s.posts.at(-1)).toEqual({ ids: 'all', status: 'paused' });
  for (const id of [A, B, C]) await expect(sw(page, id)).toHaveAttribute('aria-checked', 'false');

  await page.reload();
  for (const id of [A, B, C]) await expect(sw(page, id)).toHaveAttribute('aria-checked', 'false');

  // Two of three, then Turn on.
  await row(page, A).getByRole('button', { name: /^Select / }).click();
  await row(page, C).getByRole('button', { name: /^Select / }).click();
  await expect(page.getByRole('button', { name: 'Select all' })).toHaveAttribute('aria-pressed', 'mixed');
  await page.getByRole('button', { name: 'Turn on' }).click();
  expect(s.posts.at(-1)).toEqual({ ids: [A, C], status: 'live' });
  await page.reload();
  await expect(sw(page, A)).toHaveAttribute('aria-checked', 'true');
  await expect(sw(page, B)).toHaveAttribute('aria-checked', 'false');
  await expect(sw(page, C)).toHaveAttribute('aria-checked', 'true');
});

test('turning all on while held: every offer stays off and each row says why; turning off still works', async ({ page }) => {
  const s = fresh();
  s.offers.forEach((o) => (o.status = 'paused'));
  s.refuseOn = 'trading-hold';
  await stub(page, s);
  await page.goto('/profile/offers');
  await page.getByRole('button', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByRole('status')).toHaveText('No offers turned on. Each one says why below.');
  for (const id of [A, B, C]) {
    await expect(sw(page, id)).toHaveAttribute('aria-checked', 'false');
    await expect(row(page, id)).toContainText('trading hold');
    await expect(sw(page, id)).toHaveAccessibleDescription(/trading hold/);
  }
  for (const v of PHONE_VIEWPORTS) {
    await setPhone(page, v);
    await expectPhoneLayout(page);
  }
});

test('PostOffer links to My offers; an empty list links back to Post an offer', async ({ page }) => {
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
