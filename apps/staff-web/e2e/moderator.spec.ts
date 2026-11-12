// Plan 4 Task 18: the moderator pages in a real browser, checked with the parity harness against
// their boards: ModQueue at 1280x1000 and ModCase at 1280x1600, with the trade codes masked; the
// stubbed times are set to the boards' own, and the chat is not on the page at all
// (NEEDS_P4_CHAT_MEMBERSHIP). The staff API is stubbed
// with page.route in the shapes of apps/api/src/disputes/staffRoutes.ts, filled with the boards' own
// example data, so any board copy the page does not show is either listed below with its reason or
// fails the test. The case page is also checked to make no chat request.
import { expect, test, type Page, type Route } from '@playwright/test';
import { expectParity } from '../../web/e2e/parity.js';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const MIN = 60_000;
const H = 60 * MIN;
/** Half a minute of slack, so a "25 min" on the board stays 25 while the test runs. */
const at = (ms: number) => new Date(Date.now() + ms + (ms >= 0 ? 30_000 : -30_000)).toISOString();

const ME = { displayName: 'dmitri_k', role: 'mod', nav: ['disputes', 'training', 'log'], sessionEndsAt: new Date(Date.now() + 8 * H).toISOString() };

const row = (o: Record<string, unknown>) => ({
  incidentId: 'D-0000', status: 'open', round: 1, openedBy: 'buyer', rulingDueAt: at(40 * H), approval: 'not-needed', assignee: null, mine: false, ...o,
});

/** Board ModQueue's five example cases, in its order. */
const QUEUE = {
  settings: { firstResponseH: 4, largeTradeLimitUsd: 1000 },
  counts: { open: 5, overdue: 1, unassigned: 1, needApproval: 2 },
  rows: [
    row({ code: 'M3TB9HQZ6WCR1FXA', xmr: '2100000000000', usd: '693.00', method: 'Cash by mail', openedBy: 'seller', waitingMs: 4 * H + 25 * MIN, replyDueAt: at(-25 * MIN), deadlineTone: 'overdue', assignee: 'dmitri_k', mine: true }),
    row({ code: 'P9VC6KE1YB4M2HJD', xmr: '400000000000', usd: '132.00', method: 'Revolut', openedBy: 'seller', waitingMs: 3 * H + 45 * MIN, replyDueAt: at(15 * MIN), deadlineTone: 'due' }),
    row({ code: '7RWD3MXEKQ84HN2T', xmr: '4000000000000', usd: '1320.00', method: 'Zelle', waitingMs: 2 * H + 40 * MIN, replyDueAt: at(80 * MIN), deadlineTone: 'due', approval: 'needs-second', assignee: 'dmitri_k', mine: true }),
    row({ code: 'K7M29QXA4FTR8WPN', xmr: '1250000000000', usd: '412.50', method: 'Zelle', waitingMs: 3 * H + 16 * MIN, replyDueAt: at(44 * MIN), deadlineTone: 'replied', assignee: 'sarah.v' }),
    row({
      code: 'B8NE4YJW2PVK7DSG', status: 'awaiting-approval', xmr: '6500000000000', usd: '2145.00', method: 'Bank transfer (ACH)', waitingMs: 26 * H, replyDueAt: at(-22 * H),
      deadlineTone: 'replied', approval: { waitingFor: 'second-approval', proposedBy: 'sarah.v' }, assignee: 'sarah.v',
    }),
  ],
};

const trader = (name: string, trades: number, pct: number) => ({
  displayName: name, completedTrades: trades, online: false, lastSeenAt: null, typicalMinutes: null, positivePct: pct, badges: [], stage: 'graduated', tradedOverXmr: null, imported: [],
});

/** Board ModCase's example case: 7RWD-3MXE-KQ84-HN2T, assigned to the viewer, above the limit. */
const CASE = {
  code: '7RWD3MXEKQ84HN2T', incidentId: 'D-7RWD', seq: 1, status: 'open', round: 1, openedBy: 'buyer', reason: 'paid', note: '',
  afterRefund: false, openedAt: at(-(2 * H + 40 * MIN)), replyDueAt: at(80 * MIN), rulingDueAt: at(45 * H), firstReplyAt: null,
  usd: '1320.00', overLimit: true, limitUsd: 1000, assignee: 'dmitri_k', assignedToYou: true, proposedByYou: false, taken: null, mayWork: true, moderator: null,
  traders: { buyer: trader('harbor_lin', 31, 100), seller: trader('quietfox', 145, 97) },
  escrow: { state: 'escrow-secured', amountAtomic: '4000000000000', methodId: 'Zelle', currency: 'USD', centsPerXmr: '33000', fiatCents: '132000', confirmations: 10, takenAt: at(-4 * H) },
  ruling: { proposal: null, sentBack: null, draft: null, round1: null, publishedAt: null, appealEndsAt: null, appeal: null, complyBy: null },
  freezes: { buyer: false, seller: false },
};

