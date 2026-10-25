// Trader-side disputes (Plan 3 Task 27; boards DisputeOpen, DisputeRoom, DisputeRuling). The API is
// stubbed per test with page.route, in the shapes of apps/api/src/trades/view.ts (TradeView) and
// apps/api/src/disputes/routes.ts (the dispute view). Times are the boards' (Thursday 15 October
// 2026, shown in UTC). Display names only: the counterparty and the moderator are the names the
// API sends, which are public display names.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page, type Request, type Route } from '@playwright/test';

test.use({ timezoneId: 'UTC' });

const HARNESS = fileURLToPath(new URL('./parity.ts', import.meta.url));
const CODE = 'K7M2-9QXA-4FTR-8WPN';
const T = (hhmm: string, day = 15) => `2026-10-${day}T${hhmm}:00.000Z`;

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

function tradeView(o: Partial<Record<string, unknown>> & { role?: 'buyer' | 'seller' } = {}) {
  const role = o.role ?? 'buyer';
  return {
    code: CODE,
    role,
    poster: 'seller',
    state: 'paid',
    counterparty: { username: role === 'buyer' ? 'satoshi_ghost' : 'mira.k', completedTrades: 12, online: true, lastSeenAt: null, typicalMinutes: null, positivePct: null, badges: [] },
    methodId: 'ZELLE',
    profile: { id: 'ZELLE', whatItIs: 'Zelle: a US bank-to-bank instant transfer built into most US banking apps.' },
    amountAtomic: '1250000000000',
    fiatCents: '41250',
    lockedRate: { currency: 'USD', centsPerXmr: '33000' },
    maxFiatCents: '100000',
    grown: null,
    receivedAtomic: '1262500000000',
    confirmations: 12,
    releasable: true,
    releasableEtaMin: null,
    funding: null,
    extensions: 0,
    cancelProposedBy: null,
    settling: null,
    dispute: null,
    txHash: null,
    takenAt: T('07:30'),
    setupBy: null,
    fundBy: null,
    fundingSeenAt: T('07:40'),
    securedAt: T('08:00'),
    payBy: T('09:30'),
    paidAt: T('08:02'),
    confirmBy: T('10:02'),
    finalAlertAt: null,
    settleBy: null,
    pausedAt: null,
    closedAt: null,
    nextDeadline: null,
    serverNow: T('10:14'),
    ...o,
  };
}

const disputed = (role: 'buyer' | 'seller' = 'buyer', now = T('11:00')) =>
  tradeView({ role, state: 'disputed', dispute: { by: 'buyer', at: T('10:14') }, serverNow: now });

function disputeView(o: Record<string, unknown> = {}) {
  return {
    openedBy: 'buyer',
    reason: 'paid',
    openedAt: T('10:14'),
    afterRefund: false,
    dueAt: T('10:14', 16),
    status: 'open',
    moderator: { name: 'sarah.v', joinedAt: T('10:52') },
    ruling: null,
    appeal: null,
    serverNow: T('11:00'),
    ...o,
  };
}

const RULING = {
  round: 1,
  outcome: 'release-to-buyer',
  reason:
    "satoshi_ghost's Zelle activity shows $412.50 received today at 10:02 with this trade's code in the note. The unblurred proof from mira.k shows the same payment, sent from an account in mira.k's name.",
  evidence: ["mira.k's Zelle screenshot, blurred and unblurred", "satoshi_ghost's Zelle activity screenshot", 'The trade chat, 09:40 to 13:55'],
  moderatorName: 'sarah.v',
  ruledAt: T('14:30'),
  appealUntil: T('14:30', 17),
  destination: { walletApp: 'cake', addressEnd: 'a9k3Fz' },
};

interface Stubs {
  trade: unknown;
  dispute?: unknown;
  /** What POST /dispute and POST /appeal answer. */
  post?: { status: number; body: unknown };
}

