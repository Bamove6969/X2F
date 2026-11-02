// Design screenshot pack (not a test): phone-size PNGs of every screen and state added or changed
// since the design team's last look (7c43bf0, 29 Oct 2026), for Claude Design, which can only read
// the repo. Skipped unless X2F_DESIGN_SHOTS=1, so the normal e2e run never writes files:
//
//   cd apps/web && X2F_DESIGN_SHOTS=1 X2F_CHROMIUM_PATH=/usr/bin/chromium \
//     npx playwright test -c e2e/playwright.config.ts design-shots
//
// Writes docs/design-screens/<X2F_DESIGN_SHOTS_DATE or 2026-11-01>/NN-area-state-theme.png at
// 412x915 (night, then day: the app's two themes, :root[data-theme]) and a few at 884x1104 (an
// unfolded Fold). Every state is reached the way the feature's own spec reaches it (team.spec.ts,
// security.spec.ts, pay.spec.ts, ...): the API stubbed with page.route, the trade room on a
// fixtures build with the fixture escrow. Test fixtures only: no real names, addresses or keys.
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';
import { seal, type Identity, type Participants } from '@x2f/protocol';
import { attestationBytes, channelFor, chatIdentityProofValid, type Attestation } from '@x2f/trade';
import type { FastifyInstance } from 'fastify';
import sodium from 'libsodium-wrappers';
import type { TradeView } from '../src/api/trade.js';
import { BOARD_SELL_LIVE_USD, BOARD_SELL_OFFERS, boardSellOffers } from '../src/fixtures/boards.js';
import { PAY_NOW, PAY_SECURED, PAY_SECURING } from '../src/fixtures/payBoard.js';
import { BOARD_BUY_QUOTE as B } from '../src/fixtures/quoteBoard.js';
import { stubBrowseApi } from './browse-stub.js';
import { startFixtures } from './fixtures-serve.js';
import { BOARD, SERVER_NOW, sellerView } from './refundViews.js';

const ON = process.env.X2F_DESIGN_SHOTS === '1';
test.skip(!ON, 'design screenshots: set X2F_DESIGN_SHOTS=1');

const DATE = process.env.X2F_DESIGN_SHOTS_DATE ?? '2026-11-01';
const OUT = fileURLToPath(new URL(`../../../docs/design-screens/${DATE}/`, import.meta.url));
const PHONE = { width: 412, height: 915 };
const FOLD = { width: 884, height: 1104 };
const PORT = 4331;
const FX = `http://127.0.0.1:${PORT}`;

test.use({ viewport: PHONE, timezoneId: 'UTC', locale: 'en-GB' });

let server: FastifyInstance | undefined;
let modKey: { publicKey: Uint8Array; privateKey: Uint8Array };

test.beforeAll(async () => {
  if (!ON) return;
  test.setTimeout(300_000);
  mkdirSync(OUT, { recursive: true });
  await sodium.ready;
  modKey = sodium.crypto_sign_keypair();
  // The fixtures build pins this moderation signing key, so the real chat can check its attestation (chat.spec.ts).
  process.env.VITE_MOD_SIGNING_PUBLIC = sodium.to_hex(modKey.publicKey);
  server = await startFixtures(PORT, 'dist-fixtures-design-shots');
});
test.afterAll(async () => {
  await server?.close();
});

// ---- The camera -------------------------------------------------------------------------------------

const settle = (page: Page) =>
  page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r())));
  });

/** Saves `name`-night.png and `name`-day.png (or only night with `nightOnly`), then puts night back. */
async function shot(page: Page, name: string, o: { nightOnly?: boolean; scrollTo?: Locator } = {}): Promise<void> {
  if (o.scrollTo) await o.scrollTo.evaluate((el) => el.scrollIntoView({ block: 'center' }));
  await page.mouse.move(0, 0);
  for (const theme of o.nightOnly ? ['night'] : ['night', 'day']) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
    await settle(page);
    await page.screenshot({ path: `${OUT}${name}-${theme}.png`, animations: 'disabled', caret: 'hide' });
  }
  await page.evaluate(() => {
    document.documentElement.dataset.theme = 'night';
  });
}

const json = (body: unknown, status = 200) => (r: Route) => r.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
const LATER = '2099-01-01T00:00:00.000Z';
const HOLD_UNTIL = '2099-01-02T15:00:00.000Z';
const noEvents = (page: Page) => page.route('**/v1/events', (r) => r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream' }, body: 'retry: 600000\n\n' }));

// ---- 01-13 New-device approval and the 24-hour hold (Plan 2 Tasks 16-17) ----------------------------

const TRADER_ME = { displayName: 'nightowl', kind: 'trader', level: 'full', holdUntil: null, methods: ['password'], hasBackup: true, suggestions: [], termsCurrent: true };

async function passwordLogin(page: Page): Promise<void> {
  await page.click('[data-method="password"]');
  await page.fill('#login-name', 'nightowl');
  await page.fill('#login-password', 'Correct-Horse-9!');
  await page.click('[data-part="password-login"]');
}

test('01-02 the new device: the 2-digit number, then let in', async ({ page }) => {
  await page.route('**/v1/account/me', json(TRADER_ME));
  const id = '11111111-1111-4111-8111-111111111111';
  await page.route('**/v1/login/password', json({ status: 'approve-on-device', approvalId: id, number: 47, expiresAt: new Date(Date.now() + 300_000).toISOString() }));
  let letIn = false;
  await page.route(`**/v1/login/approval/${id}/poll`, (r) =>
    json(letIn ? { status: 'ok', loggedOut: [] } : { status: 'waiting', expiresAt: new Date(Date.now() + 240_000).toISOString() })(r),
  );
  await page.goto('/login?returnTo=%2Fbuy');
  await passwordLogin(page);
  await expect(page.locator('[data-part="approve-number"]')).toHaveText('47');
  await shot(page, '01-login-approve-number');
  letIn = true;
  await expect(page.locator('[data-part="approve-in"]')).toBeVisible({ timeout: 20_000 });
  await shot(page, '02-login-approve-let-in');
});

test('03 the new device: blocked', async ({ page }) => {
  const id = '22222222-2222-4222-8222-222222222222';
  await page.route('**/v1/login/password', json({ status: 'approve-on-device', approvalId: id, number: 12, expiresAt: new Date(Date.now() + 300_000).toISOString() }));
  await page.route(`**/v1/login/approval/${id}/poll`, json({ status: 'blocked' }));
  await page.goto('/login');
  await passwordLogin(page);
  await expect(page.locator('[data-part="approve-blocked"]')).toContainText('This login was blocked');
  await shot(page, '03-login-approve-blocked');
});

test('04 a login refused during the 24-hour hold (CantDoThat)', async ({ page }) => {
  await page.route('**/v1/login/password', json({ error: 'recovery-hold', holdUntil: HOLD_UNTIL }, 403));
  await page.goto('/login');
  await passwordLogin(page);
  await expect(page.locator('[role="dialog"] [data-part="cant-do-that"]')).toContainText("This login can't get in until");
  await shot(page, '04-login-hold-refused');
});

test('05 a backup login starts the 24-hour hold', async ({ page }) => {
  await page.route('**/v1/account/me', json({ ...TRADER_ME, level: 'recovery', holdUntil: HOLD_UNTIL }));
  await page.route('**/v1/login/backup', json({ status: 'ok', level: 'recovery', holdUntil: HOLD_UNTIL }));
  await page.goto('/login/backup?returnTo=%2Fbuy');
  await page.click('[data-kind="totp"]');
  await page.fill('#backup-login-name', 'nightowl');
  await page.fill('#backup-code', '123456');
  await page.click('[data-part="backup-login"]');
  await expect(page.locator('[data-part="hold-note"]')).toContainText('Your account is on a 24-hour hold');
  await shot(page, '05-backup-login-hold-note');
});

async function securityApi(page: Page, o: { me?: Record<string, unknown>; sessions?: unknown[]; devices?: unknown } = {}): Promise<void> {
  await page.route('**/v1/account/me', json({ ...TRADER_ME, ...o.me }));
  await page.route('**/v1/account/methods', json([{ type: 'password', id: 'password', label: 'Password', createdAt: null, lastUsedAt: null }]));
  await page.route('**/v1/account/sessions', json(o.sessions ?? [
    { id: 's1', deviceLabel: 'Browser on Linux', level: 'full', createdAt: '2026-10-20T00:00:00.000Z', lastSeenAt: '2026-10-31T00:00:00.000Z', current: true, member: null },
    { id: 's2', deviceLabel: 'Chrome on Android', level: 'full', createdAt: '2026-10-22T00:00:00.000Z', lastSeenAt: '2026-10-30T00:00:00.000Z', current: false, member: null },
  ]));
  await page.route('**/v1/account/alerts', json([]));
  await page.route('**/v1/account/security/logout-timer', json({ idleHours: 12, adjustable: true }));
  await page.route('**/v1/account/security/devices', json(o.devices ?? { oneDevice: false, maxDevices: 3 }));
}

const APPROVAL_ID = '33333333-3333-4333-8333-333333333333';
const approval = (over: Record<string, unknown> = {}) => ({
  id: APPROVAL_ID,
  deviceLabel: 'Chrome on Windows',
  choices: [31, 47, 86],
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 240_000).toISOString(),
  atLimit: false,
  oneDevice: false,
  ...over,
});

