// Plan 2 Task 17 (owner 2026-10-29 13:23 and 14:12; R42): login strength and the 24-hour hold.
// One block per row of the owner's rule, then the attacks of review 2026-10-30 (C1, C2, I1-I3,
// M1, M2, M4-M6, M9), each through the real routes.
import { readFileSync } from 'node:fs';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { HOLD_BLOCKED_ROUTES, HOLD_MS, SECURITY_CHANGE_ROUTES, settleDueHolds } from '../src/auth/hold.js';
import { STRONG_COMBOS, loginStrength } from '../src/auth/strength.js';
import { codeOf, decrypt, genKey, type Pair } from './helpers/pgpKeys.js';
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
const T0 = new Date('2026-10-17T12:00:00Z');

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let step = 0;
let trader: Awaited<ReturnType<typeof tradeApp>>['trader'];
let cleanup: () => Promise<void>;
let leaked: Deps['leaked'];

beforeAll(async () => {
  const fixture = await fixtureLeakedList();
  cleanup = fixture.cleanup;
  leaked = fixture.list;
  let set: (d: Date) => void;
  ({ app, deps, setNow: set, trader } = await tradeApp({}, { leaked }));
  setNow = (d) => {
    now = d;
    set(d);
  };
  // I2: a switch that makes starting a hold fail for one account, to prove nothing commits without it.
  await deps.db.query(`
    create table t_fail_holds (account_id uuid primary key);
    create function t_fail_hold() returns trigger language plpgsql as $$
    begin
      if exists (select 1 from t_fail_holds where account_id = new.account_id) then raise exception 'injected failure'; end if;
      return new;
    end $$;
    create trigger t_fail_hold before insert on account_holds for each row execute function t_fail_hold();`);
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
const unique = (p: string) => `${p}${++seq}x`;
const errorOf = (r: LightMyRequestResponse) => (r.json() as { error?: string }).error;

/** The account's hold row as the test needs it, or null. */
async function holdOf(d: Deps, accountId: string): Promise<{ until: string; reason: string; pending: string | null } | null> {
  const { rows } = await d.db.query<{ hold_until: Date; reason: string; pending: string | null }>(
    "select hold_until, reason, pending_change->>'kind' as pending from account_holds where account_id = $1",
    [accountId],
  );
  const r = rows[0];
  return r ? { until: r.hold_until.toISOString(), reason: r.reason, pending: r.pending } : null;
}

const in24h = () => new Date(now.getTime() + HOLD_MS).toISOString();

async function alertsOf(d: Deps, accountId: string, kind: string): Promise<unknown[]> {
  const { rows } = await d.db.query<{ detail: unknown }>('select detail from alerts where account_id = $1 and kind = $2 order by created_at, id', [accountId, kind]);
  return rows.map((r) => r.detail);
}

/** Sets the account's sessions' 30-minute set-up window (`until`) or ends it (null). */
const onboarding = (d: Deps, accountId: string, until: Date | null) =>
  d.db.query('update sessions set onboarding_until = $2 where account_id = $1', [accountId, until]);

/** A password trader signed up in `b` (its sign-up session stays open there, its set-up window over). */
async function passwordTrader(a: FastifyInstance = app, d: Deps = deps, b = new Browser(a)) {
  const name = unique('cool');
  const res = await b.post('/v1/register/password', { displayName: `P${name}`, loginName: name, password: GOOD, deviceLabel: 'Laptop', acceptedTerms: TERMS });
  expect(res.statusCode).toBe(201);
  const { rows } = await d.db.query<{ id: string }>('select id from accounts where login_key = $1', [name.toLowerCase()]);
  const id = rows[0]!.id;
  await onboarding(d, id, null);
  return { b, name, id };
}

const passwordLogin = (b: Browser, name: string, password = GOOD) => b.post('/v1/login/password', { loginName: name, password, deviceLabel: 'Firefox on Linux' });

/** The id of the session browser `b` holds. */
async function sessionOf(b: Browser): Promise<string> {
  const res = await b.get('/v1/account/sessions');
  expect(res.statusCode).toBe(200);
  return (res.json() as Array<{ id: string; current: boolean }>).find((s) => s.current)!.id;
}

/** A confirm token for `action` on the session of browser `b` (the confirm routes are tested elsewhere). */
async function tokenFor(d: Deps, b: Browser, accountId: string, action: Parameters<typeof issueConfirmToken>[1]['action']) {
  return issueConfirmToken(d, { sessionId: await sessionOf(b), accountId, action, method: 'password' });
}

/** Signs up a passkey trader in `b`; returns its authenticator. */
async function passkeyTrader(b = new Browser(app)): Promise<{ b: Browser; id: string; name: string; auth: SoftAuthenticator }> {
  const auth = createSoftAuthenticator({ backedUp: true, userVerified: true });
  const name = unique('passkeyuser');
  const start = (await b.post('/v1/register/webauthn/start', { displayName: `D.${name}`, loginName: name, kind: 'passkey' })).json();
  expect((await b.post('/v1/register/webauthn/finish', { challengeId: start.challengeId, response: auth.register(start.options, ORIGIN), deviceLabel: 'Phone', acceptedTerms: TERMS })).statusCode).toBe(201);
  const { rows } = await deps.db.query<{ id: string }>('select id from accounts where login_key = $1', [name.toLowerCase()]);
  await onboarding(deps, rows[0]!.id, null);
  return { b, id: rows[0]!.id, name, auth };
}

async function passkeyLogin(b: Browser, auth: SoftAuthenticator) {
  const s = (await b.post('/v1/login/webauthn/start', {})).json();
  return b.post('/v1/login/webauthn/finish', { challengeId: s.challengeId, response: auth.authenticate(s.options, ORIGIN), deviceLabel: 'Phone' });
}

/** Adds a passkey from the session of `b` through the real routes; returns the finish answer (or the refused start). */
async function addPasskey(d: Deps, b: Browser, accountId: string, auth: SoftAuthenticator) {
  const confirmToken = await tokenFor(d, b, accountId, { kind: 'add-method', method: 'passkey' });
  const s = await b.post('/v1/account/webauthn/start', { kind: 'passkey', confirmToken });
  if (s.statusCode !== 200) return s;
  return b.post('/v1/account/webauthn/finish', { challengeId: s.json().challengeId, response: auth.register(s.json().options, ORIGIN) });
}

/** Enrols TOTP from the session of `b` through the real routes; returns the finish answer (or the refused start) and the secret. */
async function enrolTotp(d: Deps, b: Browser, accountId: string, at: () => Date) {
  const confirmToken = await tokenFor(d, b, accountId, { kind: 'add-method', method: 'totp' });
  const s = await b.post('/v1/account/totp/start', { confirmToken });
  if (s.statusCode !== 200) return { res: s, secret: '' };
  const { challengeId, secret } = s.json() as { challengeId: string; secret: string };
  return { res: await b.post('/v1/account/totp/finish', { challengeId, code: codeAt(secret, at()) }), secret };
}

async function changePassword(d: Deps, b: Browser, accountId: string, password = NEW_PASSWORD) {
  const confirmToken = await tokenFor(d, b, accountId, { kind: 'set-password' });
  return b.put('/v1/account/password', { password, confirmToken });
}

async function removeMethod(a: FastifyInstance, d: Deps, b: Browser, accountId: string, type: 'passkey' | 'pgp' | 'password', id: string) {
  const confirmToken = await tokenFor(d, b, accountId, { kind: 'remove-method', method: type, id });
  return b.keep(await a.inject({ method: 'DELETE', url: `/v1/account/methods/${type}/${id}`, headers: { origin: ORIGIN }, cookies: b.cookies, payload: { confirmToken } }));
}

async function methodsOf(b: Browser): Promise<Array<{ type: string; id: string }>> {
  return (await b.get('/v1/account/methods')).json() as Array<{ type: string; id: string }>;
}

/** Signs up a PGP-only trader in a new browser; returns it and the key. */
async function pgpTrader(): Promise<{ b: Browser; id: string; key: Pair }> {
  const key = await genKey();
  const name = unique('pgpuser');
  const b = new Browser(app);
  const start = await b.post('/v1/register/pgp/start', { displayName: `G${name}`, loginName: name, publicKey: key.publicKey });
  const code = codeOf(await decrypt(start.json().encryptedMessage, key.privateKey));
  expect((await b.post('/v1/register/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'Laptop', acceptedTerms: TERMS })).statusCode).toBe(201);
  const { rows } = await deps.db.query<{ id: string }>('select id from accounts where login_key = $1', [name.toLowerCase()]);
  await onboarding(deps, rows[0]!.id, null);
  return { b, id: rows[0]!.id, key };
}

async function pgpLogin(b: Browser, key: Pair) {
  const start = await b.post('/v1/login/pgp/start', { key: key.publicKey });
  const code = codeOf(await decrypt(start.json().encryptedMessage, key.privateKey));
  return b.post('/v1/login/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'Laptop' });
}

/** A weak session for the account in `b`: the trusted sign-up browser logs out and back in with the password alone (no approval, no hold; review M9's path). */
async function weakAgain(b: Browser, name: string, id: string, d: Deps = deps) {
  await b.post('/v1/logout');
  expect((await passwordLogin(b, name)).json()).toEqual({ status: 'ok' });
  expect(await holdOf(d, id)).toBeNull();
}

describe("login strength: the owner's list of 14:12, exactly", () => {
  it('strong only for the listed combinations (or a login proving more than one of them)', () => {
    expect(STRONG_COMBOS).toEqual([
      ['passkey'], ['security-key'], ['password', 'totp'], ['password', 'passkey'], ['password', 'security-key'], ['pgp', 'passkey'], ['pgp', 'security-key'],
    ]);
    for (const combo of STRONG_COMBOS) expect(loginStrength(combo)).toBe('strong');
    expect(loginStrength(['passkey', 'totp'])).toBe('strong');
  });

  it('PGP alone waits (pgp-single); every other single way, and any unlisted pair, waits (weak-single)', () => {
    expect(loginStrength(['pgp'])).toBe('pgp-single');
    expect(loginStrength(['password'])).toBe('weak-single');
    expect(loginStrength(['totp'])).toBe('weak-single');
    expect(loginStrength(['recovery-code'])).toBe('weak-single');
    // Two kinds that are not on the owner's list are not strong (review I1).
    expect(loginStrength(['totp', 'recovery-code'])).toBe('weak-single');
    expect(loginStrength(['pgp', 'password'])).toBe('weak-single');
    expect(loginStrength(['pgp', 'totp'])).toBe('weak-single');
  });
});

describe('good security: no wait', () => {
  it('a passkey on its own on a new device with nothing logged in', async () => {
    const { b, id, auth } = await passkeyTrader();
    await b.post('/v1/logout');
    expect((await passkeyLogin(new Browser(app), auth)).json()).toEqual({ status: 'ok' });
    expect(await holdOf(deps, id)).toBeNull();
  });

  it('a password with its authenticator code on a new device with nothing logged in', async () => {
    const { b, name, id } = await passwordTrader();
    await onboarding(deps, id, new Date(now.getTime() + HOUR));
    const { res, secret } = await enrolTotp(deps, b, id, () => now);
    expect(res.statusCode).toBe(200);
    await b.post('/v1/logout');
    setNow(new Date(now.getTime() + 60_000));
    const fresh = new Browser(app);
    const first = (await passwordLogin(fresh, name)).json() as { pendingId: string };
    expect((await fresh.post('/v1/login/second-factor', { pendingId: first.pendingId, code: codeAt(secret, now) })).json()).toEqual({ status: 'ok' });
    expect(await holdOf(deps, id)).toBeNull();
  });

  it('a strong session changing its login methods applies at once and starts no wait', async () => {
    const { b, id } = await passkeyTrader();
    const token = await tokenFor(deps, b, id, { kind: 'new-recovery-codes' });
    const res = await b.post('/v1/account/recovery-codes', { confirmToken: token });
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toHaveProperty('status');
    expect(await holdOf(deps, id)).toBeNull();
  });
});

describe('one weak way', () => {
  it('a password alone that changes the password: the hold starts, the change waits, the old password still works', async () => {
    const { b, name, id } = await passwordTrader();
    await weakAgain(b, name, id);
    const send = vi.spyOn(app.push, 'send');
    const res = await changePassword(deps, b, id);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'held', holdUntil: in24h() });
    expect(await holdOf(deps, id)).toEqual({ until: in24h(), reason: 'weak-change', pending: 'password' });
    expect((await b.get('/v1/account/me')).json()).toMatchObject({ accountHoldUntil: in24h() });
    expect(await alertsOf(deps, id, 'hold-started')).toEqual([{ holdUntil: in24h(), reason: 'weak-change', change: 'password' }]);
    expect(send).toHaveBeenCalledWith(id, 'alert');
    // Nothing changed yet: the new password does not log in, the old one does.
    expect(errorOf(await passwordLogin(new Browser(app), name, NEW_PASSWORD))).toBe('credentials-invalid');
    expect((await passwordLogin(new Browser(app), name)).json()).toMatchObject({ status: 'approve-on-device' });
  });

  it('the hold ends by time and the waiting change applies (the minute job)', async () => {
    const { b, name, id } = await passwordTrader();
    await weakAgain(b, name, id);
    expect((await changePassword(deps, b, id)).statusCode).toBe(202);
    const job = settleDueHolds(deps.config, app.events);
    setNow(new Date(now.getTime() + HOLD_MS - 1));
    await job.run(deps.db, now);
    expect(await holdOf(deps, id)).not.toBeNull();
    setNow(new Date(now.getTime() + 1));
    expect(await job.run(deps.db, now)).toBeGreaterThanOrEqual(1);
    expect(await holdOf(deps, id)).toBeNull();
    expect(await alertsOf(deps, id, 'hold-ended')).toEqual([{ reason: 'time', change: 'password', applied: true }]);
    // The new password works now, the old one no longer.
    expect(errorOf(await passwordLogin(new Browser(app), name))).toBe('credentials-invalid');
    expect((await passwordLogin(b, name, NEW_PASSWORD)).json()).toEqual({ status: 'ok' });
  });

  it('a hold whose time is up also ends at the next check (no job needed)', async () => {
    const t = await passwordTrader();
    await weakAgain(t.b, t.name, t.id);
    expect((await changePassword(deps, t.b, t.id)).statusCode).toBe(202);
    setNow(new Date(now.getTime() + HOLD_MS));
    // The next login on the trusted browser settles it before anything else (its session has idled out).
    expect((await passwordLogin(t.b, t.name)).json()).toEqual({ status: 'ok' });
    expect(await holdOf(deps, t.id)).toBeNull();
    expect((await t.b.get('/v1/account/me')).json()).toMatchObject({ accountHoldUntil: null });
    await t.b.post('/v1/logout');
    expect((await passwordLogin(t.b, t.name, NEW_PASSWORD)).json()).toEqual({ status: 'ok' });
  });

  it('a password alone on a new device with nothing logged in to approve it waits 24 hours at once', async () => {
    const { b, name, id } = await passwordTrader();
    await b.post('/v1/logout');
    expect((await passwordLogin(new Browser(app), name)).json()).toEqual({ status: 'ok' });
    expect(await holdOf(deps, id)).toEqual({ until: in24h(), reason: 'weak-new-device', pending: null });
  });

  it('PGP alone on a new device with nothing logged in waits too (review I1)', async () => {
    const { b, id, key } = await pgpTrader();
    await b.post('/v1/logout');
    expect((await pgpLogin(new Browser(app), key)).json()).toEqual({ status: 'ok' });
    expect(await holdOf(deps, id)).toEqual({ until: in24h(), reason: 'weak-new-device', pending: null });
  });

  it('PGP alone during a hold neither skips the approval nor ends the hold (review I1)', async () => {
    const { b, id, key } = await pgpTrader();
    // The PGP session changes a security setting: it waits (PGP alone is one way).
    const confirmToken = await tokenFor(deps, b, id, { kind: 'new-recovery-codes' });
    expect((await b.post('/v1/account/recovery-codes', { confirmToken })).statusCode).toBe(202);
    expect((await pgpLogin(new Browser(app), key)).json()).toMatchObject({ status: 'approve-on-device' });
    expect(await holdOf(deps, id)).not.toBeNull();
  });

  it('a password alone on a new device approved by a logged-in device: no wait at login, and nothing about the devices before approval (M5)', async () => {
    const { b, name, id } = await passwordTrader();
    const fresh = new Browser(app);
    const wait = (await passwordLogin(fresh, name)).json() as { approvalId: string; number: number };
    expect(Object.keys(wait).sort()).toEqual(['approvalId', 'expiresAt', 'number', 'status']);
    expect((await b.post(`/v1/account/approvals/${wait.approvalId}`, { choice: wait.number })).json()).toEqual({ outcome: 'approved' });
    expect((await fresh.post(`/v1/login/approval/${wait.approvalId}/poll`)).json()).toMatchObject({ status: 'ok' });
    expect(await holdOf(deps, id)).toBeNull();
  });

  it('an approval stays open 5 minutes (review M4)', async () => {
    const { name } = await passwordTrader();
    const wait = (await passwordLogin(new Browser(app), name)).json() as { expiresAt: string };
    expect(wait.expiresAt).toBe(new Date(now.getTime() + 5 * 60_000).toISOString());
  });

  it("an authenticator code alone (backup login): a held session and the account's hold", async () => {
    const { b, name, id } = await passwordTrader();
    await onboarding(deps, id, new Date(now.getTime() + HOUR));
    const { secret } = await enrolTotp(deps, b, id, () => now);
    setNow(new Date(now.getTime() + 60_000));
    const res = await new Browser(app).post('/v1/login/backup', { loginName: name, kind: 'totp', code: codeAt(secret, now), deviceLabel: 'X' });
    expect(res.json()).toMatchObject({ status: 'ok', level: 'recovery', holdUntil: in24h() });
    expect(await holdOf(deps, id)).toEqual({ until: in24h(), reason: 'weak-backup-login', pending: null });
  });

  it("a recovery code alone (backup login): a held session and the account's hold", async () => {
    const { b, name, id } = await passwordTrader();
    await onboarding(deps, id, new Date(now.getTime() + HOUR));
    const { codes } = (await b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
    const res = await new Browser(app).post('/v1/login/backup', { loginName: name, kind: 'recovery-code', code: codes[0]!, deviceLabel: 'X' });
    expect(res.json()).toEqual({ status: 'ok', level: 'recovery', holdUntil: in24h() });
    expect(await holdOf(deps, id)).toEqual({ until: in24h(), reason: 'weak-backup-login', pending: null });
  });

  it('the sign-up session setting the account up starts no wait', async () => {
    const b = new Browser(app);
    const name = unique('cool');
    await b.post('/v1/register/password', { displayName: `P${name}`, loginName: name, password: GOOD, deviceLabel: 'Laptop', acceptedTerms: TERMS });
    expect((await b.post('/v1/account/recovery-codes', {})).statusCode).toBe(200);
    const { rows } = await deps.db.query<{ id: string }>('select id from accounts where login_key = $1', [name.toLowerCase()]);
    expect(await holdOf(deps, rows[0]!.id)).toBeNull();
  });

  it('the logout timer is a security change (review M2)', async () => {
    const { b, name, id } = await passwordTrader();
    await weakAgain(b, name, id);
    const res = await b.put('/v1/account/security/logout-timer', { idleHours: 2 });
    expect(res.statusCode).toBe(202);
    expect(await holdOf(deps, id)).toMatchObject({ pending: 'logout-timer' });
    const { rows } = await deps.db.query<{ idle_hours: number }>('select idle_hours from accounts where id = $1', [id]);
    expect(rows[0]!.idle_hours).toBe(12);
  });
});

describe('C1: a weak session cannot add a method and use it to skip the approval or end the hold (real clock)', () => {
  let real: Awaited<ReturnType<typeof tradeApp>>;

  beforeAll(async () => {
    real = await tradeApp({}, { leaked, clock: () => new Date() });
  });

  afterAll(async () => {
    await real.app.close();
  });

  it("webauthn/finish from a weak session: 202, nothing stored; the thief's passkey logs in nowhere; the owner's pre-hold passkey ends the hold", async () => {
    const owner = await passwordTrader(real.app, real.deps);
    const ownerKey = createSoftAuthenticator({ backedUp: true, userVerified: true });
    // The owner set up a passkey earlier (here inside the sign-up window, applied at once).
    await onboarding(real.deps, owner.id, new Date(Date.now() + HOUR));
    expect((await addPasskey(real.deps, owner.b, owner.id, ownerKey)).statusCode).toBe(201);
    await onboarding(real.deps, owner.id, null);

    // The thief has the password and a browser the owner approved by mistake.
    const thief = new Browser(real.app);
    const wait = (await passwordLogin(thief, owner.name)).json() as { approvalId: string; number: number };
    expect((await owner.b.post(`/v1/account/approvals/${wait.approvalId}`, { choice: wait.number })).json()).toEqual({ outcome: 'approved' });
    expect((await thief.post(`/v1/login/approval/${wait.approvalId}/poll`)).json()).toMatchObject({ status: 'ok' });
    expect(await holdOf(real.deps, owner.id)).toBeNull();

    const thiefKey = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const added = await addPasskey(real.deps, thief, owner.id, thiefKey);
    expect(added.statusCode).toBe(202);
    expect(added.json()).toMatchObject({ status: 'held' });
    const stored = await real.deps.db.query('select 1 from webauthn_credentials where account_id = $1', [owner.id]);
    expect(stored.rows).toHaveLength(1); // the owner's only
    expect(await holdOf(real.deps, owner.id)).toMatchObject({ reason: 'weak-change', pending: 'webauthn' });

    // The thief's passkey logs in nowhere: no skipped approval, no ended hold.
    expect((await passkeyLogin(new Browser(real.app), thiefKey)).statusCode).toBe(401);
    expect(await holdOf(real.deps, owner.id)).not.toBeNull();
    // Nor can the thief add anything else now (C2).
    expect(errorOf((await enrolTotp(real.deps, thief, owner.id, () => new Date())).res)).toBe('recovery-hold');

    // The owner's own pre-hold passkey: straight in on a new device, the hold ends, the waiting passkey is dropped.
    expect((await passkeyLogin(new Browser(real.app), ownerKey)).json()).toEqual({ status: 'ok' });
    expect(await holdOf(real.deps, owner.id)).toBeNull();
    expect(await alertsOf(real.deps, owner.id, 'hold-ended')).toEqual([{ reason: 'owner-login', cancelled: 'webauthn' }]);
    const after = await real.deps.db.query('select 1 from webauthn_credentials where account_id = $1', [owner.id]);
    expect(after.rows).toHaveLength(1);
  });

  it('totp/finish from a weak session on a trusted device (M9): 202, no TOTP; a later password login is still one weak way', async () => {
    const owner = await passwordTrader(real.app, real.deps);
    await weakAgain(owner.b, owner.name, owner.id, real.deps);
    const { res } = await enrolTotp(real.deps, owner.b, owner.id, () => new Date());
    expect(res.statusCode).toBe(202);
    const { rows } = await real.deps.db.query('select 1 from totp where account_id = $1', [owner.id]);
    expect(rows).toHaveLength(0);
    // "Password + TOTP" on a new device: no second step exists, so it is a password alone and needs the approval.
    expect((await passwordLogin(new Browser(real.app), owner.name)).json()).toMatchObject({ status: 'approve-on-device' });
    expect(await holdOf(real.deps, owner.id)).toMatchObject({ pending: 'totp' });
  });
});

describe('C2: during the hold a weak session cannot change the password or the login methods', () => {
  /** A password trader with a passkey added in the set-up window; returns the passkey and the ids. */
  async function withPasskey() {
    const t = await passwordTrader();
    const ownerKey = createSoftAuthenticator({ backedUp: true, userVerified: true });
    await onboarding(deps, t.id, new Date(now.getTime() + HOUR));
    expect((await addPasskey(deps, t.b, t.id, ownerKey)).statusCode).toBe(201);
    await onboarding(deps, t.id, null);
    const methods = await methodsOf(t.b);
    return { ...t, ownerKey, passkeyId: methods.find((m) => m.type === 'passkey')!.id, pwId: methods.find((m) => m.type === 'password')!.id };
  }

  it("the first change waits; every later one is refused and nothing changes; the owner's pre-hold passkey ends the hold", async () => {
    const { b, name, id, ownerKey, passkeyId, pwId } = await withPasskey();
    // The thief's weak session (trusted browser, nothing else logged in).
    await weakAgain(b, name, id);
    // Removing the owner's passkey waits; the passkey stays.
    const first = await removeMethod(app, deps, b, id, 'passkey', passkeyId);
    expect(first.statusCode).toBe(202);
    expect(await holdOf(deps, id)).toMatchObject({ pending: 'remove-method' });

    // Everything else is refused during the hold, and nothing changes.
    expect(errorOf(await removeMethod(app, deps, b, id, 'password', pwId))).toBe('recovery-hold');
    expect(errorOf(await changePassword(deps, b, id))).toBe('recovery-hold');
    expect(errorOf(await addPasskey(deps, b, id, createSoftAuthenticator({ backedUp: true, userVerified: true })))).toBe('recovery-hold');
    expect(errorOf(await b.put('/v1/account/security/logout-timer', { idleHours: 2 }))).toBe('recovery-hold');
    expect(errorOf(await b.post('/v1/account/terms', { version: TERMS }))).toBe('recovery-hold');
    expect((await methodsOf(b)).map((m) => m.type).sort()).toEqual(['passkey', 'password']);
    expect(await holdOf(deps, id)).toMatchObject({ pending: 'remove-method' });

    // The owner logs in with the passkey held before the hold: in, the hold ends, the removal is dropped.
    expect((await passkeyLogin(new Browser(app), ownerKey)).json()).toEqual({ status: 'ok' });
    expect(await holdOf(deps, id)).toBeNull();
    expect(await alertsOf(deps, id, 'hold-ended')).toEqual([{ reason: 'owner-login', cancelled: 'remove-method' }]);
    setNow(new Date(now.getTime() + HOLD_MS + HOUR));
    await settleDueHolds(deps.config, app.events).run(deps.db, now);
    const { rows } = await deps.db.query('select 1 from webauthn_credentials where id = $1', [passkeyId]);
    expect(rows).toHaveLength(1);
  });

  it('a removal nobody cancels applies when the hold ends by time', async () => {
    const { b, name, id, passkeyId } = await withPasskey();
    await weakAgain(b, name, id);
    expect((await removeMethod(app, deps, b, id, 'passkey', passkeyId)).statusCode).toBe(202);
    setNow(new Date(now.getTime() + HOLD_MS));
    await settleDueHolds(deps.config, app.events).run(deps.db, now);
    const { rows } = await deps.db.query('select 1 from webauthn_credentials where account_id = $1', [id]);
    expect(rows).toEqual([]);
    expect(await alertsOf(deps, id, 'hold-ended')).toEqual([{ reason: 'time', change: 'remove-method', applied: true }]);
  });
});

describe('I2: no hold without its change or session, and no change or session without its hold', () => {
  it('a failure starting the hold leaves the password as it was', async () => {
    const { b, name, id } = await passwordTrader();
    await weakAgain(b, name, id);
    await deps.db.query('insert into t_fail_holds values ($1)', [id]);
    try {
      expect((await changePassword(deps, b, id)).statusCode).toBe(500);
    } finally {
      await deps.db.query('delete from t_fail_holds where account_id = $1', [id]);
    }
    expect(await holdOf(deps, id)).toBeNull();
    expect(await alertsOf(deps, id, 'hold-started')).toEqual([]);
    await b.post('/v1/logout');
    expect((await passwordLogin(b, name)).json()).toEqual({ status: 'ok' }); // the old password
  });

  it('a failure starting the hold of a new-device login starts no session', async () => {
    const { b, name, id } = await passwordTrader();
    await b.post('/v1/logout');
    await deps.db.query('insert into t_fail_holds values ($1)', [id]);
    const fresh = new Browser(app);
    try {
      expect((await passwordLogin(fresh, name)).statusCode).toBe(500);
    } finally {
      await deps.db.query('delete from t_fail_holds where account_id = $1', [id]);
    }
    const { rows } = await deps.db.query('select 1 from sessions where account_id = $1 and revoked_at is null', [id]);
    expect(rows).toEqual([]);
    expect(fresh.cookies).not.toHaveProperty('__Host-x2f_session');
  });

  it('a failure starting the hold of a backup login starts no session', async () => {
    const { b, name, id } = await passwordTrader();
    await onboarding(deps, id, new Date(now.getTime() + HOUR));
    const { codes } = (await b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
    await deps.db.query('insert into t_fail_holds values ($1)', [id]);
    const backup = new Browser(app);
    try {
      expect((await backup.post('/v1/login/backup', { loginName: name, kind: 'recovery-code', code: codes[0]!, deviceLabel: 'X' })).statusCode).toBe(500);
    } finally {
      await deps.db.query('delete from t_fail_holds where account_id = $1', [id]);
    }
    const { rows } = await deps.db.query("select 1 from sessions where account_id = $1 and level = 'recovery'", [id]);
    expect(rows).toEqual([]);
    expect(backup.cookies).not.toHaveProperty('__Host-x2f_session');
  });
});

describe('during the hold', () => {
  /** A hold on a password trader's account, started for real: a weak login on a new device with nothing logged in. */
  async function heldTrader() {
    const t = await passwordTrader();
    await t.b.post('/v1/logout');
    const thief = new Browser(app);
    expect((await passwordLogin(thief, t.name)).json()).toEqual({ status: 'ok' });
    expect(await holdOf(deps, t.id)).not.toBeNull();
    return { ...t, thief };
  }

  it('no new trades, offers or wallet changes; removing an offer is fine', async () => {
    const t = await heldTrader();
    const take = await t.thief.post('/v1/offers/00000000-0000-4000-8000-000000000000/take', {});
    expect(take.json()).toEqual({ error: 'recovery-hold', holdUntil: in24h() });
    expect(errorOf(await t.thief.post('/v1/offers', {}))).toBe('recovery-hold');
    expect(errorOf(await t.thief.post('/v1/wallets', {}))).toBe('recovery-hold');
    expect(errorOf(await t.thief.delete('/v1/wallets/00000000-0000-4000-8000-000000000000'))).toBe('recovery-hold');
    const { rows } = await deps.db.query<{ id: string }>(
      `insert into offers (account_id, side, method_id, currency, price_mode, margin_bps, min_fiat_cents, max_fiat_cents, min_trades, terms, status, created_at, updated_at)
       values ($1, 'sell', 'zelle', 'USD', 'market', 0, 1000, 100000, 0, '', 'paused', $2, $2) returning id`,
      [t.id, now],
    );
    expect(errorOf(await t.thief.patch(`/v1/offers/${rows[0]!.id}`, { status: 'live' }))).toBe('recovery-hold');
    expect(errorOf(await t.thief.post('/v1/account/offers/status', { ids: [rows[0]!.id], status: 'live' }))).toBe('recovery-hold');
    expect((await t.thief.patch(`/v1/offers/${rows[0]!.id}`, { status: 'removed' })).statusCode).toBeLessThan(300);
  });

  it('no approving a new device (blocking it is still possible)', async () => {
    const t = await heldTrader();
    const w = (await passwordLogin(new Browser(app), t.name)).json() as { approvalId: string; number: number };
    expect((await t.thief.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ error: 'recovery-hold', holdUntil: in24h() });
    expect((await t.thief.post(`/v1/account/approvals/${w.approvalId}`, { block: true })).json()).toEqual({ outcome: 'blocked' });
  });

  it('I3: held backup sessions finish open trades (mark paid, release started); take and wallets stay refused', async () => {
    const other = await trader();
    // A buyer with a recovery code, mid-trade, logs in with it.
    const buyer = await passwordTrader();
    await onboarding(deps, buyer.id, new Date(now.getTime() + HOUR));
    const bc = (await buyer.b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
    const { trade } = await seedTrade(deps, { sellerId: other.id, buyerId: buyer.id, poster: 'seller' });
    const secured = await driveTo(deps, trade, 'secured');
    const buyerBackup = new Browser(app);
    expect((await buyerBackup.post('/v1/login/backup', { loginName: buyer.name, kind: 'recovery-code', code: bc.codes[0]!, deviceLabel: 'X' })).json()).toMatchObject({ level: 'recovery' });
    expect((await buyerBackup.get(`/v1/trades/${secured.code}`)).statusCode).toBe(200);
    expect((await buyerBackup.post(`/v1/trades/${secured.code}/events`, { type: 'mark-paid', fiatCents: FIAT.toString() })).statusCode).toBe(200);
    // A seller the same way.
    const seller = await passwordTrader();
    await onboarding(deps, seller.id, new Date(now.getTime() + HOUR));
    const sc = (await seller.b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
    const { trade: t2 } = await seedTrade(deps, { sellerId: seller.id, buyerId: other.id, poster: 'seller' });
    const paid = await driveTo(deps, t2, 'paid');
    const sellerBackup = new Browser(app);
    expect((await sellerBackup.post('/v1/login/backup', { loginName: seller.name, kind: 'recovery-code', code: sc.codes[0]!, deviceLabel: 'X' })).statusCode).toBe(200);
    expect((await sellerBackup.post(`/v1/trades/${paid.code}/events`, { type: 'release-started' })).statusCode).toBe(200);
    const { rows } = await deps.db.query<{ code: string; state: string }>('select code, state from trades where code = any($1)', [[secured.code, paid.code]]);
    expect(Object.fromEntries(rows.map((r) => [r.code, r.state]))).toEqual({ [secured.code]: 'paid', [paid.code]: 'settling' });
    // Starting anything new stays refused for those sessions.
    expect(errorOf(await buyerBackup.post('/v1/offers/00000000-0000-4000-8000-000000000000/take', {}))).toBe('recovery-session');
    expect(errorOf(await buyerBackup.post('/v1/wallets', {}))).toBe('recovery-session');
  });

  it("a full session's open trade can still be finished (mark paid)", async () => {
    const seller = await trader();
    const t = await heldTrader();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: t.id, poster: 'seller' });
    const s = await driveTo(deps, trade, 'secured');
    expect((await t.thief.post(`/v1/trades/${s.code}/events`, { type: 'mark-paid', fiatCents: FIAT.toString() })).statusCode).toBe(200);
  });
});

describe('a strong login by the real owner ends it', () => {
  it('with a passkey held before the hold: straight in on a new device, within the device limit (M6), and the hold ends', async () => {
    const { b, id, name, auth } = await passkeyTrader();
    // A password from the strong session (applies at once), then a thief's weak session approved by mistake changes something.
    const confirmToken = await tokenFor(deps, b, id, { kind: 'set-password' });
    expect((await b.put('/v1/account/password', { password: GOOD, confirmToken })).statusCode).toBe(200);
    const thief = new Browser(app);
    const w = (await passwordLogin(thief, name)).json() as { approvalId: string; number: number };
    expect((await b.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ outcome: 'approved' });
    expect((await thief.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toMatchObject({ status: 'ok' });
    const t2 = await tokenFor(deps, thief, id, { kind: 'new-recovery-codes' });
    expect((await thief.post('/v1/account/recovery-codes', { confirmToken: t2 })).statusCode).toBe(202);
    // Two devices are logged in; with a limit of 2 the owner must log one out first.
    await deps.db.query(`insert into owner_settings (key, value, updated_at) values ('max_devices', 2, now()) on conflict (key) do update set value = 2`);
    try {
      expect(errorOf(await passkeyLogin(new Browser(app), auth))).toBe('too-many-devices');
      expect(await holdOf(deps, id)).not.toBeNull();
    } finally {
      await deps.db.query(`delete from owner_settings where key = 'max_devices'`);
    }
    const fresh = new Browser(app);
    expect((await passkeyLogin(fresh, auth)).json()).toEqual({ status: 'ok' });
    expect(await holdOf(deps, id)).toBeNull();
    // And can sign the thief out.
    const list = (await fresh.get('/v1/account/sessions')).json() as Array<{ id: string; current: boolean }>;
    for (const s of list.filter((x) => !x.current)) expect((await fresh.delete(`/v1/account/sessions/${s.id}`)).statusCode).toBe(204);
    expect((await thief.get('/v1/account/me')).statusCode).toBe(401);
  });

  it('M1: a strong session cancelling the backup session that started the hold ends the hold too', async () => {
    const { b, id, name } = await passkeyTrader();
    const confirmToken = await tokenFor(deps, b, id, { kind: 'new-recovery-codes' });
    const { codes } = (await b.post('/v1/account/recovery-codes', { confirmToken })).json() as { codes: string[] };
    expect((await new Browser(app).post('/v1/login/backup', { loginName: name, kind: 'recovery-code', code: codes[0]!, deviceLabel: 'X' })).statusCode).toBe(200);
    expect(await holdOf(deps, id)).toMatchObject({ reason: 'weak-backup-login' });
    const rec = ((await b.get('/v1/account/sessions')).json() as Array<{ id: string; level: string }>).find((s) => s.level === 'recovery')!;
    expect((await b.delete(`/v1/account/recovery-sessions/${rec.id}`)).json()).toEqual({ ok: true });
    expect(await holdOf(deps, id)).toBeNull();
    expect(await alertsOf(deps, id, 'hold-ended')).toEqual([{ reason: 'backup-cancelled', cancelled: null }]);
  });
});

describe('every new login is pushed to the other devices', () => {
  it('"New login to your account", never to the device that just logged in (M9)', async () => {
    const send = vi.spyOn(app.push, 'send');
    const { b, name, id } = await passwordTrader();
    expect(send).not.toHaveBeenCalled(); // a sign-up is not a new login
    await b.post('/v1/logout');
    await passwordLogin(b, name);
    expect(send).toHaveBeenCalledWith(id, 'new-login', { exceptSession: await sessionOf(b) });
  });
});

describe('the route lists', () => {
  it('name routes that exist; each security route gates its write, each blocked route checks the hold', () => {
    for (const r of [...SECURITY_CHANGE_ROUTES, ...HOLD_BLOCKED_ROUTES]) {
      const [method, url] = r.split(' ') as ['GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', string];
      expect(app.hasRoute({ method, url }), r).toBe(true);
    }
    const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    const gated = ['auth/password.ts', 'auth/pgp.ts', 'auth/webauthn.ts', 'auth/totp.ts', 'auth/recovery.ts', 'auth/methods.ts', 'routes/account.ts'];
    const calls = gated.map((f) => src(f).split('await gateChange(').length - 1).reduce((a, n) => a + n, 0);
    expect(calls).toBe(SECURITY_CHANGE_ROUTES.length);
    expect(src('trades/take.ts')).toContain("'/v1/offers/:id/take', { preHandler: [requireTrader, requireNotHeld] }");
    expect(src('offers/routes.ts')).toContain("'/v1/offers', { preHandler: [requireTrader, requireNotHeld] }");
    expect(src('wallets/routes.ts')).toContain("'/v1/wallets/:id', { preHandler: [session, requireNotHeld] }");
    // The trade-finishing routes stay open during the hold, to backup sessions too.
    for (const f of ['trades/routes.ts', 'disputes/routes.ts']) {
      expect(src(f)).not.toContain('requireNotHeld');
      expect(src(f)).toContain('FINISH_OPEN_TRADES');
    }
  });
});