async function stub(page: Page, s: Stubs): Promise<Request[]> {
  const posts: Request[] = [];
  await page.route('**/v1/account/me', json({ displayName: 'mira.k', kind: 'trader', level: 'full', termsCurrent: true }));
  await page.route(/\/v1\/methods\?/, json({ live: [], all: [{ id: 'ZELLE', name: 'Zelle', group: 'Payment apps', giftCard: false, offers: 3, bestRate: null }] }));
  await page.route(`**/v1/trades/${CODE}`, json(s.trade));
  await page.route(new RegExp(`/v1/trades/${CODE}/(dispute|appeal)$`), (r) => {
    if (r.request().method() === 'POST') {
      posts.push(r.request());
      const a = s.post ?? { status: 200, body: s.dispute };
      return json(a.body, a.status)(r);
    }
    return s.dispute === undefined ? json({ error: 'not-found' }, 404)(r) : json(s.dispute)(r);
  });
  return posts;
}

const open = (page: Page, query = '') => page.goto(`/trade/${CODE}/dispute${query}`);

// --- Parity -------------------------------------------------------------------------------------

type Harness = {
  boardTexts(page: Page, board: string): Promise<string[]>;
  missingTexts(page: Page, texts: string[], masks?: Locator[]): Promise<string[]>;
  reportPixels(page: Page, board: string, viewport: `${number}x${number}`, masks: Locator[], refsDir: string): Promise<string>;
  BOARDS_DIR: string;
};

/**
 * Task 15's expectParity at 390x844, with this task's board texts that other tasks still have to
 * supply set aside (each with why) and the board's own primary count. Blocking: the primaries, no
 * horizontal scroll, no text-transform on [data-username], every other board text present.
 */
async function parity(page: Page, board: string, o: { masks?: Locator[]; deferred?: { text: string; why: string }[]; primaries: 0 | 1 }) {
  const why = !existsSync(HARNESS) ? 'Task 15 parity harness (apps/web/e2e/parity.ts) is not on this branch yet' : null;
  test.skip(why !== null, why ?? '');
  const path = './parity.js';
  const h = (await import(path)) as Harness;
  await page.setViewportSize({ width: 390, height: 844 });
  const failures: string[] = [];
  const primaries = await page.locator('[data-primary]:visible').count();
  if (primaries !== o.primaries) failures.push(`${o.primaries} [data-primary] expected, found ${primaries}`);
  const scroll = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (scroll > 0) failures.push('horizontal scroll');
  const t = await page.locator('[data-username]').evaluateAll((els) => els.filter((e) => getComputedStyle(e).textTransform !== 'none').length);
  if (t > 0) failures.push('text-transform on a username');
  const skip = new Set((o.deferred ?? []).map((d) => d.text));
  const texts = (await h.boardTexts(page, board)).filter((x) => !skip.has(x));
  for (const m of await h.missingTexts(page, texts, o.masks ?? [])) failures.push(`board copy missing: "${m}"`);
  await h.reportPixels(page, board, '390x844', o.masks ?? [], `${h.BOARDS_DIR}refs`);
  expect(failures, `parity with ${board}`).toEqual([]);
}

const PLAN5_EVIDENCE = 'Plan 5 (proof pipeline) and Task 23 (proof slot): the proof already in the trade';
const TASK20_CHAT = 'Task 20 (ChatPanel): chat messages';
const GENDER = 'The board says "She"; the app cannot know a moderator\'s gender and says "They" (lead/owner question)';

test('parity with DisputeOpen at 390x844', async ({ page }) => {
  await stub(page, { trade: tradeView() });
  await open(page);
  await page.getByLabel('Tell the moderator what happened').fill(
    'I sent $412.50 by Zelle at 10:02 from my own account, with the trade code in the memo. satoshi_ghost said they would check tonight and has not replied since.',
  );
  await parity(page, 'DisputeOpen', {
    primaries: 1,
    deferred: [
      { text: 'Zelle screenshot', why: PLAN5_EVIDENCE },
      { text: 'Already in this trade, blurred', why: PLAN5_EVIDENCE },
      { text: 'Included', why: PLAN5_EVIDENCE },
    ],
  });
});