test('06-07 the logged-in device: "Is this you?", a number picked, then let in', async ({ page }) => {
  await securityApi(page);
  await page.route('**/v1/account/approvals', json([approval()]));
  await page.route(`**/v1/account/approvals/${APPROVAL_ID}`, json({ outcome: 'approved' }));
  await page.goto('/settings/security');
  const sheet = page.locator('[role="dialog"]');
  await expect(sheet).toContainText('Is this you?');
  await sheet.locator('[data-part="approve-choice"]', { hasText: '47' }).click();
  await shot(page, '06-security-approve-ask');
  await sheet.locator('[data-part="approve-yes"]').click();
  await expect(sheet.locator('[data-part="approve-done"]')).toBeVisible();
  await shot(page, '07-security-approve-done');
});

test('08-10 at the device limit: the ask with its notes, then which device to log out', async ({ page }) => {
  await securityApi(page);
  await page.route('**/v1/account/approvals', json([approval({ atLimit: true, oneDevice: true })]));
  const tooMany = json({
    error: 'too-many-devices',
    max: 3,
    sessions: [
      { id: 's1', deviceLabel: 'Browser on Linux', lastSeenAt: '2026-10-31T00:00:00.000Z', current: true },
      { id: 's2', deviceLabel: 'Chrome on Android', lastSeenAt: '2026-10-30T00:00:00.000Z', current: false },
      { id: 's3', deviceLabel: 'Firefox on Windows', lastSeenAt: '2026-10-29T00:00:00.000Z', current: false },
    ],
  }, 409);
  await page.route(`**/v1/account/approvals/${APPROVAL_ID}`, (r) => (r.request().method() === 'POST' ? tooMany(r) : json(approval({ atLimit: true, oneDevice: true }))(r)));
  await page.goto('/settings/security');
  const sheet = page.locator('[role="dialog"]').first();
  await expect(page.locator('[data-part="approve-at-limit"]')).toBeVisible();
  await page.locator('[data-part="approve-choice"]', { hasText: '86' }).click();
  await shot(page, '08-security-approve-at-limit');
  await page.locator('[data-part="approve-yes"]').click();
  // CantDoThat says why first; OK leaves the chooser.
  const cant = page.locator('[data-part="cant-do-that"]');
  await expect(cant).toHaveAttribute('data-from', 'too-many-devices');
  await shot(page, '09-security-approve-too-many-devices');
  await cant.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('[data-part="approve-choose"]')).toBeVisible();
  await page.locator('[data-part="approve-out"]', { hasText: 'Firefox on Windows' }).click();
  await expect(sheet).toBeVisible();
  await shot(page, '10-security-approve-choose-device');
});

test('11 Devices: the count against the limit and One device at a time', async ({ page }) => {
  await securityApi(page);
  await page.goto('/settings/security');
  await expect(page.locator('[data-part="devices-count"]')).toBeVisible();
  await shot(page, '11-security-devices', { scrollTo: page.locator('[data-part="devices"]') });
});

test('12 a held backup session: the hold banner on Security', async ({ page }) => {
  await securityApi(page, { me: { level: 'recovery', holdUntil: HOLD_UNTIL } });
  await page.goto('/settings/security');
  await expect(page.locator('[data-part="hold-banner"]')).toContainText('24-hour hold');
  await shot(page, '12-security-hold-banner');
});

test('13 a change from a one-proof login is held: "takes effect at"', async ({ page }) => {
  await securityApi(page);
  await page.route('**/v1/account/security/logout-timer', async (r) =>
    r.request().method() === 'PUT' ? json({ status: 'held', holdUntil: HOLD_UNTIL }, 202)(r) : json({ idleHours: 12, adjustable: true })(r),
  );
  await page.goto('/settings/security');
  await page.selectOption('[data-part="logout-timer-select"]', '2');
  await expect(page.locator('[data-part="logout-timer-status"]')).toContainText('This change takes effect at');
  await shot(page, '13-security-held-change', { scrollTo: page.locator('[data-part="logout-timer-status"]') });
});

// ---- 14-28 Team members (Plan 2 Task 18) ----------------------------------------------------------

