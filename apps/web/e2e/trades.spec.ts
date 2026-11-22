// My trades (/trades; register D-005): the Open and Completed tabs (kept in the address), rows that
// open the trade room, "Show more" along the API's cursor, the empty, failed and team-role refused
// states, and the My trades entry in the phone tab bar. The API is stubbed with page.route in the
// shape of apps/api/src/trades/list.ts (GET /v1/trades?status=open|completed&cursor →
// { trades, next }), which apps/api/test/tradesList.test.ts checks against the real route.
//
// No board yet (DESIGNER-REVIEW, COPY-UNSIGNED: trades/model.ts): no parity; the phone layout
// (expectPhoneLayout) at PHONE_VIEWPORTS and 44 px targets only.
import { expect, test, type Page, type Route } from '@playwright/test';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';
import { sellerView } from './refundViews.js';

const ME = { displayName: 'nightowl_44', kind: 'trader', level: 'full', termsCurrent: true };
const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

type Row = Record<string, unknown>;
const row = (code: string, over: Row = {}): Row => ({
  code, role: 'buyer', state: 'secured', amountAtomic: '1250000000000', fiatCents: '41250', currency: 'USD',
  counterparty: { displayName: 'Calcium' }, takenAt: '2026-11-10T09:00:00.000Z', closedAt: null, ...over,
});

const OPEN_1 = [row('K7M2-9QXA-4FTR-8WPN'), row('AB2C-3DEF-4GHJ-5KMN', { role: 'seller', state: 'paid', amountAtomic: '500000000000', fiatCents: '15000', currency: 'EUR', counterparty: { displayName: 'aurora_9' } })];
const OPEN_2 = [row('P8MD-2NCE-7HJK-3QRS', { state: 'funding', counterparty: { displayName: 'quietfox' } })];
const DONE = [
  row('T5HJ-6YVM-8WQZ-2ABC', { state: 'released', closedAt: '2026-11-08T12:15:00.000Z' }),
  row('W2KS-8QFN-4RTX-9DEF', { role: 'seller', state: 'refunded', closedAt: '2026-11-07T10:00:00.000Z' }),
];

type Answer = (status: string, cursor: string | null) => (r: Route) => Promise<void>;

/** Signed in (as `me`, the owner by default), with GET /v1/trades answered by `answer`; returns each request's status and cursor. */
async function base(page: Page, answer: Answer, me: Record<string, unknown> = ME): Promise<string[]> {
  const asked: string[] = [];
  await page.route('**/v1/account/me', json(me));
  await page.route(/\/v1\/trades\?/, (r) => {
    const u = new URL(r.request().url());
    const status = u.searchParams.get('status') ?? '';
    const cursor = u.searchParams.get('cursor');
    asked.push(cursor === null ? status : `${status}@${cursor}`);
    return answer(status, cursor)(r);
  });
  return asked;
}

const normal: Answer = (status, cursor) =>
  status === 'completed' ? json({ trades: DONE, next: null }) : cursor === null ? json({ trades: OPEN_1, next: 'c2' }) : json({ trades: OPEN_2, next: null });

async function expectAtLeast44(page: Page, selector: string): Promise<void> {
  const boxes = await page.locator(selector).evaluateAll((els) =>
    els.filter((e) => (e as HTMLElement).checkVisibility()).map((e) => ({ s: e.outerHTML.slice(0, 80), ...e.getBoundingClientRect().toJSON() as { width: number; height: number } })),
  );
  expect(boxes.length, selector).toBeGreaterThan(0);
  for (const b of boxes) expect(Math.min(b.width, b.height), b.s).toBeGreaterThanOrEqual(44);
}

const rows = (page: Page) => page.locator('[data-part="trade-row"]');

