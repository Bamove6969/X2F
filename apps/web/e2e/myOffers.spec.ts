// My offers (Plan 3 Task 36). The API is stubbed with page.route in the shapes of
// apps/api/src/offers/routes.ts (GET /v1/account/offers → MyOffer[]; POST /v1/account/offers/status
// → { status, results }), which apps/api/test/offersBulk.test.ts checks against the real routes.
// The behaviour and structure follow Claude Design's MyOffers board (origin/wip/design-brief, not on
// the line yet: tripwire NEEDS_DESIGN_MYOFFERS) and the design review of 1 Nov 2026 (shots 31-35),
// so the phone layout rule and the review's structure checks run at both phone sizes, but there is
// no expectParity until the board lands.
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
    id: B, side: 'buy', methodId: 'REVOLUT', methodName: 'Revolut', currency: 'EUR', rate: '27000',
    pricing: { mode: 'market', marginBps: -1000 }, minFiatCents: '1250', maxFiatCents: '50000', minTrades: 5,
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
  // Review M2: the names carry the price and limits. The switch is a real track with no words now.
  await expect(sw(page, A)).toHaveAccessibleName('Selling XMR · USD Zelle +0.5% · follows the market $50 – $2,000 per trade');
  await expect(tick(page, A)).toHaveAccessibleName('Select Selling XMR · USD Zelle +0.5% · follows the market $50 – $2,000 per trade');
  // Design review 1 Nov 2026 (shot 31): every card's text starts at the same x, on the grid
  // tick box 44 | content | switch 60; the tick box is 24 px and the switch track 52×32.
  const xs = await page.locator('[data-part="offer"] .x2f-select-card__eyebrow').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().left)));
  expect(new Set(xs).size).toBe(1);
  const box = await tick(page, A).boundingBox();
  expect([box!.width, box!.height]).toEqual([24, 24]);
  const track = await row(page, A).locator('.x2f-switch__track').boundingBox();
  expect([track!.width, track!.height]).toEqual([52, 32]);
  for (const v of PHONE_VIEWPORTS) {
    await setPhone(page, v);
    await expectPhoneLayout(page);
    await expectPinnedTabBar(page);
  }
  // With the bar showing too: it takes the place of Post an offer, right above the tab bar (shot 32).
  await page.getByRole('checkbox', { name: 'Select all' }).click();
  const bar = page.getByRole('region', { name: 'Selected offers' });
  await expect(bar).toBeVisible();
  await expect(page.getByRole('link', { name: 'Post an offer' })).toHaveCount(0);
  for (const v of PHONE_VIEWPORTS) {
    await setPhone(page, v);
    await expectPhoneLayout(page);
    await expectPinnedTabBar(page);
    const b = (await bar.boundingBox())!;
    const nav = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
    expect(Math.round(b.y + b.height)).toBe(Math.round(nav.y));
  }
  // A ticked card is ringed in ink, never orange (conventions 2 Nov 2026): a 2 px ink border, not a
  // shadow (design kit handoff 1.5).
  const [ring, width, shadow, ink] = await row(page, A).evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.color = 'var(--x2f-ink)';
    el.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    const s = getComputedStyle(el);
    return [s.borderTopColor, s.borderTopWidth, s.boxShadow, c];
  });
  expect(ring).toBe(ink);
  expect(width).toBe('2px');
  expect(shadow).toBe('none');
  await expect(tick(page, A)).toHaveCSS('accent-color', ink);
});

/** The tab bar sits on the bottom edge of the viewport (design review 1 Nov 2026, shot 35). */
async function expectPinnedTabBar(page: Page): Promise<void> {
  const nav = (await page.getByRole('navigation', { name: 'Main' }).boundingBox())!;
  expect(Math.round(nav.y + nav.height)).toBe(page.viewportSize()!.height);
}

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
  await expect(page.getByRole('checkbox', { name: 'Select all' })).toHaveJSProperty('indeterminate', true);
  await page.getByRole('button', { name: 'Turn on' }).click();
  expect(s.posts.at(-1)).toEqual({ ids: [A, C], status: 'live' });
  await page.reload();
  await expect(sw(page, A)).toHaveAttribute('aria-checked', 'true');
  await expect(sw(page, B)).toHaveAttribute('aria-checked', 'false');
  await expect(sw(page, C)).toHaveAttribute('aria-checked', 'true');
});