async function stub(page: Page): Promise<string[]> {
  const calls: string[] = [];
  await page.route('**/staff/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    calls.push(`${req.method()} ${path}`);
    if (path === '/staff/v1/me') return json(ME)(route);
    if (path === '/staff/v1/disputes') return json(QUEUE)(route);
    if (path === `/staff/v1/disputes/${CASE.code}`) return json(CASE)(route);
    return json({ error: 'not-found' }, 404)(route);
  });
  return calls;
}

/** The parity failures, as the harness lists them (an empty list when it passed). */
async function parityFailures(page: Page, board: string, viewport: '1280x1000' | '1280x1600', masks: ReturnType<Page['locator']>[]): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready);
  try {
    await expectParity(page, board, { viewport, masks });
    return [];
  } catch (e) {
    return String((e as Error).message).split('\n  - ').slice(1).map((l) => l.trim());
  }
}

/**
 * ModCase copy the page does not show, each for a reason recorded in ModCase.tsx:
 * - NEEDS_P4_CHAT_MEMBERSHIP: no chat read yet, so no transcript and no "Opened by you at" header;
 * - the proof itself is not viewable yet, so its three facts are not shown, and the request names
 *   the trader asked (the API asks for a side; the board has one button for the uploader);
 * - the board's trader lines past trades and positive share are not in the case answer;
 * - the escrow's "Secured · 10 of 10": the case answer has the confirmations, not the target.
 */
const KNOWN_CASE = [
  // The chat (NEEDS_P4_CHAT_MEMBERSHIP): its header, both sections and every line.
  /^board copy missing: "Opened by you at \d\d:\d\d · logged"$/,
  /^board copy missing: "Before the trade"$/,
  /^board copy missing: "Trade"$/,
  /^board copy missing: "(harbor_lin|quietfox) · (buyer|seller) · \d\d:\d\d"$/,
  /^board copy missing: "\d\d:\d\d · .*"$/,
  /^board copy missing: "(Hi, is the 4 XMR|Yes\. Please pay|Will do\.|Nothing in my Zelle|Yes, the screenshot).*"$/,
  // The proof itself (not viewable yet); its request names the trader (the API asks for a side).
  /^board copy missing: "(Shows \$1,320\.00, the right amount|Note says .*|Sender name blurred by harbor_lin)"$/,
  /^board copy missing: "Request unblurred proof"$/,
  // Trader lines not in the case answer.
  /^board copy missing: "(0 disputes · joined Mar 2026|2 disputes, 1 lost · joined Nov 2025|Cancel rate \d%|Last ratings: .*)"$/,
  // The escrow's state in words (the case answer has the state and confirmations, not the target).
  /^board copy missing: "Secured · 10 of 10"$/,
];

test('ModQueue parity at 1280x1000, the codes masked (the stubbed times are the board\'s own)', async ({ page }) => {
  await stub(page);
  await page.goto('/disputes');
  await expect(page.locator('[data-screen="mod-queue"]')).toBeVisible();
  await expect(page.locator('table[aria-label="Disputes"] tbody tr')).toHaveCount(5);
  expect(await parityFailures(page, 'ModQueue', '1280x1000', [page.locator('[data-part="queue-code"]')])).toEqual([]);
});

test('ModCase parity at 1280x1600, the code masked; no chat is fetched', async ({ page }) => {
  const calls = await stub(page);
  await page.goto(`/disputes/${CASE.code}`);
  await expect(page.locator('[data-screen="mod-case"]')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open the full chat' })).toBeDisabled();
  const failures = await parityFailures(page, 'ModCase', '1280x1600', [page.locator('h1')]);
  expect(failures.filter((f) => !KNOWN_CASE.some((k) => k.test(f)))).toEqual([]);
  // Every known difference still occurs: one that no longer does is stale and must go.
  expect(KNOWN_CASE.filter((k) => !failures.some((f) => k.test(f))).map(String)).toEqual([]);
  expect(calls.filter((c) => /\/chat\b/.test(c))).toEqual([]);
});
