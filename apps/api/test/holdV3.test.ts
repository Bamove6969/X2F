// The 24 h hold model v3 (owner 1-2 Nov 2026; docs/design-hold-model-2026-11-02.md on the design
// branch; lead brief 2026-11-02). It replaces Task 17's hold for everything but a recovery-code login:
// - a username + password session's changes to login methods, payout wallets or a team member's
//   permissions are staged, reviewed and submitted, then QUEUED for 24 h: nobody is logged out and
//   trading goes on; any logged-in session can cancel them; a strong login sees them and may
//   approve them now, untick or cancel them (owner G58);
// - a recovery-code login logs everyone out and holds the account 24 h: logins are refused except
//   the owner's pre-existing passkey, security key or PGP key (which ends it); unfunded trades are
//   cancelled, funded ones paused, and the partner sees only that the other account has
//   a temporary problem; the code used is replaced by a new one, shown once at the next login;
// - a new device with nothing logged in to approve it: only a passkey, security key or PGP key gets
//   in; anything else is refused, and nothing is held.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { addressEnd, normalizeRecoveryCode, type ConfirmAction } from '@x2f/accounts';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressValidator, Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { HOLD_MS, endHoldByModerator, extendHoldByModerator, lockAccount, settleDueHolds, startHold, withTx } from '../src/auth/hold.js';
import { HOLD_CHANGE_ACTIONS_PER_DAY, MAX_HOLD_CHANGES, settleDueChanges } from '../src/auth/holdChanges.js';
import { APPROVALS_PER_HOUR } from '../src/auth/approval.js';
import { purgeExpired } from '../src/auth/challenges.js';
import { RECOVERY_CODE_COUNT } from '../src/auth/recovery.js';
import { SIG } from './helpers/signature.js';
import { syncHeldTradesJob } from '../src/trades/held.js';
import { applyEvent, noPublish } from '../src/trades/store.js';
import { siteMaintenanceSince, startTimers } from '../src/trades/timers.js';
import { codeOf, decrypt, genKey, type Pair } from './helpers/pgpKeys.js';
import { accountIdByLoginName, makeVendor, addUnusedSecurityKey, seedAccount } from './helpers/accounts.js';
import { rolesToAbilities } from '../src/team/abilities.js';
import { fixtureLeakedList } from './helpers/leaked.js';
import { insertOffer } from './helpers/offers.js';
import { createSoftAuthenticator, type SoftAuthenticator } from './helpers/softAuthenticator.js';
import { FIAT, driveTo, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';
import { Browser, codeAt } from './helpers/totp.js';

const ORIGIN = 'https://x2f.test';
const TERMS = '2026-10-17';
const GOOD = 'Correct-Horse-9';
const NEW_PASSWORD = 'Another-Horse-8';
const HOUR = 3600_000;
const T0 = new Date('2026-11-03T12:00:00Z');

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let step = 0;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let cleanup: () => Promise<void>;

const fakeValidator: AddressValidator = { check: async (a) => (/^5[1-9A-HJ-NP-Za-km-z]{94}$/.test(a) ? 'ok' : 'invalid') };
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const fakeAddress = () => '5' + [...randomBytes(94)].map((x) => BASE58[x % BASE58.length]).join('');
const walletAction = (address: string): ConfirmAction => ({
  kind: 'add-wallet', addressHash: createHash('sha256').update(address).digest('hex'), addressEnd: addressEnd(address),
});

beforeAll(async () => {
  const fixture = await fixtureLeakedList();
  cleanup = fixture.cleanup;
  let set: (d: Date) => void;
  ({ app, deps, setNow: set, trader } = await tradeApp({}, { leaked: fixture.list, addresses: fakeValidator }));
  setNow = (d) => {
    now = d;
    set(d);
  };
});

afterAll(async () => {
  await app.close();
  await cleanup();
});

beforeEach(() => {
  setNow(new Date(T0.getTime() + ++step * 72 * HOUR));
  vi.restoreAllMocks();
});

let seq = 0;
const unique = (p: string) => `${p}${String(++seq).padStart(4, '0')}v`;
const errorOf = (r: LightMyRequestResponse) => (r.json() as { error?: string }).error;
const in24h = () => new Date(now.getTime() + HOLD_MS).toISOString();
const later = (ms: number) => setNow(new Date(now.getTime() + ms));

async function alertsOf(accountId: string, kind: string): Promise<Array<Record<string, unknown>>> {
  const { rows } = await deps.db.query<{ detail: Record<string, unknown> }>(
    'select detail from alerts where account_id = $1 and kind = $2 order by created_at, id',
    [accountId, kind],
  );
  return rows.map((r) => r.detail);
}

async function accountHoldOf(accountId: string): Promise<{ reason: string; until: string } | null> {
  const { rows } = await deps.db.query<{ reason: string; hold_until: Date }>('select reason, hold_until from account_holds where account_id = $1', [accountId]);
  return rows[0] ? { reason: rows[0].reason, until: rows[0].hold_until.toISOString() } : null;
}

const onboarding = (accountId: string, until: Date | null) =>
  deps.db.query('update sessions set onboarding_until = $2 where account_id = $1', [accountId, until]);

/** A password trader signed up in `b`, its set-up window over. */
async function passwordTrader(b = new Browser(app)) {
  const name = unique('hv3');
  const res = await b.post('/v1/register/password', { displayName: `P${name}`, loginName: name, password: GOOD, deviceLabel: 'Laptop', acceptedTerms: TERMS, termsSignature: SIG });
  expect(res.statusCode).toBe(201);
  const id = (await accountIdByLoginName(deps, name))!;
  // Review M2: a password alone is setup-only; this account's password LOGIN is the weak one.
  await addUnusedSecurityKey(deps, id);
  await onboarding(id, null);
  return { b, name, id };
}

const passwordLogin = (b: Browser, name: string, password = GOOD) => b.post('/v1/login/password', { loginName: name, password, deviceLabel: 'Firefox on Linux' });

async function sessionOf(b: Browser): Promise<string> {
  const res = await b.get('/v1/account/sessions');
  expect(res.statusCode).toBe(200);
  return (res.json() as Array<{ id: string; current: boolean }>).find((s) => s.current)!.id;
}

async function tokenFor(b: Browser, accountId: string, action: Parameters<typeof issueConfirmToken>[1]['action']) {
  return issueConfirmToken(deps, { sessionId: await sessionOf(b), accountId, action, method: 'password' });
}

async function changePassword(b: Browser, accountId: string, password = NEW_PASSWORD) {
  return b.put('/v1/account/password', { password, confirmToken: await tokenFor(b, accountId, { kind: 'set-password' }) });
}

async function addPasskey(b: Browser, accountId: string, auth: SoftAuthenticator) {
  const confirmToken = await tokenFor(b, accountId, { kind: 'add-method', method: 'passkey' });
  const s = await b.post('/v1/account/webauthn/start', { kind: 'passkey', confirmToken });
  if (s.statusCode !== 200) return s;
  return b.post('/v1/account/webauthn/finish', { challengeId: s.json().challengeId, response: auth.register(s.json().options, ORIGIN) });
}

async function addWallet(b: Browser, accountId: string, address = fakeAddress()) {
  const confirmToken = await tokenFor(b, accountId, walletAction(address));
  return b.post('/v1/wallets', { app: 'cake', label: 'Main', address, confirmToken });
}

async function enrolTotp(b: Browser, accountId: string) {
  const confirmToken = await tokenFor(b, accountId, { kind: 'add-method', method: 'totp' });
  const s = await b.post('/v1/account/totp/start', { confirmToken });
  expect(s.statusCode).toBe(200);
  const { challengeId, secret } = s.json() as { challengeId: string; secret: string };
  return { res: await b.post('/v1/account/totp/finish', { challengeId, code: codeAt(secret, now) }), secret };
}

async function passkeyLogin(b: Browser, auth: SoftAuthenticator) {
  const s = (await b.post('/v1/login/webauthn/start', {})).json();
  return b.post('/v1/login/webauthn/finish', { challengeId: s.challengeId, response: auth.authenticate(s.options, ORIGIN), deviceLabel: 'Phone' });
}

/** Owner G6: the trader PGP login takes the username with the key. */
async function pgpLogin(b: Browser, key: Pair, loginName: string) {
  const start = await b.post('/v1/login/pgp/start', { key: key.publicKey, loginName });
  const code = codeOf(await decrypt(start.json().encryptedMessage, key.privateKey));
  return b.post('/v1/login/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'Laptop' });
}

/**
 * A password trader who, inside the sign-up window (changes apply at once there), also set up a
 * passkey and the recovery code; then the window ends. `b` is the sign-up browser (a weak session).
 */
async function ownerWithPasskey() {
  const t = await passwordTrader();
  await onboarding(t.id, new Date(now.getTime() + HOUR));
  const auth = createSoftAuthenticator({ backedUp: true, userVerified: true });
  expect((await addPasskey(t.b, t.id, auth)).statusCode).toBe(201);
  const codes = (await t.b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
  await onboarding(t.id, null);
  return { ...t, auth, code: codes.codes[0]! };
}

/** A password trader with the recovery code (made inside the sign-up window). */
async function ownerWithCode() {
  const t = await passwordTrader();
  await onboarding(t.id, new Date(now.getTime() + HOUR));
  const codes = (await t.b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
  await onboarding(t.id, null);
  return { ...t, code: codes.codes[0]! };
}

/** A second session of the account in a new browser, approved from `t.b`. */
async function secondSession(t: { b: Browser; name: string }): Promise<Browser> {
  const other = new Browser(app);
  const w = (await passwordLogin(other, t.name)).json() as { approvalId: string; number: number };
  expect((await t.b.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ outcome: 'approved' });
  expect((await other.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toMatchObject({ status: 'ok' });
  return other;
}

const backupLogin = (b: Browser, name: string, code: string) => b.post('/v1/login/backup', { loginName: name, kind: 'recovery-code', code, deviceLabel: 'Tor Browser' });

async function liveSessionsOf(accountId: string): Promise<number> {
  const { rows } = await deps.db.query<{ n: number }>('select count(*)::int as n from sessions where account_id = $1 and revoked_at is null', [accountId]);
  return rows[0]!.n;
}

const holdView = async (b: Browser) => (await b.get('/v1/account/hold')).json() as {
  accountHold: { until: string; reason: string } | null;
  changes: { count: number; takesEffectAt: string | null; items: Array<{ id: string; kind: string; mine: boolean }> };
  drafts: Array<{ id: string; kind: string }>;
  changesWait: boolean;
};

const submit = (b: Browser, ids: string[]) => b.post('/v1/account/hold/changes/submit', { ids });

// Owner demo note (12 Nov 2026, /setup/backup): the one code is about four times longer, 64 symbols (was 16).
describe('recovery code: one 64-character code', () => {
  it('RECOVERY_CODE_COUNT is 1 and the route answers one code of 64 symbols', async () => {
    expect(RECOVERY_CODE_COUNT).toBe(1);
    const t = await passwordTrader();
    await onboarding(t.id, new Date(now.getTime() + HOUR));
    const r = (await t.b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
    expect(r.codes).toHaveLength(1);
    expect(normalizeRecoveryCode(r.codes[0]!)?.replace(/-/g, '')).toHaveLength(64);
  });
});

describe('a username + password session: changes are staged, reviewed, submitted, then wait 24 h', () => {
  it('a change is staged (202 staged), nothing applies, no account hold; the session is told its changes wait', async () => {
    const t = await passwordTrader();
    expect((await holdView(t.b)).changesWait).toBe(true);
    const r = await changePassword(t.b, t.id);
    expect(r.statusCode).toBe(202);
    const body = r.json() as { status: string; changeId: string };
    expect(body.status).toBe('staged');
    expect(await accountHoldOf(t.id)).toBeNull();
    const v = await holdView(t.b);
    expect(v.drafts.map((d) => d.kind)).toEqual(['password']);
    expect(v.drafts[0]!.id).toBe(body.changeId);
    expect(v.changes.count).toBe(0);
    // The old password still works; the new one does not.
    expect((await passwordLogin(new Browser(app), t.name, NEW_PASSWORD)).statusCode).toBe(401);
  });

  it('several changes, reviewed and submitted: one total and one date, the owner alerted with the list, nobody logged out, trading goes on', async () => {
    const t = await passwordTrader();
    const other = await secondSession(t);
    const ids: string[] = [];
    ids.push(((await changePassword(t.b, t.id)).json() as { changeId: string }).changeId);
    const w = await addWallet(t.b, t.id);
    expect(w.statusCode).toBe(202);
    ids.push((w.json() as { changeId: string }).changeId);
    const auth = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const pk = await addPasskey(t.b, t.id, auth);
    expect(pk.statusCode).toBe(202);
    ids.push((pk.json() as { changeId: string }).changeId);
    const before = await liveSessionsOf(t.id);
    const s = await submit(t.b, ids);
    expect(s.statusCode).toBe(200);
    expect(s.json()).toEqual({ status: 'queued', count: 3, takesEffectAt: in24h() });
    expect(await liveSessionsOf(t.id)).toBe(before);
    expect(await accountHoldOf(t.id)).toBeNull();
    const alerts = await alertsOf(t.id, 'hold-changes-submitted');
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ count: 3, takesEffectAt: in24h() });
    expect((alerts[0]!.changes as Array<{ kind: string }>).map((c) => c.kind)).toEqual(['password', 'wallets', 'webauthn']);
    // The banner's data, on every session of the account.
    const me = (await other.get('/v1/account/me')).json() as { pendingChanges: { count: number; takesEffectAt: string } | null };
    expect(me.pendingChanges).toEqual({ count: 3, takesEffectAt: in24h() });
    const v = await holdView(other);
    expect(v.changes.count).toBe(3);
    expect(v.changes.items.every((i) => !i.mine)).toBe(true);
    // Trading goes on: offers and takes are not refused for a hold.
    expect(errorOf(await t.b.post('/v1/offers', {}))).not.toBe('recovery-hold');
    expect(errorOf(await t.b.post('/v1/offers/00000000-0000-4000-8000-000000000000/take', {}))).not.toBe('recovery-hold');
    // Nothing applied yet.
    expect((await passwordLogin(new Browser(app), t.name, NEW_PASSWORD)).statusCode).toBe(401);
  });

  it('after 24 h the changes apply (minute job); alert hold-changes-applied', async () => {
    const t = await passwordTrader();
    const id = ((await changePassword(t.b, t.id)).json() as { changeId: string }).changeId;
    expect((await submit(t.b, [id])).statusCode).toBe(200);
    later(HOLD_MS - 1000);
    await settleDueChanges(deps.config, app.events).run(deps.db, now);
    expect((await passwordLogin(new Browser(app), t.name, NEW_PASSWORD)).statusCode).toBe(401);
    later(1000);
    expect(await settleDueChanges(deps.config, app.events).run(deps.db, now)).toBeGreaterThanOrEqual(1);
    expect((await passwordLogin(t.b, t.name, NEW_PASSWORD)).json()).toEqual({ status: 'ok' });
    expect(await alertsOf(t.id, 'hold-changes-applied')).toEqual([{ applied: ['password'], dropped: [] }]);
  });

  it('lead review 8 Nov I4: each waiting change keeps its own date; a later submission never moves an earlier one', async () => {
    const t = await passwordTrader();
    const a = ((await changePassword(t.b, t.id)).json() as { changeId: string }).changeId;
    expect((await submit(t.b, [a])).statusCode).toBe(200);
    const aDue = in24h();
    later(HOUR); // inside the unchosen 2-hour session length (batch 2), so t.b is still logged in
    // A thief's small change an hour later no longer holds the owner's change back.
    const thief = await secondSession(t);
    const b = ((await addWallet(thief, t.id)).json() as { changeId: string }).changeId;
    expect((await submit(thief, [b])).json()).toEqual({ status: 'queued', count: 2, takesEffectAt: in24h() });
    const bDue = in24h();
    const v = await holdView(t.b);
    // The banner's date is the next change to apply; each item carries its own.
    expect(v.changes.takesEffectAt).toBe(aDue);
    expect(v.changes.items.map((i) => [i.id, (i as { takesEffectAt?: string }).takesEffectAt])).toEqual([[a, aDue], [b, bDue]]);
    expect(((await t.b.get('/v1/account/me')).json() as { pendingChanges: unknown }).pendingChanges).toEqual({ count: 2, takesEffectAt: aDue });
    setNow(new Date(aDue));
    await settleDueChanges(deps.config, app.events).run(deps.db, now);
    expect(await alertsOf(t.id, 'hold-changes-applied')).toEqual([{ applied: ['password'], dropped: [] }]);
    expect((await deps.db.query<{ id: string }>('select id from hold_changes where account_id = $1', [t.id])).rows.map((r) => r.id)).toEqual([b]);
    // Tidy: the wallet change goes too.
    await deps.db.query('delete from hold_changes where account_id = $1', [t.id]);
  });

  it("lead review 8 Nov I4, owner g64: the owner's older username-and-password session ends the thief's newer one, never the other way; logged", async () => {
    const t = await passwordTrader();
    later(60_000);
    const thief = await secondSession(t);
    const ownerSession = await sessionOf(t.b);
    const thiefSession = await sessionOf(thief);
    // The thief (newer) cannot end the owner's (older) session.
    expect((await thief.delete(`/v1/account/sessions/${ownerSession}`)).json()).toEqual({ error: 'weak-session' });
    expect((await t.b.get('/v1/account/me')).statusCode).toBe(200);
    // The owner (older) ends the thief's: his waiting change stays cancellable by the owner.
    expect((await t.b.delete(`/v1/account/sessions/${thiefSession}`)).statusCode).toBe(204);
    expect((await thief.get('/v1/account/me')).statusCode).toBe(401);
    expect(await alertsOf(t.id, 'sessions-ended')).toEqual([{ count: 1, reason: 'older-session' }]);
    // Never a newer strong session (a passkey login opened after the owner's weak one).
    const o = await ownerWithPasskey();
    later(60_000);
    const strong = new Browser(app);
    expect((await passkeyLogin(strong, o.auth)).json()).toEqual({ status: 'ok' });
    expect((await o.b.delete(`/v1/account/sessions/${await sessionOf(strong)}`)).json()).toEqual({ error: 'weak-session' });
  });

  it('submitting needs the exact staged ids of this session; drafts die with the session that staged them', async () => {
    const t = await passwordTrader();
    const id = ((await changePassword(t.b, t.id)).json() as { changeId: string }).changeId;
    expect(errorOf(await submit(t.b, []))).toBe('bad-request');
    expect(errorOf(await submit(t.b, ['00000000-0000-4000-8000-000000000000']))).toBe('changes-changed');
    // Another session cannot submit this session's draft.
    const other = await secondSession(t);
    expect(errorOf(await submit(other, [id]))).toBe('changes-changed');
    await t.b.post('/v1/logout');
    const { rows } = await deps.db.query('select 1 from hold_changes where id = $1', [id]);
    expect(rows).toHaveLength(0);
  });

  it('lead review item 2: an expired session with a draft is purged with it; the purge never stops; a deleted account too', async () => {
    const t = await passwordTrader();
    const draft = ((await changePassword(t.b, t.id)).json() as { changeId: string }).changeId;
    const t2 = await passwordTrader();
    const waiting = ((await changePassword(t2.b, t2.id)).json() as { changeId: string }).changeId;
    expect((await submit(t2.b, [waiting])).statusCode).toBe(200);
    // Both sessions expire without a logout (never revoked).
    await deps.db.query('update sessions set expires_at = $2 where account_id = any($1)', [[t.id, t2.id], new Date(now.getTime() - 1000)]);
    expect(await purgeExpired.run(deps.db, now)).toBeGreaterThanOrEqual(2);
    expect((await deps.db.query('select 1 from hold_changes where id = $1', [draft])).rowCount).toBe(0);
    // A submitted change outlives its session and waits for its date.
    const kept = await deps.db.query<{ session_id: string | null }>('select session_id from hold_changes where id = $1', [waiting]);
    expect(kept.rows).toEqual([{ session_id: null }]);
    // An account with a live session and a draft can be deleted.
    const t3 = await passwordTrader();
    await changePassword(t3.b, t3.id);
    await deps.db.query('delete from accounts where id = $1', [t3.id]);
    expect((await deps.db.query('select 1 from hold_changes where account_id = $1', [t3.id])).rowCount).toBe(0);
  });

  it('any logged-in session, password-only included, cancels the waiting changes; nothing applies at 24 h', async () => {
    const t = await passwordTrader();
    const id = ((await changePassword(t.b, t.id)).json() as { changeId: string }).changeId;
    expect((await submit(t.b, [id])).statusCode).toBe(200);
    // The first session also has a draft (a wallet, named by its address's last 6).
    const address = fakeAddress();
    const draft = ((await addWallet(t.b, t.id, address)).json() as { changeId: string }).changeId;
    expect((await holdView(t.b)).drafts).toEqual([expect.objectContaining({ id: draft, kind: 'wallets', wallets: 1, addressEnds: [addressEnd(address)] })]);
    const other = await secondSession(t);
    const c = await other.delete('/v1/account/hold/changes');
    expect(c.statusCode).toBe(204);
    expect(await alertsOf(t.id, 'hold-changes-cancelled')).toEqual([{ count: 1, changes: [{ kind: 'password' }] }]);
    // Cancelling all takes the other session's drafts too (review minor).
    expect((await deps.db.query('select 1 from hold_changes where account_id = $1', [t.id])).rowCount).toBe(0);
    later(HOLD_MS);
    await settleDueChanges(deps.config, app.events).run(deps.db, now);
    expect((await passwordLogin(new Browser(app), t.name, NEW_PASSWORD)).statusCode).toBe(401);
    expect((await passwordLogin(t.b, t.name)).json()).toEqual({ status: 'ok' });
  });

  it(`staging and submitting are capped at ${HOLD_CHANGE_ACTIONS_PER_DAY} a day per session, successes only (429 slow-down); cancelling never is`, async () => {
    const t = await passwordTrader();
    const day = now.toISOString().slice(0, 10);
    const sessionId = await sessionOf(t.b);
    await deps.db.query('insert into daily_counts (key, day, count) values ($1, $2, $3)', [`hold-changes:${sessionId}`, day, HOLD_CHANGE_ACTIONS_PER_DAY]);
    expect(errorOf(await changePassword(t.b, t.id))).toBe('slow-down');
    expect((await deps.db.query('select 1 from hold_changes where account_id = $1', [t.id])).rowCount).toBe(0);
    // Lead review 8 Nov C1: a session at its cap still cancels, and another session is not capped.
    expect((await t.b.delete('/v1/account/hold/changes')).statusCode).toBe(204);
    const other = await secondSession(t);
    expect((await changePassword(other, t.id)).statusCode).toBe(202);
    // Only successes count: a stage refused (409 too-many-changes) leaves the session's count as it was.
    const otherId = await sessionOf(other);
    const countOf = async () => (await deps.db.query<{ count: number }>('select count from daily_counts where key = $1', [`hold-changes:${otherId}`])).rows[0]?.count;
    expect(await countOf()).toBe(1);
    for (let i = 1; i < MAX_HOLD_CHANGES; i++) {
      await deps.db.query('insert into hold_changes (account_id, session_id, change, created_at) values ($1, $2, $3, $4)', [
        t.id, otherId, JSON.stringify({ kind: 'one-device', on: true }), now,
      ]);
    }
    expect(errorOf(await changePassword(other, t.id))).toBe('too-many-changes');
    expect(await countOf()).toBe(1);
  });

  it('lead review 8 Nov C1: a password thief flooding the hold routes never stops the owner cancelling his new password', async () => {
    const t = await ownerWithCode();
    // The thief: the password, and a login approval the owner tapped.
    const thief = await secondSession(t);
    const id = ((await changePassword(thief, t.id)).json() as { changeId: string }).changeId;
    expect((await submit(thief, [id])).statusCode).toBe(200);
    // 120 cancels of made-up ids (each a 404) and a stage flood until his own session is refused.
    for (let i = 0; i < 120; i++) expect((await thief.delete(`/v1/account/hold/changes/${randomUUID()}`)).statusCode).toBe(404);
    let refused = false;
    for (let i = 0; i < HOLD_CHANGE_ACTIONS_PER_DAY + 1 && !refused; i++) {
      const r = await changePassword(thief, t.id, `Thief-Horse-${i}`);
      if (r.statusCode === 202) await thief.delete(`/v1/account/hold/changes/${(r.json() as { changeId: string }).changeId}`);
      else refused = errorOf(r) === 'slow-down';
    }
    expect(refused).toBe(true);
    // The owner's own session taps Cancel all: it goes, and the thief's password never applies.
    expect((await t.b.delete('/v1/account/hold/changes')).statusCode).toBe(204);
    expect((await holdView(t.b)).changes.count).toBe(0);
    // The owner's own session is not capped by the thief's flood: his own change stages.
    expect((await changePassword(t.b, t.id, 'Owners-Horse-7')).statusCode).toBe(202);
    await t.b.delete('/v1/account/hold/changes');
    later(HOLD_MS);
    await settleDueChanges(deps.config, app.events).run(deps.db, now);
    expect((await passwordLogin(new Browser(app), t.name, NEW_PASSWORD)).statusCode).toBe(401);
    expect((await passwordLogin(new Browser(app), t.name)).statusCode).not.toBe(401);
  });

  it('owner g62: the 24 hours keep counting during maintenance; due changes apply then', async () => {
    const t = await passwordTrader();
    const id = ((await changePassword(t.b, t.id)).json() as { changeId: string }).changeId;
    expect((await submit(t.b, [id])).statusCode).toBe(200);
    await deps.db.query('update site_flags set maintenance_since = $1, maintenance_kind = $2', [now, 'unplanned']);
    try {
      later(HOLD_MS);
      expect(await settleDueChanges(deps.config, app.events).run(deps.db, now)).toBe(1);
    } finally {
      await deps.db.query('update site_flags set maintenance_since = null, maintenance_kind = null');
    }
    expect((await passwordLogin(new Browser(app), t.name, NEW_PASSWORD)).statusCode).not.toBe(401);
  });

  it('owner p5-7 (replacing G5): a wallet removal is staged and the wallet stays usable until it applies; cancelled, it never does', async () => {
    const t = await passwordTrader();
    // A wallet usable now (seeded: the account's first wallet would be added at once anyway).
    const address = fakeAddress();
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'Main', $2, $3, $3) returning id`,
      [t.id, address, new Date(now.getTime() - HOUR)],
    );
    const walletId = rows[0]!.id;
    // Read from the table: the session may have idled out over the 24 h.
    const usable = async () => (await deps.db.query<{ id: string }>(
      'select id from wallets where account_id = $1 and removed_at is null and usable_from <= $2 order by created_at, id', [t.id, now],
    )).rows.map((w) => w.id);
    const r = await t.b.delete(`/v1/wallets/${walletId}`);
    expect(r.statusCode).toBe(202);
    const changeId = (r.json() as { changeId: string }).changeId;
    expect(await usable()).toEqual([walletId]);
    expect((await holdView(t.b)).drafts).toEqual([expect.objectContaining({ id: changeId, kind: 'remove-wallet', label: 'Main', addressEnds: [addressEnd(address)] })]);
    expect((await submit(t.b, [changeId])).statusCode).toBe(200);
    later(HOLD_MS - 1000);
    await settleDueChanges(deps.config, app.events).run(deps.db, now);
    expect(await usable()).toEqual([walletId]);
    later(1000);
    await settleDueChanges(deps.config, app.events).run(deps.db, now);
    expect(await usable()).toEqual([]);
    expect(await alertsOf(t.id, 'hold-changes-applied')).toEqual([{ applied: ['remove-wallet'], dropped: [] }]);
    expect(await alertsOf(t.id, 'wallet-removed')).toEqual([{ app: 'cake', label: 'Main', addressEnd: addressEnd(address) }]);
    // A second wallet's removal, cancelled: it never applies.
    const w2 = (await deps.db.query<{ id: string }>(
      `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'Spare', $2, $3, $3) returning id`,
      [t.id, fakeAddress(), new Date(now.getTime() - HOUR)],
    )).rows[0]!.id;
    expect((await passwordLogin(t.b, t.name)).json()).toEqual({ status: 'ok' });
    const c2 = ((await t.b.delete(`/v1/wallets/${w2}`)).json() as { changeId: string }).changeId;
    expect((await submit(t.b, [c2])).statusCode).toBe(200);
    expect((await t.b.delete(`/v1/account/hold/changes/${c2}`)).statusCode).toBe(204);
    later(2 * HOLD_MS);
    await settleDueChanges(deps.config, app.events).run(deps.db, now);
    expect(await usable()).toEqual([w2]);
    // An unknown wallet is 404 and stages nothing.
    expect((await passwordLogin(t.b, t.name)).json()).toEqual({ status: 'ok' });
    expect(errorOf(await t.b.delete('/v1/wallets/00000000-0000-4000-8000-000000000000'))).toBe('not-found');
    expect((await holdView(t.b)).drafts).toEqual([]);
  });

  it('a strong session removes a wallet at once, as before', async () => {
    const t = await ownerWithPasskey();
    const b = new Browser(app);
    expect((await passkeyLogin(b, t.auth)).statusCode).toBe(200);
    const walletId = (await deps.db.query<{ id: string }>(
      `insert into wallets (account_id, app, label, address, created_at, usable_from) values ($1, 'cake', 'Main', $2, $3, $3) returning id`,
      [t.id, fakeAddress(), new Date(now.getTime() - HOUR)],
    )).rows[0]!.id;
    expect((await b.delete(`/v1/wallets/${walletId}`)).statusCode).toBe(204);
    expect(((await b.get('/v1/wallets')).json() as unknown[])).toEqual([]);
  });

  it('one waiting change can be cancelled by id', async () => {
    const t = await passwordTrader();
    const a = ((await changePassword(t.b, t.id)).json() as { changeId: string }).changeId;
    const b = ((await addWallet(t.b, t.id)).json() as { changeId: string }).changeId;
    expect((await submit(t.b, [a, b])).statusCode).toBe(200);
    expect((await t.b.delete(`/v1/account/hold/changes/${a}`)).statusCode).toBe(204);
    expect((await holdView(t.b)).changes.items.map((i) => i.id)).toEqual([b]);
    expect((await t.b.delete(`/v1/account/hold/changes/${a}`)).statusCode).toBe(404);
  });

  it('lead review item 6 under G58: a thief flooding approvals blocks a strong login (429) but its waiting change stays cancellable', async () => {
    const t = await ownerWithPasskey();
    // The owner's strong session on another device (it answers approvals).
    const phone = new Browser(app);
    expect((await passkeyLogin(phone, t.auth)).json()).toEqual({ status: 'ok' });
    // The thief's password-only session stages and submits a change.
    const id = ((await changePassword(t.b, t.id)).json() as { changeId: string }).changeId;
    expect((await submit(t.b, [id])).statusCode).toBe(200);
    // The thief uses up the hour's approvals.
    for (let i = 0; i < APPROVALS_PER_HOUR; i++) await passwordLogin(new Browser(app), t.name);
    const res = await passkeyLogin(new Browser(app), t.auth);
    expect([res.statusCode, errorOf(res)]).toEqual([429, 'slow-down']);
    // The owner's phone (strong) cancels it.
    expect((await phone.delete(`/v1/account/hold/changes/${id}`)).statusCode).toBe(204);
    expect((await deps.db.query('select 1 from hold_changes where id = $1', [id])).rowCount).toBe(0);
  });

  it("owner G58: the owner's strong login sees the waiting changes and chooses: Cancel all, or Approve now", async () => {
    const t = await ownerWithPasskey();
    const thief = new Browser(app);
    // Copied device cookie: the thief logs in with the password on a trusted device (no approval).
    thief.cookies = { ...t.b.cookies };
    expect((await passwordLogin(thief, t.name)).json()).toEqual({ status: 'ok' });
    const id = ((await changePassword(thief, t.id)).json() as { changeId: string }).changeId;
    expect((await submit(thief, [id])).statusCode).toBe(200);
    const owner = new Browser(app);
    expect((await passkeyLogin(owner, t.auth)).json()).toEqual({ status: 'ok' });
    expect((await holdView(owner)).changes.count).toBe(1);
    // A weak session can't approve; the strong one cancels all.
    expect(errorOf(await thief.post('/v1/account/hold/changes/approve', { ids: [id] }))).toBe('weak-session');
    expect((await owner.delete('/v1/account/hold/changes')).statusCode).toBe(204);
    expect((await holdView(owner)).changes.count).toBe(0);
    // Approve now: a new waiting change applies at once from a strong session.
    const id2 = ((await changePassword(thief, t.id)).json() as { changeId: string }).changeId;
    expect((await submit(thief, [id2])).statusCode).toBe(200);
    expect(errorOf(await owner.post('/v1/account/hold/changes/approve', { ids: ['00000000-0000-4000-8000-000000000000'] }))).toBe('changes-changed');
    expect((await owner.post('/v1/account/hold/changes/approve', { ids: [id2] })).json()).toEqual({ status: 'applied', count: 1 });
    expect((await passwordLogin(new Browser(app), t.name, NEW_PASSWORD)).statusCode).not.toBe(401);
    later(HOLD_MS);
    await settleDueChanges(deps.config, app.events).run(deps.db, now);
  });

  it('a password with an authenticator code does not end the wait (TOTP is not enough for that)', async () => {
    const t = await passwordTrader();
    await onboarding(t.id, new Date(now.getTime() + HOUR));
    const { secret } = await enrolTotp(t.b, t.id);
    await onboarding(t.id, null);
    // The sign-up session (a password login) is weak once its window is over: its change waits.
    const id = ((await changePassword(t.b, t.id)).json() as { changeId: string }).changeId;
    expect((await submit(t.b, [id])).statusCode).toBe(200);
    const b2 = new Browser(app);
    b2.cookies = { ...t.b.cookies };
    const first = await passwordLogin(b2, t.name);
    const pendingId = (first.json() as { pendingId?: string }).pendingId;
    expect(pendingId).toBeDefined();
    later(60_000);
    expect((await b2.post('/v1/login/second-factor', { pendingId, code: codeAt(secret, now) })).json()).toEqual({ status: 'ok' });
    expect((await holdView(b2)).changes.count).toBe(1);
  });

  it(`at most ${MAX_HOLD_CHANGES} changes per account, drafts and waiting ones together (409 too-many-changes); nothing more is staged`, async () => {
    const t = await passwordTrader();
    const sessionId = await sessionOf(t.b);
    for (let i = 0; i < MAX_HOLD_CHANGES; i++) {
      await deps.db.query('insert into hold_changes (account_id, session_id, change, created_at) values ($1, $2, $3, $4)', [
        t.id, sessionId, JSON.stringify({ kind: 'one-device', on: true }), now,
      ]);
    }
    const r = await changePassword(t.b, t.id);
    expect(r.statusCode).toBe(409);
    expect(r.json()).toEqual({ error: 'too-many-changes', max: MAX_HOLD_CHANGES });
    const { rows } = await deps.db.query<{ n: number }>('select count(*)::int as n from hold_changes where account_id = $1', [t.id]);
    expect(rows[0]!.n).toBe(MAX_HOLD_CHANGES);
    // One cancelled makes room again.
    await t.b.delete('/v1/account/hold/changes');
    expect((await changePassword(t.b, t.id)).statusCode).toBe(202);
  });

  it('a strong session (passkey) changes things at once, as before', async () => {
    const t = await ownerWithPasskey();
    const owner = new Browser(app);
    owner.cookies = { ...t.b.cookies };
    expect((await passkeyLogin(owner, t.auth)).json()).toEqual({ status: 'ok' });
    expect((await holdView(owner)).changesWait).toBe(false);
    expect((await changePassword(owner, t.id)).statusCode).toBe(200);
  });
});

describe('a recovery-code login', () => {
  it('logs everyone out, holds the account 24 h; the code is replaced by a new one shown once at the next login', async () => {
    const t = await ownerWithPasskey();
    const second = await secondSession(t);
    const rec = new Browser(app);
    const r = await backupLogin(rec, t.name, t.code);
    expect(r.json()).toEqual({ status: 'ok', level: 'recovery', holdUntil: in24h() });
    expect(await accountHoldOf(t.id)).toEqual({ reason: 'recovery-code', until: in24h() });
    // Only the recovery session itself is live.
    expect(await liveSessionsOf(t.id)).toBe(1);
    expect((await t.b.get('/v1/account/me')).statusCode).toBe(401);
    expect((await second.get('/v1/account/me')).statusCode).toBe(401);
    expect(await alertsOf(t.id, 'sessions-ended')).toEqual([{ count: 2, reason: 'recovery-code' }]);
    // The used code is gone; nobody logs in with it again.
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(401);
    // The recovery session sees its hold and nothing of the new code.
    expect(((await rec.get('/v1/account/me')).json() as { recoveryCodeToShow: boolean }).recoveryCodeToShow).toBe(false);
    expect((await rec.post('/v1/account/recovery-code/reveal', {})).statusCode).toBe(403);
    // The owner's pre-existing passkey ends it; that login is reminded and shown the new code once.
    const owner = new Browser(app);
    expect((await passkeyLogin(owner, t.auth)).json()).toEqual({ status: 'ok' });
    expect(await accountHoldOf(t.id)).toBeNull();
    expect(((await owner.get('/v1/account/me')).json() as { recoveryCodeToShow: boolean }).recoveryCodeToShow).toBe(true);
    const shown = await owner.post('/v1/account/recovery-code/reveal', {});
    expect(shown.statusCode).toBe(200);
    const code = (shown.json() as { code: string }).code;
    expect(normalizeRecoveryCode(code)).not.toBeNull();
    expect((await owner.post('/v1/account/recovery-code/reveal', {})).statusCode).toBe(404);
    // The recovery session ended with the hold; the new code works.
    expect((await rec.get('/v1/account/me')).statusCode).toBe(401);
    expect((await backupLogin(new Browser(app), t.name, code)).statusCode).toBe(200);
  });

  it('lead hold v3 review Critical 1: a password thief on a once-trusted device never reads the new code', async () => {
    const t = await ownerWithCode();
    // The thief copied the owner's device cookie (a trusted device) and knows the password.
    const thief = new Browser(app);
    thief.cookies = { ...t.b.cookies };
    const trusted = async () => (await deps.db.query('select 1 from trusted_devices where account_id = $1', [t.id])).rowCount;
    expect(await trusted()).toBe(1);
    const rec = new Browser(app);
    expect((await backupLogin(rec, t.name, t.code)).statusCode).toBe(200);
    // Every earlier device trust is gone with the recovery-code login; only its own browser's is new.
    expect(await trusted()).toBe(1);
    // The hold ends by time; the copied cookie no longer skips the approval.
    later(HOLD_MS + 60_000);
    // (Nothing that could approve it is logged in: 403 approval-unavailable.)
    const w = await passwordLogin(thief, t.name);
    expect([w.statusCode, w.json()]).toEqual([403, { error: 'approval-unavailable' }]);
    // Even a username-and-password full session opened after the code was replaced is refused.
    const recId = await sessionOf(rec);
    await deps.db.query("update sessions set level = 'full', strength = 'weak-single' where id = $1", [recId]);
    expect(((await rec.get('/v1/account/me')).json() as { recoveryCodeToShow: boolean }).recoveryCodeToShow).toBe(false);
    expect((await rec.post('/v1/account/recovery-code/reveal', {})).statusCode).toBe(404);
    // The recovery session itself, its 24 hours over, is shown the new code once.
    await deps.db.query("update sessions set level = 'recovery', strength = 'weak-single' where id = $1", [recId]);
    expect(((await rec.get('/v1/account/me')).json() as { recoveryCodeToShow: boolean }).recoveryCodeToShow).toBe(true);
    const shown = await rec.post('/v1/account/recovery-code/reveal', {});
    expect(shown.statusCode).toBe(200);
    expect(normalizeRecoveryCode((shown.json() as { code: string }).code)).not.toBeNull();
    expect((await rec.post('/v1/account/recovery-code/reveal', {})).statusCode).toBe(404);
  });

  it('during the hold nobody logs in: a password, on a trusted device too, and a password with its code', async () => {
    const t = await ownerWithCode();
    const trusted = new Browser(app);
    trusted.cookies = { ...t.b.cookies };
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(200);
    expect((await passwordLogin(trusted, t.name)).json()).toEqual({ error: 'recovery-hold', holdUntil: in24h() });
    expect((await passwordLogin(new Browser(app), t.name)).json()).toEqual({ error: 'recovery-hold', holdUntil: in24h() });
    expect(await liveSessionsOf(t.id)).toBe(1);
  });

  it('ends by itself after 24 h (minute job), and the account works again', async () => {
    const t = await ownerWithCode();
    const rec = new Browser(app);
    expect((await backupLogin(rec, t.name, t.code)).statusCode).toBe(200);
    later(HOLD_MS);
    expect(await settleDueHolds(deps.config, app.events).run(deps.db, now)).toBeGreaterThanOrEqual(1);
    expect(await accountHoldOf(t.id)).toBeNull();
    // The browser of the recovery-code login is trusted; every older one asks for an approval
    // (Critical 1: device trust ends with a recovery-code login).
    expect((await passwordLogin(rec, t.name)).json()).toMatchObject({ status: 'ok' });
    expect((await passwordLogin(t.b, t.name)).json()).toMatchObject({ approvalId: expect.any(String) });
  });

  it('owner G32: keeps the changes waiting from a password-only session; the recovery session may cancel them', async () => {
    const t = await ownerWithCode();
    const id = ((await changePassword(t.b, t.id)).json() as { changeId: string }).changeId;
    expect((await submit(t.b, [id])).statusCode).toBe(200);
    const draft = ((await changePassword(t.b, t.id, 'Another-Pass-77!')).json() as { changeId: string }).changeId;
    const rec = new Browser(app);
    expect((await backupLogin(rec, t.name, t.code)).statusCode).toBe(200);
    // The waiting change keeps its date; the draft died with its session.
    const { rows } = await deps.db.query<{ id: string }>('select id from hold_changes where account_id = $1', [t.id]);
    expect(rows.map((r) => r.id)).toEqual([id]);
    expect(await alertsOf(t.id, 'hold-changes-discarded')).toEqual([]);
    expect(draft).not.toBe(id);
    // The held recovery session cancels it.
    expect((await rec.delete(`/v1/account/hold/changes/${id}`)).statusCode).toBe(204);
    expect((await deps.db.query('select 1 from hold_changes where account_id = $1', [t.id])).rowCount).toBe(0);
  });

  it("trades: unfunded ones are cancelled, funded ones paused; the partner sees only the other account's problem", async () => {
    const t = await ownerWithCode();
    const partner = await trader();
    const partner2 = await trader();
    const { trade: unfunded } = await seedTrade(deps, { sellerId: partner.id, buyerId: t.id, poster: 'seller' });
    const { trade: t2 } = await seedTrade(deps, { sellerId: t.id, buyerId: partner2.id, poster: 'buyer' });
    const funded = await driveTo(deps, t2, 'secured');
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(200);
    const { rows } = await deps.db.query<{ code: string; action: string }>('select code, action from held_trades where account_id = $1 order by action', [t.id]);
    expect(rows).toEqual([{ code: unfunded.code, action: 'cancel' }, { code: funded.code, action: 'pause' }]);
    const paused = await deps.db.query<{ paused_at: Date | null }>('select paused_at from trades where code = $1', [funded.code]);
    expect(paused.rows[0]!.paused_at).not.toBeNull();
    // The unfunded one is cancelled by the machine's system-cancel, right after the login's commit.
    const cancelled = await deps.db.query<{ state: string; closed_at: Date | null }>('select state, closed_at from trades where code = $1', [unfunded.code]);
    expect(cancelled.rows[0]).toMatchObject({ state: 'cancelled' });
    expect(cancelled.rows[0]!.closed_at).not.toBeNull();
    expect((await deps.db.query<{ paused: string }>('select paused from held_trades where code = $1', [unfunded.code])).rows[0]!.paused).toBe('cancelled');
    // The partner's view: a flag, and never the words hold, security or vendor.
    const v = await partner2.browser.get(`/v1/trades/${funded.code}`);
    expect(v.json()).toMatchObject({ counterpartyProblem: true });
    // Keys and fixed words only (random codes and addresses are left out of the check).
    const words = JSON.stringify(v.json(), (k, val) => (typeof val === 'string' && /^[0-9A-Za-z-]{12,}$/.test(val) ? '' : val));
    expect(words.match(/.{0,40}(hold|security|vendor).{0,40}/i)?.[0] ?? null).toBeNull();
    expect((await partner.browser.get(`/v1/trades/${unfunded.code}`)).json()).toMatchObject({ counterpartyProblem: true });
    // The partner cannot move a held trade forward; leaving an unfunded one stays possible.
    expect(errorOf(await partner2.browser.post(`/v1/trades/${funded.code}/events`, { type: 'mark-paid', fiatCents: FIAT.toString() }))).toBe('counterparty-unavailable');
    expect(errorOf(await partner.browser.post(`/v1/trades/${unfunded.code}/events`, { type: 'fund-started' }))).toBe('counterparty-unavailable');
  });

  it('lead review minor: a take that raced the login (its trade has no held row) is held by the minute job', async () => {
    const seller = await ownerWithCode();
    const buyer = await ownerWithCode();
    expect((await backupLogin(new Browser(app), seller.name, seller.code)).statusCode).toBe(200);
    // A trade that committed after the login's holdTrades (the race), funded so it must be paused.
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const s = await driveTo(deps, trade, 'secured');
    expect((await deps.db.query('select 1 from held_trades where code = $1', [s.code])).rowCount).toBe(0);
    await syncHeldTradesJob(noPublish).run(deps.db, now);
    const row = await deps.db.query<{ action: string; paused: string }>('select action, paused from held_trades where code = $1', [s.code]);
    expect(row.rows).toEqual([{ action: 'pause', paused: 'paused' }]);
    expect((await deps.db.query<{ p: Date | null }>('select paused_at as p from trades where code = $1', [s.code])).rows[0]!.p).not.toBeNull();
  });

  it('lead review item 4: both parties held, the trade resumes when the second hold ends, whichever ends first', async () => {
    for (const firstEnds of ['seller', 'buyer'] as const) {
      const seller = await ownerWithCode();
      const buyer = await ownerWithCode();
      const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
      const s = await driveTo(deps, trade, 'secured');
      expect((await backupLogin(new Browser(app), seller.name, seller.code)).statusCode).toBe(200);
      expect((await backupLogin(new Browser(app), buyer.name, buyer.code)).statusCode).toBe(200);
      const pausedAt = async () => (await deps.db.query<{ p: Date | null }>('select paused_at as p from trades where code = $1', [s.code])).rows[0]!.p;
      expect(await pausedAt()).not.toBeNull();
      const [a, b] = firstEnds === 'seller' ? [seller, buyer] : [buyer, seller];
      expect(await endHoldByModerator(deps, a.id, { staffId: null })).toBe(true);
      await syncHeldTradesJob(noPublish).run(deps.db, now);
      expect(await pausedAt(), `${firstEnds} first: still held by the other`).not.toBeNull();
      expect(await endHoldByModerator(deps, b.id, { staffId: null })).toBe(true);
      await syncHeldTradesJob(noPublish).run(deps.db, now);
      expect(await pausedAt(), `${firstEnds} first: resumed`).toBeNull();
      expect((await deps.db.query('select 1 from held_trades where code = $1', [s.code])).rowCount).toBe(0);
    }
  });

  it('lead review 8 Nov minor 10: whether another hold still holds the trade is decided under the trade lock', async () => {
    const seller = await ownerWithCode();
    const buyer = await ownerWithCode();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
    const s = await driveTo(deps, trade, 'secured');
    expect((await backupLogin(new Browser(app), seller.name, seller.code)).statusCode).toBe(200);
    expect((await backupLogin(new Browser(app), buyer.name, buyer.code)).statusCode).toBe(200);
    // A check outside the trade's transaction (the pool) sees no other hold, as if the buyer's hold
    // had started just after it: the trade must still not resume.
    const query = deps.db.query.bind(deps.db);
    const spy = vi.spyOn(deps.db, 'query').mockImplementation(((text: unknown, ...rest: unknown[]) =>
      typeof text === 'string' && text.includes('account_id <> $2 and released_at is null')
        ? Promise.resolve({ rows: [], rowCount: 0 })
        : (query as (...a: unknown[]) => unknown)(text, ...rest)) as never);
    try {
      expect(await endHoldByModerator(deps, seller.id, { staffId: null })).toBe(true);
    } finally {
      spy.mockRestore();
    }
    expect((await deps.db.query<{ p: Date | null }>('select paused_at as p from trades where code = $1', [s.code])).rows[0]!.p).not.toBeNull();
    expect(await endHoldByModerator(deps, buyer.id, { staffId: null })).toBe(true);
    expect((await deps.db.query<{ p: Date | null }>('select paused_at as p from trades where code = $1', [s.code])).rows[0]!.p).toBeNull();
  });

  it('lead review item 4: a hold ending during maintenance resumes its trade once maintenance is over', async () => {
    const t = await ownerWithCode();
    const partner = await trader();
    const { trade } = await seedTrade(deps, { sellerId: partner.id, buyerId: t.id, poster: 'seller' });
    const s = await driveTo(deps, trade, 'secured');
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(200);
    await deps.db.query('update site_flags set maintenance_since = $1, maintenance_kind = $2', [now, 'unplanned']);
    try {
      expect(await endHoldByModerator(deps, t.id, { staffId: null })).toBe(true);
      await syncHeldTradesJob(noPublish).run(deps.db, now);
      const row = await deps.db.query<{ p: Date | null }>('select paused_at as p from trades where code = $1', [s.code]);
      expect(row.rows[0]!.p).not.toBeNull();
      expect((await deps.db.query('select 1 from held_trades where code = $1', [s.code])).rowCount).toBe(1);
    } finally {
      await deps.db.query('update site_flags set maintenance_since = null, maintenance_kind = null');
    }
    await syncHeldTradesJob(noPublish).run(deps.db, now);
    const after = await deps.db.query<{ p: Date | null }>('select paused_at as p from trades where code = $1', [s.code]);
    expect(after.rows[0]!.p).toBeNull();
    expect((await deps.db.query('select 1 from held_trades where code = $1', [s.code])).rowCount).toBe(0);
  });

  it('lead review 8 Nov C2: the real timer loop never resumes a held trade, across passes and a maintenance on/off; it resumes after the hold', async () => {
    const t = await ownerWithCode();
    const partner = await trader();
    const { trade } = await seedTrade(deps, { sellerId: t.id, buyerId: partner.id, poster: 'buyer' });
    const s = await driveTo(deps, trade, 'secured');
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(200);
    const pausedAt = async () => (await deps.db.query<{ p: Date | null }>('select paused_at as p from trades where code = $1', [s.code])).rows[0]!.p;
    const held = await pausedAt();
    expect(held).not.toBeNull();
    const timers = startTimers({ db: deps.db, clock: deps.clock, maintenanceSince: () => siteMaintenanceSince(deps.db), intervalMs: 0 });
    try {
      const mine = async () => (await timers.tick()).applied.filter((a) => a.code === s.code);
      expect(await mine()).toEqual([]);
      later(10 * 60_000);
      expect(await mine()).toEqual([]);
      expect((await pausedAt())?.getTime()).toBe(held!.getTime());
      await deps.db.query('update site_flags set maintenance_since = $1, maintenance_kind = $2', [now, 'unplanned']);
      try {
        expect(await mine()).toEqual([]);
      } finally {
        await deps.db.query('update site_flags set maintenance_since = null, maintenance_kind = null');
      }
      expect(await mine()).toEqual([]);
      expect((await pausedAt())?.getTime()).toBe(held!.getTime());
      // The partner's mark-paid is still refused, and the trade's deadlines have not run.
      expect(errorOf(await partner.browser.post(`/v1/trades/${s.code}/events`, { type: 'mark-paid', fiatCents: FIAT.toString() }))).toBe('counterparty-unavailable');
      // The hold ends (a moderator): the sync resumes it, and the loop goes on as usual.
      expect(await endHoldByModerator(deps, t.id, { staffId: null })).toBe(true);
      expect(await pausedAt()).toBeNull();
      expect(await mine()).toEqual([]);
    } finally {
      await timers.stop();
    }
  });

  it('owner G7, lead review item 5: on a paused held trade the partner opens a dispute; the held account cannot', async () => {
    const t = await ownerWithCode();
    const partner = await trader();
    const { trade } = await seedTrade(deps, { sellerId: partner.id, buyerId: t.id, poster: 'seller' });
    // Batch 3's dispute rules (design review P1, owner p9-4, 8 Nov): either side disputes only once
    // the payment method's time from "I've paid" is over. Past it, so only the hold refuses here.
    // The confirm time (120 min) outlives the unchosen 2-hour session (batch 2): the partner takes 4 hours at login.
    expect((await partner.browser.put('/v1/account/session/length', { hours: 4 })).statusCode).toBe(200);
    const s = await driveTo(deps, trade, 'paid');
    setNow(new Date(s.confirmBy!.getTime() + 60_000));
    const rec = new Browser(app);
    expect((await backupLogin(rec, t.name, t.code)).statusCode).toBe(200);
    expect((await deps.db.query<{ p: Date | null }>('select paused_at as p from trades where code = $1', [s.code])).rows[0]!.p).not.toBeNull();
    const body = { reason: 'silent', note: 'The buyer went quiet.' };
    expect(errorOf(await rec.post(`/v1/trades/${s.code}/dispute`, body))).toBe('recovery-hold');
    const opened = await partner.browser.post(`/v1/trades/${s.code}/dispute`, body);
    expect(opened.statusCode).toBe(200);
    const row = await deps.db.query<{ state: string; p: Date | null }>('select state, paused_at as p from trades where code = $1', [s.code]);
    // Still paused: no money moves until a moderator decides.
    expect(row.rows[0]!.state).toBe('disputed');
    expect(row.rows[0]!.p).not.toBeNull();
  });

  it("the held account's own recovery session cannot move its held trades either", async () => {
    const t = await ownerWithCode();
    const partner = await trader();
    const { trade } = await seedTrade(deps, { sellerId: partner.id, buyerId: t.id, poster: 'seller' });
    const s = await driveTo(deps, trade, 'secured');
    const rec = new Browser(app);
    expect((await backupLogin(rec, t.name, t.code)).statusCode).toBe(200);
    expect(errorOf(await rec.post(`/v1/trades/${s.code}/events`, { type: 'mark-paid', fiatCents: FIAT.toString() }))).toBe('recovery-hold');
  });

  it("the owner's pre-existing passkey ends it: paused trades resume and the partner's flag goes", async () => {
    const t = await ownerWithPasskey();
    const partner = await trader();
    const { trade } = await seedTrade(deps, { sellerId: t.id, buyerId: partner.id, poster: 'buyer' });
    const s = await driveTo(deps, trade, 'secured');
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(200);
    expect((await passkeyLogin(new Browser(app), t.auth)).json()).toEqual({ status: 'ok' });
    const r = await deps.db.query<{ paused_at: Date | null }>('select paused_at from trades where code = $1', [s.code]);
    expect(r.rows[0]!.paused_at).toBeNull();
    expect((await partner.browser.get(`/v1/trades/${s.code}`)).json()).toMatchObject({ counterpartyProblem: false });
  });

  it("lead review 8 Nov I5, owner G7: the partner's buyer-cancel on a held funded trade is recorded; the escrow return waits for the hold's end", async () => {
    const t = await ownerWithCode();
    const partner = await trader();
    const { trade } = await seedTrade(deps, { sellerId: t.id, buyerId: partner.id, poster: 'buyer' });
    const s = await driveTo(deps, trade, 'secured');
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(200);
    const state = async () => (await deps.db.query<{ state: string; settling: string | null; p: Date | null }>('select state, settling, paused_at as p from trades where code = $1', [s.code])).rows[0]!;
    expect((await state()).p).not.toBeNull();
    const r = await partner.browser.post(`/v1/trades/${s.code}/events`, { type: 'buyer-cancel' });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toMatchObject({ cancelWaiting: true, counterpartyProblem: true });
    // Nothing moves: the trade is not settling, so no refund can be co-signed.
    expect(await state()).toMatchObject({ state: 'secured', settling: null });
    expect((await deps.db.query<{ c: Date | null }>('select cancel_requested_at as c from held_trades where code = $1', [s.code])).rows[0]!.c).not.toBeNull();
    // Asked again: still only recorded.
    expect((await partner.browser.post(`/v1/trades/${s.code}/events`, { type: 'buyer-cancel' })).statusCode).toBe(200);
    await syncHeldTradesJob(noPublish).run(deps.db, now);
    expect(await state()).toMatchObject({ state: 'secured', settling: null });
    // The hold ends: the trade resumes and the recorded cancel is carried out.
    expect(await endHoldByModerator(deps, t.id, { staffId: null })).toBe(true);
    expect(await state()).toEqual({ state: 'settling', settling: 'buyer-cancel', p: null });
    expect((await partner.browser.get(`/v1/trades/${s.code}`)).json()).toMatchObject({ cancelWaiting: false, counterpartyProblem: false });
    // Lead review 8 Nov: each recording is `trade.buyer-cancel-recorded`; `trade.buyer-cancel` once, when carried out.
    const logged = await deps.db.query<{ action: string }>(
      "select action from activity_log where trade_code = $1 and action like 'trade.buyer-cancel%' order by id",
      [s.code],
    );
    expect(logged.rows.map((x) => x.action)).toEqual(['trade.buyer-cancel-recorded', 'trade.buyer-cancel-recorded', 'trade.buyer-cancel']);
  });

  it("lead review 8 Nov R-C1: the held buyer's seller cannot forge the buyer's cancel (409 wrong-party); nothing is recorded and no refund follows the hold", async () => {
    const t = await ownerWithCode();
    const partner = await trader();
    const { trade } = await seedTrade(deps, { sellerId: partner.id, buyerId: t.id, poster: 'seller' });
    const s = await driveTo(deps, trade, 'secured');
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(200);
    const state = async () => (await deps.db.query<{ state: string; settling: string | null; p: Date | null }>('select state, settling, paused_at as p from trades where code = $1', [s.code])).rows[0]!;
    const asked = async () => (await deps.db.query<{ c: Date | null }>('select cancel_requested_at as c from held_trades where code = $1', [s.code])).rows.map((x) => x.c);
    expect((await state()).p).not.toBeNull();
    const r = await partner.browser.post(`/v1/trades/${s.code}/events`, { type: 'buyer-cancel' });
    expect(r.statusCode, r.body).toBe(409);
    expect(errorOf(r)).toBe('wrong-party');
    expect(await asked()).toEqual([null]);
    expect((await partner.browser.get(`/v1/trades/${s.code}`)).json()).toMatchObject({ cancelWaiting: false, counterpartyProblem: true });
    await syncHeldTradesJob(noPublish).run(deps.db, now);
    expect(await state()).toMatchObject({ state: 'secured', settling: null });
    // The hold ends: the trade resumes, still secured; no buyer-cancel is carried out.
    expect(await endHoldByModerator(deps, t.id, { staffId: null })).toBe(true);
    await syncHeldTradesJob(noPublish).run(deps.db, now);
    expect(await state()).toEqual({ state: 'secured', settling: null, p: null });
    expect((await deps.db.query('select 1 from held_trades where code = $1', [s.code])).rows).toHaveLength(0);
    const logged = await deps.db.query("select 1 from activity_log where trade_code = $1 and action like 'trade.buyer-cancel%'", [s.code]);
    expect(logged.rows).toHaveLength(0);
  });

  it("lead review 8 Nov R-C1: the held buyer's own buyer-cancel is refused (403 recovery-hold) and nothing is recorded", async () => {
    const t = await ownerWithCode();
    const partner = await trader();
    const { trade } = await seedTrade(deps, { sellerId: partner.id, buyerId: t.id, poster: 'seller' });
    const s = await driveTo(deps, trade, 'secured');
    const rec = new Browser(app);
    expect((await backupLogin(rec, t.name, t.code)).statusCode).toBe(200);
    expect(errorOf(await rec.post(`/v1/trades/${s.code}/events`, { type: 'buyer-cancel' }))).toBe('recovery-hold');
    expect((await deps.db.query<{ c: Date | null }>('select cancel_requested_at as c from held_trades where code = $1', [s.code])).rows.map((x) => x.c)).toEqual([null]);
    const row = await deps.db.query<{ state: string; settling: string | null }>('select state, settling from trades where code = $1', [s.code]);
    expect(row.rows[0]).toEqual({ state: 'secured', settling: null });
  });

  it('lead review 8 Nov I5 with batch 3\'s dispute rules: a buyer whose cancel is recorded cannot dispute before "I\'ve paid"; the cancel is carried out at the hold\'s end', async () => {
    // Batch 3 (design review P1, 8 Nov): the buyer disputes only after "I've paid", and buyer-cancel
    // only comes before it, so a trader can no longer open a dispute over a recorded cancel (the
    // held seller is refused by the hold). held.ts would let a dispute take the cancel's place (its
    // catch still handles a moderator's decision and the crash rerun); no trader route can now.
    const t = await ownerWithCode();
    const partner = await trader();
    const { trade } = await seedTrade(deps, { sellerId: t.id, buyerId: partner.id, poster: 'buyer' });
    const s = await driveTo(deps, trade, 'secured');
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(200);
    expect((await partner.browser.post(`/v1/trades/${s.code}/events`, { type: 'buyer-cancel' })).statusCode).toBe(200);
    expect(errorOf(await partner.browser.post(`/v1/trades/${s.code}/dispute`, { reason: 'silent', note: 'The seller went quiet.' }))).toBe('too-early');
    expect(await endHoldByModerator(deps, t.id, { staffId: null })).toBe(true);
    const row = await deps.db.query<{ state: string; settling: string | null }>('select state, settling from trades where code = $1', [s.code]);
    expect(row.rows[0]).toEqual({ state: 'settling', settling: 'buyer-cancel' });
  });

  it("a trade marked for cancelling that the machine no longer lets cancel (Fund escrow tapped meanwhile) is paused instead, by the minute job", async () => {
    const t = await ownerWithCode();
    const partner = await trader();
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(200);
    // The race the fallback is for: the row says `cancel` (written in the login's transaction), and
    // the seller's "Fund escrow" lands before the sync applies it. Rebuilt here as that state.
    const { trade } = await seedTrade(deps, { sellerId: t.id, buyerId: partner.id, poster: 'buyer' });
    const g = await driveTo(deps, trade, 'funding');
    await applyEvent(deps, g.code, { type: 'fund-started' }, 'seller');
    await deps.db.query("insert into held_trades (code, account_id, action, held_at) values ($1, $2, 'cancel', $3)", [g.code, t.id, now]);
    expect(await syncHeldTradesJob(noPublish).run(deps.db, now)).toBeGreaterThanOrEqual(1);
    const { rows } = await deps.db.query<{ state: string; paused_at: Date | null }>('select state, paused_at from trades where code = $1', [g.code]);
    expect(rows[0]!.state).toBe('funding');
    expect(rows[0]!.paused_at).not.toBeNull();
    expect((await deps.db.query<{ paused: string }>('select paused from held_trades where code = $1', [g.code])).rows[0]!.paused).toBe('paused');
    // The hold's end resumes it.
    later(HOLD_MS);
    await settleDueHolds(deps.config, app.events).run(deps.db, now);
    await syncHeldTradesJob(noPublish).run(deps.db, now);
    expect((await deps.db.query<{ paused_at: Date | null }>('select paused_at from trades where code = $1', [g.code])).rows[0]!.paused_at).toBeNull();
    expect((await deps.db.query('select 1 from held_trades where code = $1', [g.code])).rows).toHaveLength(0);
  });

  it("the held account's offers are not listed or taken", async () => {
    const t = await ownerWithCode();
    // Migration 490's shape (J-16): the offer, its currency, one band and one method.
    const offerId = await insertOffer(deps.db, { accountId: t.id, side: 'sell', methodId: 'ZELLE', currency: 'USD', min: 1000, max: 100000, at: now });
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(200);
    const buyer = await trader();
    expect((await buyer.browser.get(`/v1/offers/${offerId}`)).statusCode).toBe(404);
  });

  it('an authenticator code alone is no backup login any more (TOTP-only login is not allowed)', async () => {
    const t = await passwordTrader();
    await onboarding(t.id, new Date(now.getTime() + HOUR));
    const { secret } = await enrolTotp(t.b, t.id);
    await onboarding(t.id, null);
    const r = await new Browser(app).post('/v1/login/backup', { loginName: t.name, kind: 'totp', code: codeAt(secret, now), deviceLabel: 'X' });
    expect(errorOf(r)).toBe('method-not-allowed');
    expect(await accountHoldOf(t.id)).toBeNull();
  });

  it('moderator hook (no route yet): extend, then end; the trades resume', async () => {
    const t = await ownerWithCode();
    const partner = await trader();
    const { trade } = await seedTrade(deps, { sellerId: partner.id, buyerId: t.id, poster: 'seller' });
    const s = await driveTo(deps, trade, 'secured');
    const rec = new Browser(app);
    expect((await backupLogin(rec, t.name, t.code)).statusCode).toBe(200);
    const until = new Date(now.getTime() + 3 * HOLD_MS);
    await withTx(deps.db, async (db) => {
      await lockAccount(db, t.id);
      await extendHoldByModerator(db, t.id, until, now, { staffId: null });
    });
    expect(await accountHoldOf(t.id)).toEqual({ reason: 'recovery-code', until: until.toISOString() });
    later(HOLD_MS);
    expect(((await rec.get('/v1/account/me')).json() as { holdUntil: string }).holdUntil).toBe(until.toISOString());
    await endHoldByModerator(deps, t.id, { staffId: null }, app.events);
    expect(await accountHoldOf(t.id)).toBeNull();
    expect(await alertsOf(t.id, 'hold-ended')).toEqual([expect.objectContaining({ reason: 'moderator' })]);
    const r = await deps.db.query<{ paused_at: Date | null }>('select paused_at from trades where code = $1', [s.code]);
    expect(r.rows[0]!.paused_at).toBeNull();
  });
});

describe('a new device with nothing logged in to approve it', () => {
  it('a password alone is refused (no hold, no session); a password with its authenticator code too', async () => {
    const t = await passwordTrader();
    await t.b.post('/v1/logout');
    const r = await passwordLogin(new Browser(app), t.name);
    expect(r.statusCode).toBe(403);
    expect(errorOf(r)).toBe('approval-unavailable');
    expect(await accountHoldOf(t.id)).toBeNull();
    expect(await liveSessionsOf(t.id)).toBe(0);
    // The trusted sign-up browser still gets in.
    expect((await passwordLogin(t.b, t.name)).json()).toEqual({ status: 'ok' });
  });

  it('a PGP key alone gets in, with no hold', async () => {
    const key = await genKey();
    const name = unique('pgpv');
    const b = new Browser(app);
    const start = await b.post('/v1/register/pgp/start', { displayName: `G${name}`, loginName: name, publicKey: key.publicKey });
    const code = codeOf(await decrypt(start.json().encryptedMessage, key.privateKey));
    expect((await b.post('/v1/register/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'Laptop', acceptedTerms: TERMS, termsSignature: SIG })).statusCode).toBe(201);
    const id = (await accountIdByLoginName(deps, name))!;
    await onboarding(id, null);
    await b.post('/v1/logout');
    expect((await pgpLogin(new Browser(app), key, name)).json()).toEqual({ status: 'ok' });
    expect(await accountHoldOf(id)).toBeNull();
  });
});

describe('team member permissions from a password-only session', () => {
  it('a role change is staged like the other changes (202 staged), not refused', async () => {
    const t = await passwordTrader();
    // Batch 2 (owner 2 Nov 2026): team members are for vendor accounts only.
    await makeVendor(deps, t.id);
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, created_at)
       values ($1, 'Ann', 'ann', '{offers-see}', $2, $2) returning id`,
      [t.id, new Date(now.getTime() + HOUR)],
    );
    const memberId = rows[0]!.id;
    const confirmToken = await tokenFor(t.b, t.id, { kind: 'team-roles', memberId, roles: 'offers,trades' });
    const r = await t.b.patch(`/v1/team/members/${memberId}`, { roles: ['offers', 'trades'], confirmToken });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ status: 'staged' });
    // Job 1c: the member's boxes (migration 360) are unchanged until the staged change applies.
    const boxes = await deps.db.query<{ abilities: string[] }>('select abilities from team_members where id = $1', [memberId]);
    expect(boxes.rows[0]!.abilities).toEqual(['offers-see']);
  });
});