const CODE = 'Tq9vX2fInviteCodeAAAAAAAAAAAAAAAAAAAAAAA_-Z';
const PGP_MESSAGE = '-----BEGIN PGP MESSAGE-----\n\nwcBMA0team\n-----END PGP MESSAGE-----\n';
const FAKE_KEY = '-----BEGIN PGP PUBLIC KEY BLOCK-----\n\nmDMEteam\n-----END PGP PUBLIC KEY BLOCK-----\n';
const OWNER_ME = { displayName: 'Calcium', kind: 'trader', level: 'full', termsCurrent: true, methods: ['password'], hasBackup: true, suggestions: [], member: null };
const memberMe = (roles: string[]) => ({ ...OWNER_ME, methods: ['pgp', 'security-key'], member: { name: 'Aurora', roles } });
type Member = { id: string; displayName: string; roles: string[]; status: string; inviteExpiresAt: string | null; joinedAt: string | null; createdAt: string };
const member = (id: string, displayName: string, roles: string[], status = 'active'): Member => ({
  id, displayName, roles, status, inviteExpiresAt: status === 'active' ? null : LATER, joinedAt: status === 'active' ? '2026-10-29T10:00:00.000Z' : null, createdAt: '2026-10-29T09:00:00.000Z',
});
const AUDIT = [
  { id: '4', at: '2026-10-30T10:03:00.000Z', memberId: 'm2', memberName: 'Basil', action: 'mark-paid', tradeCode: 'K7M2-9QXA-4FTR-8WPN', detail: {} },
  { id: '3', at: '2026-10-30T10:02:00.000Z', memberId: 'm1', memberName: 'Aurora', action: 'offer-paused', tradeCode: null, detail: {} },
  { id: '2', at: '2026-10-30T10:01:00.000Z', memberId: 'm2', memberName: 'Basil', action: 'dispute-opened', tradeCode: 'K7M2-9QXA-4FTR-8WPN', detail: {} },
  { id: '1', at: '2026-10-30T10:00:00.000Z', memberId: 'm1', memberName: 'Aurora', action: 'offer-posted', tradeCode: null, detail: {} },
];

async function ownerApi(page: Page, s: { members: Member[]; audit?: unknown[]; inviteAnswer?: { status: number; body: unknown } }): Promise<void> {
  await page.route('**/v1/account/me', json(OWNER_ME));
  await page.route('**/v1/confirm/password', json({ confirmToken: 'tok-1' }));
  await page.route('**/v1/team', (r) => json({ members: s.members, max: 3 })(r));
  await page.route('**/v1/team/audit*', (r) => {
    const who = new URL(r.request().url()).searchParams.get('member');
    const rows = (s.audit ?? []) as { memberId: string }[];
    return json(who === null ? rows : rows.filter((e) => e.memberId === who))(r);
  });
  await page.route('**/v1/team/invites', (r) => {
    const body = r.request().postDataJSON() as Record<string, unknown>;
    if (body.confirmToken === undefined) return json({ error: 'confirm-required', action: 'team-invite' }, 403)(r);
    if (s.inviteAnswer) return json(s.inviteAnswer.body, s.inviteAnswer.status)(r);
    s.members = [...s.members, member(`m${s.members.length + 1}`, String(body.displayName), body.roles as string[], 'invited')];
    return json({ id: `m${s.members.length}`, invite: CODE, expiresAt: LATER }, 201)(r);
  });
}

async function confirmWithPassword(page: Page, shotName?: string): Promise<void> {
  const sheet = page.getByRole('dialog', { name: "Confirm it's you" });
  await expect(sheet).toBeVisible();
  await sheet.getByLabel('Your password').fill('Correct-Horse-9!');
  if (shotName) await shot(page, shotName);
  await sheet.getByRole('button', { name: 'Confirm' }).click();
}

test('14-16 the owner invites a member: the form, the confirm, the link', async ({ page }) => {
  await ownerApi(page, { members: [] });
  await page.goto('/settings/team');
  await expect(page.locator('[data-part="team-count"]')).toHaveText('0 of 3 members');
  await page.getByLabel('Their name in trade chats').fill('Aurora.K');
  await page.locator('input[data-role="offers"]').uncheck();
  await page.locator('input[data-role="trades"]').check();
  await shot(page, '14-team-owner-invite-form');
  await page.locator('[data-part="invite"]').click();
  await confirmWithPassword(page, '15-team-owner-invite-confirm');
  await expect(page.locator('[data-part="invite-url"]')).toBeVisible();
  await shot(page, '16-team-owner-invite-link', { scrollTo: page.locator('[data-part="invite-url"]') });
});

test('17-18 the owner\'s team: members and the activity log', async ({ page }) => {
  await ownerApi(page, { members: [member('m1', 'Aurora', ['offers']), member('m2', 'Basil', ['trades']), member('m3', 'Cedric', ['offers', 'trades'], 'invited')], audit: AUDIT });
  await page.goto('/settings/team');
  await expect(page.locator('[data-part="log-list"] li')).toHaveCount(4);
  await shot(page, '17-team-owner-members');
  await shot(page, '18-team-owner-activity-log', { scrollTo: page.locator('[data-part="log-list"]') });
});

test('19 a 4th member is refused (CantDoThat too-many-members)', async ({ page }) => {
  await ownerApi(page, { members: [member('m1', 'Aurora', ['trades']), member('m2', 'Basil', ['offers'])], inviteAnswer: { status: 409, body: { error: 'too-many-members', max: 3 } } });
  await page.goto('/settings/team');
  await page.getByLabel('Their name in trade chats').fill('Cedric');
  await page.locator('[data-part="invite"]').click();
  await confirmWithPassword(page);
  await expect(page.locator('[data-part="cant-do-that"]')).toHaveAttribute('data-from', 'too-many-members');
  await shot(page, '19-team-refused-too-many-members');
});

test('20 an invite from a one-proof login is refused (CantDoThat weak-session)', async ({ page }) => {
  await ownerApi(page, { members: [member('m1', 'Aurora', ['trades'])], inviteAnswer: { status: 403, body: { error: 'weak-session' } } });
  await page.goto('/settings/team');
  await page.getByLabel('Their name in trade chats').fill('Cedric');
  await page.locator('[data-part="invite"]').click();
  await confirmWithPassword(page);
  await expect(page.locator('[data-part="cant-do-that"]')).toHaveAttribute('data-from', 'weak-session');
  await shot(page, '20-team-refused-weak-session');
});

async function joinApi(page: Page, invite?: { status: number; body: unknown }): Promise<void> {
  await page.route('**/v1/account/me', json({ error: 'not-authenticated' }, 401));
  await page.route('**/v1/team/invite', json(invite?.body ?? { team: 'Calcium', displayName: 'Aurora', roles: ['trades'], expiresAt: LATER }, invite?.status ?? 200));
  await page.route('**/v1/team/join/start', json({ challengeId: 'c1', encryptedMessage: PGP_MESSAGE, expiresAt: LATER }));
  await page.route('**/v1/team/join/finish', json({ setupId: 's1', needs: ['security-key', 'passkey', 'pgp'], setupUntil: LATER }, 201));
}

test('21-23 a member joins: the invite, the PGP step, the second way', async ({ page }) => {
  await joinApi(page);
  await page.goto(`/team/join#${CODE}`);
  await expect(page.locator('[data-part="invite-who"]')).toBeVisible();
  await shot(page, '21-team-join-invite');
  await page.getByLabel('Your private login name').fill('aurora_login');
  await page.locator('#join-key').fill(FAKE_KEY);
  await page.locator('[data-part="send-message"]').click();
  await expect(page.locator('[data-part="pgp-message"]')).toContainText('BEGIN PGP MESSAGE');
  await page.getByLabel('Code', { exact: true }).fill('12345678');
  await shot(page, '22-team-join-pgp-code', { scrollTo: page.locator('[data-part="prove"]') });
  await page.locator('[data-part="prove"]').click();
  await expect(page.locator('[data-part="join-second"]')).toBeVisible();
  await shot(page, '23-team-join-second-way');
});

