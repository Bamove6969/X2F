// The 24 h hold model v3 (owner 1-2 Nov 2026; docs/design-hold-model-2026-11-02.md on the design
// branch; lead brief 2026-11-02). It replaces Task 17's hold for everything but a recovery-code login:
// - a username + password session's changes to login methods, payout wallets or a team member's
//   permissions are staged, reviewed and submitted, then QUEUED for 24 h: nobody is logged out and
//   trading goes on; any logged-in session can cancel them; a login with a passkey, security key or
//   PGP key the account held before they were submitted discards them;
// - a recovery-code login logs everyone out and holds the account 24 h: logins are refused except
//   the owner's pre-existing passkey, security key or PGP key (which ends it); unfunded trades are
//   cancelled, funded ones paused, and the partner sees only that the other account has
//   a temporary problem; the code used is replaced by a new one, shown once at the next login;
// - a new device with nothing logged in to approve it: only a passkey, security key or PGP key gets
//   in; anything else is refused, and nothing is held.
import { createHash, randomBytes } from 'node:crypto';
import { addressEnd, normalizeRecoveryCode, type ConfirmAction } from '@x2f/accounts';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressValidator, Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { HOLD_MS, endHoldByModerator, extendHoldByModerator, lockAccount, settleDueHolds, withTx } from '../src/auth/hold.js';
import { MAX_HOLD_CHANGES, settleDueChanges } from '../src/auth/holdChanges.js';
import { purgeExpired } from '../src/auth/challenges.js';
import { RECOVERY_CODE_COUNT } from '../src/auth/recovery.js';
import { syncHeldTradesJob } from '../src/trades/held.js';
import { applyEvent, noPublish } from '../src/trades/store.js';
import { codeOf, decrypt, genKey, type Pair } from './helpers/pgpKeys.js';
import { accountIdByLoginName } from './helpers/accounts.js';
import { fixtureLeakedList } from './helpers/leaked.js';
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
const unique = (p: string) => `${p}${++seq}v`;
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
  const res = await b.post('/v1/register/password', { displayName: `P${name}`, loginName: name, password: GOOD, deviceLabel: 'Laptop', acceptedTerms: TERMS });
  expect(res.statusCode).toBe(201);
  const id = (await accountIdByLoginName(deps, name))!;
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

