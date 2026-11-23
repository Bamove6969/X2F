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
  HOLD_BLOCKED_ROUTES, HOLD_MS, LIVE_SESSION_EXEMPT, LIVE_SESSION_ROUTES, LIVE_SESSION_TRADING_ROUTES, SECURITY_CHANGE_ROUTES, WEAK_LIMITED_ROUTES, endHoldIfOwner, gateChange, lockAccount, settleDueHolds, startHold, withTx,
} from '../src/auth/hold.js';
import { OWNER_WARNINGS } from '../src/routes/account.js';
import { settleDueChanges } from '../src/auth/holdChanges.js';
import { APPROVAL_DECISION_BUCKET, SECURITY_CHANGE_BUCKET } from '../src/limits.js';
import { hashPassword } from '../src/auth/password.js';
import { insertPgpKey } from '../src/auth/pgp.js';
import { PUSH_SUBSCRIPTION_CAP } from '../src/push/send.js';
import { STRONG_COMBOS, loginStrength } from '../src/auth/strength.js';
import { codeOf, decrypt, genKey, type Pair } from './helpers/pgpKeys.js';
import { accountIdByLoginName, makeVendor, seedAccount, addUnusedSecurityKey } from './helpers/accounts.js';
import { fixtureLeakedList } from './helpers/leaked.js';
import { createSoftAuthenticator, type SoftAuthenticator } from './helpers/softAuthenticator.js';
import { FIAT, driveTo, seedTrade } from './helpers/trades.js';
import { tradeApp } from './helpers/tradeApp.js';
import type { JabberSender } from '../src/jabber/sender.js';
import { Browser, codeAt } from './helpers/totp.js';
import { SIG } from './helpers/signature.js';
import { flexBody, insertOffer } from './helpers/offers.js';

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

/** Owner rule p5-7: the Jabber set-up's test codes, by address (the class audit's rows read them). */
const jabberCodes = new Map<string, string>();
const jabberSender: JabberSender = {
  async send(to, m) {
    if (m.kind === 'test-code') jabberCodes.set(to, m.code);
  },
};

