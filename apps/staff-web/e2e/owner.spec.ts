// Plan 4 Task 17: the owner pages in a real browser. StaffList (1280x1000), StaffSettings (1280x1240)
// and StaffOverview (1280x1500) are checked with the parity harness against their boards, the
// invite link, figures and times masked; the board copy each page does not show is listed below
// with its reason, and any other difference fails. Every tapped action is tapped with a soft
// security key (Chromium's virtual authenticator), the challenge the stub answers being the honest
// `tapChallenge(intent + issuedAt, nonce)` the page checks before it asks the key (re-verify X1).
// The staff API is stubbed with page.route in the shapes of apps/api/src/staff/{members,invites,
// settings,pay,site,revenue}.ts; their own tests cover the server side.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import { hasIssuedAt, stampIssuedAt, tapChallenge, type KeyTapIntent } from '@x2f/staff';
import { expectParity } from '../../web/e2e/parity.js';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const MIN = 60_000;
const H = 60 * MIN;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

const ME = { displayName: 'lumen.k', role: 'owner', nav: ['overview', 'disputes', 'staff', 'performance', 'prices', 'training', 'log', 'feedback', 'settings'], sessionEndsAt: new Date(Date.now() + 8 * H).toISOString() };

/** One soft security key, already registered for localhost (its id goes in each tap's allowCredentials). */
async function softKey(page: Page): Promise<string> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: { protocol: 'ctap2', transport: 'usb', hasResidentKey: false, hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true },
  });
  const id = randomBytes(16);
  const { privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  await cdp.send('WebAuthn.addCredential', {
    authenticatorId,
    credential: {
      credentialId: id.toString('base64'),
      isResidentCredential: false,
      rpId: 'localhost',
      privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'),
      signCount: 0,
    },
  });
  return id.toString('base64url');
}

/** The staff API's members list in the board StaffList's example (plus the owner, first). */
function members() {
  const weekdays = { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], start: '09:00', end: '17:00', tz: 'UTC' };
  return [
    { accountId: '00000000-0000-4000-8000-000000000001', inviteId: null, displayName: 'lumen.k', role: 'owner', status: 'active', grants: [], hours: 'any', joinedAt: '2026-08-01T00:00:00Z', lastActiveAt: ago(10_000), openCases: 0, expiresAt: null, missingMethods: [] },
    { accountId: '00000000-0000-4000-8000-000000000002', inviteId: null, displayName: 'sarah.v', role: 'senior', status: 'active', grants: [], hours: 'any', joinedAt: '2026-09-03T00:00:00Z', lastActiveAt: ago(12 * MIN + 10_000), openCases: 41, expiresAt: null, missingMethods: [] },
    { accountId: '00000000-0000-4000-8000-000000000003', inviteId: null, displayName: 'dmitri_k', role: 'mod', status: 'active', grants: [], hours: weekdays, joinedAt: '2026-10-02T00:00:00Z', lastActiveAt: ago(2 * H + 10_000), openCases: 17, expiresAt: null, missingMethods: [] },
    {
      accountId: '00000000-0000-4000-8000-000000000004', inviteId: null, displayName: 'tobi.w', role: 'helper', status: 'active', grants: [],
      hours: { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], start: '18:00', end: '23:00', tz: 'UTC' }, joinedAt: '2026-10-09T00:00:00Z', lastActiveAt: ago(30 * H), openCases: 0, expiresAt: null, missingMethods: [],
    },
    { accountId: null, inviteId: '00000000-0000-4000-8000-0000000000a1', displayName: null, role: 'mod', status: 'waiting', grants: [], hours: weekdays, joinedAt: null, lastActiveAt: null, openCases: 0, expiresAt: new Date(Date.now() + 21 * H + 30 * MIN).toISOString(), missingMethods: [] },
  ];
}

const bucket = (period: string, xmr: string, cents: string, trades: number) => ({ period, trades, feeAtomic: xmr, owedCollectedAtomic: '0', owedCollections: 0, totalAtomic: xmr, usdEstimateCents: cents });

interface Stub {
  calls: { method: string; path: string; body: Record<string, unknown> }[];
  taps: KeyTapIntent[];
  site: Record<string, unknown>;
  list: ReturnType<typeof members>;
}