test('parity with DisputeRoom at 390x844', async ({ page }) => {
  await stub(page, { trade: disputed(), dispute: disputeView() });
  await open(page);
  await expect(page.getByText('In dispute', { exact: true })).toBeVisible();
  await parity(page, 'DisputeRoom', {
    // The board's one orange action is the unblurred-proof request (Plan 5).
    primaries: 0,
    deferred: [
      { text: 'Your Zelle screenshot', why: PLAN5_EVIDENCE },
      { text: 'She can read this whole chat, including messages from before the trade. Moderators only ever contact you here.', why: GENDER },
      { text: 'Message', why: 'Task 20 (ChatPanel): the composer and its label' },
      { text: 'satoshi_ghost · 10:20', why: TASK20_CHAT },
      { text: "Nothing from Zelle on my side yet. I'll check again tonight.", why: TASK20_CHAT },
      { text: 'X2F Moderator', why: TASK20_CHAT },
      { text: 'sarah.v · 10:53', why: TASK20_CHAT },
      {
        text: "Hi both. I've read the chat and seen the proof. mira.k, please send me the unblurred screenshot so I can check the sender name. satoshi_ghost, please look in your Zelle activity for $412.50 today with the note K7M2-9QXA-4FTR-8WPN.",
        why: TASK20_CHAT,
      },
      { text: "sarah.v asked you for the unblurred proof. Only she will see it. satoshi_ghost won't.", why: 'Plan 5 (SendUnblurred) with Plan 4\'s proof request' },
      { text: 'Send unblurred proof to sarah.v', why: 'Plan 5 (SendUnblurred) with Plan 4\'s proof request' },
    ],
  });
});

test('parity with DisputeRuling at 390x844', async ({ page }) => {
  await stub(page, { trade: disputed('buyer', T('14:32')), dispute: disputeView({ status: 'ruled', ruling: RULING, serverNow: T('14:32') }) });
  await open(page);
  await parity(page, 'DisputeRuling', {
    // The board has no orange action until the appeal form holds 10 characters (lead question).
    primaries: 0,
    // The harness's mask can stand for a value like "28:12" but not for "47 h 58 min" (a unit
    // inside the value), so the appeal countdown's two board texts are checked here instead.
    deferred: [
      { text: 'Open · 47 h 58 min left', why: 'countdown in the minutes format; checked by the regex below' },
      { text: '47 h 58 min', why: 'countdown in the minutes format; checked by the regex below' },
    ],
  });
  await expect(page.locator('.dispute-window-open')).toHaveText(/^Open · \d+ h \d+ min left$/);
});

// --- Behaviour ----------------------------------------------------------------------------------

test('DisputeOpen shows the board copy and sends the reason and note', async ({ page }) => {
  const posts = await stub(page, { trade: tradeView(), dispute: undefined, post: { status: 200, body: disputeView({ moderator: null }) } });
  await open(page);
  await expect(page.getByRole('heading', { name: 'Open a dispute' })).toBeVisible();
  await expect(page.getByText("Seller's time to confirm ran out", { exact: true })).toBeVisible();
  await expect(page.getByText('A moderator looks at what happened and decides where the 1.25 XMR goes. It stays locked in escrow until then.')).toBeVisible();
  await expect(page.getByText("A moderator will read this trade's chat to decide", { exact: true })).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(4);
  await page.getByRole('radio', { name: "The seller isn't replying" }).check();
  await page.getByLabel('Tell the moderator what happened').fill('No answer since 10:02.');
  await expect(page.getByText('22 / 1000')).toBeVisible();
  // Spec 4.2: no file can be picked until Plan 5's on-device pipeline strips and blurs it.
  await expect(page.locator('input[type=file]')).toHaveCount(0);
  await expect(page.locator('.x2f-moderator-badge')).toHaveCount(0);
  await page.getByRole('button', { name: 'Open dispute' }).click();
  await expect.poll(() => posts.length).toBe(1);
  expect(posts[0]!.postDataJSON()).toEqual({ reason: 'silent', note: 'No answer since 10:02.' });
});