test('24 a used or expired invite link', async ({ page }) => {
  await joinApi(page, { status: 404, body: { error: 'not-found' } });
  await page.goto(`/team/join#${CODE}`);
  await expect(page.locator('[data-part="invite-gone"]')).toBeVisible();
  await shot(page, '24-team-join-invite-gone');
});

test('25 a member opens an owner-only screen (CantDoThat owner-only)', async ({ page }) => {
  await page.route('**/v1/account/me', json(memberMe(['offers', 'trades'])));
  await page.route(/\/v1\/(team|wallets|account\/(sessions|security|alerts|blocks)).*/, json({ error: 'owner-only' }, 403));
  await page.goto('/wallets');
  await expect(page.locator('[data-part="cant-do-that"]')).toHaveAttribute('data-from', 'owner-only');
  await shot(page, '25-team-member-owner-only');
});

test('26 a Trades-only member tries to post an offer (CantDoThat role)', async ({ page }) => {
  await page.route('**/v1/account/me', json(memberMe(['trades'])));
  await page.route(/\/v1\/methods\?/, json({ live: [], all: [{ id: 'ZELLE', name: 'Zelle', group: 'Payment apps', giftCard: false, offers: 0, bestRate: null }] }));
  await page.route('**/v1/offers?*', json([]));
  await page.route(/\/v1\/price\?/, json({ currency: 'USD', centsPerXmr: '32990', usdCentsPerXmr: '32990', exponent: 2, at: '2026-10-24T12:00:00.000Z' }));
  await page.route('**/v1/offers', (r) => (r.request().method() === 'POST' ? json({ error: 'forbidden' }, 403)(r) : r.fallback()));
  await page.goto('/post?method=ZELLE');
  await page.getByLabel('Smallest trade').fill('$50');
  await page.getByLabel('Largest trade').fill('$2,000');
  await page.getByRole('button', { name: 'Post offer' }).click();
  await expect(page.locator('[data-part="cant-do-that"]')).toHaveAttribute('data-from', 'forbidden');
  await shot(page, '26-team-member-role-refused');
});

test("27 a Trades member's device when an offer is taken: a notice, not the accept sheet", async ({ page }) => {
  const trade = sellerView().code;
  await page.route('**/v1/account/me', json(memberMe(['trades'])));
  await page.route('**/v1/wallets', json([]));
  await page.route(/\/v1\/methods\?/, json({ live: [], all: [] }));
  await page.route(`**/v1/trades/${trade}`, json({ ...sellerView(), role: 'seller', poster: 'seller', grown: null }));
  await page.route('**/v1/events', (r) =>
    r.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }, body: `retry: 600000\n\ndata: ${JSON.stringify({ type: 'accepted', code: trade, by: 'mira.k' })}\n\n` }),
  );
  await page.goto('/sell');
  await expect(page.locator('[data-part="member-accepted"]')).toBeVisible();
  await shot(page, '27-team-member-offer-taken-notice');
});

test("28-29 a member's trade room: waiting for the owner's device; Propose cancel", async ({ page }) => {
  const trade = sellerView().code;
  const later = new Date(Date.now() + 25 * 60_000).toISOString();
  let view = { ...sellerView(), payBy: later, nextDeadline: later, serverNow: new Date().toISOString() };
  await page.route('**/v1/account/me', json(memberMe(['trades'])));
  await page.route(`**/v1/trades/${trade}`, (r) => json(view)(r));
  await page.route(`**/v1/trades/${trade}/events`, (r) => {
    view = { ...view, cancelProposedBy: 'seller' };
    return json(view)(r);
  });
  await noEvents(page);
  await page.goto(`/trade/${trade}`);
  const room = page.locator('[data-screen="trade"][data-member]');
  await expect(room.locator('[data-part="member-waiting"]')).toBeVisible();
  await shot(page, '28-team-member-trade-waiting');
  await room.getByRole('button', { name: 'Propose cancel' }).click();
  await expect(room.getByRole('button', { name: 'Withdraw' })).toBeVisible();
  await shot(page, '29-team-member-trade-cancel-proposed');
});

test("30 the owner's Devices list names a member's session", async ({ page }) => {
  await securityApi(page, {
    me: { displayName: 'Calcium', member: null },
    sessions: [
      { id: 's-own', deviceLabel: 'Pixel 8', level: 'full', createdAt: LATER, lastSeenAt: LATER, current: true, member: null },
      { id: 's-m', deviceLabel: 'Firefox on Linux', level: 'full', createdAt: LATER, lastSeenAt: LATER, current: false, member: 'Basil' },
    ],
  });
  await page.goto('/settings/security');
  await expect(page.locator('[data-part="device-list"] li[data-member="Basil"]')).toBeVisible();
  await shot(page, '30-team-owner-devices-member-session', { scrollTo: page.locator('[data-part="device-list"]') });
});

// ---- 31-35 My offers (Plan 3 Task 36) ---------------------------------------------------------------

const OA = '11111111-1111-4111-8111-111111111111';
const OB = '22222222-2222-4222-8222-222222222222';
const OC = '33333333-3333-4333-8333-333333333333';
type Offer = Record<string, unknown> & { id: string; status: 'live' | 'paused'; hidden?: string };
const myOffers = (): Offer[] => [
  { id: OA, side: 'sell', methodId: 'ZELLE', methodName: 'Zelle', currency: 'USD', rate: '33165', pricing: { mode: 'market', marginBps: 50 }, minFiatCents: '5000', maxFiatCents: '200000', minTrades: 0, status: 'live', createdAt: '2026-10-29T10:00:00.000Z' },
  { id: OB, side: 'buy', methodId: 'REVOLUT', methodName: 'Revolut', currency: 'EUR', rate: '30000', pricing: { mode: 'fixed', centsPerXmr: '30000' }, minFiatCents: '1250', maxFiatCents: '50000', minTrades: 5, status: 'paused', createdAt: '2026-10-29T09:00:00.000Z' },
  { id: OC, side: 'sell', methodId: 'WISE', methodName: 'Wise', currency: 'GBP', rate: '26530', pricing: { mode: 'market', marginBps: 0 }, minFiatCents: '2000', maxFiatCents: '90000', minTrades: 0, status: 'live', createdAt: '2026-10-29T08:00:00.000Z' },
];

async function myOffersApi(page: Page, s: { offers: Offer[]; refuseOn?: string }): Promise<void> {
  await page.route('**/v1/account/me', json({ displayName: 'nightowl_44', kind: 'trader', level: 'full', termsCurrent: true }));
  await page.route('**/v1/account/offers', (r) => json(s.offers)(r));
  await page.route('**/v1/account/offers/status', (r) => {
    const body = r.request().postDataJSON() as { ids: string[]; status: 'live' | 'paused' };
    const results = body.ids.map((id) => {
      const o = s.offers.find((x) => x.id === id)!;
      if (o.status === body.status) return { id, status: o.status };
      if (body.status === 'live' && s.refuseOn) return { id, status: o.status, refused: s.refuseOn };
      o.status = body.status;
      return { id, status: o.status };
    });
    return json({ status: body.status, results })(r);
  });
}

