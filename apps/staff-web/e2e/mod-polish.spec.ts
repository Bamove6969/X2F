// Mod polish in a real browser, under STAFF_CSP: the approver's "Send back" with its required note,
// the queue's status and age filters, count badge and oldest-waiting timer, the Overview's Today
// card, the Activity log's on-demand chain check (review m7: nothing re-hashed on load) and its
// paged Active disputes list, and the training curator's paged list (re-review m3). The staff API is
// stubbed with page.route in the shapes of apps/api/src/disputes/{staffRoutes,rulings}.ts and
// apps/api/src/staff/{activityLog,training,site,ownerAlerts}.ts; their own tests cover the server.
import { expect, test, type Page, type Route } from '@playwright/test';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const MIN = 60_000;
const H = 60 * MIN;
const at = (ms: number) => new Date(Date.now() + ms).toISOString();
const ends = at(8 * H);
const OWNER = { displayName: 'lumen.k', role: 'owner', nav: ['overview', 'disputes', 'staff', 'performance', 'training', 'log', 'settings'], sessionEndsAt: ends };
const SENIOR = { displayName: 'sarah.v', role: 'senior', nav: ['disputes', 'training', 'log'], sessionEndsAt: ends };
const MOD = { displayName: 'dmitri_k', role: 'mod', nav: ['disputes', 'training', 'log'], sessionEndsAt: ends };

const CODE = '7RWD3MXEKQ84HN2T';
const REASON = 'The bank statement shows the Zelle payment arrived on time and in full.';

const row = (o: Record<string, unknown>) => ({
  incidentId: 'D-0000', status: 'open', round: 1, xmr: '1250000000000', usd: '412.50', method: 'ZELLE', methodName: 'Zelle', openedBy: 'buyer',
  rulingDueAt: at(40 * H), approval: 'not-needed', assignee: null, mine: false, ...o,
});
const QUEUE = {
  settings: { firstResponseH: 4, largeTradeLimitUsd: 1000 },
  counts: { open: 4, overdue: 1, unassigned: 2, needApproval: 1 },
  rows: [
    row({ code: 'M3TB9HQZ6WCR1FXA', waitingMs: 5 * H, replyDueAt: at(-H), deadlineTone: 'overdue' }),
    row({ code: 'P9VC6KE1YB4M2HJD', waitingMs: 2 * H, replyDueAt: at(2 * H), deadlineTone: 'due' }),
    row({ code: 'K7M29QXA4FTR8WPN', waitingMs: 30 * MIN, replyDueAt: at(3 * H), deadlineTone: 'replied', assignee: 'sarah.v' }),
    row({ code: 'A9PE4YJW2PVK7DSZ', status: 'appealed', round: 2, waitingMs: 26 * H, replyDueAt: at(-22 * H), deadlineTone: 'replied' }),
  ],
};

const trader = (name: string) => ({ displayName: name, completedTrades: 30, online: false, lastSeenAt: null, typicalMinutes: null, positivePct: 100, badges: [], stage: 'graduated', tradedOverXmr: null, imported: [] });
const WAITING = {
  code: CODE, incidentId: 'D-7RWD', seq: 1, status: 'awaiting-approval', round: 1, openedBy: 'buyer', reason: 'paid', note: '', afterRefund: false,
  openedAt: at(-2 * H), replyDueAt: at(2 * H), rulingDueAt: at(46 * H), firstReplyAt: at(-H), usd: '1320.00', overLimit: true, limitUsd: 1000,
  assignee: 'dmitri_k', assignedToYou: false, proposedByYou: false, taken: null, mayWork: true, moderator: null,
  traders: { buyer: trader('harbor_lin'), seller: trader('quietfox') },
  escrow: { state: 'escrow-secured', amountAtomic: '4000000000000', methodId: 'ZELLE', methodName: 'Zelle', currency: 'USD', centsPerXmr: '33000', fiatCents: '132000', confirmations: 10, takenAt: at(-3 * H) },
  ruling: {
    proposal: { rulingId: 'r1', reason: REASON, evidence: ['Bank statement'], proposer: 'p', proposedAt: at(-30 * MIN) }, sentBack: null,
    draft: { id: 'r1', outcome: 'refund-to-seller' }, round1: null, publishedAt: null, appealEndsAt: null, appeal: null, complyBy: null,
  },
  freezes: { buyer: false, seller: false },
};

type Handler = (u: URL, method: string, body: unknown) => unknown;

/** Stubs the staff API from `routes` ("METHOD /path"); records every call; anything else is a 404. */
async function stub(page: Page, me: unknown, routes: Record<string, Handler | object>): Promise<string[]> {
  const calls: string[] = [];
  await page.route('**/staff/v1/**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const key = `${req.method()} ${u.pathname}`;
    calls.push(`${key}${u.search}`);
    if (key === 'GET /staff/v1/me') return json(me)(route);
    const h = routes[key];
    if (h === undefined) return json({ error: 'not-found' }, 404)(route);
    return json(typeof h === 'function' ? (h as Handler)(u, req.method(), req.postDataJSON()) : h)(route);
  });
  return calls;
}

