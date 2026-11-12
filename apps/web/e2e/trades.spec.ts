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

const ME = { displayName: 'nightowl_44', kind: 'trader', level: 'full', termsCurrent: true };
const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

type Row = Record<string, unknown>;
const row = (code: string, over: Row = {}): Row => ({
  code, role: 'buyer', state: 'secured', amountAtomic: '1250000000000', fiatCents: '41250', currency: 'USD',
  counterparty: { displayName: 'Calcium' }, takenAt: '2026-11-10T09:00:00.000Z', closedAt: null, ...over,
});

const OPEN_1 = [row('K7Q2-9XPA'), row('M3RT-4WZB', { role: 'seller', state: 'paid', amountAtomic: '500000000000', fiatCents: '15000', currency: 'EUR', counterparty: { displayName: 'aurora_9' } })];
const OPEN_2 = [row('P8LD-2NCE', { state: 'funding', counterparty: { displayName: 'quietfox' } })];
const DONE = [
  row('T5HJ-6YVM', { state: 'released', closedAt: '2026-11-08T12:15:00.000Z' }),
  row('W2KS-8QFN', { role: 'seller', state: 'refunded', closedAt: '2026-11-07T10:00:00.000Z' }),
];

type Answer = (status: string, cursor: string | null) => (r: Route) => Promise<void>;

/** Signed in, with GET /v1/trades answered by `answer`; returns each request's status and cursor. */
async function base(page: Page, answer: Answer): Promise<string[]> {
  const asked: string[] = [];
  await page.route('**/v1/account/me', json(ME));
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
    await expect(first).toContainText('K7Q2-9XPA');
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

test('a row opens its trade room; the Completed tab survives a reload', async ({ page }) => {
  await base(page, normal);
  await page.goto('/trades?tab=completed');
  await expect(page.getByRole('tab', { name: 'Completed' })).toHaveAttribute('aria-selected', 'true');
  await expect(rows(page)).toHaveCount(2);
  await page.reload();
  await expect(page.getByRole('tab', { name: 'Completed' })).toHaveAttribute('aria-selected', 'true');
  await rows(page).first().getByRole('link').click();
  await expect(page).toHaveURL(/\/trade\/T5HJ-6YVM$/);
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
