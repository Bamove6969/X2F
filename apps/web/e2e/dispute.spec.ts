// Trader-side disputes (Plan 3 Task 27; boards DisputeOpen, DisputeRoom, DisputeRuling). The API is
// stubbed per test with page.route, in the shapes of apps/api/src/trades/view.ts (TradeView) and
// apps/api/src/disputes/routes.ts (the dispute view). Times are the boards' (Thursday 15 October
// 2026, shown in UTC). Display names only: the counterparty and the moderator are the names the
// API sends, which are public display names.
import { expect, test, type Locator, type Page, type Request, type Route } from '@playwright/test';
import { expectParity } from './parity.js';
import { PHONE_VIEWPORTS, expectPhoneLayout, setPhone } from './phone.js';

test.use({ timezoneId: 'UTC' });

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
    counterparty: { displayName: role === 'buyer' ? 'satoshi_ghost' : 'mira.k', completedTrades: 12, online: true, lastSeenAt: null, typicalMinutes: null, positivePct: null, badges: [] },
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
    fundStartedAt: null,
    securedAt: T('08:00'),
    payBy: T('09:30'),
    paidAt: T('08:02'),
    confirmBy: T('10:02'),
    finalAlertAt: null,
    settleBy: null,
    pausedAt: null,
    closedAt: null,
    cancelConfirmedAt: null,
    cancelConfirmableAt: null,
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

// Task 15's expectParity. The board texts other tasks still have to supply (Plan 5's evidence,
// Task 20's chat) are in parity.ts KNOWN_EXCEPTIONS with their reasons. DisputeRoom and
// DisputeRuling have no primary on their boards by default (lead question), so `primary: false`.

test('parity with DisputeOpen at 390x844', async ({ page }) => {
  await stub(page, { trade: tradeView() });
  await open(page);
  await page.getByLabel('Tell the moderator what happened').fill(
    'I sent $412.50 by Zelle at 10:02 from my own account, with the trade code in the memo. satoshi_ghost said they would check tonight and has not replied since.',
  );
  await expectParity(page, 'DisputeOpen');
});

test('parity with DisputeRoom at 390x844', async ({ page }) => {
  await stub(page, { trade: disputed(), dispute: disputeView() });
  await open(page);
  await expect(page.getByText('In dispute', { exact: true })).toBeVisible();
  await expectParity(page, 'DisputeRoom', { primary: false });
});

test('parity with DisputeRuling at 390x844', async ({ page }) => {
  await stub(page, { trade: disputed('buyer', T('14:32')), dispute: disputeView({ status: 'ruled', ruling: RULING, serverNow: T('14:32') }) });
  await open(page);
  await expectParity(page, 'DisputeRuling', { primary: false });
  // The appeal countdown's board texts are KNOWN_EXCEPTIONS (a mask cannot stand for "47 h 58 min"); its shape:
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

for (const viewport of PHONE_VIEWPORTS) {
  for (const s of SCREENS) {
    test(`${s.name} fits a ${viewport} phone`, async ({ page }) => {
      await stub(page, s.stubs());
      await open(page);
      await setPhone(page, viewport);
      await expect(s.ready(page)).toBeVisible();
      await expectPhoneLayout(page);
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