test('before the seller\'s confirm window ends, the buyer is told when and nothing is sent', async ({ page }) => {
  const posts = await stub(page, { trade: tradeView({ serverNow: T('09:30') }) });
  await open(page);
  await expect(page.getByText("You can open a dispute if the seller hasn't confirmed within 2 h of your payment.")).toBeVisible();
  const button = page.getByRole('button', { name: 'Open dispute' });
  await expect(button).toBeDisabled();
  await button.click({ force: true });
  await page.waitForTimeout(300);
  expect(posts).toHaveLength(0);
});

test('the seller sees the seller\'s reasons', async ({ page }) => {
  await stub(page, { trade: tradeView({ role: 'seller' }) });
  await open(page);
  await expect(page.getByRole('heading', { name: 'Open a dispute' })).toBeVisible();
  await expect(page.getByRole('radio', { name: "I haven't received the payment" })).toBeVisible();
  await expect(page.getByText('Selling to', { exact: false })).toBeVisible();
});

test('DisputeRoom: rose In dispute chip, locked amount, deadline line and the join banner from the server', async ({ page }) => {
  await stub(page, { trade: disputed(), dispute: disputeView() });
  await open(page);
  const chip = page.locator('.x2f-chip[data-tone="danger"]');
  await expect(chip).toHaveText('In dispute');
  await expect(page.getByText('1.25 XMR locked in escrow')).toBeVisible();
  await expect(page.getByText('Replied in 38 min · ruling due by Fri 16 Oct, 10:14 (in 23 h)')).toBeVisible();
  await expect(page.getByRole('region', { name: 'Moderator joined' })).toContainText('Moderator sarah.v joined this dispute');
  await expect(page.getByText('10:14 · You opened a dispute: I paid, but the seller hasn\'t released')).toBeVisible();
  await expect(page.getByText('10:52 · Moderator sarah.v joined this dispute')).toBeVisible();
  await expect(page.getByText('Chats are encrypted. If a dispute is opened, a moderator can read this conversation.')).toBeVisible();
});