/** Fails the test on any CSP violation or page error. */
function watchConsole(page: Page): string[] {
  const out: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' && /content security policy|refused to/i.test(m.text())) out.push(m.text());
  });
  page.on('pageerror', (e) => out.push(String(e)));
  return out;
}

test('a senior sends a proposed ruling back with a required note; the proposer sees the note', async ({ page }) => {
  const problems = watchConsole(page);
  let state: Record<string, unknown> = WAITING;
  let sent: unknown = null;
  const calls = await stub(page, SENIOR, {
    [`GET /staff/v1/disputes/${CODE}`]: () => state,
    [`POST /staff/v1/disputes/${CODE}/rulings/r1/send-back`]: (_u: URL, _m: string, body: unknown) => {
      sent = body;
      state = { ...WAITING, status: 'open', ruling: { ...WAITING.ruling, proposal: null, draft: null, sentBack: { rulingId: 'r1', note: (body as { note: string }).note, at: at(0) } } };
      return { code: CODE, ruling: (state as typeof WAITING).ruling };
    },
  });
  await page.goto(`/disputes/${CODE}`);
  const panel = page.locator('[data-part="approve"]');
  await expect(panel).toContainText(REASON);
  await panel.getByRole('button', { name: 'Send back', exact: true }).click();
  const send = page.getByRole('button', { name: 'Send back to the moderator' });
  await expect(send).toBeDisabled();
  await page.getByLabel('Note for the moderator').fill('   ');
  await expect(send).toBeDisabled();
  await page.getByRole('button', { name: 'Keep the proposal' }).click();
  await expect(page.locator('[data-part="send-back-form"]')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Send back', exact: true }).click();
  await page.getByLabel('Note for the moderator').fill('Ask the buyer for the bank reference first.');
  await send.click();
  await expect(page.locator('[data-part="approve"]')).toHaveCount(0);
  expect(sent).toEqual({ note: 'Ask the buyer for the bank reference first.' });
  expect(calls.filter((c) => c.includes('/approve'))).toEqual([]);
  expect(problems).toEqual([]);
});

test('a moderator, and the senior who proposed it, are offered no Send back', async ({ page }) => {
  await stub(page, MOD, { [`GET /staff/v1/disputes/${CODE}`]: WAITING });
  await page.goto(`/disputes/${CODE}`);
  await expect(page.locator('[data-part="ruling-waiting"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send back', exact: true })).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await stub(page, SENIOR, { [`GET /staff/v1/disputes/${CODE}`]: { ...WAITING, proposedByYou: true } });
  await page.goto(`/disputes/${CODE}`);
  await expect(page.locator('[data-part="ruling-waiting"]')).toContainText('Waiting for approval from a senior moderator or the owner.');
  await expect(page.getByRole('button', { name: 'Send back', exact: true })).toHaveCount(0);
});

test('the queue filters by status and age, counts what it shows and names the oldest wait for a first reply', async ({ page }) => {
  const problems = watchConsole(page);
  await stub(page, SENIOR, { 'GET /staff/v1/disputes': QUEUE });
  await page.goto('/disputes');
  const codes = page.locator('[data-part="queue-code"]');
  await expect(codes).toHaveCount(4);
  await expect(page.locator('[data-part="queue-badge"]')).toHaveText('4 of 4');
  await expect(page.locator('[data-part="queue-oldest"]')).toContainText('Oldest waiting for a first reply: M3TB-9HQZ-6WCR-1FXA, waiting 5 h. Overdue by 1 h.');
  await expect(page.locator('[data-part="queue-oldest"]')).toHaveAttribute('data-tone', 'overdue');
  await page.locator('[data-part="queue-status"]').selectOption('appealed');
  await expect(codes).toHaveText(['A9PE-4YJW-2PVK-7DSZ']);
  await expect(page.locator('[data-part="queue-badge"]')).toHaveText('1 of 4');
  await page.locator('[data-part="queue-status"]').selectOption('');
  await page.locator('[data-part="queue-age"]').selectOption('reply');
  await expect(codes).toHaveText(['M3TB-9HQZ-6WCR-1FXA', 'A9PE-4YJW-2PVK-7DSZ']);
  await expect(page.getByRole('button', { name: 'Unassigned (2)' })).toBeVisible();
  await page.locator('[data-part="queue-oldest-code"]').click();
  await expect(page).toHaveURL(/\/disputes\/M3TB9HQZ6WCR1FXA$/);
  expect(problems).toEqual([]);
});

