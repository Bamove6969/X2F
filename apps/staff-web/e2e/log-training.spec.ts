// Plan 4 Task 19: the Activity log page in a real browser, checked with the parity harness against
// board StaffLog at 1280x900 (codes and times masked), and the training library (no board, A8).
// The staff API is stubbed with page.route in the shapes of apps/api/src/staff/activityLog.ts and
// training.ts, filled with the board's own example entries. Board copy the page does not show is
// listed below with its reason, or fails the test.
import { expect, test, type Page, type Route } from '@playwright/test';
import { expectParity } from '../../web/e2e/parity.js';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const H = 3_600_000;
const NAV = ['overview', 'disputes', 'staff', 'performance', 'training', 'log', 'settings'];
const OWNER = { displayName: 'lumen.k', role: 'owner', nav: NAV, sessionEndsAt: new Date(Date.now() + 8 * H).toISOString() };
const MOD = { displayName: 'dmitri_k', role: 'mod', nav: ['disputes', 'training', 'log'], sessionEndsAt: OWNER.sessionEndsAt };

const A = '3HW8ZD2NRT6KQ9VB';
const B = 'K7M29QXA4FTR8WPN';
const C = 'P9VC6KE1YB4M2HJD';
const DMITRI = '11111111-1111-4111-8111-111111111111';
const today = (h: number, m: number) => {
  const d = new Date();
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const staff = (id: string, name: string, role: string) => ({ kind: 'staff', role, id, name });
const trader = (name: string, side: string) => ({ kind: 'trader', role: side, id: null, name });
const SYSTEM = { kind: 'system', role: null, id: null, name: null };

/** Board StaffLog's example entries, as the API would send them (the board's order, newest first). */
const ENTRIES = [
  { id: '12', at: today(9, 50), tradeCode: C, actor: SYSTEM, action: 'dispute.opened', detail: { reason: 'paid', afterRefund: false, seq: 1 } },
  { id: '11', at: today(9, 44), tradeCode: C, actor: trader('nightjar', 'buyer'), action: 'trade.mark-paid', detail: {} },
  { id: '10', at: today(9, 31), tradeCode: A, actor: staff(DMITRI, 'dmitri_k', 'mod'), action: 'ruling.proposed', detail: { rulingId: 'r1', round: 1, outcome: 'release-to-buyer', accountAction: 'none', amountAtomic: '1800000000000' } },
  { id: '9', at: today(9, 20), tradeCode: B, actor: trader('mira.k', 'buyer'), action: 'trade.mark-paid', detail: {} },
  { id: '8', at: today(9, 12), tradeCode: A, actor: staff(DMITRI, 'dmitri_k', 'mod'), action: 'chat.read', detail: {} },
  { id: '7', at: today(8, 55), tradeCode: A, actor: staff(DMITRI, 'dmitri_k', 'mod'), action: 'proof.unblurred-requested', detail: { side: 'buyer' } },
  { id: '6', at: today(8, 47), tradeCode: B, actor: SYSTEM, action: 'trade.chain', detail: { receivedAtomic: '1250000000000', unlockedAtomic: '1250000000000', confirmations: 10 } },
  { id: '5', at: today(8, 40), tradeCode: A, actor: SYSTEM, action: 'dispute.opened', detail: { reason: 'paid', afterRefund: false, seq: 1 } },
];
const ACTIVE = [
  { code: A, method: 'ZELLE', methodName: 'Zelle', xmr: '1800000000000', status: 'awaiting-approval' },
  { code: C, method: 'REVOLUT', methodName: 'Revolut', xmr: '400000000000', status: 'open' },
];

async function stub(page: Page, me: unknown): Promise<string[]> {
  const calls: string[] = [];
  await page.route('**/staff/v1/**', async (route) => {
    const u = new URL(route.request().url());
    calls.push(`${u.pathname}${u.search}`);
    if (u.pathname === '/staff/v1/me') return json(me)(route);
    if (u.pathname === '/staff/v1/log') {
      const code = u.searchParams.get('code');
      const entries = code ? ENTRIES.filter((e) => e.tradeCode.replace(/(.{4})(?=.)/g, '$1-') === code) : ENTRIES;
      return json({ scope: 'all', entries, names: { [DMITRI]: 'dmitri_k' }, next: null })(route);
    }
    if (u.pathname === '/staff/v1/log/filters') return json({ scope: 'all', actors: [{ id: DMITRI, name: 'dmitri_k', role: 'mod' }], kinds: ['trade', 'dispute', 'chat', 'ruling', 'account', 'other'] })(route);
    if (u.pathname === '/staff/v1/log/active-disputes') return json({ items: ACTIVE })(route);
    if (u.pathname === '/staff/v1/log/integrity') return json({ checkedAt: new Date().toISOString(), chain: { ok: true, headId: '12' }, entries: 12, alarm: null })(route);
    if (u.pathname === '/staff/v1/training') return json({ items: [TRAINING_ITEM], next: null })(route);
    if (u.pathname === `/staff/v1/training/${TRAINING_ITEM.id}`) return json(TRAINING_CASE)(route);
    return json({ error: 'not-found' }, 404)(route);
  });
  return calls;
}

const TRAINING_ITEM = { id: 'b'.repeat(32), closedOn: '2026-11-13', method: 'REVOLUT', methodName: 'Revolut', xmr: '400000000000', outcome: 'refund-to-seller', overturned: false, afterRefund: false };
const TRAINING_CASE = {
  ...TRAINING_ITEM, tradeCode: 'XXXX-XXXX-XXXX-XXXX', openedBy: 'seller', reason: 'paid', closedAt: 'T+52:00', chat: 'not-available', appeal: null,
  note: { text: 'Nothing arrived at [account].', masks: [{ start: 19, end: 28, kind: 'account' }] },
  rulings: [{ round: 1, outcome: 'refund-to-seller', at: 'T+3:00', reason: { text: 'Buyer sent no payment; Seller showed the statement for [account].', masks: [{ start: 55, end: 64, kind: 'account' }] }, evidence: [] }],
  timeline: [{ at: 'T+0:00', who: 'Seller', action: 'dispute.opened' }, { at: 'T+0:42', who: 'Moderator', action: 'case.opened' }],
};

/**
 * StaffLog copy the page does not show, each for a reason:
 * - "Entries are examples." closes the board's footnote; the page's entries are real.
 * - "Show everything" shows only while a filter is set (as on the board, whose preview has none set
 *   but whose text check reads the hidden button too).
 */
const KNOWN = [
  /^board copy missing: "Every trade gets a random 16-character code .* Entries are examples\."$/,
  /^board copy missing: "Show everything"$/,
];

async function parityFailures(page: Page, masks: ReturnType<Page['locator']>[]): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready);
  try {
    await expectParity(page, 'StaffLog', { viewport: '1280x900', masks, primary: false });
    return [];
  } catch (e) {
    return String((e as Error).message).split('\n  - ').slice(1).map((l) => l.trim());
  }
}