// Security review of wip/lead-seckey-fix: naming a key (PUT /v1/account/webauthn/label) is refused
// to a session whose changes must wait, during a hold, to a backup session and to a team member;
// a staged key has no row to name; names are unique per account; renames are budgeted.
describe('security review of wip/lead-seckey-fix: PUT /v1/account/webauthn/label', () => {
  const rename = (b: Browser, credentialId: string, label: string) => b.put('/v1/account/webauthn/label', { credentialId, label });
  const labelOf = async (credentialId: string) =>
    (await deps.db.query<{ label: string }>('select label from webauthn_credentials where credential_id = $1', [Buffer.from(credentialId, 'base64url')])).rows[0]?.label;

  async function strongOwner() {
    const t = await ownerWithPasskey();
    const strong = new Browser(app);
    expect((await passkeyLogin(strong, t.auth)).json()).toEqual({ status: 'ok' });
    return { ...t, strong };
  }

  it('a waiting (username and password) session is refused 403 weak-session; a passkey session names the key', async () => {
    const t = await strongOwner();
    const weak = await rename(t.b, t.auth.credentialId, 'Thief named it');
    expect([weak.statusCode, errorOf(weak)]).toEqual([403, 'weak-session']);
    expect(await labelOf(t.auth.credentialId)).toBe('Passkey 1');
    const ok = await rename(t.strong, t.auth.credentialId, 'My phone');
    expect([ok.statusCode, ok.json()]).toEqual([200, { label: 'My phone' }]);
    expect(await labelOf(t.auth.credentialId)).toBe('My phone');
  });

  it('a key staged by a waiting session has no row yet: 404 not-found, nothing written', async () => {
    const t = await strongOwner();
    const staged = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const add = await addPasskey(t.b, t.id, staged);
    expect([add.statusCode, add.json().status]).toEqual([202, 'staged']);
    const res = await rename(t.strong, staged.credentialId, 'Early name');
    expect([res.statusCode, errorOf(res)]).toEqual([404, 'not-found']);
    expect(await labelOf(staged.credentialId)).toBeUndefined();
  });

  it('a running hold refuses it (403 recovery-hold)', async () => {
    const t = await strongOwner();
    await withTx(deps.db, async (db) => {
      await lockAccount(db, t.id);
      await startHold(db, t.id, now, { reason: 'weak-change', startedBy: null });
    });
    const res = await rename(t.strong, t.auth.credentialId, 'During hold');
    expect([res.statusCode, errorOf(res)]).toEqual([403, 'recovery-hold']);
    expect(await labelOf(t.auth.credentialId)).toBe('Passkey 1');
  });

  it('a backup (recovery) session is refused 403 recovery-session; a team member 403 owner-only', async () => {
    const t = await strongOwner();
    const rec = new Browser(app);
    expect((await rec.post('/t/login', { accountId: t.id, level: 'recovery' })).statusCode).toBe(200);
    const r = await rename(rec, t.auth.credentialId, 'Backup named it');
    expect([r.statusCode, errorOf(r)]).toEqual([403, 'recovery-session']);

    const loginId = await seedAccount(deps, { loginName: unique('keymember'), displayName: unique('km-'), kind: 'member' });
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, $2, lower($2), $3, $4, $5, $4, $4)`,
      [t.id, unique('KeyMem'), rolesToAbilities(['offers', 'trades']), deps.clock(), loginId],
    );
    const mb = new Browser(app);
    expect((await mb.post('/t/login', { accountId: loginId })).statusCode).toBe(200);
    const m = await rename(mb, t.auth.credentialId, 'Member named it');
    expect([m.statusCode, errorOf(m)]).toEqual([403, 'owner-only']);
    expect(await labelOf(t.auth.credentialId)).toBe('Passkey 1');
  });

  it('a staff account is refused (traders only: staff keys are managed on the staff API), nothing written', async () => {
    const staffId = await seedAccount(deps, { loginName: unique('keystaff'), kind: 'staff' });
    const auth = createSoftAuthenticator({ backedUp: false, userVerified: true });
    await deps.db.query(
      `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, attested, label, created_at)
       values ($1, $2, $3, 0, 'security-key', false, 'singleDevice', true, 'Staff key', $4)`,
      [staffId, Buffer.from(auth.credentialId, 'base64url'), auth.cosePublicKey, now],
    );
    const sb = new Browser(app);
    expect((await sb.post('/t/login', { accountId: staffId })).statusCode).toBe(200);
    const res = await rename(sb, auth.credentialId, 'Renamed');
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('wrong-account-kind');
    expect(await labelOf(auth.credentialId)).toBe('Staff key');
  });

  it("a name another of the account's keys has (trimmed, any case) is 400 key-name-invalid { reason: 'taken' }; its own name is fine", async () => {
    const t = await strongOwner();
    const second = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const confirmToken = await issueConfirmToken(deps, { sessionId: await sessionOf(t.strong), accountId: t.id, action: { kind: 'add-method', method: 'passkey' }, method: 'passkey' });
    const s = await t.strong.post('/v1/account/webauthn/start', { kind: 'passkey', confirmToken });
    expect((await t.strong.post('/v1/account/webauthn/finish', { challengeId: s.json().challengeId, response: second.register(s.json().options, ORIGIN) })).statusCode).toBe(201);
    expect(await labelOf(second.credentialId)).toBe('Passkey 2');
    const dup = await rename(t.strong, second.credentialId, '  passKEY 1 ');
    expect([dup.statusCode, dup.json()]).toEqual([400, { error: 'key-name-invalid', reason: 'taken' }]);
    expect(await labelOf(second.credentialId)).toBe('Passkey 2');
    expect((await rename(t.strong, t.auth.credentialId, 'PASSKEY 1')).json()).toEqual({ label: 'PASSKEY 1' });
  });

  it('renames are budgeted per account (10, then 429 slow-down), so a loop cannot flood Jabber notices', async () => {
    const t = await strongOwner();
    for (let i = 1; i <= 10; i++) expect((await rename(t.strong, t.auth.credentialId, `Name ${i}`)).statusCode, `rename ${i}`).toBe(200);
    const over = await rename(t.strong, t.auth.credentialId, 'Name 11');
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ error: 'slow-down' });
    expect(await labelOf(t.auth.credentialId)).toBe('Name 10');
    // Another account has its own budget.
    const other = await strongOwner();
    expect((await rename(other.strong, other.auth.credentialId, 'Fine')).statusCode).toBe(200);
  });
});