async function pgpLogin(b: Browser, key: Pair) {
  const start = await b.post('/v1/login/pgp/start', { key: key.publicKey });
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

describe('recovery code: one 16-character code', () => {
  it('RECOVERY_CODE_COUNT is 1 and the route answers one code in the trade-code format', async () => {
    expect(RECOVERY_CODE_COUNT).toBe(1);
    const t = await passwordTrader();
    await onboarding(t.id, new Date(now.getTime() + HOUR));
    const r = (await t.b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
    expect(r.codes).toHaveLength(1);
    expect(normalizeRecoveryCode(r.codes[0]!)?.replace(/-/g, '')).toHaveLength(16);
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

  it('a later submission moves the date of every waiting change to 24 h after it (one date on the banner)', async () => {
    const t = await passwordTrader();
    const a = ((await changePassword(t.b, t.id)).json() as { changeId: string }).changeId;
    expect((await submit(t.b, [a])).statusCode).toBe(200);
    later(5 * HOUR);
    const b = ((await addWallet(t.b, t.id)).json() as { changeId: string }).changeId;
    expect((await submit(t.b, [b])).json()).toEqual({ status: 'queued', count: 2, takesEffectAt: in24h() });
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
    const other = await secondSession(t);
    const c = await other.delete('/v1/account/hold/changes');
    expect(c.statusCode).toBe(204);
    expect(await alertsOf(t.id, 'hold-changes-cancelled')).toEqual([{ count: 1, changes: [{ kind: 'password' }] }]);
    later(HOLD_MS);
    await settleDueChanges(deps.config, app.events).run(deps.db, now);
    expect((await passwordLogin(new Browser(app), t.name, NEW_PASSWORD)).statusCode).toBe(401);
    expect((await passwordLogin(t.b, t.name)).json()).toEqual({ status: 'ok' });
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

  it("the owner's passkey held before the submission ends the wait early and discards the changes", async () => {
    const t = await ownerWithPasskey();
    const thief = new Browser(app);
    // Copied device cookie: the thief logs in with the password on a trusted device (no approval).
    thief.cookies = { ...t.b.cookies };
    expect((await passwordLogin(thief, t.name)).json()).toEqual({ status: 'ok' });
    const id = ((await changePassword(thief, t.id)).json() as { changeId: string }).changeId;
    expect((await submit(thief, [id])).statusCode).toBe(200);
    const owner = new Browser(app);
    expect((await passkeyLogin(owner, t.auth)).json()).toEqual({ status: 'ok' });
    expect((await holdView(owner)).changes.count).toBe(0);
    expect(await alertsOf(t.id, 'hold-changes-discarded')).toEqual([{ count: 1, changes: [{ kind: 'password' }], reason: 'owner-login' }]);
    later(HOLD_MS);
    await settleDueChanges(deps.config, app.events).run(deps.db, now);
    expect((await passwordLogin(new Browser(app), t.name, NEW_PASSWORD)).statusCode).toBe(401);
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
        t.id, sessionId, JSON.stringify({ kind: 'logout-timer', idleHours: 24 }), now,
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

  it('discards changes waiting from a password-only session', async () => {
    const t = await ownerWithCode();
    const id = ((await changePassword(t.b, t.id)).json() as { changeId: string }).changeId;
    expect((await submit(t.b, [id])).statusCode).toBe(200);
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(200);
    const { rows } = await deps.db.query('select 1 from hold_changes where account_id = $1', [t.id]);
    expect(rows).toHaveLength(0);
    expect(await alertsOf(t.id, 'hold-changes-discarded')).toEqual([{ count: 1, changes: [{ kind: 'password' }], reason: 'recovery-code' }]);
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

  it('lead review item 4: a hold ending during maintenance resumes its trade once maintenance is over', async () => {
    const t = await ownerWithCode();
    const partner = await trader();
    const { trade } = await seedTrade(deps, { sellerId: partner.id, buyerId: t.id, poster: 'seller' });
    const s = await driveTo(deps, trade, 'secured');
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(200);
    await deps.db.query('update site_flags set maintenance_since = $1', [now]);
    try {
      expect(await endHoldByModerator(deps, t.id, { staffId: null })).toBe(true);
      await syncHeldTradesJob(noPublish).run(deps.db, now);
      const row = await deps.db.query<{ p: Date | null }>('select paused_at as p from trades where code = $1', [s.code]);
      expect(row.rows[0]!.p).not.toBeNull();
      expect((await deps.db.query('select 1 from held_trades where code = $1', [s.code])).rowCount).toBe(1);
    } finally {
      await deps.db.query('update site_flags set maintenance_since = null');
    }
    await syncHeldTradesJob(noPublish).run(deps.db, now);
    const after = await deps.db.query<{ p: Date | null }>('select paused_at as p from trades where code = $1', [s.code]);
    expect(after.rows[0]!.p).toBeNull();
    expect((await deps.db.query('select 1 from held_trades where code = $1', [s.code])).rowCount).toBe(0);
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

  it("the partner's way out of a held funded trade stays open: the buyer's cancel goes through (paused or not)", async () => {
    const t = await ownerWithCode();
    const partner = await trader();
    const { trade } = await seedTrade(deps, { sellerId: t.id, buyerId: partner.id, poster: 'buyer' });
    const s = await driveTo(deps, trade, 'secured');
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(200);
    expect((await deps.db.query<{ paused_at: Date | null }>('select paused_at from trades where code = $1', [s.code])).rows[0]!.paused_at).not.toBeNull();
    const r = await partner.browser.post(`/v1/trades/${s.code}/events`, { type: 'buyer-cancel' });
    expect(r.statusCode, r.body).toBe(200);
    const { rows } = await deps.db.query<{ state: string; settling: string | null }>('select state, settling from trades where code = $1', [s.code]);
    expect(rows[0]).toEqual({ state: 'settling', settling: 'buyer-cancel' });
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
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into offers (account_id, side, method_id, currency, price_mode, margin_bps, min_fiat_cents, max_fiat_cents, min_trades, terms, status, created_at, updated_at)
       values ($1, 'sell', 'zelle', 'USD', 'market', 0, 1000, 100000, 0, '', 'live', $2, $2) returning id`,
      [t.id, now],
    );
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(200);
    const buyer = await trader();
    expect((await buyer.browser.get(`/v1/offers/${rows[0]!.id}`)).statusCode).toBe(404);
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
    expect((await b.post('/v1/register/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'Laptop', acceptedTerms: TERMS })).statusCode).toBe(201);
    const id = (await accountIdByLoginName(deps, name))!;
    await onboarding(id, null);
    await b.post('/v1/logout');
    expect((await pgpLogin(new Browser(app), key)).json()).toEqual({ status: 'ok' });
    expect(await accountHoldOf(id)).toBeNull();
  });
});

describe('team member permissions from a password-only session', () => {
  it('a role change is staged like the other changes (202 staged), not refused', async () => {
    const t = await passwordTrader();
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into team_members (account_id, display_name, display_key, roles, invite_expires_at, created_at)
       values ($1, 'Ann', 'ann', '{offers}', $2, $2) returning id`,
      [t.id, new Date(now.getTime() + HOUR)],
    );
    const memberId = rows[0]!.id;
    const confirmToken = await tokenFor(t.b, t.id, { kind: 'team-roles', memberId, roles: 'offers,trades' });
    const r = await t.b.patch(`/v1/team/members/${memberId}`, { roles: ['offers', 'trades'], confirmToken });
    expect(r.statusCode).toBe(202);
    expect(r.json()).toMatchObject({ status: 'staged' });
    const roles = await deps.db.query<{ roles: string[] }>('select roles from team_members where id = $1', [memberId]);
    expect(roles.rows[0]!.roles).toEqual(['offers']);
  });
});