test('StaffLog parity at 1280x900, codes and times masked; the board\'s example sentences', async ({ page }) => {
  await stub(page, OWNER);
  await page.goto('/log');
  await expect(page.locator('[data-screen="staff-log"]')).toBeVisible();
  await expect(page.locator('table[aria-label="Activity log"] tbody tr')).toHaveCount(ENTRIES.length);
  const what = await page.locator('table[aria-label="Activity log"] tbody tr td:nth-child(4)').allTextContents();
  // The board's own sentences, where the entry alone says them.
  expect(what).toContain("Tapped I've paid");
  expect(what).toContain('Opened the trade chat');
  expect(what).toContain('Escrow secured after 10 confirmations');
  expect(what).toContain('Proposed a ruling: release 1.80 XMR to the buyer');
  const failures = await parityFailures(page, [page.locator('[data-part="log-code"]'), page.locator('.x2f-staff-log__when'), page.locator('[data-part="integrity"]')]);
  expect(failures.filter((f) => !KNOWN.some((k) => k.test(f)))).toEqual([]);
});

test('searching by a code typed without dashes asks the API for that trade and says the board\'s summary', async ({ page }) => {
  const calls = await stub(page, OWNER);
  await page.goto('/log');
  await page.getByLabel('Trade code').fill('k7m29qxa4ftr8wpn');
  await expect(page.locator('[data-part="summary"]')).toHaveText('2 entries for trade K7M29QXA4FTR8WPN, newest first.');
  expect(calls).toContain('/staff/v1/log?code=K7M2-9QXA-4FTR-8WPN');
  await page.getByRole('button', { name: 'Show everything' }).click();
  await expect(page.locator('[data-part="summary"]')).toHaveText('Showing everything, newest first.');
  // The Active disputes list fills the code field.
  await page.getByLabel('Active disputes').selectOption(A);
  await expect(page.getByLabel('Trade code')).toHaveValue('3HW8-ZD2N-RT6K-Q9VB');
  await expect(page.locator('[data-part="summary"]')).toHaveText('3 entries for trade 3HW8-ZD2N-RT6K-Q9VB, newest first.');
});

test('a moderator never asks for the chain check; the training library lists and opens a scrubbed case', async ({ page }) => {
  const calls = await stub(page, MOD);
  await page.goto('/log');
  await expect(page.locator('[data-screen="staff-log"]')).toBeVisible();
  await expect(page.locator('table[aria-label="Activity log"] tbody tr')).toHaveCount(ENTRIES.length);
  expect(calls.filter((c) => c.startsWith('/staff/v1/log/integrity'))).toEqual([]);
  await expect(page.locator('[data-part="integrity"]')).toHaveCount(0);

  await page.getByRole('link', { name: 'Training library' }).click();
  await expect(page.locator('[data-screen="training"]')).toBeVisible();
  await page.getByRole('link', { name: 'Read the case' }).click();
  await expect(page.locator('[data-screen="training-case"]')).toBeVisible();
  await expect(page.locator('mark[data-mask="account"]')).toHaveCount(2);
  await expect(page.locator('[data-part="no-chat"]')).toBeVisible();
  const scroll = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
  expect(scroll.wide).toBeLessThanOrEqual(scroll.view);
});