test('31-32 My offers: the list, then two ticked with the bar', async ({ page }) => {
  await myOffersApi(page, { offers: myOffers() });
  await page.goto('/profile/offers');
  await expect(page.locator('[data-part="offer"]')).toHaveCount(3);
  await shot(page, '31-myoffers-list');
  await page.locator(`[data-offer="${OA}"]`).getByRole('checkbox').click();
  await page.locator(`[data-offer="${OB}"]`).getByRole('checkbox').click();
  await expect(page.getByRole('region', { name: 'Selected offers' })).toContainText('2 selected');
  await shot(page, '32-myoffers-selected-bar');
});

test('33-34 My offers under a trading hold: the refusal, then the lines under each offer', async ({ page }) => {
  const offers = myOffers();
  offers[0]!.hidden = 'trading-hold';
  await myOffersApi(page, { offers, refuseOn: 'trading-hold' });
  await page.goto('/profile/offers');
  await page.getByRole('checkbox', { name: 'Select all' }).click();
  await page.getByRole('button', { name: 'Turn on' }).click();
  const pop = page.getByRole('dialog');
  await expect(pop).toContainText('trading hold');
  await shot(page, '33-myoffers-hold-refused');
  await pop.getByRole('button', { name: 'OK' }).click();
  await expect(page.locator('[data-part="summary"]')).toBeVisible();
  await shot(page, '34-myoffers-hold-summary');
});

test('35 My offers: empty', async ({ page }) => {
  await myOffersApi(page, { offers: [] });
  await page.goto('/profile/offers');
  await expect(page.getByText('You have no offers yet.')).toBeVisible();
  await shot(page, '35-myoffers-empty');
});

// ---- The trade room on the fixtures build (Tasks 20, 23-24, 38-40) ------------------------------------

/** Plays the other trader and the moderation service for one chat (chat.spec.ts), for any side. */
function identity(): Identity {
  const kp = sodium.crypto_sign_keypair();
  return {
    signPublic: sodium.to_hex(kp.publicKey),
    boxPublic: sodium.to_hex(sodium.crypto_sign_ed25519_pk_to_curve25519(kp.publicKey)),
    signSecret: kp.privateKey,
    boxSecret: sodium.crypto_sign_ed25519_sk_to_curve25519(kp.privateKey),
  };
}

async function stubChat(page: Page, tradeCode: string, me: 'buyer' | 'seller', other: string, lines: string[]): Promise<void> {
  const chatId = 'C7AT-2M9Q-XA4F-TR8W';
  const them: 'buyer' | 'seller' = me === 'buyer' ? 'seller' : 'buyer';
  const channel = await channelFor(chatId, 'chat');
  const peer = identity();
  const mod = identity();
  const registered: { signPublic: string; boxPublic: string }[] = [];
  const envelopes: { id: string; senderRole: string; envelope: unknown; at: string }[] = [];
  let attestation: { attestation: Attestation; sig: string } | null = null;
  const at = '2026-10-31T12:00:00.000Z';
  const participants = (): Participants => {
    const mine = registered[0]!;
    const p = { signPublic: peer.signPublic, boxPublic: peer.boxPublic };
    const m = { signPublic: mine.signPublic, boxPublic: mine.boxPublic };
    return { buyer: me === 'buyer' ? m : p, seller: me === 'seller' ? m : p, mod: { signPublic: mod.signPublic, boxPublic: mod.boxPublic } };
  };
  await page.route(`**/v1/trades/${encodeURIComponent(tradeCode)}/chat`, json({ chat: chatId, role: me }));
  await page.context().route('**/v1/chats/**', async (r) => {
    const url = new URL(r.request().url());
    const path = url.pathname.replace(`/v1/chats/${chatId}`, '');
    const method = r.request().method();
    if (path === '' && method === 'GET') {
      return json({ chat: chatId, role: me, offerId: '00000000-0000-4000-8000-000000000000', counterparty: { displayName: other }, tradeCode, disputeOpen: false, attested: attestation !== null, mySignPublic: registered[0]?.signPublic ?? null, createdAt: at, lastMessageAt: null })(r);
    }
    if (path === '/identity' && method === 'POST') {
      const body = r.request().postDataJSON() as { signPublic: string; boxPublic: string; proof: string };
      if (!(await chatIdentityProofValid(chatId, me, body))) return json({ error: 'bad-proof' }, 400)(r);
      if (registered.length > 0) return json({ error: 'identity-exists' }, 409)(r);
      registered.push(body);
      const a: Attestation = { v: 1, trade: chatId, channels: { chat: channel }, participants: participants(), issuedAt: at };
      attestation = { attestation: a, sig: sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(a), modKey.privateKey)) };
      let seq = 0;
      for (const text of lines) {
        const env = await seal({ trade: channel, from: them, seq: seq++, type: 'chat.msg', payload: { text }, to: ['buyer', 'seller', 'mod'], me: peer, participants: participants() });
        envelopes.push({ id: String(envelopes.length + 1), senderRole: them, envelope: env, at });
      }
      return json({ ok: true, role: me }, 201)(r);
    }
    if (path === '/attestation' && method === 'GET') return attestation ? json(attestation)(r) : json({ status: 'pending' }, 202)(r);
    if (path === '/envelopes' && method === 'GET') {
      const after = BigInt(url.searchParams.get('after') ?? '0');
      return json({ envelopes: envelopes.filter((e) => BigInt(e.id) > after), more: false })(r);
    }
    if (path === '/envelopes' && method === 'POST') {
      const env = r.request().postDataJSON() as unknown;
      const id = String(envelopes.length + 1);
      envelopes.push({ id, senderRole: me, envelope: env, at });
      return json({ id }, 201)(r);
    }
    return json({ error: 'not-found' }, 404)(r);
  });
}

interface Room {
  view: TradeView;
}

/** The pay.spec.ts trade rules, enough for the states shot here. */
function apply(s: Room, e: Record<string, unknown>): { status: number; json: unknown } {
  const v = s.view;
  switch (e.type) {
    case 'mark-paid':
      s.view = { ...v, state: 'paid', paidAt: PAY_NOW, confirmBy: new Date(Date.parse(PAY_NOW) + 120 * 60_000).toISOString() };
      break;
    case 'propose-cancel':
      s.view = { ...v, cancelProposedBy: v.role };
      break;
    default:
      return { status: 400, json: { error: 'event-not-allowed' } };
  }
  return { status: 200, json: s.view };
}

/**
 * Opens /trade/:code on the fixtures build with the fixture escrow ready for the board trade.
 * `warned` false leaves Task 38's warnings to show; `chat` keeps Task 20's real chat in the room.
 */