for (const viewport of PHONE_VIEWPORTS) {
  test(`My trades at ${viewport}: phone layout and 44 px targets on both tabs, the rows' words, Show more`, async ({ page }) => {
    const asked = await base(page, normal);
    await setPhone(page, viewport);
    await page.goto('/trades');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('My trades');
    const open = page.getByRole('tab', { name: 'Open' });
    await expect(open).toHaveAttribute('aria-selected', 'true');
    await expect(rows(page)).toHaveCount(2);

    const first = rows(page).first();
    await expect(first).toContainText('Buying 1.250000 XMR');
    await expect(first).toContainText('$412.50');
    await expect(first).toContainText('with Calcium');
    await expect(first).toContainText('K7M2-9QXA-4FTR-8WPN');
    await expect(first).toContainText('Started ');
    await expect(first).toContainText('Escrow secured');
    await expect(rows(page).nth(1)).toContainText('Selling 0.500000 XMR');
    await expect(rows(page).nth(1)).toContainText('Paid, waiting for release');
    // A public name is never restyled.
    await expect(first.locator('[data-username]')).toHaveCSS('text-transform', 'none');

    await expectPhoneLayout(page);
    await expectAtLeast44(page, '[role="tab"], .x2f-trades__link, [data-part="more"]');

    await page.locator('[data-part="more"]').click();
    await expect(rows(page)).toHaveCount(3);
    await expect(rows(page).nth(2)).toContainText('Waiting for escrow');
    await expect(page.locator('[data-part="more"]')).toHaveCount(0);

    await page.getByRole('tab', { name: 'Completed' }).click();
    await expect(page).toHaveURL(/\/trades\?tab=completed$/);
    await expect(rows(page)).toHaveCount(2);
    await expect(rows(page).first()).toContainText('Completed');
    await expect(rows(page).first()).toContainText('Ended ');
    await expect(rows(page).nth(1)).toContainText('Refunded');
    await expectPhoneLayout(page);
    await expectAtLeast44(page, '[role="tab"], .x2f-trades__link');
    expect(asked).toEqual(['open', 'open@c2', 'completed']);
  });
}

for (const viewport of PHONE_VIEWPORTS) {
  // My trades has no tab bar of its own (like Wallets and Post offer, App.tsx nav={false}); the bar on
  // Trade carries it, after Trade.
  test(`the phone tab bar on Trade at ${viewport}: My trades after Trade, five 44 px tabs, it opens My trades`, async ({ page }) => {
    await base(page, normal);
    await page.route(/\/v1\/methods\?/, json({ live: [], all: [] }));
    await page.route(/\/v1\/price\?/, json({ error: 'price-unavailable' }, 503));
    await setPhone(page, viewport);
    await page.goto('/sell');
    const bar = page.getByRole('navigation', { name: 'Main' });
    await expect(bar.getByRole('link')).toHaveText(['Trade', 'My trades', 'Post offer', 'Wallets', 'Profile']);
    await expectPhoneLayout(page);
    await expectAtLeast44(page, '.x2f-bottom-nav__tab');
    await bar.getByRole('link', { name: 'My trades' }).click();
    await expect(page).toHaveURL(/\/trades$/);
    await expect(rows(page)).toHaveCount(2);
  });
}

for (const viewport of PHONE_VIEWPORTS) {
  // Review m1 (design review shot 26: no tab that only leads to a refusal): a member with neither
  // trades box gets no My trades tab; one with either box gets it.
  test(`a team member's tab bar at ${viewport}: no My trades without a trades box, My trades with See trade history`, async ({ page }) => {
    const member = (abilities: string[], roles: string[]) => ({ ...ME, accountType: 'vendor', member: { name: 'Aurora', abilities, preset: null, roles } });
    let me: Record<string, unknown> = member(['offers-see', 'offers-post'], ['offers']);
    await base(page, normal, me);
    // The last route wins: /me answers whoever `me` is now.
    await page.route('**/v1/account/me', (r) => json(me)(r));
    await page.route(/\/v1\/methods\?/, json({ live: [], all: [] }));
    await page.route(/\/v1\/price\?/, json({ error: 'price-unavailable' }, 503));
    await setPhone(page, viewport);
    await page.goto('/sell');
    const bar = page.getByRole('navigation', { name: 'Main' });
    await expect(bar.getByRole('link', { name: 'Trade' })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'My trades' })).toHaveCount(0);
    await expectPhoneLayout(page);

    me = member(['trades-see-history'], []);
    await page.reload();
    await expect(bar.getByRole('link', { name: 'My trades' })).toBeVisible();
    await expect(bar.getByRole('link', { name: 'Post offer' })).toHaveCount(0);
    await expectPhoneLayout(page);
  });
}

test('a row opens its trade room; the Completed tab survives a reload', async ({ page }) => {
  await base(page, normal);
  await page.goto('/trades?tab=completed');
  await expect(page.getByRole('tab', { name: 'Completed' })).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page)).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Completed' })).toHaveAttribute('aria-selected', 'true');
  await rows(page).first().getByRole('link').click();
  await expect(page).toHaveURL(/\/trade\/T5HJ-6YVM-8WQZ-2ABC$/);
});

for (const viewport of PHONE_VIEWPORTS) {
  test(`empty tabs at ${viewport}: each says what shows there; phone layout`, async ({ page }) => {
    await base(page, () => json({ trades: [], next: null }));
    await setPhone(page, viewport);
    await page.goto('/trades');
    await expect(page.locator('[data-part="empty"]')).toContainText('No open trades');
    await expectPhoneLayout(page);
    await page.getByRole('tab', { name: 'Completed' }).click();
    await expect(page.locator('[data-part="empty"]')).toContainText('No completed trades');
    await expect(rows(page)).toHaveCount(0);
  });
}