test('the Overview\'s Today card reads the queue and the alerts, and links to them', async ({ page }) => {
  const problems = watchConsole(page);
  const calls = await stub(page, OWNER, {
    'GET /staff/v1/site': { tradingPaused: false, stoppedAt: null, banner: null, maintenance: null, planned: null, logAlarm: null },
    'GET /staff/v1/revenue': { by: 'month', from: '2017-01-01', to: '2026-11-26', buckets: [], total: { period: 'all', trades: 0, totalAtomic: '0', usdEstimateCents: '0' } },
    'GET /staff/v1/disputes': QUEUE,
    'GET /staff/v1/owner/alerts': { items: [], unread: 2, next: null },
  });
  await page.goto('/overview');
  const today = page.locator('[data-part="today"]');
  await expect(today.locator('[data-part="today-open"]')).toHaveText('4Open disputes');
  await expect(today.locator('[data-part="today-appeals"]')).toHaveText('1Appeals waiting');
  await expect(today.locator('[data-part="today-alerts"]')).toHaveText('2New alerts');
  await expect(page.locator('[data-screen="staff-overview"] [data-primary]')).toHaveCount(1);
  expect(calls.filter((c) => !c.startsWith('GET '))).toEqual([]);
  await today.getByRole('link', { name: 'Appeals waiting' }).click();
  await expect(page.locator('[data-screen="mod-queue"]')).toBeVisible();
  expect(problems).toEqual([]);
});

test('the Activity log re-hashes nothing on load; Check integrity runs the check; Active disputes pages', async ({ page }) => {
  const problems = watchConsole(page);
  const item = (code: string) => ({ code, method: 'ZELLE', methodName: 'Zelle', xmr: '1250000000000', status: 'open' });
  const calls = await stub(page, OWNER, {
    'GET /staff/v1/log': { scope: 'all', entries: [], names: {}, next: null },
    'GET /staff/v1/log/filters': { scope: 'all', actors: [], kinds: ['trade'] },
    'GET /staff/v1/log/active-disputes': (u: URL) =>
      u.searchParams.get('before') === 'M3TB-9HQZ-6WCR-1FXA' ? { items: [item('P9VC-6KE1-YB4M-2HJD')], next: null } : { items: [item('M3TB-9HQZ-6WCR-1FXA')], next: 'M3TB-9HQZ-6WCR-1FXA' },
    'GET /staff/v1/log/integrity': { entries: 1200, headId: '1200', alarm: null },
    'POST /staff/v1/log/integrity/check': { checkedAt: at(0), chain: { ok: false, brokenAt: '17' }, entries: 1200, alarm: null },
  });
  await page.goto('/log');
  const integrity = page.locator('[data-part="integrity"]');
  await expect(integrity).toContainText('Not checked on this visit. A check re-reads all 1200 entries');
  expect(calls.filter((c) => c.includes('/integrity/check'))).toEqual([]);
  await integrity.getByRole('button', { name: 'Check integrity' }).click();
  await expect(integrity).toContainText('Chain check failed at entry 17: an entry was changed or removed.');
  expect(calls.filter((c) => c.includes('/integrity/check'))).toEqual(['POST /staff/v1/log/integrity/check']);
  const active = page.getByLabel('Active disputes');
  await expect(active.locator('option')).toHaveText(['Active disputes (1+)', /M3TB-9HQZ-6WCR-1FXA/, 'Show more active disputes']);
  await active.selectOption({ label: 'Show more active disputes' });
  await expect(active.locator('option')).toHaveText(['Active disputes (2)', /M3TB-9HQZ-6WCR-1FXA/, /P9VC-6KE1-YB4M-2HJD/]);
  expect(problems).toEqual([]);
});

test('the training curator\'s list pages with Show older cases', async ({ page }) => {
  const item = (id: string, status: string) => ({ id, closedMonth: '2026-11', method: 'REVOLUT', methodName: 'Revolut', xmr: '400000000000', outcome: 'refund-to-seller', overturned: false, afterRefund: false, status });
  const A = 'a'.repeat(32);
  const B = 'b'.repeat(32);
  await stub(page, OWNER, {
    'GET /staff/v1/training/review': (u: URL) => (u.searchParams.get('before') === A ? { items: [item(B, 'marked')], next: null } : { items: [item(A, 'unmarked')], next: A }),
  });
  await page.goto('/training/review');
  const rows = page.locator('table[aria-label="Closed cases"] tbody tr');
  await expect(rows).toHaveCount(1);
  await page.getByRole('button', { name: 'Show older cases' }).click();
  await expect(rows).toHaveCount(2);
  await expect(rows.nth(1)).toContainText('In the library');
  await expect(page.getByRole('button', { name: 'Show older cases' })).toHaveCount(0);
});
