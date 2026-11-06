// Plan 2 Task 17 (owner 2026-10-29 13:23 and 14:12; R42): login strength and the 24-hour hold.
// One block per row of the owner's rule, then the attacks of review 2026-10-30 (C1, C2, I1-I3,
// M1, M2, M4-M6, M9), each through the real routes.
import { createECDH, createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { addressEnd, type ConfirmAction } from '@x2f/accounts';
import type { FastifyInstance, FastifyRequest, LightMyRequestResponse } from 'fastify';
import * as openpgp from 'openpgp';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressValidator, Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import {
  HOLD_BLOCKED_ROUTES, HOLD_MS, LIVE_SESSION_EXEMPT, LIVE_SESSION_ROUTES, LIVE_SESSION_TRADING_ROUTES, SECURITY_CHANGE_ROUTES, WEAK_LIMITED_ROUTES, endHoldIfOwner, gateChange, lockAccount, settleDueHolds, withTx,
} from '../src/auth/hold.js';
import { APPROVAL_DECISION_BUCKET, SECURITY_CHANGE_BUCKET } from '../src/limits.js';
import { hashPassword } from '../src/auth/password.js';
import { PUSH_SUBSCRIPTION_CAP } from '../src/push/send.js';
import { STRONG_COMBOS, loginStrength } from '../src/auth/strength.js';
import { codeOf, decrypt, genKey, type Pair } from './helpers/pgpKeys.js';
import { accountIdByLoginName, makeVendor, seedAccount } from './helpers/accounts.js';
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
let logs: string[];

/** Round 2 N-I4: a 95-character address starting with 5 is ok (the real validator is address.test.ts's). */
const fakeValidator: AddressValidator = { check: async (a) => (/^5[1-9A-HJ-NP-Za-km-z]{94}$/.test(a) ? 'ok' : 'invalid') };
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const fakeAddress = () => '5' + [...randomBytes(94)].map((x) => BASE58[x % BASE58.length]).join('');
const walletAction = (address: string): ConfirmAction => ({
  kind: 'add-wallet', addressHash: createHash('sha256').update(address).digest('hex'), addressEnd: addressEnd(address),
});

beforeAll(async () => {
  const fixture = await fixtureLeakedList();
  cleanup = fixture.cleanup;
  leaked = fixture.list;
  let set: (d: Date) => void;
  ({ app, deps, setNow: set, trader, logs } = await tradeApp({}, { leaked, addresses: fakeValidator }));
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
    create trigger t_fail_hold before insert on account_holds for each row execute function t_fail_hold();
    create table t_fail_passwords (account_id uuid primary key);
    create function t_fail_password() returns trigger language plpgsql as $$
    begin
      if exists (select 1 from t_fail_passwords where account_id = new.account_id) then raise exception 'injected fault'; end if;
      return new;
    end $$;
    create trigger t_fail_password before insert or update on passwords for each row execute function t_fail_password();`);
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
  const rows = [{ id: (await accountIdByLoginName(d, name))! }];
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
  const rows = [{ id: (await accountIdByLoginName(deps, name))! }];
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
  const rows = [{ id: (await accountIdByLoginName(deps, name))! }];
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
    // Nothing changed yet: the new password does not log in; the old one is right but opens nothing during the hold (round 2 N-C1).
    expect(errorOf(await passwordLogin(new Browser(app), name, NEW_PASSWORD))).toBe('credentials-invalid');
    expect((await passwordLogin(new Browser(app), name)).json()).toEqual({ error: 'recovery-hold', holdUntil: in24h() });
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

  it('PGP alone during a hold neither gets in nor ends the hold (review I1, round 2 N-C1)', async () => {
    const { b, id, key } = await pgpTrader();
    // The PGP session changes a security setting: it waits (PGP alone is one way).
    const confirmToken = await tokenFor(deps, b, id, { kind: 'new-recovery-codes' });
    expect((await b.post('/v1/account/recovery-codes', { confirmToken })).statusCode).toBe(202);
    expect(errorOf(await pgpLogin(new Browser(app), key))).toBe('recovery-hold');
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
    const rows = [{ id: (await accountIdByLoginName(deps, name))! }];
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
    // "Password + TOTP" on a new device: no second step exists, so it is a password alone, which opens nothing during the hold.
    expect(errorOf(await passwordLogin(new Browser(real.app), owner.name))).toBe('recovery-hold');
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
    // Accepting the Terms is not a security change: allowed during the hold (lead decision 2026-10-30).
    expect((await b.post('/v1/account/terms', { version: TERMS })).statusCode).toBe(204);
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
    const t = await passwordTrader();
    // A login waiting for approval when the hold starts (a login during the hold opens nothing: round 2 N-C1).
    const w = (await passwordLogin(new Browser(app), t.name)).json() as { approvalId: string; number: number };
    expect((await changePassword(deps, t.b, t.id)).statusCode).toBe(202);
    expect((await t.b.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ error: 'recovery-hold', holdUntil: in24h() });
    expect((await t.b.post(`/v1/account/approvals/${w.approvalId}`, { block: true })).json()).toEqual({ outcome: 'blocked' });
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
  it('with a passkey held before the hold: straight in on a new device, never refused by the device limit (round 2 N-C1), and the hold ends', async () => {
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
    // Two devices are logged in and the limit is 2: the owner's proof wins (round 2 N-C1, was a bare 409 before).
    await deps.db.query(`insert into owner_settings (key, value, updated_at) values ('max_devices', 2, now()) on conflict (key) do update set value = 2`);
    const fresh = new Browser(app);
    try {
      expect((await passkeyLogin(fresh, auth)).json()).toEqual({ status: 'ok' });
    } finally {
      await deps.db.query(`delete from owner_settings where key = 'max_devices'`);
    }
    expect(await holdOf(deps, id)).toBeNull();
    // The thief's waiting session ended with the hold; the owner's strong session stays.
    expect((await thief.get('/v1/account/me')).statusCode).toBe(401);
    expect((await b.get('/v1/account/me')).statusCode).toBe(200);
    expect(await alertsOf(deps, id, 'sessions-ended')).toContainEqual({ count: 1, reason: 'owner-login' });
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

describe('review round 2', () => {
  /** A passkey trader with a password set from its strong session; `b` stays logged in. */
  async function passkeyWithPassword() {
    const t = await passkeyTrader();
    const confirmToken = await tokenFor(deps, t.b, t.id, { kind: 'set-password' });
    expect((await t.b.put('/v1/account/password', { password: GOOD, confirmToken })).statusCode).toBe(200);
    return t;
  }

  /** A weak session for a thief with the password, on a new browser the owner's session `b` approved by mistake. */
  async function approvedThief(b: Browser, name: string): Promise<Browser> {
    const thief = new Browser(app);
    const w = (await passwordLogin(thief, name)).json() as { approvalId: string; number: number };
    expect((await b.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ outcome: 'approved' });
    expect((await thief.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toMatchObject({ status: 'ok' });
    return thief;
  }

  /** A browser that holds only a copy of `from`'s device cookie (the trust is a client-held cookie). */
  function copyDevice(from: Browser): Browser {
    const copy = new Browser(app);
    copy.cookies['__Host-x2f_dev'] = from.cookies['__Host-x2f_dev']!;
    return copy;
  }

  const live = async (accountId: string) =>
    (await deps.db.query('select 1 from sessions where account_id = $1 and revoked_at is null', [accountId])).rows.length;

  describe('N-C1: a password alone cannot fill the device limit and lock the owner out of ending the hold', () => {
    it("the review's reproduction: copies of the thief's trusted device cookie open nothing; the owner's passkey ends the hold, the thief's session and the pending removal", async () => {
      const o = await passkeyWithPassword();
      const passkeyId = (await methodsOf(o.b)).find((m) => m.type === 'passkey')!.id;
      await o.b.post('/v1/logout');
      // 2. The thief logs in with the password on a new browser: nothing is logged in, so a session and the hold.
      const send = vi.spyOn(app.push, 'send');
      const thief = new Browser(app);
      expect((await passwordLogin(thief, o.name)).json()).toEqual({ status: 'ok' });
      expect(await holdOf(deps, o.id)).toMatchObject({ reason: 'weak-new-device' });
      // The hold's warning is pushed to the account's devices (N-I2).
      expect(send).toHaveBeenCalledWith(o.id, 'alert', { exceptSession: await sessionOf(thief) });
      // 3. Copies of the device cookie: trusted, but a waiting login opens no session during the hold.
      for (let i = 0; i < 2; i++) {
        const copy = copyDevice(thief);
        expect((await passwordLogin(copy, o.name)).json()).toEqual({ error: 'recovery-hold', holdUntil: in24h() });
        expect(copy.cookies).not.toHaveProperty('__Host-x2f_session');
      }
      expect(await live(o.id)).toBe(1);
      // 4. The owner's pre-hold passkey: straight in; the hold ends and the thief's session with it.
      const owner = new Browser(app);
      expect((await passkeyLogin(owner, o.auth)).json()).toEqual({ status: 'ok' });
      expect(await holdOf(deps, o.id)).toBeNull();
      expect((await thief.get('/v1/account/me')).statusCode).toBe(401);
      expect(await alertsOf(deps, o.id, 'sessions-ended')).toEqual([{ count: 1, reason: 'owner-login' }]);
      // 5-7. The owner's proof also forgot the account's trusted devices, so the thief's copied cookie
      // trusts nothing: with the owner's strong session open, a new weak login needs the owner's
      // approval; the passkey stays.
      expect((await passwordLogin(copyDevice(thief), o.name)).json()).toMatchObject({ status: 'approve-on-device' });
      setNow(new Date(now.getTime() + HOLD_MS + HOUR));
      await settleDueHolds(deps.config, app.events).run(deps.db, now);
      expect((await deps.db.query('select 1 from webauthn_credentials where id = $1', [passkeyId])).rows).toHaveLength(1);
    });

    it('with "One device at a time" the thief\'s one session fills the limit: the owner\'s passkey still gets in (no 409)', async () => {
      const o = await passkeyWithPassword();
      await deps.db.query('update accounts set one_device = true where id = $1', [o.id]);
      await o.b.post('/v1/logout');
      const thief = new Browser(app);
      expect((await passwordLogin(thief, o.name)).json()).toEqual({ status: 'ok' });
      expect(await holdOf(deps, o.id)).not.toBeNull();
      // A removal from the thief's session would need the hold to end by time; it is refused now anyway.
      const owner = new Browser(app);
      expect((await passkeyLogin(owner, o.auth)).json()).toEqual({ status: 'ok' });
      expect(await holdOf(deps, o.id)).toBeNull();
      expect((await thief.get('/v1/account/me')).statusCode).toBe(401);
      expect(await live(o.id)).toBe(1);
    });

    it("the owner's proof wins over strong sessions too: at the limit the least recently seen is logged out", async () => {
      const o = await passkeyWithPassword();
      await deps.db.query('update accounts set one_device = true where id = $1', [o.id]);
      // A weak session approved by the owner changes something: the hold starts (two sessions, one strong).
      const thief = await approvedThief(o.b, o.name);
      expect((await thief.put('/v1/account/security/logout-timer', { idleHours: 2 })).statusCode).toBe(202);
      expect((await passkeyLogin(new Browser(app), o.auth)).json()).toEqual({ status: 'ok' });
      expect((await thief.get('/v1/account/me')).statusCode).toBe(401);
      expect((await o.b.get('/v1/account/me')).statusCode).toBe(401);
      expect(await live(o.id)).toBe(1);
      expect(await alertsOf(deps, o.id, 'logged-out-by-new-device')).toEqual([{ deviceLabels: ['Phone'], count: 1 }]);
    });
  });

  it('N-I1: the owner ending a backup login\'s hold ends that backup session too; 24 h later it changes nothing', async () => {
    const o = await passkeyWithPassword();
    const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'new-recovery-codes' });
    const { codes } = (await o.b.post('/v1/account/recovery-codes', { confirmToken })).json() as { codes: string[] };
    const thief = new Browser(app);
    expect((await thief.post('/v1/login/backup', { loginName: o.name, kind: 'recovery-code', code: codes[0]!, deviceLabel: 'X' })).json()).toMatchObject({ level: 'recovery' });
    expect(await holdOf(deps, o.id)).toMatchObject({ reason: 'weak-backup-login' });
    expect((await passkeyLogin(new Browser(app), o.auth)).json()).toEqual({ status: 'ok' });
    expect(await holdOf(deps, o.id)).toBeNull();
    expect((await thief.get('/v1/account/me')).statusCode).toBe(401);
    expect(await alertsOf(deps, o.id, 'sessions-ended')).toEqual([{ count: 1, reason: 'owner-login' }]);
    // 24 hours later the backup session would be past its own hold: it is gone, so nothing applies.
    setNow(new Date(now.getTime() + HOLD_MS + 60_000));
    expect((await thief.put('/v1/account/password', { password: NEW_PASSWORD })).statusCode).toBe(401);
    expect((await thief.post('/v1/account/webauthn/start', { kind: 'passkey' })).statusCode).toBe(401);
    expect(errorOf(await passwordLogin(new Browser(app), o.name, NEW_PASSWORD))).toBe('credentials-invalid');
  });

  describe('N-I2: a weak session cannot silence the pushes that carry the hold\'s warning', () => {
    function subscription() {
      const ecdh = createECDH('prime256v1');
      ecdh.generateKeys();
      return {
        endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(24).toString('base64url')}`,
        keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
      };
    }
    const unsubscribe = (b: Browser, body?: unknown) =>
      app.inject({ method: 'DELETE', url: '/v1/account/push', headers: { origin: ORIGIN }, cookies: b.cookies, ...(body === undefined ? {} : { payload: body as Record<string, unknown> }) });
    const endpoints = async (accountId: string) =>
      (await deps.db.query<{ endpoint: string }>('select endpoint from push_subscriptions where account_id = $1', [accountId])).rows.map((r) => r.endpoint);

    it("unsubscribing drops only the calling session's subscriptions; the cap never evicts the owner's for a weak session; the warning goes out", async () => {
      // No real sends: the test transport's answer would drop subscriptions as a dead push service (404/410) does.
      const send = vi.spyOn(app.push, 'send').mockResolvedValue(true);
      const o = await passkeyWithPassword();
      const mine = subscription();
      expect((await o.b.post('/v1/account/push', mine)).statusCode).toBe(204);
      const thief = await approvedThief(o.b, o.name);
      expect((await unsubscribe(thief)).statusCode).toBe(204);
      expect((await unsubscribe(thief, { endpoint: mine.endpoint })).statusCode).toBe(204);
      expect(await endpoints(o.id)).toEqual([mine.endpoint]);
      for (let i = 0; i < PUSH_SUBSCRIPTION_CAP + 2; i++) expect((await thief.post('/v1/account/push', subscription())).statusCode).toBe(204);
      const after = await endpoints(o.id);
      expect(after).toContain(mine.endpoint);
      expect(after.length).toBeLessThanOrEqual(PUSH_SUBSCRIPTION_CAP);
      // The thief's change waits and its warning is pushed to the account (the owner's subscription is still there).
      send.mockClear();
      expect((await changePassword(deps, thief, o.id)).statusCode).toBe(202);
      expect(send).toHaveBeenCalledWith(o.id, 'alert');
      // The owner's own unsubscribe still works.
      expect((await unsubscribe(o.b)).statusCode).toBe(204);
      expect(await endpoints(o.id)).not.toContain(mine.endpoint);
    });
  });

  describe('N-I3: a weak session cannot end stronger sessions or answer a strong login', () => {
    it("cannot log the owner's strong session out; can log itself out", async () => {
      const o = await passkeyWithPassword();
      const thief = await approvedThief(o.b, o.name);
      expect((await thief.delete(`/v1/account/sessions/${await sessionOf(o.b)}`)).json()).toEqual({ error: 'weak-session' });
      expect((await o.b.get('/v1/account/me')).statusCode).toBe(200);
      expect((await thief.delete(`/v1/account/sessions/${await sessionOf(thief)}`)).statusCode).toBe(204);
    });

    it('during a hold it cannot log out any other session, weak ones included', async () => {
      const o = await passwordTrader();
      const thief = new Browser(app);
      const w = (await passwordLogin(thief, o.name)).json() as { approvalId: string; number: number };
      expect((await o.b.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ outcome: 'approved' });
      expect((await thief.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toMatchObject({ status: 'ok' });
      expect((await thief.put('/v1/account/security/logout-timer', { idleHours: 2 })).statusCode).toBe(202);
      expect((await thief.delete(`/v1/account/sessions/${await sessionOf(o.b)}`)).json()).toEqual({ error: 'weak-session' });
      expect((await o.b.get('/v1/account/me')).statusCode).toBe(200);
    });

    it("cannot block or approve the owner's passkey login; the owner's strong session can", async () => {
      const o = await passkeyWithPassword();
      const thief = await approvedThief(o.b, o.name);
      const fresh = new Browser(app);
      const w = (await passkeyLogin(fresh, o.auth)).json() as { status: string; approvalId: string; number: number };
      expect(w.status).toBe('approve-on-device');
      expect((await thief.post(`/v1/account/approvals/${w.approvalId}`, { block: true })).json()).toEqual({ error: 'weak-session' });
      expect((await thief.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ error: 'weak-session' });
      expect((await o.b.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ outcome: 'approved' });
      expect((await fresh.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toMatchObject({ status: 'ok' });
    });

    it('a strong login with only weak sessions open goes straight in; at the limit a weak session makes room', async () => {
      const o = await passkeyWithPassword();
      const thief = await approvedThief(o.b, o.name);
      await o.b.post('/v1/logout');
      await deps.db.query('update accounts set one_device = true where id = $1', [o.id]);
      expect((await passkeyLogin(new Browser(app), o.auth)).json()).toEqual({ status: 'ok' });
      expect((await thief.get('/v1/account/me')).statusCode).toBe(401);
      expect(await holdOf(deps, o.id)).toBeNull();
    });
  });

  it('N-I4 (lead decision 2026-10-30): a PGP-alone session adding a wallet with a PGP confirm waits out the hold; a strong session does not', async () => {
    const { b, id } = await pgpTrader();
    const address = fakeAddress();
    const confirmToken = await issueConfirmToken(deps, { sessionId: await sessionOf(b), accountId: id, action: walletAction(address), method: 'pgp' });
    const send = vi.spyOn(app.push, 'send');
    const res = await b.post('/v1/wallets', { app: 'feather', label: 'Main', address, confirmToken });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'held', holdUntil: in24h() });
    expect(send).toHaveBeenCalledWith(id, 'alert');
    expect((await b.get('/v1/wallets')).json()).toEqual([]);
    expect(await holdOf(deps, id)).toEqual({ until: in24h(), reason: 'weak-change', pending: 'wallets' });
    setNow(new Date(now.getTime() + HOLD_MS));
    await settleDueHolds(deps.config, app.events).run(deps.db, now);
    expect(await alertsOf(deps, id, 'hold-ended')).toEqual([{ reason: 'time', change: 'wallets', applied: true }]);
    const { rows } = await deps.db.query<{ address: string; usable_from: Date }>('select address, usable_from from wallets where account_id = $1', [id]);
    expect(rows).toEqual([{ address, usable_from: now }]);

    // A strong (passkey) session confirming with PGP: usable at once, no hold (the owner's wallet rule of 10-24).
    const strong = await passkeyTrader();
    await deps.db.query('update accounts set had_wallet = true where id = $1', [strong.id]);
    const a2 = fakeAddress();
    const t2 = await issueConfirmToken(deps, { sessionId: await sessionOf(strong.b), accountId: strong.id, action: walletAction(a2), method: 'pgp' });
    const ok = await strong.b.post('/v1/wallets', { app: 'feather', label: 'Main', address: a2, confirmToken: t2 });
    expect(ok.statusCode).toBe(201);
    expect(ok.json()).toMatchObject({ usable: true });
    expect(await holdOf(deps, strong.id)).toBeNull();
  });

  describe('N-M1: a login name waiting out the hold', () => {
    /** A pre-009 account (logs in by its display name) with a password and a session whose login waits. */
    async function legacyWeak() {
      const id = await seedAccount(deps, { loginName: null });
      const h = await hashPassword(deps.config, GOOD);
      await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, $3, $4)', [id, h.hash, h.pepperId, now]);
      const b = new Browser(app);
      expect((await b.post('/t/login', { accountId: id })).statusCode).toBe(200);
      await deps.db.query("update sessions set strength = 'weak-single' where account_id = $1", [id]);
      return { id, b };
    }
    async function setName(t: { id: string; b: Browser }, loginName: string) {
      const confirmToken = await tokenFor(deps, t.b, t.id, { kind: 'set-login-name' });
      return t.b.post('/v1/account/login-name', { loginName, confirmToken });
    }
    const legacy = async (id: string) =>
      (await deps.db.query<{ legacy_login_name: boolean }>('select legacy_login_name from accounts where id = $1', [id])).rows[0]!.legacy_login_name;

    it('is held, counts as taken in both namespaces meanwhile, and applies at the end', async () => {
      const t = await legacyWeak();
      const name = unique('pend');
      const res = await setName(t, name);
      expect(res.statusCode).toBe(202);
      expect(await holdOf(deps, t.id)).toMatchObject({ pending: 'login-name' });
      expect(await legacy(t.id)).toBe(true);
      // Nobody can take it meanwhile, as a display name or as a login name.
      const asDisplay = await new Browser(app).post('/v1/register/password', { displayName: name, loginName: unique('other'), password: GOOD, deviceLabel: 'L', acceptedTerms: TERMS });
      expect(errorOf(asDisplay)).toBe('names-unavailable');
      const asLogin = await new Browser(app).post('/v1/register/password', { displayName: `P${unique('d')}`, loginName: name, password: GOOD, deviceLabel: 'L', acceptedTerms: TERMS });
      expect(errorOf(asLogin)).toBe('names-unavailable');
      setNow(new Date(now.getTime() + HOLD_MS));
      await settleDueHolds(deps.config, app.events).run(deps.db, now);
      expect(await alertsOf(deps, t.id, 'hold-ended')).toEqual([{ reason: 'time', change: 'login-name', applied: true }]);
      expect(await legacy(t.id)).toBe(false);
      expect(await accountIdByLoginName(deps, name)).toBe(t.id);
    });

    it('is dropped when its key is no longer the current one', async () => {
      const t = await legacyWeak();
      expect((await setName(t, unique('pend'))).statusCode).toBe(202);
      await deps.db.query(`update account_holds set pending_change = jsonb_set(pending_change, '{keyId}', '999') where account_id = $1`, [t.id]);
      setNow(new Date(now.getTime() + HOLD_MS));
      await settleDueHolds(deps.config, app.events).run(deps.db, now);
      expect(await alertsOf(deps, t.id, 'hold-ended')).toEqual([{ reason: 'time', change: 'login-name', applied: false }]);
      expect(await legacy(t.id)).toBe(true);
    });
  });

  it('N-M2: a pending change that fails with a fault is dropped and logged; logins go on (no 500 on every login)', async () => {
    const { b, name, id } = await passwordTrader();
    await weakAgain(b, name, id);
    expect((await changePassword(deps, b, id)).statusCode).toBe(202);
    await deps.db.query('insert into t_fail_passwords values ($1)', [id]);
    try {
      setNow(new Date(now.getTime() + HOLD_MS));
      // The trusted browser logs in again (nothing else is logged in, so no new hold).
      const res = await passwordLogin(b, name);
      expect(res.json()).toEqual({ status: 'ok' });
      expect(await holdOf(deps, id)).toBeNull();
      expect(await alertsOf(deps, id, 'hold-ended')).toEqual([{ reason: 'time', change: 'password', applied: false }]);
      expect(logs.some((l) => l.includes('pending change failed'))).toBe(true);
      // Fails closed: the old password still logs in, the held one does not.
      expect(errorOf(await passwordLogin(new Browser(app), name, NEW_PASSWORD))).toBe('credentials-invalid');
    } finally {
      await deps.db.query('delete from t_fail_passwords where account_id = $1', [id]);
    }
  });

  it("N-M3: a weak session cannot mark the hold's or the login alerts seen; others it can", async () => {
    const o = await passkeyWithPassword();
    const thief = await approvedThief(o.b, o.name);
    expect((await changePassword(deps, thief, o.id)).statusCode).toBe(202);
    const list = (await thief.get('/v1/account/alerts')).json() as Array<{ id: string; kind: string }>;
    for (const kind of ['hold-started', 'new-login']) {
      const a = list.find((x) => x.kind === kind)!;
      expect((await thief.post(`/v1/account/alerts/${a.id}/seen`)).json()).toEqual({ error: 'weak-session' });
    }
    const plain = list.find((x) => !['hold-started', 'hold-ended', 'new-login', 'recovery-login', 'login-approval', 'login-blocked', 'logged-out-by-new-device', 'sessions-ended'].includes(x.kind))!;
    expect((await thief.post(`/v1/account/alerts/${plain.id}/seen`)).statusCode).toBe(204);
    const seen = await deps.db.query("select 1 from alerts where account_id = $1 and kind = 'hold-started' and seen_at is not null", [o.id]);
    expect(seen.rows).toEqual([]);
    // The owner's strong session can.
    const hs = list.find((x) => x.kind === 'hold-started')!;
    expect((await o.b.post(`/v1/account/alerts/${hs.id}/seen`)).statusCode).toBe(204);
  });

  describe('review round 3', () => {
    /** The gate as a security route calls it, for a session whose request passed its preHandlers earlier. */
    const gateAs = (accountId: string, sessionId: string) =>
      withTx(deps.db, (db) =>
        gateChange(db, { server: app, auth: { accountId, sessionId, level: 'full' }, log: app.log } as unknown as FastifyRequest, { kind: 'logout-timer', idleHours: 2 }),
      );

    it("R3-I1: a thief's change in flight across the owner's proof starts no new hold: the gate refuses a revoked session (401)", async () => {
      const o = await passkeyWithPassword();
      const thief = await approvedThief(o.b, o.name);
      const w = await sessionOf(thief);
      expect((await thief.put('/v1/account/security/logout-timer', { idleHours: 2 })).statusCode).toBe(202);
      expect((await passkeyLogin(new Browser(app), o.auth)).json()).toEqual({ status: 'ok' });
      expect(await holdOf(deps, o.id)).toBeNull();
      expect((await thief.get('/v1/account/me')).statusCode).toBe(401);
      // The thief's request read its session before the owner's commit and reaches the gate after it.
      await expect(gateAs(o.id, w)).rejects.toMatchObject({ status: 401, code: 'not-authenticated' });
      expect(await holdOf(deps, o.id)).toBeNull();
      // An expired session is refused the same way.
      const t2 = await approvedThief(o.b, o.name);
      const s2 = await sessionOf(t2);
      await deps.db.query('update sessions set expires_at = $2 where id = $1', [s2, now]);
      await expect(gateAs(o.id, s2)).rejects.toMatchObject({ status: 401 });
      expect(await holdOf(deps, o.id)).toBeNull();
    });

    it('R3-I1: PUT /v1/account/password is throttled per session (a refused loop runs dry: 429 slow-down)', async () => {
      const o = await passkeyWithPassword();
      const thief = await approvedThief(o.b, o.name);
      expect((await thief.put('/v1/account/security/logout-timer', { idleHours: 2 })).statusCode).toBe(202);
      const confirmToken = await tokenFor(deps, thief, o.id, { kind: 'set-password' });
      for (let i = 0; i < SECURITY_CHANGE_BUCKET.capacity; i++) {
        expect(errorOf(await thief.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken }))).toBe('recovery-hold');
      }
      const dry = await thief.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken });
      expect(dry.statusCode).toBe(429);
      expect(dry.json()).toMatchObject({ error: 'slow-down' });
      // Per session: the owner's own session is not throttled by the thief's loop.
      const ownToken = await tokenFor(deps, o.b, o.id, { kind: 'set-password' });
      expect(errorOf(await o.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: ownToken }))).toBe('recovery-hold');
    });

    it('R3-I1: a confirm token is single-use (a second change with it is refused)', async () => {
      const o = await passkeyTrader();
      const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'set-password' });
      expect((await o.b.put('/v1/account/password', { password: GOOD, confirmToken })).statusCode).toBe(200);
      expect(errorOf(await o.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken }))).toBe('confirm-invalid');
    });

    it('R3-M1: an approval approved before a hold cannot be collected during it (403 recovery-hold, no session)', async () => {
      const o = await passwordTrader();
      const t2 = new Browser(app);
      const w = (await passwordLogin(t2, o.name)).json() as { approvalId: string; number: number };
      expect((await o.b.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ outcome: 'approved' });
      expect((await o.b.put('/v1/account/security/logout-timer', { idleHours: 2 })).statusCode).toBe(202);
      const before = await live(o.id);
      const res = await t2.post(`/v1/login/approval/${w.approvalId}/poll`);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: 'recovery-hold', holdUntil: in24h() });
      expect(await live(o.id)).toBe(before);
      expect((await t2.get('/v1/account/me')).statusCode).toBe(401);
    });

    it("R3-M1: a collection racing the owner's proof waits for it and gets nothing (no weak session outlives the proof)", async () => {
      const o = await passkeyWithPassword();
      const thief = await approvedThief(o.b, o.name);
      const t2 = new Browser(app);
      const w = (await passwordLogin(t2, o.name)).json() as { approvalId: string; number: number };
      expect((await thief.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ outcome: 'approved' });
      expect((await thief.put('/v1/account/security/logout-timer', { idleHours: 2 })).statusCode).toBe(202);
      // The owner's proof, statement by statement as `endHoldIfOwner` runs them, with the poll in between.
      const owner = await deps.db.connect();
      let polled: Promise<LightMyRequestResponse> | undefined;
      try {
        await owner.query('begin');
        await lockAccount(owner, o.id);
        await owner.query('delete from account_holds where account_id = $1', [o.id]);
        await owner.query(`update sessions set revoked_at = $2 where account_id = $1 and revoked_at is null and strength is distinct from 'strong'`, [o.id, now]);
        polled = t2.post(`/v1/login/approval/${w.approvalId}/poll`);
        await new Promise((r) => setTimeout(r, 300));
        await owner.query(`update login_approvals set outcome = 'expired' where account_id = $1 and outcome = 'approved' and used_at is null`, [o.id]);
        await owner.query('commit');
      } finally {
        owner.release();
      }
      expect((await polled!).json()).toEqual({ status: 'expired' });
      const weak = await deps.db.query(`select 1 from sessions where account_id = $1 and revoked_at is null and strength is distinct from 'strong'`, [o.id]);
      expect(weak.rows).toEqual([]);
    });

    describe('R3-M2 (lead decision 2026-10-30): a weak session may log out only itself, hold or not', () => {
      it("outside a hold it cannot log out the owner's weak phone (its push subscription stays)", async () => {
        const o = await passwordTrader();
        const t2 = new Browser(app);
        const w = (await passwordLogin(t2, o.name)).json() as { approvalId: string; number: number };
        expect((await o.b.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ outcome: 'approved' });
        expect((await t2.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toMatchObject({ status: 'ok' });
        expect(await holdOf(deps, o.id)).toBeNull();
        expect((await t2.delete(`/v1/account/sessions/${await sessionOf(o.b)}`)).json()).toEqual({ error: 'weak-session' });
        expect((await o.b.get('/v1/account/me')).statusCode).toBe(200);
        expect((await t2.delete(`/v1/account/sessions/${await sessionOf(t2)}`)).statusCode).toBe(204);
      });

      it("it cannot cancel a backup session either; the owner's strong session can", async () => {
        const o = await passkeyWithPassword();
        const thief = await approvedThief(o.b, o.name);
        const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'new-recovery-codes' });
        const { codes } = (await o.b.post('/v1/account/recovery-codes', { confirmToken })).json() as { codes: string[] };
        expect((await new Browser(app).post('/v1/login/backup', { loginName: o.name, kind: 'recovery-code', code: codes[0]!, deviceLabel: 'X' })).statusCode).toBe(200);
        const rec = ((await o.b.get('/v1/account/sessions')).json() as Array<{ id: string; level: string }>).find((s) => s.level === 'recovery')!;
        // Review round 4 R4-M1 (lead decision 2026-10-30): only a weak session younger than the
        // backup session is refused (the older direction is round 4's test).
        await deps.db.query(
          "update sessions set created_at = (select created_at from sessions where id = $2) + interval '1 second' where id = $1",
          [await sessionOf(thief), rec.id],
        );
        expect((await thief.delete(`/v1/account/recovery-sessions/${rec.id}`)).json()).toEqual({ error: 'weak-session' });
        expect((await o.b.delete(`/v1/account/recovery-sessions/${rec.id}`)).json()).toEqual({ ok: true });
      });
    });
  });

  describe('review round 4', () => {
    const lockApprovalsAs = (db: { query: (s: string, p: unknown[]) => Promise<unknown> }, accountId: string) =>
      db.query("select pg_advisory_xact_lock(hashtextextended('x2f-approval/' || $1, 0))", [accountId]);
    /** The owner's passkey as the hold recorded it (`started_methods`), as a strong login proves it. */
    const ownerPasskey = async (accountId: string) => {
      const { rows } = await deps.db.query<{ m: string[] }>('select started_methods as m from account_holds where account_id = $1', [accountId]);
      const id = rows[0]!.m.find((x) => x.startsWith('webauthn:'))!.slice('webauthn:'.length);
      return { kind: 'webauthn' as const, credentialId: id };
    };
    const weakLive = async (accountId: string) =>
      (await deps.db.query(`select 1 from sessions where account_id = $1 and revoked_at is null and strength is distinct from 'strong'`, [accountId])).rows;

    it("R4-I1: the review's reproduction: the thief's approval in flight across the owner's proof gets 401, and the waiting login gets no session", async () => {
      const o = await passkeyWithPassword();
      const thief = await approvedThief(o.b, o.name);
      const b2 = new Browser(app);
      const a = (await passwordLogin(b2, o.name)).json() as { approvalId: string; number: number };
      expect(typeof a.approvalId).toBe('string');
      expect((await thief.put('/v1/account/security/logout-timer', { idleHours: 2 })).statusCode).toBe(202);
      const proven = await ownerPasskey(o.id);
      // The owner's login transaction holds the approval and account locks while the thief's
      // decision (past its preHandler) waits on them; then `endHoldIfOwner` runs and commits.
      const owner = await deps.db.connect();
      let decided: Promise<LightMyRequestResponse> | undefined;
      try {
        await owner.query('begin');
        await lockApprovalsAs(owner, o.id);
        await lockAccount(owner, o.id);
        decided = thief.post(`/v1/account/approvals/${a.approvalId}`, { choice: a.number });
        await new Promise((r) => setTimeout(r, 300));
        expect(await endHoldIfOwner(owner, { config: deps.config }, o.id, proven, now)).not.toBeNull();
        await owner.query('commit');
      } finally {
        owner.release();
      }
      const res = await decided!;
      expect(res.statusCode).toBe(401);
      expect(errorOf(res)).toBe('not-authenticated');
      expect((await b2.post(`/v1/login/approval/${a.approvalId}/poll`)).json()).toEqual({ status: 'expired' });
      expect((await b2.get('/v1/account/me')).statusCode).toBe(401);
      expect(await weakLive(o.id)).toEqual([]);
      expect(await holdOf(deps, o.id)).toBeNull();
    });

    it("R4-I1: the owner's proof also ends logins still waiting for an answer (outcome expired)", async () => {
      const o = await passkeyWithPassword();
      const thief = await approvedThief(o.b, o.name);
      const b2 = new Browser(app);
      const a = (await passwordLogin(b2, o.name)).json() as { approvalId: string; number: number };
      expect((await thief.put('/v1/account/security/logout-timer', { idleHours: 2 })).statusCode).toBe(202);
      expect((await passkeyLogin(new Browser(app), o.auth)).json()).toEqual({ status: 'ok' });
      const { rows } = await deps.db.query<{ outcome: string | null }>('select outcome from login_approvals where id = $1', [a.approvalId]);
      expect(rows).toEqual([{ outcome: 'expired' }]);
      // The owner's own session can no longer approve it either.
      expect((await o.b.post(`/v1/account/approvals/${a.approvalId}`, { choice: a.number })).json()).toMatchObject({ error: 'approval-ended' });
    });

    it('R4-I1: deciding approvals is throttled per session (a refused loop during the hold runs dry: 429 slow-down)', async () => {
      const o = await passkeyWithPassword();
      const thief = await approvedThief(o.b, o.name);
      const b2 = new Browser(app);
      const a = (await passwordLogin(b2, o.name)).json() as { approvalId: string; number: number };
      expect((await thief.put('/v1/account/security/logout-timer', { idleHours: 2 })).statusCode).toBe(202);
      for (let i = 0; i < APPROVAL_DECISION_BUCKET.capacity; i++) {
        expect(errorOf(await thief.post(`/v1/account/approvals/${a.approvalId}`, { choice: a.number }))).toBe('recovery-hold');
      }
      const dry = await thief.post(`/v1/account/approvals/${a.approvalId}`, { choice: a.number });
      expect(dry.statusCode).toBe(429);
      expect(dry.json()).toMatchObject({ error: 'slow-down' });
      // Per session: the owner's session still gets its own answer.
      expect(errorOf(await o.b.post(`/v1/account/approvals/${a.approvalId}`, { choice: a.number }))).toBe('recovery-hold');
    });

    it('R4-M2: an approval dies with the session that granted it (the granting session logged out before collection: expired)', async () => {
      const o = await passkeyWithPassword();
      const thief = await approvedThief(o.b, o.name);
      const b2 = new Browser(app);
      const a = (await passwordLogin(b2, o.name)).json() as { approvalId: string; number: number };
      expect((await thief.post(`/v1/account/approvals/${a.approvalId}`, { choice: a.number })).json()).toEqual({ outcome: 'approved' });
      expect((await o.b.delete(`/v1/account/sessions/${await sessionOf(thief)}`)).statusCode).toBe(204);
      const before = await live(o.id);
      expect((await b2.post(`/v1/login/approval/${a.approvalId}/poll`)).json()).toEqual({ status: 'expired' });
      expect((await b2.get('/v1/account/me')).statusCode).toBe(401);
      expect(await live(o.id)).toBe(before);
      // An approval whose granting session is still live is collected as before.
      const b3 = new Browser(app);
      const a3 = (await passwordLogin(b3, o.name)).json() as { approvalId: string; number: number };
      expect((await o.b.post(`/v1/account/approvals/${a3.approvalId}`, { choice: a3.number })).json()).toEqual({ outcome: 'approved' });
      expect((await b3.post(`/v1/login/approval/${a3.approvalId}/poll`)).json()).toMatchObject({ status: 'ok' });
    });

    describe('R4-M1 (lead decision 2026-10-30): a weak full session may cancel a backup session only when it is older', () => {
      /** A password-only owner whose sign-up session (weak, set-up window over) made recovery codes. */
      async function weakOwnerWithCodes() {
        const o = await passwordTrader();
        await onboarding(deps, o.id, new Date(now.getTime() + HOUR));
        const { codes } = (await o.b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
        expect(codes.length).toBeGreaterThan(1);
        await onboarding(deps, o.id, null);
        return { ...o, codes };
      }
      const backupLogin = async (name: string, code: string) => {
        const b = new Browser(app);
        expect((await b.post('/v1/login/backup', { loginName: name, kind: 'recovery-code', code, deviceLabel: 'X' })).statusCode).toBe(200);
        return sessionOf(b);
      };

      it("the owner's older weak session cancels a thief's later backup session; the hold stays (fail closed)", async () => {
        const o = await weakOwnerWithCodes();
        setNow(new Date(now.getTime() + 60_000));
        const rec = await backupLogin(o.name, o.codes[0]!);
        expect((await o.b.delete(`/v1/account/recovery-sessions/${rec}`)).json()).toEqual({ ok: true });
        const { rows } = await deps.db.query('select 1 from sessions where id = $1 and revoked_at is not null', [rec]);
        expect(rows).toHaveLength(1);
        expect(await holdOf(deps, o.id)).toMatchObject({ reason: 'weak-backup-login' });
      });

      it('a weak session younger than the backup session is refused (403 weak-session) and the backup session stays', async () => {
        const o = await weakOwnerWithCodes();
        setNow(new Date(now.getTime() + 60_000));
        const rec = await backupLogin(o.name, o.codes[0]!);
        await deps.db.query("update sessions set created_at = $2::timestamptz + interval '1 second' where id = $1", [await sessionOf(o.b), now]);
        expect((await o.b.delete(`/v1/account/recovery-sessions/${rec}`)).json()).toEqual({ error: 'weak-session' });
        const { rows } = await deps.db.query('select 1 from sessions where id = $1 and revoked_at is null', [rec]);
        expect(rows).toHaveLength(1);
      });
    });

    describe('class audit: every route acting with the caller session as authority re-checks it under its lock', () => {
      beforeAll(async () => {
        // Revokes a flagged session at `requireSession`'s touch: after its liveness read, before the
        // route's handler, exactly the window a request in flight across the owner's proof has.
        await deps.db.query(`
          create table t_revoke_on_touch (session_id uuid primary key);
          create function t_revoke_on_touch() returns trigger language plpgsql as $$
          begin
            if new.last_seen_at is distinct from old.last_seen_at and old.revoked_at is null
               and exists (select 1 from t_revoke_on_touch where session_id = new.id) then
              new.revoked_at := new.last_seen_at;
              delete from t_revoke_on_touch where session_id = new.id;
            end if;
            return new;
          end $$;
          create trigger t_revoke_on_touch before update on sessions for each row execute function t_revoke_on_touch();`);
      });

      function pushSub() {
        const ecdh = createECDH('prime256v1');
        ecdh.generateKeys();
        return {
          endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(24).toString('base64url')}`,
          keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') },
        };
      }

      /** Everything of the account a route could write, but the calling session's own row (its touch) and one-shot tokens. */
      async function stateOf(accountId: string, caller: string): Promise<unknown> {
        const agg = (from: string) => `select coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text), '[]'::jsonb) as j from ${from}`;
        const tables = ['alerts', 'login_approvals', 'account_holds', 'push_subscriptions', 'wallets', 'passwords', 'totp', 'pgp_keys', 'webauthn_credentials', 'recovery_codes', 'trusted_devices', 'team_members', 'team_audit', 'past_reputation'];
        const out: Record<string, unknown> = {};
        for (const t of tables) out[t] = (await deps.db.query<{ j: unknown }>(`${agg(`${t} t`)} where account_id = $1`, [accountId])).rows[0]!.j;
        out.sessions = (await deps.db.query<{ j: unknown }>(`${agg('sessions t')} where account_id = $1 and id <> $2`, [accountId, caller])).rows[0]!.j;
        out.account = (await deps.db.query<{ j: unknown }>(`${agg('accounts t')} where id = $1`, [accountId])).rows[0]!.j;
        return out;
      }

      /** An open team invite of `o` (Offers role); returns the member id. */
      async function teamInvite(o: { b: Browser; id: string }): Promise<string> {
        await makeVendor(deps, o.id);
        const displayName = unique('Mate');
        const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'team-invite', name: displayName, roles: 'offers' });
        const r = await o.b.post('/v1/team/invites', { displayName, roles: ['offers'], confirmToken });
        expect(r.statusCode, r.body).toBe(201);
        return (r.json() as { id: string }).id;
      }

      type Prepared = { b: Browser; accountId: string; fire: () => Promise<LightMyRequestResponse> };
      const del = async (b: Browser, url: string, payload?: unknown) =>
        b.keep(await app.inject({ method: 'DELETE', url, headers: { origin: ORIGIN }, cookies: b.cookies, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) }));

      const ROWS: Record<string, () => Promise<Prepared>> = {
        'PUT /v1/account/password': async () => {
          const o = await passkeyWithPassword();
          const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'set-password' });
          return { b: o.b, accountId: o.id, fire: () => o.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken }) };
        },
        'POST /v1/account/pgp/finish': async () => {
          const o = await passkeyWithPassword();
          const key = await genKey();
          const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'add-method', method: 'pgp' });
          const s = await o.b.post('/v1/account/pgp/start', { publicKey: key.publicKey, confirmToken });
          expect(s.statusCode).toBe(200);
          const code = codeOf(await decrypt(s.json().encryptedMessage, key.privateKey));
          return { b: o.b, accountId: o.id, fire: () => o.b.post('/v1/account/pgp/finish', { challengeId: s.json().challengeId, code }) };
        },
        'POST /v1/account/webauthn/finish': async () => {
          const o = await passkeyWithPassword();
          const auth = createSoftAuthenticator({ backedUp: true, userVerified: true });
          const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'add-method', method: 'passkey' });
          const s = await o.b.post('/v1/account/webauthn/start', { kind: 'passkey', confirmToken });
          expect(s.statusCode).toBe(200);
          return { b: o.b, accountId: o.id, fire: () => o.b.post('/v1/account/webauthn/finish', { challengeId: s.json().challengeId, response: auth.register(s.json().options, ORIGIN) }) };
        },
        'POST /v1/account/totp/finish': async () => {
          const o = await passkeyWithPassword();
          const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'add-method', method: 'totp' });
          const s = await o.b.post('/v1/account/totp/start', { confirmToken });
          expect(s.statusCode).toBe(200);
          const { challengeId, secret } = s.json() as { challengeId: string; secret: string };
          return { b: o.b, accountId: o.id, fire: () => o.b.post('/v1/account/totp/finish', { challengeId, code: codeAt(secret, now) }) };
        },
        'POST /v1/account/recovery-codes': async () => {
          const o = await passkeyWithPassword();
          const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'new-recovery-codes' });
          return { b: o.b, accountId: o.id, fire: () => o.b.post('/v1/account/recovery-codes', { confirmToken }) };
        },
        'DELETE /v1/account/methods/:type/:id': async () => {
          const o = await passkeyWithPassword();
          const pid = (await methodsOf(o.b)).find((m) => m.type === 'password')!.id;
          const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'remove-method', method: 'password', id: pid });
          return { b: o.b, accountId: o.id, fire: () => del(o.b, `/v1/account/methods/password/${pid}`, { confirmToken }) };
        },
        'POST /v1/account/login-name': async () => {
          const id = await seedAccount(deps, { loginName: null });
          const b = new Browser(app);
          expect((await b.post('/t/login', { accountId: id })).statusCode).toBe(200);
          const confirmToken = await tokenFor(deps, b, id, { kind: 'set-login-name' });
          return { b, accountId: id, fire: () => b.post('/v1/account/login-name', { loginName: unique('livename'), confirmToken }) };
        },
        'PUT /v1/account/security/one-device': async () => {
          const o = await passkeyWithPassword();
          const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'set-one-device', on: 'on' });
          return { b: o.b, accountId: o.id, fire: () => o.b.put('/v1/account/security/one-device', { on: true, confirmToken }) };
        },
        'PUT /v1/account/security/logout-timer': async () => {
          const o = await passkeyWithPassword();
          return { b: o.b, accountId: o.id, fire: () => o.b.put('/v1/account/security/logout-timer', { idleHours: 2 }) };
        },
        'POST /v1/wallets': async () => {
          const o = await passkeyWithPassword();
          await deps.db.query('update accounts set had_wallet = true where id = $1', [o.id]);
          const address = fakeAddress();
          const confirmToken = await issueConfirmToken(deps, { sessionId: await sessionOf(o.b), accountId: o.id, action: walletAction(address), method: 'pgp' });
          return { b: o.b, accountId: o.id, fire: () => o.b.post('/v1/wallets', { app: 'feather', label: 'Main', address, confirmToken }) };
        },
        'DELETE /v1/wallets/:id': async () => {
          const o = await passkeyWithPassword();
          await deps.db.query('update accounts set had_wallet = true where id = $1', [o.id]);
          const address = fakeAddress();
          const confirmToken = await issueConfirmToken(deps, { sessionId: await sessionOf(o.b), accountId: o.id, action: walletAction(address), method: 'pgp' });
          expect((await o.b.post('/v1/wallets', { app: 'feather', label: 'Main', address, confirmToken })).statusCode).toBe(201);
          const wid = ((await o.b.get('/v1/wallets')).json() as Array<{ id: string }>)[0]!.id;
          return { b: o.b, accountId: o.id, fire: () => o.b.delete(`/v1/wallets/${wid}`) };
        },
        'POST /v1/account/approvals/:id': async () => {
          const o = await passkeyWithPassword();
          const a = (await passwordLogin(new Browser(app), o.name)).json() as { approvalId: string; number: number };
          return { b: o.b, accountId: o.id, fire: () => o.b.post(`/v1/account/approvals/${a.approvalId}`, { choice: a.number }) };
        },
        'DELETE /v1/account/sessions/:id': async () => {
          const o = await passkeyWithPassword();
          const other = await sessionOf(await approvedThief(o.b, o.name));
          return { b: o.b, accountId: o.id, fire: () => o.b.delete(`/v1/account/sessions/${other}`) };
        },
        'DELETE /v1/account/recovery-sessions/:id': async () => {
          const o = await passkeyWithPassword();
          const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'new-recovery-codes' });
          const { codes } = (await o.b.post('/v1/account/recovery-codes', { confirmToken })).json() as { codes: string[] };
          const rb = new Browser(app);
          expect((await rb.post('/v1/login/backup', { loginName: o.name, kind: 'recovery-code', code: codes[0]!, deviceLabel: 'X' })).statusCode).toBe(200);
          const rec = await sessionOf(rb);
          return { b: o.b, accountId: o.id, fire: () => o.b.delete(`/v1/account/recovery-sessions/${rec}`) };
        },
        'POST /v1/account/push': async () => {
          const o = await passkeyWithPassword();
          return { b: o.b, accountId: o.id, fire: () => o.b.post('/v1/account/push', pushSub()) };
        },
        'DELETE /v1/account/push': async () => {
          const o = await passkeyWithPassword();
          expect((await o.b.post('/v1/account/push', pushSub())).statusCode).toBe(204);
          return { b: o.b, accountId: o.id, fire: () => del(o.b, '/v1/account/push') };
        },
        'POST /v1/account/alerts/:id/seen': async () => {
          const o = await passkeyWithPassword();
          const { rows } = await deps.db.query<{ id: string }>('select id from alerts where account_id = $1 and seen_at is null limit 1', [o.id]);
          return { b: o.b, accountId: o.id, fire: () => o.b.post(`/v1/account/alerts/${rows[0]!.id}/seen`) };
        },
        'POST /v1/account/terms': async () => {
          const o = await passkeyWithPassword();
          await deps.db.query('update accounts set terms_accepted_at = null where id = $1', [o.id]);
          return { b: o.b, accountId: o.id, fire: () => o.b.post('/v1/account/terms', { version: TERMS }) };
        },
        // Plan 2 Task 18 (team members), at its landing.
        'POST /v1/team/invites': async () => {
          const o = await passkeyWithPassword();
          await makeVendor(deps, o.id);
          const displayName = unique('Mate');
          const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'team-invite', name: displayName, roles: 'offers' });
          return { b: o.b, accountId: o.id, fire: () => o.b.post('/v1/team/invites', { displayName, roles: ['offers'], confirmToken }) };
        },
        'PATCH /v1/team/members/:id': async () => {
          const o = await passkeyWithPassword();
          const mid = await teamInvite(o);
          const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'team-roles', memberId: mid, roles: 'offers,trades' });
          return { b: o.b, accountId: o.id, fire: () => o.b.patch(`/v1/team/members/${mid}`, { roles: ['offers', 'trades'], confirmToken }) };
        },
        'DELETE /v1/team/members/:id': async () => {
          const o = await passkeyWithPassword();
          const mid = await teamInvite(o);
          const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'team-remove', memberId: mid });
          return { b: o.b, accountId: o.id, fire: () => del(o.b, `/v1/team/members/${mid}`, { confirmToken }) };
        },
        // Plan 5 Task 10 review round 1 M3: finish re-checks the session under the account lock.
        'POST /v1/account/past-rep/finish': async () => {
          const o = await passkeyWithPassword();
          const key = await genKey();
          const s = await o.b.post('/v1/account/past-rep/start', {
            site: 'Bisq', url: 'https://archive.ph/AbCd1', claimedTrades: 5, publicKey: key.publicKey,
          });
          expect(s.statusCode, s.body).toBe(200);
          const { challengeId, text } = s.json() as { challengeId: string; text: string };
          const signed = await openpgp.sign({
            message: await openpgp.createCleartextMessage({ text }), signingKeys: await openpgp.readPrivateKey({ armoredKey: key.privateKey }), date: deps.clock(),
          });
          return { b: o.b, accountId: o.id, fire: () => o.b.post('/v1/account/past-rep/finish', { challengeId, signed }) };
        },
      };

      // Owner 2 Nov 2026: switching to a vendor account (a passkey on the account; confirmed with it).
      ROWS['PUT /v1/account/type'] = async () => {
        const o = await passkeyWithPassword();
        const confirmToken = await issueConfirmToken(deps, { sessionId: await sessionOf(o.b), accountId: o.id, action: { kind: 'become-vendor' }, method: 'passkey' });
        return { b: o.b, accountId: o.id, fire: () => o.b.put('/v1/account/type', { type: 'vendor', confirmToken }) };
      };

      it('the table covers exactly LIVE_SESSION_ROUTES (the trading ones in take.test.ts)', () => {
        expect(Object.keys(ROWS).sort()).toEqual(LIVE_SESSION_ROUTES.filter((r) => !LIVE_SESSION_TRADING_ROUTES.includes(r)).sort());
      });

      for (const route of Object.keys(ROWS)) {
        it(`${route}: a session revoked after its preHandler gets 401 and writes nothing`, async () => {
          // No real push sends (a test-transport answer would drop subscriptions).
          vi.spyOn(app.push, 'send').mockResolvedValue(true);
          const p = await ROWS[route]!();
          const sid = await sessionOf(p.b);
          // The touch must move `last_seen_at` (it only moves it forward); then the flag arms the trigger.
          await deps.db.query('update sessions set last_seen_at = $2 where id = $1', [sid, new Date(now.getTime() - 1000)]);
          await deps.db.query('insert into t_revoke_on_touch (session_id) values ($1)', [sid]);
          expect((await deps.db.query('select 1 from sessions where id = $1 and revoked_at is null', [sid])).rows).toHaveLength(1);
          const before = await stateOf(p.accountId, sid);
          const res = await p.fire();
          expect(res.statusCode, `${route} ${res.body}`).toBe(401);
          expect(errorOf(res)).toBe('not-authenticated');
          // The revocation did happen in the window (the trigger fired), and the route wrote nothing.
          const { rows } = await deps.db.query('select 1 from sessions where id = $1 and revoked_at is not null', [sid]);
          expect(rows, route).toHaveLength(1);
          expect(await stateOf(p.accountId, sid)).toEqual(before);
        });
      }
    });
  });
});

describe('the route lists', () => {
  it('every route other than GET that runs with a session is classified: LIVE_SESSION_ROUTES or LIVE_SESSION_EXEMPT (review round 5 M1)', () => {
    const classified = [...LIVE_SESSION_ROUTES, ...Object.keys(LIVE_SESSION_EXEMPT)];
    expect(new Set(classified).size, 'listed twice').toBe(classified.length);
    // Both ways: a new route fails until it is classified, and a listed route must still exist.
    expect([...app.sessionWriteRoutes].sort()).toEqual(classified.sort());
    for (const [route, reason] of Object.entries(LIVE_SESSION_EXEMPT)) expect(reason.length, route).toBeGreaterThan(10);
  });

  it('name routes that exist; each security route gates its write, each blocked route checks the hold', () => {
    for (const r of [...SECURITY_CHANGE_ROUTES, ...HOLD_BLOCKED_ROUTES, ...WEAK_LIMITED_ROUTES]) {
      const [method, url] = r.split(' ') as ['GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', string];
      expect(app.hasRoute({ method, url }), r).toBe(true);
    }
    const src = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
    const gated = ['auth/password.ts', 'auth/pgp.ts', 'auth/webauthn.ts', 'auth/totp.ts', 'auth/recovery.ts', 'auth/methods.ts', 'routes/account.ts', 'wallets/routes.ts'];
    const calls = gated.map((f) => src(f).split('await gateChange(').length - 1).reduce((a, n) => a + n, 0);
    expect(calls).toBe(SECURITY_CHANGE_ROUTES.length);
    expect(src('trades/take.ts')).toContain("'/v1/offers/:id/take', { preHandler: [...requireTrader, requireNotHeld] }");
    expect(src('offers/routes.ts')).toContain("'/v1/offers', { preHandler: [requireTrader, requireNotHeld] }");
    expect(src('wallets/routes.ts')).toContain("'/v1/wallets/:id', { preHandler: [session, requireNotHeld] }");
    // Plan 2 Task 18 (owner 2026-10-30): the three team writes check the hold before spending the confirm token.
    // Owner 2026-11-01 (landing review I1): invites and role changes also need a strong session,
    // checked after the hold and before the confirm token is spent; removal does not.
    expect(src('routes/team.ts').split(', requireNotHeld, requireStrongSession, requireConfirm(').length - 1).toBe(2);
    expect(src('routes/team.ts').split(', requireNotHeld, requireConfirm(').length - 1).toBe(1);
    expect(src('team/members.ts').split('await ownerWriteGate(c, caller, now, { strong: true });').length - 1).toBe(2);
    expect(src('team/members.ts').split('await ownerWriteGate(c, caller, now, { strong: false });').length - 1).toBe(1);
    // Plan 5 Task 10 (owner 1 Nov): past-rep start and finish check the hold; list and delete do not.
    expect(src('pastrep/routes.ts').split('preHandler: [requireTrader, requireNotHeld] }').length - 1).toBe(2);
    // The trade-finishing routes stay open during the hold, to backup sessions too.
    for (const f of ['trades/routes.ts', 'disputes/routes.ts']) {
      expect(src(f)).not.toContain('requireNotHeld');
      expect(src(f)).toContain('FINISH_OPEN_TRADES');
    }
  });
});