/** The owner's staff API, stubbed; `credId` is the soft key every tap is offered. */
async function stub(page: Page, credId: string): Promise<Stub> {
  const s: Stub = {
    calls: [],
    taps: [],
    site: { tradingPaused: false, stoppedAt: null, banner: null, maintenance: null, planned: null, logAlarm: null },
    list: members(),
  };
  const now = new Date();
  const month = (back: number) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1)).toISOString().slice(0, 7);
  await page.route('**/staff/v1/**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    s.calls.push({ method: req.method(), path, body });
    const key = `${req.method()} ${path}`;
    if (key === 'GET /staff/v1/me') return json(ME)(route);
    if (key === 'GET /staff/v1/owner/alerts') return json({ items: [], unread: 0, next: null })(route);
    if (key === 'GET /staff/v1/members') return json({ members: s.list })(route);
    if (key === 'POST /staff/v1/taps/start') {
      const intent = body as unknown as KeyTapIntent;
      s.taps.push(intent);
      const nonce = randomBytes(16);
      const at = new Date();
      const challenge = Buffer.from(tapChallenge(stampIssuedAt(intent, at), nonce)).toString('base64url');
      return json({
        tapId: `tap-${s.taps.length}`,
        nonce: nonce.toString('hex'),
        issuedAt: hasIssuedAt(intent.kind) ? at.toISOString() : null,
        options: { challenge, rpId: 'localhost', allowCredentials: [{ id: credId, type: 'public-key' }], userVerification: 'discouraged', timeout: 60_000 },
      })(route);
    }
    if (/^POST \/staff\/v1\/taps\/[^/]+\/finish$/.test(key)) return json({ tapId: path.split('/')[4] })(route);
    if (key === 'POST /staff/v1/invites') {
      return json({ inviteId: body.inviteId, link: `https://staff.x2f.example/invite/${String(body.token)}`, expiresAt: body.expiresAt }, 201)(route);
    }
    const off = /^POST \/staff\/v1\/members\/([^/]+)\/switch-off$/.exec(key);
    if (off) {
      s.list = s.list.map((m) => (m.accountId === off[1] ? { ...m, status: 'switched-off' } : m));
      return json({ status: 'switched-off' })(route);
    }
    if (key === 'GET /staff/v1/settings') return json({ largeTradeLimitUsd: 1000, firstResponseH: 4, appealWindowH: 48, moderatorContactUrl: null, communityMatrixUrl: null, communityTelegramUrl: null })(route);
    if (key === 'GET /staff/v1/pay/settings') return json({ modDisputeUsdCents: null, seniorDisputeUsdCents: null, seniorLargeTradeBp: null, largeTradeThresholdUsd: null })(route);
    if (key === 'GET /staff/v1/site') return json(s.site)(route);
    if (key === 'POST /staff/v1/site/stop') {
      if (typeof body.tapId !== 'string') return json({ error: 'tap-invalid' }, 403)(route);
      s.site = { ...s.site, tradingPaused: true, stoppedAt: new Date(Date.UTC(2026, 10, 18, 1, 20)).toISOString() };
      return json(s.site)(route);
    }
    if (key === 'GET /staff/v1/revenue') {
      // The board's figures: this month 4.82 XMR ($1,590, 211 trades), last month 3.07 XMR ($1,013, 140), all time 7.89 XMR ($2,603).
      return json({
        by: 'month', from: '2017-01-01', to: now.toISOString().slice(0, 10),
        buckets: [bucket(month(1), '3070000000000', '101300', 140), bucket(month(0), '4820000000000', '159000', 211)],
        total: bucket('all', '7890000000000', '260300', 351), byCurrency: [], owedOutstandingAtomic: '0',
      })(route);
    }
    return json({ error: 'not-found' }, 404)(route);
  });
  return s;
}

/** The parity failures, as the harness lists them (an empty list when it passed). */
async function parityFailures(page: Page, board: string, masks: ReturnType<Page['locator']>[]): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready);
  try {
    await expectParity(page, board, { masks });
    return [];
  } catch (e) {
    return String((e as Error).message).split('\n  - ').slice(1).map((l) => l.trim());
  }
}

/** Every listed difference is still there (a stale one must go), and nothing else differs. */
function expectOnly(failures: string[], known: RegExp[]): void {
  expect(failures.filter((f) => !known.some((k) => k.test(f)))).toEqual([]);
  expect(known.filter((k) => !failures.some((f) => k.test(f))).map(String)).toEqual([]);
}

/**
 * StaffSettings copy the page does not show: the board's pay section is Plan 4's A3 (per case, and
 * a helper's monthly rate), which Task 33 as built replaced (per completed dispute at a correct
 * clock-out, and a senior's large-trade share; StaffSettings.tsx, OWNER-Q).
 */
const KNOWN_SETTINGS = [
  /^board copy missing: "Paid monthly in XMR\. Amounts to be decided; check with the lawyer before the first payment\."$/,
  /^board copy missing: "Senior moderator, per case"$/,
  /^board copy missing: "Includes co-approving large rulings\."$/,
  /^board copy missing: "Moderator, per case"$/,
  /^board copy missing: "A ruling overturned on appeal earns nothing\."$/,
  /^board copy missing: "Helper, per month"$/,
  /^board copy missing: "Flat rate, since questions don't come in cases\."$/,
];

/**
 * StaffOverview copy the page does not show: the fee wallet's last characters and the view-only key
 * (the staff API has neither; the fee wallet's address is the moderation process's,
 * NEEDS_PLAN_6_FEE_WALLET; StaffOverview.tsx, OWNER-Q).
 */