async function openRoom(
  page: Page,
  view: TradeView,
  o: { warned?: boolean; chat?: string[]; me?: Record<string, unknown>; confirmations?: unknown; dispute?: unknown; url?: string } = {},
): Promise<Room> {
  const s: Room = { view };
  await page.route('**/v1/account/me', json(o.me ?? { displayName: view.role === 'buyer' ? 'mira.k' : 'satoshi_ghost', kind: 'trader', level: 'full', termsCurrent: true }));
  await page.route(/\/v1\/trades\/[^/]+(\/events)?$/, async (route) => {
    const req = route.request();
    if (req.method() === 'POST') {
      const r = apply(s, req.postDataJSON() as Record<string, unknown>);
      return route.fulfill({ status: r.status, contentType: 'application/json', body: JSON.stringify(r.json) });
    }
    return json(s.view)(route);
  });
  await page.route(/\/v1\/trades\/[^/]+\/confirmations$/, json(o.confirmations ?? { confirmations: 12, target: 10, payoutEnd: 'k3Fz' }));
  await page.route(/\/v1\/trades\/[^/]+\/dispute$/, o.dispute === undefined ? json({ error: 'not-found' }, 404) : json(o.dispute));
  await noEvents(page);
  if (o.chat) await stubChat(page, view.code, view.role, view.counterparty.displayName, o.chat);
  await page.addInitScript(
    (f) => {
      window.__x2fFixtureEscrow = { phase: 'ready', amountAtomic: f.amountAtomic, fiatCents: f.fiatCents, deal: { poster: 'seller', takeAmountAtomic: f.amountAtomic } };
      if (f.chat) window.__x2fRealChat = true;
      if (f.warned) {
        try {
          localStorage.setItem(`x2f.warned.pay.${f.code}`, '1');
          localStorage.setItem(`x2f.warned.release.${f.code}`, '1');
        } catch {
          // No store: the warning shows.
        }
      }
    },
    { amountAtomic: PAY_SECURED.amountAtomic, fiatCents: PAY_SECURED.fiatCents, warned: o.warned !== false, chat: o.chat !== undefined, code: view.code },
  );
  await page.goto(o.url ?? `${FX}/trade/${encodeURIComponent(view.code)}`);
  return s;
}

const roomState = (page: Page, state: string) => expect(page.locator('main[data-screen="trade"]')).toHaveAttribute('data-trade-state', state);
const SELLER_SECURED: TradeView = { ...PAY_SECURED, role: 'seller', counterparty: { ...PAY_SECURED.counterparty, displayName: 'mira.k' } };
const CHAT_LINES = ['Hi! Sending the Zelle payment now.', 'Memo has the trade code.'];

test('36 BuyerPay while the escrow secures', async ({ page }) => {
  await openRoom(page, PAY_SECURING);
  await roomState(page, 'securing');
  await shot(page, '36-trade-buyer-pay-securing');
});

test("37-39 Task 38-39: the pay warning, the two-step I've paid, marked as paid", async ({ page }) => {
  await openRoom(page, PAY_SECURING, { warned: false });
  const warn = page.getByRole('alertdialog');
  await expect(warn).toContainText('Before you pay');
  await shot(page, '37-trade-pay-warning');
  await page.getByRole('button', { name: "I'll wait" }).click();
  // The second step: I've paid, the warning again (still confirming), then the confirm sheet.
  await page.locator('[data-primary]').first().click();
  if (await warn.count()) await page.getByRole('button', { name: "I've already paid" }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toContainText('Mark this trade as paid?');
  await sheet.getByRole('checkbox').check();
  await shot(page, '38-trade-paid-confirm-sheet');
  await page.getByRole('button', { name: 'Yes, mark as paid' }).click();
  await roomState(page, 'paid');
  await expect(page.locator('[data-primary]').first()).toHaveText('Marked as paid');
  await shot(page, '39-trade-marked-paid');
});

test("40-41 the seller's waiting room: Propose cancel, then the buyer's accept card", async ({ page }) => {
  const s = await openRoom(page, SELLER_SECURED);
  await expect(page.getByText('Waiting for mira.k to pay')).toBeVisible();
  await page.getByRole('button', { name: 'Propose cancel' }).click();
  await expect(page.getByText('You proposed cancelling. Waiting for mira.k.')).toBeVisible();
  await shot(page, '40-trade-seller-proposed-cancel');
  s.view = { ...PAY_SECURED, cancelProposedBy: 'seller' };
  await page.reload();
  await expect(page.getByText('satoshi_ghost proposed cancelling this trade.')).toBeVisible();
  await shot(page, '41-trade-buyer-cancel-proposal');
});

const PAID_SELLER = {
  ...SELLER_SECURED,
  poster: 'seller',
  state: 'paid',
  paidAt: new Date(Date.parse(PAY_NOW) - 8 * 60_000).toISOString(),
  confirmBy: new Date(Date.parse(PAY_NOW) + 112 * 60_000).toISOString(),
  nextDeadline: new Date(Date.parse(PAY_NOW) + 112 * 60_000).toISOString(),
  fee: { atomic: '12500000000' },
} as TradeView;

test('42-43 SellerConfirm: the release warning, then the box ticked', async ({ page }) => {
  await openRoom(page, PAID_SELLER, { warned: false });
  const warn = page.getByRole('alertdialog');
  await expect(warn).toContainText('Before you release');
  await shot(page, '42-trade-release-warning');
  await page.getByRole('button', { name: "It's in my account" }).click();
  await expect(warn).toHaveCount(0);
  await page.getByRole('checkbox').check();
  await expect(page.locator('[data-screen="seller-confirm"]')).toBeVisible();
  await shot(page, '43-trade-seller-confirm');
});

const CANCELLED = {
  ...SELLER_SECURED,
  settling: 'buyer-cancel',
  paidAt: null,
  txHash: 'ab'.repeat(32),
  cancelConfirmedAt: null,
  cancelConfirmableAt: null,
} as TradeView;

test("44-46 Task 39: the seller confirms a buyer's cancel", async ({ page }) => {
  const s = await openRoom(page, { ...CANCELLED, state: 'refunded' }, { confirmations: { confirmations: 4, target: 10, payoutEnd: 'k3Fz' } });
  await expect(page.locator('[data-seller-cancel]')).toBeVisible();
  await expect(page.locator('[data-return-confirmations]')).toHaveText('Confirmations 4 of 10');
  await shot(page, '44-trade-seller-cancel-returning');
  s.view = { ...CANCELLED, state: 'refunded', cancelConfirmableAt: PAY_NOW };
  await page.reload();
  await expect(page.locator('[data-input-needed]')).toBeVisible();
  await shot(page, '45-trade-seller-cancel-confirm');
  s.view = { ...CANCELLED, state: 'refunded', cancelConfirmableAt: PAY_NOW, cancelConfirmedAt: PAY_NOW };
  await page.reload();
  await expect(page.getByText('Trade cancelled')).toBeVisible();
  await shot(page, '46-trade-seller-cancel-done');
});

test('47 Released (Task 24): the buyer\'s view', async ({ page }) => {
  await openRoom(page, { ...PAY_SECURED, poster: 'buyer', state: 'released', txHash: 'ab'.repeat(32), closedAt: PAY_NOW, paidAt: PAY_NOW, fee: { atomic: '12500000000' } } as TradeView, {
    confirmations: { confirmations: 3, target: 10, payoutEnd: 'k3Fz' },
  });
  await roomState(page, 'released');
  await shot(page, '47-trade-released-buyer');
});

test("48 the buyer's refunded trade: why, and the 48-hour Open a dispute", async ({ page }) => {
  const v = sellerView({ role: 'buyer', state: 'refunded', settling: 'auto-refund', closedAt: new Date(Date.parse(SERVER_NOW) - 10 * 3_600_000).toISOString(), txHash: 'ab'.repeat(32) });
  await openRoom(page, v);
  await expect(page.getByRole('link', { name: 'Open a dispute' })).toBeVisible();
  await shot(page, '48-trade-buyer-refunded');
});

test('49 Task 20: the encrypted chat sheet', async ({ page }) => {
  await openRoom(page, PAY_SECURED, { chat: CHAT_LINES, url: `${FX}/trade/${encodeURIComponent(PAY_SECURED.code)}#chat` });
  const panel = page.getByRole('dialog', { name: /^Chat with/ });
  await expect(panel.locator('[data-from="seller"]').first()).toContainText(CHAT_LINES[0]!, { timeout: 30_000 });
  await panel.locator('textarea').fill('Sent. Memo has the trade code.');
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.locator('[data-mine]')).toBeVisible();
  await shot(page, '49-trade-chat-sheet');
});