test('a failed load says so and Try again loads it; a failed Show more keeps the rows and retries', async ({ page }) => {
  let opens = 0;
  let more = 0;
  await base(page, (status, cursor) => {
    if (cursor !== null) {
      more += 1;
      return more === 1 ? json({ error: 'internal' }, 500) : json({ trades: OPEN_2, next: null });
    }
    opens += 1;
    return opens === 1 ? json({ error: 'internal' }, 500) : normal(status, cursor);
  });
  await page.goto('/trades');
  await expect(page.locator('[data-part="error"]')).toContainText('Your trades could not be loaded.');
  await page.locator('[data-part="retry"]').click();
  await expect(rows(page)).toHaveCount(2);

  await page.locator('[data-part="more"]').click();
  await expect(page.locator('[data-part="more-error"]')).toContainText('Your trades could not be loaded.');
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator('[data-part="more"]')).toHaveText('Try again');
  await page.locator('[data-part="more"]').click();
  await expect(rows(page)).toHaveCount(3);
  await expect(page.locator('[data-part="more-error"]')).toHaveCount(0);
});

for (const viewport of PHONE_VIEWPORTS) {
  test(`a member without See active trades at ${viewport}: CantDoThat says the role, OK goes to Completed`, async ({ page }) => {
    await base(page, (status) => (status === 'open' ? json({ error: 'forbidden' }, 403) : json({ trades: DONE, next: null })));
    await setPhone(page, viewport);
    await page.goto('/trades');
    const refusal = page.locator('[data-part="cant-do-that"]');
    await expect(refusal).toHaveAttribute('data-from', 'forbidden');
    await expect(refusal).toContainText("Your team role doesn't include this. The account owner can change your roles.");
    await expect(rows(page)).toHaveCount(0);
    await expectPhoneLayout(page);
    await refusal.getByRole('button', { name: 'OK' }).click();
    await expect(page).toHaveURL(/\/trades\?tab=completed$/);
    await expect(rows(page)).toHaveCount(2);
  });
}

test('a member refused both tabs is sent to Trade, never round in circles', async ({ page }) => {
  await base(page, () => json({ error: 'forbidden' }, 403));
  await page.goto('/trades');
  await page.locator('[data-part="cant-do-that"]').getByRole('button', { name: 'OK' }).click();
  await expect(page.getByRole('tab', { name: 'Completed' })).toHaveAttribute('aria-selected', 'true');
  await page.locator('[data-part="cant-do-that"]').getByRole('button', { name: 'OK' }).click();
  await expect(page).toHaveURL(/\/sell$/);
});

// The lead's ruling after review trades-list I1: the API opens the live stream to a member with
// either trades box and carries them only the events of their parts, so the web opens it for a
// member with See trade history alone too (not only the Trades role), and their room updates live.
test('a member with See trade history only gets live updates: the stream opens and a completed trade\'s room reloads on its event', async ({ page }) => {
  const view = { ...sellerView({ state: 'released' }), closedAt: '2026-10-25T13:40:00.000Z' };
  const reads: string[] = [];
  let streams = 0;
  await page.route('**/v1/account/me', json({ ...ME, accountType: 'vendor', member: { name: 'Aurora', abilities: ['trades-see-history'], preset: null, roles: [] } }));
  await page.route(`**/v1/trades/${view.code}`, (r) => {
    reads.push(r.request().url());
    return json(view)(r);
  });
  await page.route('**/v1/events', (r) => {
    streams += 1;
    return r.fulfill({
      status: 200,
      headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' },
      // Every connection carries the trade's event; the short retry reconnects for the next one.
      body: `retry: 400\n\ndata: ${JSON.stringify({ type: 'trade', code: view.code, state: 'released' })}\n\n`,
    });
  });
  await page.goto(`/trade/${view.code}`);
  await expect.poll(() => streams, { timeout: 5000 }).toBeGreaterThan(0);
  // The room reads the trade again on its live event, well before its 15 s poll.
  await expect.poll(() => reads.length, { timeout: 5000 }).toBeGreaterThan(1);
});

test('a member with no trades box opens no live stream', async ({ page }) => {
  let streams = 0;
  await page.route('**/v1/account/me', json({ ...ME, accountType: 'vendor', member: { name: 'Aurora', abilities: ['offers-see', 'offers-post'], preset: null, roles: ['offers'] } }));
  await page.route('**/v1/events', (r) => {
    streams += 1;
    return r.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: 'forbidden' }) });
  });
  await page.route(/\/v1\/methods\?/, json({ live: [], all: [] }));
  await page.route(/\/v1\/price\?/, json({ error: 'price-unavailable' }, 503));
  await page.goto('/sell');
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(streams).toBe(0);
});