beforeAll(async () => {
  const fixture = await fixtureLeakedList();
  cleanup = fixture.cleanup;
  leaked = fixture.list;
  let set: (d: Date) => void;
  ({ app, deps, setNow: set, trader, logs } = await tradeApp({}, { leaked, addresses: fakeValidator, jabberSender }));
  setNow = (d) => {
    now = d;
    set(d);
  };
  // I2: switches that make starting a hold, or staging a change, fail for one account, to prove nothing commits without it.
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
    create trigger t_fail_password before insert or update on passwords for each row execute function t_fail_password();
    create table t_fail_changes (account_id uuid primary key);
    create function t_fail_change() returns trigger language plpgsql as $$
    begin
      if exists (select 1 from t_fail_changes where account_id = new.account_id) then raise exception 'injected failure'; end if;
      return new;
    end $$;
    create trigger t_fail_change before insert on hold_changes for each row execute function t_fail_change();`);
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
const unique = (p: string) => `${p}${String(++seq).padStart(4, '0')}x`;
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
  const res = await b.post('/v1/register/password', { displayName: `P${name}`, loginName: name, password: GOOD, deviceLabel: 'Laptop', acceptedTerms: TERMS, termsSignature: SIG });
  expect(res.statusCode).toBe(201);
  const rows = [{ id: (await accountIdByLoginName(d, name))! }];
  const id = rows[0]!.id;
  // Review M2: a password alone is setup-only; this account's password LOGIN is the weak one.
  await addUnusedSecurityKey(d, id);
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

/**
 * A security change that a weak session's request stages (202, hold model v3): "One device at a
 * time" on, with its confirm token. (The logout timer played this part until it was retired, 2 Nov 2026.)
 */
async function heldChange(b: Browser, accountId: string) {
  return b.put('/v1/account/security/one-device', { on: true, confirmToken: await tokenFor(deps, b, accountId, { kind: 'set-one-device', on: 'on' }) });
}

/** Signs up a passkey trader in `b`; returns its authenticator. */
async function passkeyTrader(b = new Browser(app)): Promise<{ b: Browser; id: string; name: string; auth: SoftAuthenticator }> {
  const auth = createSoftAuthenticator({ backedUp: true, userVerified: true });
  const name = unique('passkeyuser');
  const start = (await b.post('/v1/register/webauthn/start', { displayName: `D.${name}`, loginName: name, kind: 'passkey' })).json();
  expect((await b.post('/v1/register/webauthn/finish', { challengeId: start.challengeId, response: auth.register(start.options, ORIGIN), deviceLabel: 'Phone', acceptedTerms: TERMS, termsSignature: SIG })).statusCode).toBe(201);
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
async function pgpTrader(): Promise<{ b: Browser; id: string; name: string; key: Pair }> {
  const key = await genKey();
  const name = unique('pgpuser');
  const b = new Browser(app);
  const start = await b.post('/v1/register/pgp/start', { displayName: `G${name}`, loginName: name, publicKey: key.publicKey });
  const code = codeOf(await decrypt(start.json().encryptedMessage, key.privateKey));
  expect((await b.post('/v1/register/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'Laptop', acceptedTerms: TERMS, termsSignature: SIG })).statusCode).toBe(201);
  const rows = [{ id: (await accountIdByLoginName(deps, name))! }];
  await onboarding(deps, rows[0]!.id, null);
  return { b, id: rows[0]!.id, name, key };
}

/** Owner G6: the trader PGP login takes the username with the key. */
async function pgpLogin(b: Browser, key: Pair, loginName: string) {
  const start = await b.post('/v1/login/pgp/start', { key: key.publicKey, loginName });
  const code = codeOf(await decrypt(start.json().encryptedMessage, key.privateKey));
  return b.post('/v1/login/pgp/finish', { challengeId: start.json().challengeId, code, deviceLabel: 'Laptop' });
}

/** The account's staged and waiting changes (hold model v3), oldest first. */
async function changesOf(accountId: string): Promise<Array<{ kind: string; submitted: boolean }>> {
  const { rows } = await deps.db.query<{ kind: string; submitted: boolean }>(
    "select change->>'kind' as kind, submitted_at is not null as submitted from hold_changes where account_id = $1 order by seq",
    [accountId],
  );
  return rows;
}

const changeIdOf = (r: LightMyRequestResponse) => (r.json() as { changeId: string }).changeId;
/** Submits exactly these drafts of the session in `b` (hold model v3). */
const submit = (b: Browser, ids: string[]) => b.post('/v1/account/hold/changes/submit', { ids });
/** A recovery-code (backup) login. */
const backup = (b: Browser, name: string, code: string) => b.post('/v1/login/backup', { loginName: name, kind: 'recovery-code', code, deviceLabel: 'X' });

/** A hold of an older reason, as one still running at deploy (model v3 starts only `recovery-code` holds); returns its end. */
async function legacyHold(accountId: string, reason = 'weak-new-device'): Promise<string> {
  const until = new Date(now.getTime() + HOLD_MS);
  await deps.db.query(
    `insert into account_holds (account_id, started_at, hold_until, reason, pending_change, started_methods, started_by)
     values ($1, $2, $3, $4, null, '{}', null)`,
    [accountId, now, until, reason],
  );
  return until.toISOString();
}

/** A weak session for the account in `b`: the trusted sign-up browser logs out and back in with the password alone (no approval, no hold; review M9's path). */
async function weakAgain(b: Browser, name: string, id: string, d: Deps = deps) {
  await b.post('/v1/logout');
  expect((await passwordLogin(b, name)).json()).toEqual({ status: 'ok' });
  expect(await holdOf(d, id)).toBeNull();
}

describe("login strength: the owner's list of 14:12, exactly, plus a PGP key (owner 6 Nov 2026, Q81)", () => {
  it('strong only for the listed combinations (or a login proving more than one of them)', () => {
    expect(STRONG_COMBOS).toEqual([
      ['passkey'], ['security-key'], ['pgp'], ['password', 'totp'], ['password', 'passkey'], ['password', 'security-key'], ['pgp', 'passkey'], ['pgp', 'security-key'],
    ]);
    for (const combo of STRONG_COMBOS) expect(loginStrength(combo)).toBe('strong');
    expect(loginStrength(['passkey', 'totp'])).toBe('strong');
  });

  it('Q81: a PGP key login (username and PGP key) is strong, with anything else it proved too', () => {
    expect(loginStrength(['pgp'])).toBe('strong');
    expect(loginStrength(['pgp', 'password'])).toBe('strong');
    expect(loginStrength(['pgp', 'totp'])).toBe('strong');
  });

  it('every other single way, and any unlisted pair, waits (weak-single)', () => {
    expect(loginStrength(['password'])).toBe('weak-single');
    expect(loginStrength(['totp'])).toBe('weak-single');
    expect(loginStrength(['recovery-code'])).toBe('weak-single');
    // Two kinds that are not on the owner's list are not strong (review I1).
    expect(loginStrength(['totp', 'recovery-code'])).toBe('weak-single');
    expect(loginStrength(['password', 'recovery-code'])).toBe('weak-single');
  });
});

describe('good security: no wait', () => {
  it('a passkey on its own on a new device with nothing logged in', async () => {
    const { b, id, auth } = await passkeyTrader();
    await b.post('/v1/logout');
    expect((await passkeyLogin(new Browser(app), auth)).json()).toEqual({ status: 'ok' });
    expect(await holdOf(deps, id)).toBeNull();
  });

  it('a password with its authenticator code on a trusted device with nothing logged in', async () => {
    const { b, name, id } = await passwordTrader();
    await onboarding(deps, id, new Date(now.getTime() + HOUR));
    const { res, secret } = await enrolTotp(deps, b, id, () => now);
    expect(res.statusCode).toBe(200);
    await b.post('/v1/logout');
    setNow(new Date(now.getTime() + 60_000));
    const first = (await passwordLogin(b, name)).json() as { pendingId: string };
    expect((await b.post('/v1/login/second-factor', { pendingId: first.pendingId, code: codeAt(secret, now) })).json()).toEqual({ status: 'ok' });
    expect(await holdOf(deps, id)).toBeNull();
  });

  it('hold model v3: on a new device with nothing logged in, a password with its code is refused (only a passkey, security key or PGP key gets in there)', async () => {
    const { b, name, id } = await passwordTrader();
    await onboarding(deps, id, new Date(now.getTime() + HOUR));
    const { secret } = await enrolTotp(deps, b, id, () => now);
    await b.post('/v1/logout');
    setNow(new Date(now.getTime() + 60_000));
    const fresh = new Browser(app);
    const first = (await passwordLogin(fresh, name)).json() as { pendingId: string };
    const res = await fresh.post('/v1/login/second-factor', { pendingId: first.pendingId, code: codeAt(secret, now) });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('approval-unavailable');
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

describe('one weak way (hold model v3: its changes are staged and wait; nothing is held)', () => {
  it('a password alone that changes the password: staged, no hold, the old password still works', async () => {
    const { b, name, id } = await passwordTrader();
    await weakAgain(b, name, id);
    const res = await changePassword(deps, b, id);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'staged', changeId: changeIdOf(res) });
    expect(await holdOf(deps, id)).toBeNull();
    expect(await changesOf(id)).toEqual([{ kind: 'password', submitted: false }]);
    expect((await b.get('/v1/account/me')).json()).toMatchObject({ accountHoldUntil: null, changesWait: true, pendingChanges: null });
    expect(await alertsOf(deps, id, 'hold-started')).toEqual([]);
    // Nothing changed: the new password does not log in; the old one does (here it waits for the logged-in device's approval).
    expect(errorOf(await passwordLogin(new Browser(app), name, NEW_PASSWORD))).toBe('credentials-invalid');
    expect((await passwordLogin(new Browser(app), name)).json()).toMatchObject({ status: 'approve-on-device' });
  });

  it('a submitted change applies 24 h after the submission (the minute job)', async () => {
    const { b, name, id } = await passwordTrader();
    await weakAgain(b, name, id);
    const send = vi.spyOn(app.push, 'send');
    const changeId = changeIdOf(await changePassword(deps, b, id));
    expect((await submit(b, [changeId])).json()).toEqual({ status: 'queued', count: 1, takesEffectAt: in24h() });
    expect(send).toHaveBeenCalledWith(id, 'alert');
    const job = settleDueChanges(deps.config, app.events);
    setNow(new Date(now.getTime() + HOLD_MS - 1));
    await job.run(deps.db, now);
    expect(await changesOf(id)).toEqual([{ kind: 'password', submitted: true }]);
    setNow(new Date(now.getTime() + 1));
    expect(await job.run(deps.db, now)).toBeGreaterThanOrEqual(1);
    expect(await changesOf(id)).toEqual([]);
    expect(await alertsOf(deps, id, 'hold-changes-applied')).toEqual([{ applied: ['password'], dropped: [] }]);
    // The new password works now, the old one no longer.
    expect(errorOf(await passwordLogin(new Browser(app), name))).toBe('credentials-invalid');
    await b.post('/v1/logout');
    expect((await passwordLogin(b, name, NEW_PASSWORD)).json()).toEqual({ status: 'ok' });
  });

  it('a change whose date has come also applies at the next read of the changes (no job needed)', async () => {
    const t = await passwordTrader();
    await weakAgain(t.b, t.name, t.id);
    expect((await submit(t.b, [changeIdOf(await changePassword(deps, t.b, t.id))])).statusCode).toBe(200);
    setNow(new Date(now.getTime() + HOLD_MS));
    // The trusted browser logs in again (its session has idled out; nothing else is logged in).
    expect((await passwordLogin(t.b, t.name)).json()).toEqual({ status: 'ok' });
    expect((await t.b.get('/v1/account/hold')).json()).toMatchObject({ accountHold: null, changes: { count: 0 } });
    expect(await changesOf(t.id)).toEqual([]);
    await t.b.post('/v1/logout');
    expect((await passwordLogin(t.b, t.name, NEW_PASSWORD)).json()).toEqual({ status: 'ok' });
  });

  it('a password alone on a new device with nothing logged in to approve it is refused (approval-unavailable); nothing is held', async () => {
    const { b, name, id } = await passwordTrader();
    await b.post('/v1/logout');
    const fresh = new Browser(app);
    const res = await passwordLogin(fresh, name);
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('approval-unavailable');
    expect(fresh.cookies).not.toHaveProperty('__Host-x2f_session');
    expect(await holdOf(deps, id)).toBeNull();
  });

  it('PGP alone on a new device with nothing logged in gets in (a PGP key is enough there); nothing is held', async () => {
    const { b, id, name, key } = await pgpTrader();
    await b.post('/v1/logout');
    expect((await pgpLogin(new Browser(app), key, name)).json()).toEqual({ status: 'ok' });
    expect(await holdOf(deps, id)).toBeNull();
  });

  it("Q81 (owner 6 Nov 2026): a PGP key login is strong: its session is stored strong, its changes apply at once (nothing staged), and the account's PGP key ends a recovery-code hold", async () => {
    const { b, id, name, key } = await pgpTrader();
    await onboarding(deps, id, new Date(now.getTime() + HOUR));
    const { codes } = (await b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
    await onboarding(deps, id, null);
    // A fresh PGP login (not the sign-up session) in the trusted browser.
    await b.post('/v1/logout');
    expect((await pgpLogin(b, key, name)).json()).toEqual({ status: 'ok' });
    const st = await deps.db.query<{ strength: string }>('select strength from sessions where id = $1', [await sessionOf(b)]);
    expect(st.rows[0]!.strength).toBe('strong');
    expect((await b.get('/v1/account/me')).json()).toMatchObject({ changesWait: false, pendingChanges: null });
    const confirmToken = await tokenFor(deps, b, id, { kind: 'new-recovery-codes' });
    const renewed = await b.post('/v1/account/recovery-codes', { confirmToken });
    expect(renewed.statusCode, renewed.body).toBe(200);
    expect(renewed.json()).not.toMatchObject({ status: 'staged' });
    const fresh = (renewed.json() as { codes: string[] }).codes;
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).not.toBe(codes[0]);
    expect(await changesOf(id)).toEqual([]);
    expect((await backup(new Browser(app), name, fresh[0]!)).statusCode).toBe(200);
    expect(await holdOf(deps, id)).toMatchObject({ reason: 'recovery-code' });
    expect((await pgpLogin(new Browser(app), key, name)).json()).toEqual({ status: 'ok' });
    expect(await holdOf(deps, id)).toBeNull();
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

  it('an authenticator code alone is no backup login any more (403 method-not-allowed): no session, nothing held', async () => {
    const { b, name, id } = await passwordTrader();
    await onboarding(deps, id, new Date(now.getTime() + HOUR));
    const { secret } = await enrolTotp(deps, b, id, () => now);
    setNow(new Date(now.getTime() + 60_000));
    const fresh = new Browser(app);
    const res = await fresh.post('/v1/login/backup', { loginName: name, kind: 'totp', code: codeAt(secret, now), deviceLabel: 'X' });
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('method-not-allowed');
    expect(fresh.cookies).not.toHaveProperty('__Host-x2f_session');
    expect(await holdOf(deps, id)).toBeNull();
  });

  it("a recovery code alone (backup login): a held session and the account's hold (reason recovery-code)", async () => {
    const { b, name, id } = await passwordTrader();
    await onboarding(deps, id, new Date(now.getTime() + HOUR));
    const { codes } = (await b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
    const res = await backup(new Browser(app), name, codes[0]!);
    expect(res.json()).toEqual({ status: 'ok', level: 'recovery', holdUntil: in24h() });
    expect(await holdOf(deps, id)).toEqual({ until: in24h(), reason: 'recovery-code', pending: null });
  });

  it('the sign-up session setting the account up stages nothing', async () => {
    const b = new Browser(app);
    const name = unique('cool');
    await b.post('/v1/register/password', { displayName: `P${name}`, loginName: name, password: GOOD, deviceLabel: 'Laptop', acceptedTerms: TERMS, termsSignature: SIG });
    expect((await b.post('/v1/account/recovery-codes', {})).statusCode).toBe(200);
    const id = (await accountIdByLoginName(deps, name))!;
    expect(await holdOf(deps, id)).toBeNull();
    expect(await changesOf(id)).toEqual([]);
  });
});

describe('C1: a weak session cannot add a method and use it to skip the approval or the wait (real clock)', () => {
  let real: Awaited<ReturnType<typeof tradeApp>>;

  beforeAll(async () => {
    real = await tradeApp({}, { leaked, clock: () => new Date() });
  });

  afterAll(async () => {
    await real.app.close();
  });

  it("webauthn/finish from a weak session: 202 staged, nothing stored; the thief's passkey logs in nowhere; the owner's earlier passkey discards the waiting change", async () => {
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

    const thiefKey = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const added = await addPasskey(real.deps, thief, owner.id, thiefKey);
    expect(added.statusCode).toBe(202);
    expect(added.json()).toMatchObject({ status: 'staged' });
    const stored = await real.deps.db.query("select 1 from webauthn_credentials where account_id = $1 and kind = 'passkey'", [owner.id]);
    expect(stored.rows).toHaveLength(1); // the owner's only
    expect(await holdOf(real.deps, owner.id)).toBeNull();
    expect((await thief.post('/v1/account/hold/changes/submit', { ids: [changeIdOf(added)] })).statusCode).toBe(200);

    // The thief's passkey logs in nowhere: no skipped approval.
    expect((await passkeyLogin(new Browser(real.app), thiefKey)).statusCode).toBe(401);

    // The owner's own earlier passkey: straight in on a new device (only weak sessions are open); the
    // waiting passkey stays for the owner's choice (G58) and the owner cancels it.
    const ownerB = new Browser(real.app);
    expect((await passkeyLogin(ownerB, ownerKey)).json()).toEqual({ status: 'ok' });
    expect((await real.deps.db.query('select 1 from hold_changes where account_id = $1', [owner.id])).rows).toHaveLength(1);
    expect((await ownerB.delete('/v1/account/hold/changes')).statusCode).toBe(204);
    expect((await real.deps.db.query('select 1 from hold_changes where account_id = $1', [owner.id])).rows).toEqual([]);
    const after = await real.deps.db.query("select 1 from webauthn_credentials where account_id = $1 and kind = 'passkey'", [owner.id]);
    expect(after.rows).toHaveLength(1);
  });

  it('totp/finish from a weak session on a trusted device (M9): 202 staged, no TOTP; a later password login is still one weak way', async () => {
    const owner = await passwordTrader(real.app, real.deps);
    await weakAgain(owner.b, owner.name, owner.id, real.deps);
    const { res } = await enrolTotp(real.deps, owner.b, owner.id, () => new Date());
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ status: 'staged' });
    const { rows } = await real.deps.db.query('select 1 from totp where account_id = $1', [owner.id]);
    expect(rows).toHaveLength(0);
    // "Password + TOTP" on a new device: no second step exists, so it is a password alone, which waits for the logged-in device.
    expect((await passwordLogin(new Browser(real.app), owner.name)).json()).toMatchObject({ status: 'approve-on-device' });
    const staged = await real.deps.db.query<{ kind: string }>("select change->>'kind' as kind from hold_changes where account_id = $1", [owner.id]);
    expect(staged.rows).toEqual([{ kind: 'totp' }]);
  });
});

describe("C2: a weak session's changes touch nothing before their date", () => {
  /**
   * A password trader with a passkey added in the set-up window; returns the passkey and the ids.
   * Owner, 16 Nov 2026: a password never stands alone, so the trader also holds a PGP key (removing
   * the passkey would otherwise leave the password alone, 409 `password-alone`).
   */
  async function withPasskey() {
    const t = await passwordTrader();
    const pgp = await genKey();
    await insertPgpKey(deps.db, deps.config, { accountId: t.id, fingerprint: pgp.fingerprint, armored: pgp.publicKey, now });
    const ownerKey = createSoftAuthenticator({ backedUp: true, userVerified: true });
    await onboarding(deps, t.id, new Date(now.getTime() + HOUR));
    expect((await addPasskey(deps, t.b, t.id, ownerKey)).statusCode).toBe(201);
    await onboarding(deps, t.id, null);
    const methods = await methodsOf(t.b);
    return { ...t, ownerKey, passkeyId: methods.find((m) => m.type === 'passkey')!.id, pwId: methods.find((m) => m.type === 'password')!.id };
  }

  it("each change is staged and nothing changes; submitted, the owner's earlier passkey discards them all", async () => {
    const { b, name, id, ownerKey, passkeyId } = await withPasskey();
    // The thief's weak session (trusted browser, nothing else logged in).
    await weakAgain(b, name, id);
    const ids: string[] = [];
    for (const r of [
      await removeMethod(app, deps, b, id, 'passkey', passkeyId),
      await changePassword(deps, b, id),
      await addPasskey(deps, b, id, createSoftAuthenticator({ backedUp: true, userVerified: true })),
      await heldChange(b, id),
    ]) {
      expect(r.statusCode, r.body).toBe(202);
      ids.push(changeIdOf(r));
    }
    // Accepting the Terms is not a security change: it applies (lead decision 2026-10-30).
    expect((await b.post('/v1/account/terms', { version: TERMS, signature: SIG })).statusCode).toBe(204);
    // (The unused security key is the M2 second method passwordTrader adds.)
    expect((await methodsOf(b)).map((m) => m.type).sort()).toEqual(['passkey', 'password', 'pgp', 'security-key']);
    expect((await submit(b, ids)).json()).toMatchObject({ status: 'queued', count: 4 });

    // The owner logs in with the passkey held before the submission: in; the waiting changes stay for
    // the owner's choice (G58), and Cancel all takes them.
    const ownerB = new Browser(app);
    expect((await passkeyLogin(ownerB, ownerKey)).json()).toEqual({ status: 'ok' });
    expect(await changesOf(id)).toHaveLength(4);
    expect((await ownerB.delete('/v1/account/hold/changes')).statusCode).toBe(204);
    expect(await changesOf(id)).toEqual([]);
    setNow(new Date(now.getTime() + HOLD_MS + HOUR));
    await settleDueChanges(deps.config, app.events).run(deps.db, now);
    const { rows } = await deps.db.query('select 1 from webauthn_credentials where id = $1', [passkeyId]);
    expect(rows).toHaveLength(1);
  });

  it('a removal nobody cancels applies 24 h after its submission', async () => {
    const { b, name, id, passkeyId } = await withPasskey();
    await weakAgain(b, name, id);
    const r = await removeMethod(app, deps, b, id, 'passkey', passkeyId);
    expect(r.statusCode).toBe(202);
    expect((await submit(b, [changeIdOf(r)])).statusCode).toBe(200);
    setNow(new Date(now.getTime() + HOLD_MS));
    await settleDueChanges(deps.config, app.events).run(deps.db, now);
    const { rows } = await deps.db.query("select 1 from webauthn_credentials where account_id = $1 and kind = 'passkey'", [id]);
    expect(rows).toEqual([]);
    expect(await alertsOf(deps, id, 'hold-changes-applied')).toEqual([{ applied: ['remove-method'], dropped: [] }]);
  });
});

describe('I2: no change, hold or session without the rest of its transaction', () => {
  it('a failure staging the change leaves the password as it was and stages nothing', async () => {
    const { b, name, id } = await passwordTrader();
    await weakAgain(b, name, id);
    await deps.db.query('insert into t_fail_changes values ($1)', [id]);
    try {
      expect((await changePassword(deps, b, id)).statusCode).toBe(500);
    } finally {
      await deps.db.query('delete from t_fail_changes where account_id = $1', [id]);
    }
    expect(await changesOf(id)).toEqual([]);
    expect(await holdOf(deps, id)).toBeNull();
    await b.post('/v1/logout');
    expect((await passwordLogin(b, name)).json()).toEqual({ status: 'ok' }); // the old password
  });

  it('a failure starting the hold of a recovery-code login starts no session, logs nobody out and leaves the code unused', async () => {
    const { b, name, id } = await passwordTrader();
    await onboarding(deps, id, new Date(now.getTime() + HOUR));
    const { codes } = (await b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
    await deps.db.query('insert into t_fail_holds values ($1)', [id]);
    const rec = new Browser(app);
    try {
      expect((await backup(rec, name, codes[0]!)).statusCode).toBe(500);
    } finally {
      await deps.db.query('delete from t_fail_holds where account_id = $1', [id]);
    }
    const { rows } = await deps.db.query("select 1 from sessions where account_id = $1 and level = 'recovery'", [id]);
    expect(rows).toEqual([]);
    expect(rec.cookies).not.toHaveProperty('__Host-x2f_session');
    expect((await b.get('/v1/account/me')).statusCode).toBe(200);
    // The account's one code was not spent by the failed login: it still works.
    expect((await backup(new Browser(app), name, codes[0]!)).statusCode).toBe(200);
  });
});

describe('during the hold', () => {
  /** A weak session of a password trader under a hold of an older reason (one still running at deploy). */
  async function heldTrader() {
    const t = await passwordTrader();
    const until = await legacyHold(t.id);
    return { ...t, thief: t.b, until };
  }

  it('no new trades, offers or wallet changes; removing an offer is fine', async () => {
    const t = await heldTrader();
    const take = await t.thief.post('/v1/offers/00000000-0000-4000-8000-000000000000/take', {});
    expect(take.json()).toEqual({ error: 'recovery-hold', holdUntil: t.until });
    expect(errorOf(await t.thief.post('/v1/offers', flexBody({})))).toBe('recovery-hold');
    expect(errorOf(await t.thief.post('/v1/wallets', {}))).toBe('recovery-hold');
    expect(errorOf(await t.thief.delete('/v1/wallets/00000000-0000-4000-8000-000000000000'))).toBe('recovery-hold');
    const rows = [{ id: await insertOffer(deps.db, { accountId: t.id, side: 'sell', methodId: 'zelle', currency: 'USD', min: 1000, max: 100000, status: 'paused', at: now }) }];
    expect(errorOf(await t.thief.patch(`/v1/offers/${rows[0]!.id}`, { status: 'live' }))).toBe('recovery-hold');
    expect(errorOf(await t.thief.post('/v1/account/offers/status', { ids: [rows[0]!.id], status: 'live' }))).toBe('recovery-hold');
    expect((await t.thief.patch(`/v1/offers/${rows[0]!.id}`, { status: 'removed' })).statusCode).toBeLessThan(300);
  });

  it('no approving a new device (blocking it is still possible)', async () => {
    const t = await passwordTrader();
    // A login waiting for approval when the hold starts (a login during the hold opens nothing).
    const w = (await passwordLogin(new Browser(app), t.name)).json() as { approvalId: string; number: number };
    const until = await legacyHold(t.id);
    expect((await t.b.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ error: 'recovery-hold', holdUntil: until });
    expect((await t.b.post(`/v1/account/approvals/${w.approvalId}`, { block: true })).json()).toEqual({ outcome: 'blocked' });
  });

  it("the recovery session (model v3): its account's trades are held (403 recovery-hold); take and wallets stay refused", async () => {
    const other = await trader();
    const buyer = await passwordTrader();
    await onboarding(deps, buyer.id, new Date(now.getTime() + HOUR));
    const bc = (await buyer.b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
    const { trade } = await seedTrade(deps, { sellerId: other.id, buyerId: buyer.id, poster: 'seller' });
    const secured = await driveTo(deps, trade, 'secured');
    const rec = new Browser(app);
    expect((await backup(rec, buyer.name, bc.codes[0]!)).json()).toMatchObject({ level: 'recovery' });
    expect((await rec.get(`/v1/trades/${secured.code}`)).statusCode).toBe(200);
    expect(errorOf(await rec.post(`/v1/trades/${secured.code}/events`, { type: 'mark-paid', fiatCents: FIAT.toString() }))).toBe('recovery-hold');
    const { rows } = await deps.db.query<{ state: string }>('select state from trades where code = $1', [secured.code]);
    expect(rows[0]!.state).toBe('secured');
    expect(errorOf(await rec.post('/v1/offers/00000000-0000-4000-8000-000000000000/take', {}))).toBe('recovery-session');
    expect(errorOf(await rec.post('/v1/wallets', {}))).toBe('recovery-session');
  });

  it("a full session's open trade can still be finished (mark paid) under a hold of an older reason", async () => {
    const seller = await trader();
    const t = await heldTrader();
    const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: t.id, poster: 'seller' });
    const s = await driveTo(deps, trade, 'secured');
    expect((await t.thief.post(`/v1/trades/${s.code}/events`, { type: 'mark-paid', fiatCents: FIAT.toString() })).statusCode).toBe(200);
  });
});

describe('a strong login by the real owner ends a recovery-code hold', () => {
  it('with a passkey held before the hold: straight in on a new device, never refused by the device limit (round 2 N-C1), and the recovery session ends', async () => {
    const { b, id, name, auth } = await passkeyTrader();
    const confirmToken = await tokenFor(deps, b, id, { kind: 'new-recovery-codes' });
    const { codes } = (await b.post('/v1/account/recovery-codes', { confirmToken })).json() as { codes: string[] };
    const rec = new Browser(app);
    expect((await backup(rec, name, codes[0]!)).statusCode).toBe(200);
    // The recovery session fills "One device at a time": the owner's proof still gets in.
    await deps.db.query('update accounts set one_device = true where id = $1', [id]);
    expect((await passkeyLogin(new Browser(app), auth)).json()).toEqual({ status: 'ok' });
    expect(await holdOf(deps, id)).toBeNull();
    expect((await rec.get('/v1/account/me')).statusCode).toBe(401);
    expect((await deps.db.query('select 1 from sessions where account_id = $1 and revoked_at is null', [id])).rows).toHaveLength(1);
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

  /**
   * Hold model v3: only a recovery-code login starts a hold, and it logs every session out, so a
   * weak session living through a hold is left only in a hold of an older reason still running at
   * deploy. The tests of a weak session racing the owner's proof start one through the real
   * `startHold`, started by the session in `b` (its methods are the account's now).
   */
  async function legacyHoldBy(accountId: string, b: Browser, reason: 'weak-change' | 'weak-new-device' = 'weak-change') {
    const startedBy = await sessionOf(b);
    await withTx(deps.db, async (db) => {
      await lockAccount(db, accountId);
      await startHold(db, accountId, now, { reason, startedBy });
    });
    expect(await holdOf(deps, accountId)).toMatchObject({ reason });
  }

  /** The account's one recovery code, made from the owner's strong session in `b`. */
  async function recoveryCodeOf(o: { b: Browser; id: string }): Promise<string> {
    const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'new-recovery-codes' });
    const { codes } = (await o.b.post('/v1/account/recovery-codes', { confirmToken })).json() as { codes: string[] };
    expect(codes).toHaveLength(1);
    return codes[0]!;
  }

  describe('N-C1: a password alone cannot fill the device limit and lock the owner out of ending the hold', () => {
    it("the review's reproduction (model v3: the thief's way in is the recovery code): copies of the thief's trusted device cookie open nothing; the owner's passkey ends the hold and the thief's session", async () => {
      const o = await passkeyWithPassword();
      const passkeyId = (await methodsOf(o.b)).find((m) => m.type === 'passkey')!.id;
      const code = await recoveryCodeOf(o);
      await o.b.post('/v1/logout');
      // 2. The thief logs in with the recovery code: a recovery session and the account's hold.
      const thief = new Browser(app);
      expect((await backup(thief, o.name, code)).json()).toMatchObject({ level: 'recovery' });
      expect(await holdOf(deps, o.id)).toMatchObject({ reason: 'recovery-code' });
      // 3. Copies of the device cookie: a login opens no session during the hold.
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
      expect(await alertsOf(deps, o.id, 'sessions-ended')).toContainEqual({ count: 1, reason: 'owner-login' });
      // 5-7. The owner's proof also forgot the account's trusted devices, so the thief's copied cookie
      // trusts nothing: with the owner's strong session open, a new weak login needs the owner's
      // approval; the passkey stays.
      expect((await passwordLogin(copyDevice(thief), o.name)).json()).toMatchObject({ status: 'approve-on-device' });
      setNow(new Date(now.getTime() + HOLD_MS + HOUR));
      await settleDueHolds(deps.config, app.events).run(deps.db, now);
      expect((await deps.db.query('select 1 from webauthn_credentials where id = $1', [passkeyId])).rows).toHaveLength(1);
    });

    it('with "One device at a time" the thief\'s one weak session fills the limit under a hold of an older reason: the owner\'s passkey still gets in (no 409)', async () => {
      const o = await passkeyWithPassword();
      await deps.db.query('update accounts set one_device = true where id = $1', [o.id]);
      const thief = await approvedThief(o.b, o.name);
      await o.b.post('/v1/logout');
      await legacyHoldBy(o.id, thief, 'weak-new-device');
      expect(await live(o.id)).toBe(1);
      const owner = new Browser(app);
      expect((await passkeyLogin(owner, o.auth)).json()).toEqual({ status: 'ok' });
      expect(await holdOf(deps, o.id)).toBeNull();
      expect((await thief.get('/v1/account/me')).statusCode).toBe(401);
      expect(await live(o.id)).toBe(1);
    });

    it("the owner's proof wins over strong sessions too: at the limit the least recently seen is logged out", async () => {
      const o = await passkeyWithPassword();
      await deps.db.query('update accounts set one_device = true where id = $1', [o.id]);
      // A weak session approved by the owner, then a hold of an older reason started by it (two sessions, one strong).
      const thief = await approvedThief(o.b, o.name);
      await legacyHoldBy(o.id, thief);
      expect((await passkeyLogin(new Browser(app), o.auth)).json()).toEqual({ status: 'ok' });
      expect((await thief.get('/v1/account/me')).statusCode).toBe(401);
      expect((await o.b.get('/v1/account/me')).statusCode).toBe(401);
      expect(await live(o.id)).toBe(1);
      expect(await alertsOf(deps, o.id, 'logged-out-by-new-device')).toEqual([{ deviceLabels: ['Phone'], count: 1 }]);
    });
  });

  it('N-I1: the owner ending a backup login\'s hold ends that backup session too; 24 h later it changes nothing', async () => {
    const o = await passkeyWithPassword();
    const code = await recoveryCodeOf(o);
    const thief = new Browser(app);
    expect((await backup(thief, o.name, code)).json()).toMatchObject({ level: 'recovery' });
    expect(await holdOf(deps, o.id)).toMatchObject({ reason: 'recovery-code' });
    // A minute later, so the two `sessions-ended` alerts below have distinct times (a frozen clock ties them, then the random id orders them).
    setNow(new Date(now.getTime() + 60_000));
    expect((await passkeyLogin(new Browser(app), o.auth)).json()).toEqual({ status: 'ok' });
    expect(await holdOf(deps, o.id)).toBeNull();
    expect((await thief.get('/v1/account/me')).statusCode).toBe(401);
    // Model v3: the recovery-code login logged the owner's session out; the owner's proof ended the backup session.
    expect(await alertsOf(deps, o.id, 'sessions-ended')).toEqual([{ count: 1, reason: 'recovery-code' }, { count: 1, reason: 'owner-login' }]);
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
      // The thief's change is staged; submitted, it waits and its warning is pushed to the account (the owner's subscription is still there).
      send.mockClear();
      const staged = await changePassword(deps, thief, o.id);
      expect(staged.json()).toMatchObject({ status: 'staged' });
      expect((await submit(thief, [changeIdOf(staged)])).statusCode).toBe(200);
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
      await legacyHoldBy(o.id, thief);
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

  it('N-I4 (lead decision 2026-10-30; model v3): a username-and-password session adding a wallet, even with a PGP confirm, is staged and waits 24 h once submitted; a strong session does not', async () => {
    const t = await passwordTrader();
    await weakAgain(t.b, t.name, t.id);
    const { b, id } = t;
    await deps.db.query('update accounts set had_wallet = true where id = $1', [id]);
    const address = fakeAddress();
    const confirmToken = await issueConfirmToken(deps, { sessionId: await sessionOf(b), accountId: id, action: walletAction(address), method: 'pgp' });
    const send = vi.spyOn(app.push, 'send');
    const res = await b.post('/v1/wallets', { app: 'feather', label: 'Main', address, confirmToken });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'staged', changeId: expect.any(String) });
    expect((await b.get('/v1/wallets')).json()).toEqual([]);
    expect(await holdOf(deps, id)).toBeNull();
    expect((await submit(b, [changeIdOf(res)])).json()).toEqual({ status: 'queued', count: 1, takesEffectAt: in24h() });
    expect(send).toHaveBeenCalledWith(id, 'alert');
    expect((await b.get('/v1/wallets')).json()).toEqual([]);
    setNow(new Date(now.getTime() + HOLD_MS));
    await settleDueChanges(deps.config, app.events).run(deps.db, now);
    expect(await alertsOf(deps, id, 'hold-changes-applied')).toEqual([{ applied: ['wallets'], dropped: [] }]);
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

    // Q81 (owner 6 Nov 2026): a PGP key login is strong: its wallet confirmed with PGP is usable at once, nothing staged.
    const g = await pgpTrader();
    await deps.db.query('update accounts set had_wallet = true where id = $1', [g.id]);
    const a3 = fakeAddress();
    const t3 = await issueConfirmToken(deps, { sessionId: await sessionOf(g.b), accountId: g.id, action: walletAction(a3), method: 'pgp' });
    const pgpOk = await g.b.post('/v1/wallets', { app: 'feather', label: 'Main', address: a3, confirmToken: t3 });
    expect(pgpOk.statusCode, pgpOk.body).toBe(201);
    expect(pgpOk.json()).toMatchObject({ usable: true });
    expect(await changesOf(g.id)).toEqual([]);
  });

  describe('N-M1: a login name waiting out the hold', () => {
    /** A pre-009 account (logs in by its display name) with a password and a session whose login waits. */
    async function legacyWeak() {
      const id = await seedAccount(deps, { loginName: null });
      const h = await hashPassword(deps.config, GOOD);
      await deps.db.query('insert into passwords (account_id, hash, pepper_id, updated_at) values ($1, $2, $3, $4)', [id, h.hash, h.pepperId, now]);
      // Review M2: a password alone is setup-only; the session below is the weak one.
      await addUnusedSecurityKey(deps, id);
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

    it('is staged, counts as taken in both namespaces meanwhile, and applies 24 h after its submission', async () => {
      const t = await legacyWeak();
      const name = unique('pend');
      const res = await setName(t, name);
      expect(res.json()).toMatchObject({ status: 'staged' });
      expect(await changesOf(t.id)).toEqual([{ kind: 'login-name', submitted: false }]);
      expect(await legacy(t.id)).toBe(true);
      // Nobody can take it meanwhile, as a display name or as a login name.
      const asDisplay = await new Browser(app).post('/v1/register/password', { displayName: name, loginName: unique('other'), password: GOOD, deviceLabel: 'L', acceptedTerms: TERMS, termsSignature: SIG });
      expect(errorOf(asDisplay)).toBe('names-unavailable');
      const asLogin = await new Browser(app).post('/v1/register/password', { displayName: `P${unique('dname')}`, loginName: name, password: GOOD, deviceLabel: 'L', acceptedTerms: TERMS, termsSignature: SIG });
      expect(errorOf(asLogin)).toBe('names-unavailable');
      expect((await submit(t.b, [changeIdOf(res)])).statusCode).toBe(200);
      setNow(new Date(now.getTime() + HOLD_MS));
      await settleDueChanges(deps.config, app.events).run(deps.db, now);
      expect(await alertsOf(deps, t.id, 'hold-changes-applied')).toEqual([{ applied: ['login-name'], dropped: [] }]);
      expect(await legacy(t.id)).toBe(false);
      expect(await accountIdByLoginName(deps, name)).toBe(t.id);
    });

    it('is dropped when its key is no longer the current one', async () => {
      const t = await legacyWeak();
      const res = await setName(t, unique('pend'));
      expect(res.statusCode).toBe(202);
      expect((await submit(t.b, [changeIdOf(res)])).statusCode).toBe(200);
      await deps.db.query(`update hold_changes set change = jsonb_set(change, '{keyId}', '999') where account_id = $1`, [t.id]);
      setNow(new Date(now.getTime() + HOLD_MS));
      await settleDueChanges(deps.config, app.events).run(deps.db, now);
      expect(await alertsOf(deps, t.id, 'hold-changes-applied')).toEqual([{ applied: [], dropped: ['login-name'] }]);
      expect(await legacy(t.id)).toBe(true);
    });
  });

  it('N-M2: a waiting change that fails with a fault is dropped and logged; reads and logins go on (no 500)', async () => {
    const { b, name, id } = await passwordTrader();
    await weakAgain(b, name, id);
    const staged = await changePassword(deps, b, id);
    expect(staged.statusCode).toBe(202);
    expect((await submit(b, [changeIdOf(staged)])).statusCode).toBe(200);
    await deps.db.query('insert into t_fail_passwords values ($1)', [id]);
    try {
      setNow(new Date(now.getTime() + HOLD_MS));
      // The minute job settles them: the faulty one is dropped, the job goes on.
      await settleDueChanges(deps.config, app.events, app.log).run(deps.db, now);
      expect(await changesOf(id)).toEqual([]);
      expect(await alertsOf(deps, id, 'hold-changes-applied')).toEqual([{ applied: [], dropped: ['password'] }]);
      expect(logs.some((l) => l.includes('waiting change failed'))).toBe(true);
      // The trusted browser logs in again.
      await b.post('/v1/logout');
      expect((await passwordLogin(b, name)).json()).toEqual({ status: 'ok' });
      // Fails closed: the old password still logs in, the held one does not.
      expect(errorOf(await passwordLogin(new Browser(app), name, NEW_PASSWORD))).toBe('credentials-invalid');
    } finally {
      await deps.db.query('delete from t_fail_passwords where account_id = $1', [id]);
    }
  });

  it("N-M3: a weak session cannot mark the hold's or the login alerts seen; others it can", async () => {
    const o = await passkeyWithPassword();
    const thief = await approvedThief(o.b, o.name);
    const staged = await changePassword(deps, thief, o.id);
    expect(staged.statusCode).toBe(202);
    expect((await submit(thief, [changeIdOf(staged)])).statusCode).toBe(200);
    // A hold's own alert too (one of an older reason).
    await legacyHoldBy(o.id, thief);
    const list = (await o.b.get('/v1/account/alerts')).json() as Array<{ id: string; kind: string }>;
    for (const kind of ['hold-changes-submitted', 'hold-started', 'new-login']) {
      const a = list.find((x) => x.kind === kind)!;
      expect((await thief.post(`/v1/account/alerts/${a.id}/seen`)).json()).toEqual({ error: 'weak-session' });
    }
    const plain = list.find((x) => !OWNER_WARNINGS.includes(x.kind))!;
    expect((await thief.post(`/v1/account/alerts/${plain.id}/seen`)).statusCode).toBe(204);
    const seen = await deps.db.query("select 1 from alerts where account_id = $1 and kind in ('hold-started', 'hold-changes-submitted') and seen_at is not null", [o.id]);
    expect(seen.rows).toEqual([]);
    // The owner's strong session can.
    const hs = list.find((x) => x.kind === 'hold-changes-submitted')!;
    expect((await o.b.post(`/v1/account/alerts/${hs.id}/seen`)).statusCode).toBe(204);
  });

  describe('review round 3', () => {
    /** The gate as a security route calls it, for a session whose request passed its preHandlers earlier. */
    const gateAs = (accountId: string, sessionId: string) =>
      withTx(deps.db, (db) =>
        gateChange(db, { server: app, auth: { accountId, sessionId, level: 'full' }, log: app.log } as unknown as FastifyRequest, { kind: 'one-device', on: true }),
      );

    it("R3-I1: a thief's change in flight across the owner's proof starts no new hold: the gate refuses a revoked session (401)", async () => {
      const o = await passkeyWithPassword();
      const thief = await approvedThief(o.b, o.name);
      const w = await sessionOf(thief);
      await legacyHoldBy(o.id, thief);
      expect((await passkeyLogin(new Browser(app), o.auth)).json()).toEqual({ status: 'ok' });
      expect(await holdOf(deps, o.id)).toBeNull();
      expect((await thief.get('/v1/account/me')).statusCode).toBe(401);
      // The thief's request read its session before the owner's commit and reaches the gate after it: nothing is staged.
      await expect(gateAs(o.id, w)).rejects.toMatchObject({ status: 401, code: 'not-authenticated' });
      expect(await holdOf(deps, o.id)).toBeNull();
      expect(await changesOf(o.id)).toEqual([]);
      // An expired session is refused the same way.
      const t2 = await approvedThief(o.b, o.name);
      const s2 = await sessionOf(t2);
      await deps.db.query('update sessions set expires_at = $2 where id = $1', [s2, now]);
      await expect(gateAs(o.id, s2)).rejects.toMatchObject({ status: 401 });
      expect(await holdOf(deps, o.id)).toBeNull();
      expect(await changesOf(o.id)).toEqual([]);
    });

    it('R3-I1: PUT /v1/account/password is throttled per session (a refused loop runs dry: 429 slow-down)', async () => {
      const o = await passkeyWithPassword();
      const thief = await approvedThief(o.b, o.name);
      await legacyHoldBy(o.id, thief);
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
      await legacyHoldBy(o.id, o.b);
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
      await legacyHoldBy(o.id, thief);
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

      it("model v3: the recovery-code login logs both out, so neither cancels the backup session; the owner's passkey ends it", async () => {
        const o = await passkeyWithPassword();
        const thief = await approvedThief(o.b, o.name);
        const code = await recoveryCodeOf(o);
        const rb = new Browser(app);
        expect((await backup(rb, o.name, code)).statusCode).toBe(200);
        const rec = await sessionOf(rb);
        expect((await thief.delete(`/v1/account/recovery-sessions/${rec}`)).statusCode).toBe(401);
        expect((await o.b.delete(`/v1/account/recovery-sessions/${rec}`)).statusCode).toBe(401);
        expect((await passkeyLogin(new Browser(app), o.auth)).json()).toEqual({ status: 'ok' });
        expect((await rb.get('/v1/account/me')).statusCode).toBe(401);
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
      await legacyHoldBy(o.id, thief);
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
      await legacyHoldBy(o.id, thief);
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
      await legacyHoldBy(o.id, thief);
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
      /** A password-only owner whose sign-up session (weak, set-up window over) made the recovery code. */
      async function weakOwnerWithCode() {
        const o = await passwordTrader();
        await onboarding(deps, o.id, new Date(now.getTime() + HOUR));
        const { codes } = (await o.b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
        expect(codes).toHaveLength(1);
        await onboarding(deps, o.id, null);
        return { ...o, code: codes[0]! };
      }
      const backupLogin = async (name: string, code: string) => {
        const b = new Browser(app);
        expect((await backup(b, name, code)).statusCode).toBe(200);
        return sessionOf(b);
      };

      it("model v3: no older weak session is left to cancel it (the recovery-code login logged the owner's out); the hold stays", async () => {
        const o = await weakOwnerWithCode();
        setNow(new Date(now.getTime() + 60_000));
        const rec = await backupLogin(o.name, o.code);
        expect((await o.b.delete(`/v1/account/recovery-sessions/${rec}`)).statusCode).toBe(401);
        const { rows } = await deps.db.query('select 1 from sessions where id = $1 and revoked_at is null', [rec]);
        expect(rows).toHaveLength(1);
        expect(await holdOf(deps, o.id)).toMatchObject({ reason: 'recovery-code' });
      });

      it('after the hold, a weak session younger than the backup session is refused (403 weak-session) and the backup session stays', async () => {
        const o = await weakOwnerWithCode();
        const trust = await deps.db.query<{ device_hash: Buffer }>('select device_hash from trusted_devices where account_id = $1', [o.id]);
        setNow(new Date(now.getTime() + 60_000));
        const rec = await backupLogin(o.name, o.code);
        setNow(new Date(now.getTime() + HOLD_MS + 60_000));
        await settleDueHolds(deps.config, app.events).run(deps.db, now);
        expect(await holdOf(deps, o.id)).toBeNull();
        // The recovery-code login ended every device trust (hold v3 review Critical 1); the sign-up
        // browser is trusted again here as if a login of it had been approved since.
        for (const r of trust.rows) {
          await deps.db.query('insert into trusted_devices (account_id, device_hash, created_at, last_used_at) values ($1, $2, $3, $3) on conflict do nothing', [o.id, r.device_hash, now]);
        }
        // The sign-up browser logs in again with the password: a weak session opened after the backup login.
        expect((await passwordLogin(o.b, o.name)).json()).toEqual({ status: 'ok' });
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
        const tables = [
          'alerts', 'login_approvals', 'account_holds', 'push_subscriptions', 'wallets', 'passwords', 'totp', 'pgp_keys', 'webauthn_credentials', 'recovery_codes', 'trusted_devices', 'team_members', 'team_audit',
          'recovery_code_reveals', 'held_trades', 'past_reputation', 'jabber_contacts', 'chat_key_envelopes',
        ];
        const out: Record<string, unknown> = {};
        for (const t of tables) out[t] = (await deps.db.query<{ j: unknown }>(`${agg(`${t} t`)} where account_id = $1`, [accountId])).rows[0]!.j;
        // Model v3: the calling session's own drafts die with it (migration 016's trigger), so they are left out.
        out.hold_changes = (await deps.db.query<{ j: unknown }>(
          `${agg('hold_changes t')} where account_id = $1 and (submitted_at is not null or session_id is distinct from $2)`, [accountId, caller],
        )).rows[0]!.j;
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

      /** A trader with Jabber alerts on (owner rule p5-7). */
      async function jabberOn() {
        const o = await passkeyWithPassword();
        const jid = `${unique('live')}@xmpp.example.org`;
        expect((await o.b.post('/v1/account/jabber/test', { address: jid })).statusCode).toBe(202);
        await new Promise((r) => setImmediate(r));
        expect((await o.b.post('/v1/account/jabber/verify', { code: jabberCodes.get(jid)! })).statusCode).toBe(200);
        return o;
      }

      type Prepared = { b: Browser; accountId: string; fire: () => Promise<LightMyRequestResponse> };
      /** A password-only trader whose weak session staged a password change (model v3). */
      async function weakStaged() {
        const t = await passwordTrader();
        await weakAgain(t.b, t.name, t.id);
        const r = await changePassword(deps, t.b, t.id);
        expect(r.json()).toMatchObject({ status: 'staged' });
        return { ...t, changeId: changeIdOf(r) };
      }
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
        'PUT /v1/account/session/length': async () => {
          const o = await passkeyWithPassword();
          return { b: o.b, accountId: o.id, fire: () => o.b.put('/v1/account/session/length', { hours: 4 }) };
        },
        'POST /v1/account/session/extend': async () => {
          const o = await passkeyWithPassword();
          const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'extend-session' });
          return { b: o.b, accountId: o.id, fire: () => o.b.post('/v1/account/session/extend', { confirmToken }) };
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
          // Model v3: the recovery-code login logs everyone out and the owner's proof would end the
          // backup session, so the caller is the owner's passkey session opened after the hold's 24 h.
          const o = await passkeyWithPassword();
          const code = await recoveryCodeOf(o);
          const rb = new Browser(app);
          expect((await backup(rb, o.name, code)).statusCode).toBe(200);
          const rec = await sessionOf(rb);
          setNow(new Date(now.getTime() + HOLD_MS + 60_000));
          await settleDueHolds(deps.config, app.events).run(deps.db, now);
          const ob = new Browser(app);
          expect((await passkeyLogin(ob, o.auth)).json()).toEqual({ status: 'ok' });
          return { b: ob, accountId: o.id, fire: () => ob.delete(`/v1/account/recovery-sessions/${rec}`) };
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
          return { b: o.b, accountId: o.id, fire: () => o.b.post('/v1/account/terms', { version: TERMS, signature: SIG }) };
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
        // J-20: a member's trade-size band and working hours.
        'PUT /v1/team/members/:id/limits': async () => {
          const o = await passkeyWithPassword();
          const mid = await teamInvite(o);
          const confirmToken = await tokenFor(deps, o.b, o.id, { kind: 'team-limits', memberId: mid, band: '0-1000000000000', hours: 'any' });
          return { b: o.b, accountId: o.id, fire: () => o.b.put(`/v1/team/members/${mid}/limits`, { band: { minAtomic: '0', maxAtomic: '1000000000000' }, hours: 'any', confirmToken }) };
        },
        // Hold model v3: submitting and cancelling the waiting changes, and showing the renewed recovery code.
        'POST /v1/account/hold/changes/submit': async () => {
          const t = await weakStaged();
          return { b: t.b, accountId: t.id, fire: () => submit(t.b, [t.changeId]) };
        },
        // Owner G58: a strong session approves waiting changes now (here the weak session made strong in the database).
        'POST /v1/account/hold/changes/approve': async () => {
          const t = await weakStaged();
          expect((await submit(t.b, [t.changeId])).statusCode).toBe(200);
          await deps.db.query("update sessions set strength = 'strong' where account_id = $1 and revoked_at is null", [t.id]);
          return { b: t.b, accountId: t.id, fire: () => t.b.post('/v1/account/hold/changes/approve', { ids: [t.changeId] }) };
        },
        'DELETE /v1/account/hold/changes': async () => {
          const t = await weakStaged();
          expect((await submit(t.b, [t.changeId])).statusCode).toBe(200);
          return { b: t.b, accountId: t.id, fire: () => del(t.b, '/v1/account/hold/changes') };
        },
        'DELETE /v1/account/hold/changes/:id': async () => {
          const t = await weakStaged();
          expect((await submit(t.b, [t.changeId])).statusCode).toBe(200);
          return { b: t.b, accountId: t.id, fire: () => del(t.b, `/v1/account/hold/changes/${t.changeId}`) };
        },
        'POST /v1/account/recovery-code/reveal': async () => {
          const o = await passkeyWithPassword();
          const code = await recoveryCodeOf(o);
          expect((await backup(new Browser(app), o.name, code)).statusCode).toBe(200);
          // The owner's proof ends the hold; the new code is due to this session.
          const ob = new Browser(app);
          expect((await passkeyLogin(ob, o.auth)).json()).toEqual({ status: 'ok' });
          return { b: ob, accountId: o.id, fire: () => ob.post('/v1/account/recovery-code/reveal') };
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
        // Owner rule p5-7: the Jabber set-up (jabber/routes.ts `writeGate`).
        'POST /v1/account/jabber/test': async () => {
          const o = await passkeyWithPassword();
          return { b: o.b, accountId: o.id, fire: () => o.b.post('/v1/account/jabber/test', { address: `${unique('live')}@xmpp.example.org` }) };
        },
        'POST /v1/account/jabber/verify': async () => {
          const o = await passkeyWithPassword();
          const jid = `${unique('live')}@xmpp.example.org`;
          expect((await o.b.post('/v1/account/jabber/test', { address: jid })).statusCode).toBe(202);
          await new Promise((r) => setImmediate(r));
          return { b: o.b, accountId: o.id, fire: () => o.b.post('/v1/account/jabber/verify', { code: jabberCodes.get(jid)! }) };
        },
        'PUT /v1/account/jabber/enabled': async () => {
          const o = await jabberOn();
          return { b: o.b, accountId: o.id, fire: () => o.b.put('/v1/account/jabber/enabled', { on: false }) };
        },
        // W-021: the Jabber notifications settings page.
        'PUT /v1/account/jabber/events': async () => {
          const o = await jabberOn();
          return { b: o.b, accountId: o.id, fire: () => o.b.put('/v1/account/jabber/events', { kind: 'trade-attention', on: false }) };
        },
        'DELETE /v1/account/jabber': async () => {
          const o = await jabberOn();
          return { b: o.b, accountId: o.id, fire: () => o.b.delete('/v1/account/jabber') };
        },
        // J-23 groundwork: the chat-key courier (auth/chatKeys.ts), strong sessions only (a passkey session is).
        'POST /v1/account/chat-keys': async () => {
          const o = await passkeyWithPassword();
          return { b: o.b, accountId: o.id, fire: () => o.b.post('/v1/account/chat-keys', { recipientPublic: 'ab'.repeat(32), sealed: Buffer.alloc(80, 1).toString('base64url'), epoch: 0 }) };
        },
        'DELETE /v1/account/chat-keys/:id': async () => {
          const o = await passkeyWithPassword();
          const r = await o.b.post('/v1/account/chat-keys', { recipientPublic: 'cd'.repeat(32), sealed: Buffer.alloc(80, 2).toString('base64url'), epoch: 0 });
          expect(r.statusCode, r.body).toBe(201);
          return { b: o.b, accountId: o.id, fire: () => del(o.b, `/v1/account/chat-keys/${(r.json() as { id: string }).id}`) };
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
    // Owner 2026-11-01 (landing review I1): invites also need a strong session, checked after the
    // hold and before the confirm token is spent; removal does not. Hold model v3 (owner 2 Nov): a
    // role change by a password-only session is staged (`gateChange`) instead of refused. Owner
    // p11-21 (S-104): a password-only session's invite goes out with its boxes staged
    // (`gateChange` for the new member); only one inside its sign-up window is refused before the
    // confirm token is spent (`requireStageableSession`).
    expect(src('routes/team.ts').split(', requireNotHeld, requireStageableSession, requireConfirm(').length - 1).toBe(1);
    // J-20: the limits route checks the hold like a boxes change, and stages a password-only session's change too.
    expect(src('routes/team.ts').split(', requireNotHeld, requireConfirm(').length - 1).toBe(3);
    expect(src('routes/team.ts').split('await gateChange(').length - 1).toBe(2);
    expect(src('routes/team.ts').split("=> gateChange(c, req, { kind: 'team-abilities', memberId, abilities })").length - 1).toBe(1);
    expect(src('team/members.ts').split('await ownerWriteGate(c, caller, now, { strong: true });').length - 1).toBe(2);
    expect(src('team/members.ts').split('await ownerWriteGate(c, caller, now, stage ? { strong: false, vendor: true } : { strong: true });').length - 1).toBe(1);
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