test('50 Task 20: the chat open on another device of the account', async ({ page }) => {
  const other = identity();
  const code = encodeURIComponent(PAY_SECURED.code);
  await page.route(`**/v1/trades/${code}/chat`, json({ chat: 'C7AT-2M9Q-XA4F-TR8W', role: 'buyer' }));
  await page.context().route('**/v1/chats/C7AT-2M9Q-XA4F-TR8W', json({ chat: 'C7AT-2M9Q-XA4F-TR8W', role: 'buyer', offerId: '00000000-0000-4000-8000-000000000000', counterparty: { displayName: 'satoshi_ghost' }, tradeCode: PAY_SECURED.code, disputeOpen: false, attested: true, mySignPublic: other.signPublic, createdAt: '2026-10-31T12:00:00.000Z', lastMessageAt: null }));
  await page.addInitScript(() => {
    window.__x2fRealChat = true;
  });
  await openRoom(page, PAY_SECURED, { url: `${FX}/trade/${code}#chat` });
  await expect(page.getByRole('dialog')).toContainText('This conversation is open on another device', { timeout: 30_000 });
  await shot(page, '50-trade-chat-other-device');
});

// ---- 51-57 Foldables (Plan 3 Task 40) ----------------------------------------------------------------

test('51 an unfolded Fold (884x1104): the trade room and the real chat in two panes', async ({ page }) => {
  await page.setViewportSize(FOLD);
  await openRoom(page, PAY_SECURED, { chat: CHAT_LINES });
  await expect(page.locator('html')).toHaveAttribute('data-fold', 'two');
  await expect(page.locator('[data-pane="side"] [data-from="seller"]').first()).toBeVisible({ timeout: 30_000 });
  await shot(page, '51-fold-884-trade-room');
});

test("52 an unfolded Fold (884x1104): the seller's paid room with the chat pane", async ({ page }) => {
  await page.setViewportSize(FOLD);
  await openRoom(page, PAID_SELLER, { chat: CHAT_LINES });
  await expect(page.locator('[data-pane="side"] [data-from="buyer"]').first()).toBeVisible({ timeout: 30_000 });
  await shot(page, '52-fold-884-trade-seller-confirm');
});

test('53 an unfolded Fold (884x1104): the offers list (SellOffers)', async ({ page }) => {
  await page.setViewportSize(FOLD);
  await stubBrowseApi(page, { signedIn: true, live: { USD: BOARD_SELL_LIVE_USD }, offers: (c) => (c === 'USD' ? boardSellOffers() : []), market: { USD: BOARD_SELL_OFFERS.marketCentsPerXmr } });
  await page.goto('/sell/ZELLE');
  await expect(page.locator('article').first()).toBeVisible();
  await shot(page, '53-fold-884-offers-list');
});

test('54 an unfolded Fold (884x1104): My offers', async ({ page }) => {
  await page.setViewportSize(FOLD);
  await myOffersApi(page, { offers: myOffers() });
  await page.goto('/profile/offers');
  await expect(page.locator('[data-part="offer"]')).toHaveCount(3);
  await shot(page, '54-fold-884-myoffers');
});

async function cdpMetrics(page: Page, m: Record<string, unknown>): Promise<boolean> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Emulation.setDeviceMetricsOverride', { deviceScaleFactor: 1, mobile: false, ...m } as never);
  return true;
}

test('55 a flip phone folded (360x380 cover screen): the trade card', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 380 });
  await openRoom(page, PAY_SECURED);
  await cdpMetrics(page, { width: 360, height: 380, devicePosture: { type: 'folded' } });
  const ok = await page.evaluate(() => matchMedia('(device-posture: folded)').matches);
  test.skip(!ok, 'this Chromium does not report a folded posture');
  await expect(page.locator('html')).toHaveAttribute('data-fold', 'cover');
  await shot(page, '55-fold-cover-trade-card');
});

test('56 tabletop (1000x840, half folded): information on top, controls below', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 840 });
  await openRoom(page, PAY_SECURED);
  await cdpMetrics(page, { width: 1000, height: 840, displayFeature: { orientation: 'horizontal', offset: 412, maskLength: 16 } });
  const ok = await page.evaluate(() => matchMedia('(vertical-viewport-segments: 2)').matches);
  test.skip(!ok, 'this Chromium does not report viewport segments');
  await expect(page.locator('html')).toHaveAttribute('data-fold', 'tabletop');
  await shot(page, '56-fold-tabletop-trade');
});

// ---- 57-59 Disputes (Plan 3 Task 27) -----------------------------------------------------------------

const T = (hhmm: string, day = 15) => `2026-10-${day}T${hhmm}:00.000Z`;
const disputeTrade = (o: Record<string, unknown> = {}) => ({
  ...sellerView(),
  role: 'buyer',
  poster: 'seller',
  state: 'paid',
  counterparty: { displayName: 'satoshi_ghost', completedTrades: 12, online: true, lastSeenAt: null, typicalMinutes: null, positivePct: null, badges: [] },
  paidAt: T('08:02'),
  confirmBy: T('10:02'),
  payBy: T('09:30'),
  serverNow: T('10:14'),
  ...o,
});
const disputeView = (o: Record<string, unknown> = {}) => ({
  openedBy: 'buyer', reason: 'paid', openedAt: T('10:14'), afterRefund: false, dueAt: T('10:14', 16), status: 'open',
  moderator: { name: 'sarah.v', joinedAt: T('10:52') }, ruling: null, appeal: null, serverNow: T('11:00'), ...o,
});
const RULING = {
  round: 1,
  outcome: 'release-to-buyer',
  reason: "satoshi_ghost's Zelle activity shows $412.50 received today at 10:02 with this trade's code in the note. The unblurred proof from mira.k shows the same payment.",
  evidence: ["mira.k's Zelle screenshot, blurred and unblurred", "satoshi_ghost's Zelle activity screenshot", 'The trade chat, 09:40 to 13:55'],
  moderatorName: 'sarah.v',
  ruledAt: T('14:30'),
  appealUntil: T('14:30', 17),
  destination: { walletApp: 'cake', addressEnd: 'a9k3Fz' },
};