test('during a trading hold: the hold popup on Turn on, then one caution notice, a Paused chip on every offer, everything that switches disabled, and Post an offer refused', async ({ page }) => {
  const s = fresh();
  s.refuseOn = 'trading-hold';
  // Every offer off: the list cannot show the hold (the API marks only live offers hidden), so the
  // screen learns it from the refused Turn on.
  for (const o of s.offers) o.status = 'paused';
  await stub(page, s);
  await page.goto('/profile/offers');
  await expect(page.locator('[data-part="hold-notice"]')).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Turn on' }).click();
  // None can be turned on: the hold's own popup, with its feedback link (Plan 5 Task 21).
  const pop = page.getByRole('dialog');
  await expect(pop).toContainText("You can't turn offers on during a trading hold");
  await expect(pop).toContainText('They stay paused until the hold ends. Trades already started carry on.');
  await expect(pop.getByRole('link', { name: 'feedback' })).toHaveAttribute('href', '/feedback?from=trading-hold');
  await pop.getByRole('button', { name: 'OK' }).click();
  await expect(pop).toHaveCount(0);
  // Design session 2 Nov 2026: one caution notice at the top, a chip on every offer, on or off.
  const notice = page.locator('[data-part="hold-notice"]');
  await expect(notice).toHaveText('Your offers are paused during a trading holdNobody can see or take them until the hold ends. Trades already started carry on.');
  await expect(page.locator('.x2f-outcome')).toHaveCount(1);
  await expect(page.getByText('Trading hold · all offers paused')).toBeVisible();
  for (const id of [A, B, C]) {
    await expect(row(page, id).locator('[data-part="status"]')).toHaveText('Paused · trading hold');
    await expect(sw(page, id)).toBeDisabled();
    await expect(sw(page, id)).toHaveAccessibleDescription('Paused · trading hold');
  }
  const [border, caution] = await notice.evaluate((el) => {
    const probe = document.createElement('span');
    // The kit Notice's caution tone is the v2 callout: a 30% caution border (visual system v2,
    // section 12), so the probe mixes the same way.
    probe.style.color = 'color-mix(in srgb, var(--x2f-caution) 30%, transparent)';
    el.append(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return [getComputedStyle(el).borderTopColor, c];
  });
  expect(border).toBe(caution);
  for (const v of PHONE_VIEWPORTS) {
    await setPhone(page, v);
    await expectPhoneLayout(page);
  }
  // Batch 3 board: Turn on / Turn off are disabled too, and Post an offer is refused with CantDoThat.
  await tick(page, A).click();
  await expect(page.getByRole('button', { name: 'Turn on' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Turn off' })).toBeDisabled();
  await page.getByRole('button', { name: 'Clear' }).click();
  await page.getByRole('link', { name: 'Post an offer' }).click();
  await expect(pop).toContainText("Your account has a trading hold while a dispute is open, so you can't post offers until it's resolved.");
  await expect(page).toHaveURL(/\/profile\/offers$/);
});

test('a live offer hidden by a hold shows the hold state on load', async ({ page }) => {
  const s = fresh();
  s.offers[0]!.hidden = 'trading-hold';
  s.offers[2]!.hidden = 'trading-hold';
  await stub(page, s);
  await page.goto('/profile/offers');
  await expect(page.locator('[data-part="hold-notice"]')).toBeVisible();
  for (const id of [A, B, C]) await expect(sw(page, id)).toBeDisabled();
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
  await expect(page.getByRole('heading', { name: 'No offers yet' })).toBeVisible();
  await expect(page.getByText('0 of 0 offers on')).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Post an offer' })).toHaveAttribute('href', '/post');
  // Shot 35: the tab bar is pinned to the bottom, not floating under the button.
  for (const v of PHONE_VIEWPORTS) {
    await setPhone(page, v);
    await expectPhoneLayout(page);
    await expectPinnedTabBar(page);
  }
});