test('no moderator on record: no banner and no violet badge anywhere', async ({ page }) => {
  await stub(page, { trade: disputed(), dispute: disputeView({ moderator: null }) });
  await open(page);
  await expect(page.getByText('In dispute', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Moderator joined' })).toHaveCount(0);
  await expect(page.locator('.x2f-moderator-badge')).toHaveCount(0);
});

test('DisputeRuling: the ruling card, the destination ending, evidence and the appeal sheet', async ({ page }) => {
  const posts = await stub(page, {
    trade: disputed('seller', T('14:32')),
    dispute: disputeView({ status: 'ruled', ruling: { ...RULING, destination: null }, serverNow: T('14:32') }),
    post: { status: 200, body: disputeView({ status: 'appealed', ruling: { ...RULING, destination: null }, appeal: { by: 'seller', at: T('14:40') }, serverNow: T('14:40') }) },
  });
  await open(page);
  const card = page.getByRole('region', { name: 'Ruling' });
  await expect(card.locator('.x2f-moderator-badge')).toHaveText('X2F Moderator');
  await expect(card).toContainText('Ruling: release to the buyer');
  await expect(card).toContainText('1.25 XMR goes to mira.k');
  await expect(card).not.toContainText('address ending');
  await page.getByRole('button', { name: 'Appeal this ruling' }).click();
  const send = page.getByRole('button', { name: 'Send appeal' });
  await page.getByLabel('Why should it be looked at again?').fill('123456789');
  await expect(send).toBeDisabled();
  await page.getByLabel('Why should it be looked at again?').fill('My bank shows no payment.');
  await send.click();
  await expect(page.getByText('Appeal sent. The XMR stays locked until a second moderator decides.')).toBeVisible();
  expect(posts[0]!.postDataJSON()).toEqual({ why: 'My bank shows no payment.' });
  await expect(page.getByText("It appears on your profile as a lost dispute.", { exact: false })).toBeVisible();
});

test('DisputeRuling: the winner sees where the XMR goes; past the window there is no appeal button', async ({ page }) => {
  await stub(page, {
    trade: disputed('buyer', T('14:31', 17)),
    dispute: disputeView({ status: 'ruled', ruling: RULING, serverNow: T('14:31', 17) }),
  });
  await open(page);
  await expect(page.getByText('To Cake Wallet, address ending …k3Fz.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Appeal this ruling' })).toHaveCount(0);
  await expect(page.getByText('The appeal window closed on Sat 17 Oct, 14:30.')).toBeVisible();
});

test('an appeal refused as too late shows the refusal', async ({ page }) => {
  await stub(page, {
    trade: disputed('seller', T('14:29', 17)),
    dispute: disputeView({ status: 'ruled', ruling: { ...RULING, destination: null }, serverNow: T('14:29', 17) }),
    post: { status: 409, body: { error: 'too-late' } },
  });
  await open(page);
  await page.getByRole('button', { name: 'Appeal this ruling' }).click();
  await page.getByLabel('Why should it be looked at again?').fill('My bank shows no payment.');
  await page.getByRole('button', { name: 'Send appeal' }).click();
  await expect(page.getByRole('alert')).toHaveText('The time for this has passed.');
});

// --- Phone sizes (spec "Mobile ready at launch", owner 2026-10-25) --------------------------------

const SCREENS: { name: string; stubs: () => Stubs; ready: (p: Page) => Locator; action?: (p: Page) => Locator }[] = [
  { name: 'DisputeOpen', stubs: () => ({ trade: tradeView() }), ready: (p) => p.getByRole('heading', { name: 'Open a dispute' }), action: (p) => p.getByRole('button', { name: 'Open dispute' }) },
  { name: 'DisputeRoom', stubs: () => ({ trade: disputed(), dispute: disputeView() }), ready: (p) => p.getByText('In dispute', { exact: true }) },
  {
    name: 'DisputeRuling',
    stubs: () => ({ trade: disputed('buyer', T('14:32')), dispute: disputeView({ status: 'ruled', ruling: RULING, serverNow: T('14:32') }) }),
    ready: (p) => p.getByRole('region', { name: 'Ruling' }),
    action: (p) => p.getByRole('button', { name: 'Appeal this ruling' }),
  },
];

for (const [width, height] of [
  [360, 640],
  [390, 844],
  [412, 915],
] as const) {
  for (const s of SCREENS) {
    test(`${s.name} fits a ${width}x${height} phone`, async ({ page }) => {
      await page.setViewportSize({ width, height });
      await stub(page, s.stubs());
      await open(page);
      await expect(s.ready(page)).toBeVisible();
      const scroll = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth, view: document.documentElement.clientWidth }));
      expect(scroll.wide).toBeLessThanOrEqual(scroll.view);
      expect(await page.locator('[data-primary]:visible').count()).toBeLessThanOrEqual(1);
      const sizes = await page.locator('input:not([type=radio]), textarea').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
      for (const px of sizes) expect(px).toBeGreaterThanOrEqual(16);
      const body = await page.locator('.dispute-body, .dispute-lead, .dispute-reason').evaluateAll((els) => els.map((e) => parseFloat(getComputedStyle(e).fontSize)));
      for (const px of body) expect(px).toBeGreaterThanOrEqual(16);
      if (s.action) {
        const a = s.action(page);
        await a.scrollIntoViewIfNeeded();
        await expect(a).toBeInViewport({ ratio: 1 });
      }
      // Display names are shown exactly as set.
      for (const n of await page.locator('[data-username]').allTextContents()) expect(['satoshi_ghost', 'mira.k']).toContain(n);
    });
  }
}
