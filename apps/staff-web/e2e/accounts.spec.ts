// Spec 6.6 "Account actions" (Plan 4 Task 27) in a real browser: the Accounts page (find a trader
// by display name or trade code; ban with a security-key tap, lift a ban, extend or end an account
// hold after a confirm sheet), ModCase's Account actions card, the role gates, and the owner's
// Reset security in the Staff list's Change sheet. Taps sign with a soft security key (Chromium's
// virtual authenticator) over the honest `tapChallenge(intent + issuedAt, nonce)` the page checks
// before it asks the key. The staff API is stubbed with page.route in the shapes of apps/api/src/
// staff/{accountLookup,bans,holds,invites}.ts; apps/api/test/staff covers the server side. No board
// draws these screens.
import { generateKeyPairSync, randomBytes } from 'node:crypto';
import { expect, test, type Page, type Route } from '@playwright/test';
import { BAN_RULES, hasIssuedAt, inviteTokenHash, stampIssuedAt, tapChallenge, type KeyTapIntent } from '@x2f/staff';

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const H = 3_600_000;
const DAY = 24 * H;
const ends = () => new Date(Date.now() + 8 * H).toISOString();
const OWNER = { displayName: 'lumen.k', role: 'owner', nav: ['overview', 'disputes', 'past-reputation', 'accounts', 'staff', 'performance', 'prices', 'training', 'log', 'feedback', 'settings'], grants: [], sessionEndsAt: ends() };
const SENIOR = { displayName: 'sarah.v', role: 'senior', nav: ['disputes', 'past-reputation', 'accounts', 'training', 'log', 'feedback'], grants: ['accounts.ban', 'accounts.unban'], sessionEndsAt: ends() };
const MOD = { displayName: 'dmitri_k', role: 'mod', nav: ['disputes', 'past-reputation', 'training', 'log'], grants: [], sessionEndsAt: ends() };
const ACCT = '7c3f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f';
const SELLER = '1b2c3d4e-2f0e-4b8a-9d55-0a1b2c3d4e5f';
const CODE = '7RWD3MXEKQ84HN2T';

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
    credential: { credentialId: id.toString('base64'), isResidentCredential: false, rpId: 'localhost', privateKey: privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'), signCount: 0 },
  });
  return id.toString('base64url');
}

interface World {
  holdUntil: string | null;
  bans: Array<Record<string, unknown>>;
}
const account = (w: World, o: Record<string, unknown> = {}) => ({
  accountId: ACCT, displayName: 'harbor_lin', matchedBy: 'name', side: null, completedTrades: 30, positivePct: 97, disputes: { won: 1, lost: 0 }, stage: 'graduated',
  status: {
    bans: w.bans.filter((b) => b.active === true).map((b) => ({ id: b.id, kind: b.kind, reasonCode: b.reasonCode, until: b.until, permanent: b.until === null })),
    hold: w.holdUntil === null ? null : { until: w.holdUntil, reason: 'recovery-code' },
    frozen: false,
    lien: false,
  },
  ...o,
});
const trader = (name: string) => ({ displayName: name, completedTrades: 30, online: false, lastSeenAt: null, typicalMinutes: null, positivePct: 100, badges: [], stage: 'graduated', tradedOverXmr: null, imported: [] });
const kase = () => ({
  code: CODE, incidentId: 'D-7RWD', seq: 1, status: 'open', round: 1, openedBy: 'buyer', reason: 'paid', note: '',
  afterRefund: false, openedAt: new Date(Date.now() - 2 * H).toISOString(), replyDueAt: new Date(Date.now() + 2 * H).toISOString(),
  rulingDueAt: new Date(Date.now() + 46 * H).toISOString(), firstReplyAt: null, usd: '330.00', overLimit: false, limitUsd: 1000,
  assignee: 'dmitri_k', assignedToYou: false, proposedByYou: false, taken: null, mayWork: true, moderator: null,
  traders: { buyer: trader('harbor_lin'), seller: trader('quietfox') },
  escrow: { state: 'escrow-secured', amountAtomic: '1000000000000', methodId: 'ZELLE', methodName: 'Zelle', currency: 'USD', centsPerXmr: '33000', fiatCents: '33000', confirmations: 10, takenAt: new Date(Date.now() - 3 * H).toISOString() },
  ruling: { proposal: null, sentBack: null, draft: null, round1: null, publishedAt: null, appealEndsAt: null, appeal: null, complyBy: null },
  freezes: { buyer: false, seller: false },
});
const MEMBERS = [
  { accountId: 'o-1', inviteId: null, displayName: 'lumen.k', role: 'owner', status: 'active', grants: [], hours: 'any', joinedAt: '2026-08-01T00:00:00Z', lastActiveAt: new Date().toISOString(), openCases: 0, expiresAt: null, missingMethods: [] },
  { accountId: 'm-1', inviteId: null, displayName: 'dmitri_k', role: 'mod', status: 'active', grants: [], hours: 'any', joinedAt: '2026-10-02T00:00:00Z', lastActiveAt: new Date().toISOString(), openCases: 3, expiresAt: null, missingMethods: [] },
];