async function disputeApi(page: Page, trade: unknown, dispute?: unknown): Promise<void> {
  await page.route('**/v1/account/me', json({ displayName: 'mira.k', kind: 'trader', level: 'full', termsCurrent: true }));
  await page.route(/\/v1\/methods\?/, json({ live: [], all: [{ id: 'ZELLE', name: 'Zelle', group: 'Payment apps', giftCard: false, offers: 3, bestRate: null }] }));
  await page.route(`**/v1/trades/${BOARD.code}`, json(trade));
  await page.route(new RegExp(`/v1/trades/${BOARD.code}/(dispute|appeal)$`), dispute === undefined ? json({ error: 'not-found' }, 404) : json(dispute));
}

test('57 DisputeOpen', async ({ page }) => {
  await disputeApi(page, disputeTrade());
  await page.goto(`/trade/${BOARD.code}/dispute`);
  await expect(page.getByRole('heading', { name: 'Open a dispute' })).toBeVisible();
  await page.getByRole('radio', { name: "The seller isn't replying" }).check();
  await page.getByLabel('Tell the moderator what happened').fill('No answer since 10:02.');
  await shot(page, '57-dispute-open');
});

test('58 DisputeRoom', async ({ page }) => {
  await disputeApi(page, disputeTrade({ state: 'disputed', dispute: { by: 'buyer', at: T('10:14') }, serverNow: T('11:00') }), disputeView());
  await page.goto(`/trade/${BOARD.code}/dispute`);
  await expect(page.getByText('In dispute', { exact: true })).toBeVisible();
  await shot(page, '58-dispute-room');
});

test('59 DisputeRuling', async ({ page }) => {
  await disputeApi(page, disputeTrade({ state: 'disputed', dispute: { by: 'buyer', at: T('10:14') }, serverNow: T('14:32') }), disputeView({ status: 'ruled', ruling: RULING, serverNow: T('14:32') }));
  await page.goto(`/trade/${BOARD.code}/dispute`);
  await expect(page.getByRole('region', { name: 'Ruling' })).toBeVisible();
  await shot(page, '59-dispute-ruling');
});

// ---- 60-65 News, feedback and CantDoThat, block (Plan 4 Task 28, Plan 5 Task 21, Plan 3 Task 37) ----

test('60 News', async ({ page }) => {
  const item = (id: number, iso: string, title: string, body: string) => ({ id, title, body, publishedAt: iso, editedAt: null });
  await page.route('**/v1/news**', json({ items: [
    item(3, '2026-10-29T09:00:00.000Z', 'Upgrade done', 'All systems are back.\nThanks for waiting.'),
    item(2, '2026-10-28T09:00:00.000Z', 'Planned upgrade', 'Tomorrow at 09:00 UTC. Trades in escrow are safe.'),
    item(1, '2026-10-20T09:00:00.000Z', 'Welcome', 'Hello from X2F.'),
  ], serverNow: '2026-10-29T12:00:00.000Z' }));
  await page.route('**/v1/account/me', json({ error: 'not-authenticated' }, 401));
  await page.goto('/news');
  await expect(page.getByRole('heading', { level: 1, name: 'News' })).toBeVisible();
  await shot(page, '60-news');
});

test('61-63 CantDoThat on PostOffer, the feedback form, the thank-you', async ({ page }) => {
  await page.route('**/v1/account/me', json({ displayName: 'nightowl_44', kind: 'trader', level: 'full', termsCurrent: true }));
  await page.route(/\/v1\/methods\?/, json({ live: [], all: [{ id: 'ZELLE', name: 'Zelle', group: 'Payment apps', giftCard: false, offers: 0, bestRate: null }] }));
  await page.route('**/v1/offers?*', json([]));
  await page.route(/\/v1\/price\?/, json({ currency: 'USD', centsPerXmr: '32990', usdCentsPerXmr: '32990', exponent: 2, at: '2026-10-24T12:00:00.000Z' }));
  await page.route('**/v1/offers', (r) => (r.request().method() === 'POST' ? json({ error: 'trading-hold' }, 409)(r) : r.fallback()));
  await page.route('**/v1/feedback/form', json({}, 202));
  await page.goto('/post?method=ZELLE');
  await page.getByLabel('Smallest trade').fill('$50');
  await page.getByLabel('Largest trade').fill('$2,000');
  await page.getByRole('button', { name: 'Post offer' }).click();
  const popup = page.getByRole('dialog', { name: "This offer can't be posted" });
  await expect(popup).toBeVisible();
  await shot(page, '61-cantdothat-post-offer');
  await popup.getByRole('link', { name: 'feedback' }).click();
  await expect(page.getByRole('heading', { name: 'Feedback' })).toBeVisible();
  await page.getByRole('radio', { name: 'Complaint' }).check();
  await page.getByLabel('Your comment').fill('A hold should say how long it lasts.');
  await shot(page, '62-feedback-form');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.locator('[data-part="feedback-thanks"]')).toBeVisible();
  await shot(page, '63-feedback-thanks');
});

async function blockApi(page: Page): Promise<void> {
  let blocks: string[] = [];
  await page.route('**/v1/account/me', json({ displayName: 'viewer_1', kind: 'trader', level: 'full', termsCurrent: true, methods: ['pgp'] }));
  await page.route('**/v1/events', json({ error: 'not-authenticated' }, 401));
  await page.route('**/v1/methods?*', json({ live: [{ id: B.method.id, name: B.method.name, group: 'Payment apps', giftCard: false, offers: 1, bestRate: B.marketCentsPerXmr }], all: [] }));
  await page.route('**/v1/price?*', (r) => {
    const currency = new URL(r.request().url()).searchParams.get('currency');
    return json({ currency, centsPerXmr: B.marketCentsPerXmr, exponent: 2, at: new Date().toISOString(), usdCentsPerXmr: B.marketCentsPerXmr })(r);
  });
  await page.route('**/v1/offers?*', (r) => json(blocks.includes(B.offer.poster.displayName) ? [] : [B.offer])(r));
  await page.route('**/v1/wallets', json([...B.wallets]));
  await page.route('**/v1/wallets/rule', json({ firstWallet: false, strongMethods: [], password: 'immediate', waitHours: 24 }));
  await page.route('**/v1/account/blocks', (r) => {
    if (r.request().method() === 'POST') {
      blocks = [(r.request().postDataJSON() as { displayName: string }).displayName, ...blocks];
      return r.fulfill({ status: 204 });
    }
    return json(blocks.map((displayName) => ({ displayName, blockedAt: '2026-10-29T10:00:00.000Z' })))(r);
  });
}

test('64-65 block a trader from the quote; Blocked traders', async ({ page }) => {
  await blockApi(page);
  await page.goto(`/buy/${B.method.id}/${B.offer.id}?currency=${B.currency}&amount=${B.amount}`);
  await page.getByRole('button', { name: `Block ${B.offer.poster.displayName}` }).click();
  await expect(page.locator('[data-part="block-ask"]')).toBeVisible();
  await shot(page, '64-block-ask-on-quote', { scrollTo: page.locator('[data-part="block-ask"]') });
  await page.locator('[data-part="block-confirm"]').click();
  await expect(page.locator('[data-part="block-done"]')).toBeVisible();
  await page.getByRole('link', { name: 'Blocked traders' }).click();
  await expect(page.locator('[data-part="blocked-list"] [data-username]')).toHaveCount(1);
  await shot(page, '65-blocked-traders');
});