const KNOWN_OVERVIEW = [
  /^board copy missing: "The 1% fee from each completed trade goes to X2F's fee wallet ending …9Fq2 \. This page reads it with a view-only key; the key that can spend from it stays offline, never on the server\."$/,
  /^board copy missing: "…9Fq2"$/,
];

test('StaffList parity at 1280x1000 with the add panel and a new invite link (tapped with a soft key), the link masked', async ({ page }) => {
  const credId = await softKey(page);
  const s = await stub(page, credId);
  await page.goto('/staff');
  await expect(page.locator('table[aria-label="Staff"] tbody tr')).toHaveCount(5);
  await page.getByRole('button', { name: 'Add staff member' }).click();
  await page.getByRole('button', { name: 'Create invite link' }).click();
  await page.getByRole('button', { name: 'Tap security key' }).click();
  const link = page.getByRole('textbox', { name: 'Invite link' });
  await expect(link).toHaveValue(/^https:\/\/staff\.x2f\.example\/invite\/[A-Za-z0-9_-]{43}$/);
  const post = s.calls.find((c) => c.path === '/staff/v1/invites')!;
  expect(post.body).toMatchObject({ role: 'mod', hours: { days: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], start: '09:00', end: '17:00', tz: 'UTC' }, tapId: 'tap-1' });
  expect(s.taps).toEqual([{ kind: 'create-invite', inviteId: post.body.inviteId, role: 'mod', tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/), expiresAt: post.body.expiresAt }]);
  // The stubbed dates and times are the board's own ("Sep 2026", "12 min ago", "Expires in 21 h").
  expect(await parityFailures(page, 'StaffList', [link])).toEqual([]);
});

test('a switch-off click changes the row to Switched off at once, with no tap', async ({ page }) => {
  const s = await stub(page, await softKey(page));
  await page.goto('/staff');
  const row = page.locator('table[aria-label="Staff"] tbody tr', { hasText: 'dmitri_k' });
  await row.getByRole('button', { name: 'Switch off' }).click();
  await expect(row).toContainText('Switched off');
  await expect(row.getByRole('button', { name: 'Switch on' })).toBeVisible();
  expect(s.calls.filter((c) => c.method === 'POST' && c.path.endsWith('/switch-off')).map((c) => c.path)).toEqual(['/staff/v1/members/00000000-0000-4000-8000-000000000003/switch-off']);
  expect(s.taps).toEqual([]);
});

test('StaffSettings parity at 1280x1240; pay amounts not set read "Not set"', async ({ page }) => {
  await stub(page, await softKey(page));
  await page.goto('/settings');
  await expect(page.getByRole('textbox', { name: 'Large-trade limit' })).toHaveValue('1000');
  await expect(page.getByRole('textbox', { name: 'Moderator, per dispute' })).toHaveAttribute('placeholder', 'Not set');
  expectOnly(await parityFailures(page, 'StaffSettings', []), KNOWN_SETTINGS);
});

test('StaffOverview parity at 1280x1500; 141 banner characters put the counter in danger and disable Show to everyone', async ({ page }) => {
  await stub(page, await softKey(page));
  await page.goto('/overview');
  await expect(page.locator('[data-part="earnings-card"]').first()).toContainText('4.82 XMR');
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('Zelle payments may take longer this weekend because of a bank holiday.');
  await page.getByRole('textbox', { name: 'Message to users' }).fill('X2F is being upgraded. Back by 03:00 UTC.');
  // The stubbed figures are the board's own; the XMR amounts carry data-mask for the pixel diff.
  expectOnly(await parityFailures(page, 'StaffOverview', []), KNOWN_OVERVIEW);
  await page.getByRole('textbox', { name: 'Message', exact: true }).fill('x'.repeat(141));
  const count = page.locator('[data-part="banner-count"]');
  await expect(count).toHaveText('141 / 140');
  await expect(count).toHaveAttribute('data-tone', 'danger');
  await expect(page.getByRole('button', { name: 'Show to everyone' })).toBeDisabled();
});

test('Pause needs the soft-key tap ("Tap key and pause"), then the page reads paused', async ({ page }) => {
  const s = await stub(page, await softKey(page));
  await page.goto('/overview');
  await page.getByRole('button', { name: 'Pause all new trades' }).click();
  expect(s.calls.some((c) => c.path === '/staff/v1/site/stop')).toBe(false);
  await page.getByRole('dialog').getByRole('button', { name: 'Tap key and pause' }).click();
  await expect(page.locator('section[aria-label="Emergency stop"]')).toContainText('New trades are paused since 01:20 UTC. Trades in escrow are carrying on.');
  expect(s.taps).toEqual([{ kind: 'emergency-stop' }]);
  expect(s.calls.find((c) => c.path === '/staff/v1/site/stop')?.body).toEqual({ tapId: 'tap-1' });
  await expect(page.getByRole('button', { name: 'Tap key and resume trading' })).toBeVisible();
});