interface Stub {
  calls: { method: string; path: string; search: string; body: Record<string, unknown> }[];
  taps: KeyTapIntent[];
  world: World;
}

async function stub(page: Page, me: typeof SENIOR, credId: string | null, world: World = { holdUntil: null, bans: [] }): Promise<Stub> {
  const s: Stub = { calls: [], taps: [], world };
  await page.route('**/staff/v1/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const path = url.pathname;
    const body = (req.postDataJSON() ?? {}) as Record<string, unknown>;
    s.calls.push({ method: req.method(), path, search: url.search, body });
    const key = `${req.method()} ${path}`;
    if (key === 'GET /staff/v1/me') return json(me)(route);
    if (key === `GET /staff/v1/disputes/${CODE}`) return json(kase())(route);
    if (key === 'GET /staff/v1/members') return json({ members: MEMBERS })(route);
    if (key === 'GET /staff/v1/accounts/lookup') {
      const q = url.searchParams.get('q') ?? '';
      if (q === CODE) return json({ accounts: [account(world, { matchedBy: 'code', side: 'buyer' }), account(world, { accountId: SELLER, displayName: 'quietfox', matchedBy: 'code', side: 'seller' })] })(route);
      return json({ accounts: q === 'harbor_lin' ? [account(world)] : [] })(route);
    }
    if (key === `GET /staff/v1/accounts/${ACCT}/bans` || key === `GET /staff/v1/accounts/${SELLER}/bans`) return json({ priorOffences: world.bans.length, bans: world.bans, rules: BAN_RULES })(route);
    if (key === 'POST /staff/v1/taps/start' && credId !== null) {
      const intent = body as unknown as KeyTapIntent;
      s.taps.push(intent);
      const nonce = randomBytes(16);
      const at = new Date();
      const challenge = Buffer.from(tapChallenge(stampIssuedAt(intent, at), nonce)).toString('base64url');
      return json({
        tapId: `tap-${s.taps.length}`, nonce: nonce.toString('hex'), issuedAt: hasIssuedAt(intent.kind) ? at.toISOString() : null,
        options: { challenge, rpId: 'localhost', allowCredentials: [{ id: credId, type: 'public-key' }], userVerification: 'discouraged', timeout: 60_000 },
      })(route);
    }
    if (/^POST \/staff\/v1\/taps\/[^/]+\/finish$/.test(key)) return json({ tapId: path.split('/')[4] })(route);
    if (key === `POST /staff/v1/accounts/${ACCT}/bans`) {
      if (body.tapId !== `tap-${s.taps.length}`) return json({ error: 'tap-invalid' }, 403)(route);
      const ban = { id: body.banId, kind: body.kind, ruleId: body.ruleId, reasonCode: 'abuse', until: body.until, permanent: body.until === null, note: body.note ?? null, createdAt: new Date().toISOString(), endedAt: null, liftedAt: null, active: true };
      world.bans.unshift(ban);
      return json(ban, 201)(route);
    }
    const lift = /^POST \/staff\/v1\/accounts\/[^/]+\/bans\/([^/]+)\/lift$/.exec(key);
    if (lift) {
      const b = world.bans.find((x) => x.id === lift[1]);
      if (!b) return json({ error: 'not-found' }, 404)(route);
      b.active = false;
      b.liftedAt = new Date().toISOString();
      return json(b)(route);
    }
    if (key === `POST /staff/v1/accounts/${ACCT}/hold/extend`) {
      world.holdUntil = body.until as string;
      return json({ holdUntil: world.holdUntil })(route);
    }
    if (key === `POST /staff/v1/accounts/${ACCT}/hold/end`) {
      world.holdUntil = null;
      return route.fulfill({ status: 204 });
    }
    if (key === 'POST /staff/v1/members/m-1/reset-security') {
      if (body.tapId !== `tap-${s.taps.length}`) return json({ error: 'tap-invalid' }, 403)(route);
      return json({ inviteId: body.inviteId, link: 'http://localhost:4318/invite/RESET-TOKEN', expiresAt: body.expiresAt }, 201)(route);
    }
    return json({ error: 'not-found' }, 404)(route);
  });
  return s;
}

function noErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => {
    if (m.type() === 'error' && /Content Security Policy|Refused to/.test(m.text())) errors.push(m.text());
  });
  return errors;
}

async function lookUp(page: Page, q: string) {
  await page.getByLabel('Display name or trade code').fill(q);
  await page.getByRole('button', { name: 'Look up' }).click();
}

test('a senior moderator finds a trader, bans them for 7 days with a tap bound to exactly that ban, and lifts it', async ({ page }) => {
  const errors = noErrors(page);
  const credId = await softKey(page);
  const s = await stub(page, SENIOR, credId);
  await page.goto('/disputes');
  await page.locator('[data-nav="accounts"]').click();
  await expect(page.locator('[data-screen="accounts"]')).toBeVisible();
  await lookUp(page, 'harbor_lin');
  const card = page.locator('[data-part="account-card"]');
  await expect(card.locator('[data-part="account-status"]')).toHaveText('No ban, hold, freeze or lien.');
  await card.getByRole('button', { name: 'Ban harbor_lin' }).click();
  const form = page.locator('[data-part="ban-form"]');
  const review = form.getByRole('button', { name: 'Review the ban' });
  await expect(review).toBeDisabled();
  await form.locator('[data-part="ban-kind"] input[value="trade"]').check();
  await form.locator('[data-part="ban-rule"] input[value="abuse"]').check();
  await form.locator('[data-part="ban-term"] input[value="7"]').check();
  await form.getByLabel(/Staff note/).fill('Threatened a buyer in chat');
  await review.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText("harbor_lin can't post or take offers until");
  await expect(dialog).toContainText('Trades already open still finish.');
  await page.getByRole('button', { name: 'Tap security key' }).click();
  await expect(card.locator('[data-part="account-done"]')).toContainText('harbor_lin is banned from trading until');
  await expect(card.locator('[data-part="account-status"]')).toContainText('Trade ban, until');
  const intent = s.taps[0]!;
  expect(intent).toMatchObject({ kind: 'ban-account', accountId: ACCT, banKind: 'trade', ruleId: 'abuse' });
  const until = Date.parse((intent as { until: string }).until);
  expect(Math.abs(until - (Date.now() + 7 * DAY))).toBeLessThan(5 * 60_000);
  const placed = s.calls.find((c) => c.method === 'POST' && c.path === `/staff/v1/accounts/${ACCT}/bans`)!;
  expect(placed.body).toEqual({ banId: (intent as { banId: string }).banId, kind: 'trade', ruleId: 'abuse', until: (intent as { until: string }).until, note: 'Threatened a buyer in chat', tapId: 'tap-1' });

  await card.getByRole('button', { name: 'Lift this trade ban' }).click();
  await expect(page.getByRole('dialog')).toContainText('ends now and the account works again');
  await page.getByRole('button', { name: 'Tap security key' }).click();
  await expect(card.locator('[data-part="account-status"]')).toHaveText('No ban, hold, freeze or lien.');
  expect(s.taps[1]).toEqual({ kind: 'lift-ban', accountId: ACCT, banId: (intent as { banId: string }).banId });
  expect(errors).toEqual([]);
});

test('a senior moderator extends, then ends, an account hold, each after a sheet that says what happens', async ({ page }) => {
  const errors = noErrors(page);
  const holdUntil = new Date(Date.now() + DAY).toISOString();
  const s = await stub(page, SENIOR, null, { holdUntil, bans: [] });
  await page.goto('/accounts');
  await lookUp(page, 'harbor_lin');
  const card = page.locator('[data-part="account-card"]');
  await expect(card.locator('[data-part="account-status"]')).toContainText('Account hold until');
  await card.getByRole('button', { name: 'Extend the hold', exact: true }).click();
  const want = new Date(Date.parse(holdUntil) + 3 * DAY).toISOString();
  await page.locator(`[data-part="hold-days"] input[value="${want}"]`).check();
  await page.getByRole('button', { name: 'Review the extension' }).click();
  const confirm = page.locator('[data-part="account-confirm"]');
  await expect(confirm).toContainText("can't trade or change their security");
  await confirm.getByRole('button', { name: 'Extend the hold', exact: true }).click();
  await expect(card.locator('[data-part="account-done"]')).toContainText('now ends at');
  expect(s.calls.find((c) => c.path.endsWith('/hold/extend'))!.body).toEqual({ until: want });

  await card.getByRole('button', { name: 'End the hold', exact: true }).click();
  await expect(confirm).toContainText('dropped, not applied');
  await confirm.getByRole('button', { name: 'End the hold', exact: true }).click();
  await expect(card.locator('[data-part="account-status"]')).toHaveText('No ban, hold, freeze or lien.');
  expect(s.calls.find((c) => c.path.endsWith('/hold/end'))!.body).toEqual({});
  expect(errors).toEqual([]);
});

test('a senior moderator opens both traders from the case; a moderator gets neither the card nor the page', async ({ page }) => {
  const errors = noErrors(page);
  const s = await stub(page, SENIOR, null);
  await page.goto(`/disputes/${CODE}`);
  const box = page.locator('[data-part="account-actions"]');
  await expect(box).toBeVisible();
  expect(s.calls.some((c) => c.path === '/staff/v1/accounts/lookup')).toBe(false);
  await box.getByRole('button', { name: 'Show both accounts' }).click();
  await expect(box.locator('[data-part="account-card"]')).toHaveCount(2);
  await expect(box.getByRole('button', { name: 'Ban harbor_lin' })).toBeVisible();
  await expect(box.getByRole('button', { name: 'Ban quietfox' })).toBeVisible();
  expect(s.calls.find((c) => c.path === '/staff/v1/accounts/lookup')!.search).toBe(`?q=${CODE}`);
  expect(errors).toEqual([]);
});

test('a moderator: no Accounts in the menu, nothing at /accounts, no Account actions on the case, no account calls', async ({ page }) => {
  const s = await stub(page, MOD, null);
  await page.goto(`/disputes/${CODE}`);
  await expect(page.locator('[data-screen="mod-case"]')).toBeVisible();
  await expect(page.locator('[data-part="account-actions"]')).toHaveCount(0);
  await expect(page.locator('[data-nav="accounts"]')).toHaveCount(0);
  await page.goto('/accounts');
  await expect(page.locator('[data-part="nothing-for-role"]')).toBeVisible();
  expect(s.calls.some((c) => c.path.startsWith('/staff/v1/accounts'))).toBe(false);
});

test("the owner resets a member's security: a typed-name confirm, then a tap bound to the new link, shown once", async ({ page }) => {
  const errors = noErrors(page);
  const credId = await softKey(page);
  const s = await stub(page, OWNER, credId);
  await page.goto('/staff');
  await page.locator('tr', { hasText: 'dmitri_k' }).getByRole('button', { name: 'Change' }).click();
  await page.getByRole('button', { name: "Reset this member's security" }).click();
  const sheet = page.locator('[data-part="reset-confirm"]');
  await expect(sheet).toContainText('every session of theirs ends now');
  const go = sheet.getByRole('button', { name: 'Reset their security' });
  await expect(go).toBeDisabled();
  await sheet.getByLabel('Type dmitri_k to confirm').fill('dmitri_k');
  await go.click();
  await page.getByRole('button', { name: 'Tap security key' }).click();
  await expect(page.getByLabel('Security reset link')).toHaveValue('http://localhost:4318/invite/RESET-TOKEN');
  const call = s.calls.find((c) => c.path === '/staff/v1/members/m-1/reset-security')!;
  expect(s.taps).toEqual([{ kind: 'reset-staff-security', accountId: 'm-1', inviteId: call.body.inviteId, tokenHash: inviteTokenHash(call.body.token as string), expiresAt: call.body.expiresAt }]);
  expect(call.body.tapId).toBe('tap-1');
  expect(errors).toEqual([]);
});
