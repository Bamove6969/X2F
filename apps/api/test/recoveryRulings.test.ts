// Owner rulings of 9 Nov 2026 on the recovery code (owner-answers page 11):
// - S-109 (p11-34): "a correct recovery code always gets in", even when logins are throttled. A
//   wrong code is still throttled (429 while it waits); since review L1 (12 Nov) a wrong code that
//   arrives while throttled is counted too, so the streak and its lock alert follow a real attack.
// - S-110 (p11-35): a password change with the current password (the confirm token), the new
//   password and the recovery code goes through at once, with no 24-hour hold, for a session whose
//   changes would otherwise wait.
// - S-111 (p11-36): after a code is used the person is told it is burned (`recoveryCodeBurned`).
import { createHash, randomBytes } from 'node:crypto';
import { addressEnd, type ConfirmAction } from '@x2f/accounts';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AddressValidator, Deps } from '../src/app.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { HOLD_MS } from '../src/auth/hold.js';
import { settleDueChanges } from '../src/auth/holdChanges.js';
import { verifyPassword } from '../src/auth/password.js';
import { SIG } from './helpers/signature.js';
import { accountIdByLoginName, addUnusedSecurityKey } from './helpers/accounts.js';
import { fixtureLeakedList } from './helpers/leaked.js';
import { tradeApp } from './helpers/tradeApp.js';
import { Browser } from './helpers/totp.js';

const TERMS = '2026-10-17';
const GOOD = 'Correct-Horse-9';
const NEW_PASSWORD = 'Another-Horse-8';
const WRONG_CODE = 'ABCD-EFGH-JKMN-PQRT';
const HOUR = 3600_000;
const T0 = new Date('2026-11-12T12:00:00Z');

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let step = 0;
let cleanup: () => Promise<void>;

const fakeValidator: AddressValidator = { check: async (a) => (/^5[1-9A-HJ-NP-Za-km-z]{94}$/.test(a) ? 'ok' : 'invalid') };
const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const fakeAddress = () => '5' + [...randomBytes(94)].map((x) => BASE58[x % BASE58.length]).join('');
const walletAction = (address: string): ConfirmAction => ({
  kind: 'add-wallet', addressHash: createHash('sha256').update(address).digest('hex'), addressEnd: addressEnd(address),
});

/**
 * Review M1(b) (12 Nov 2026), an OWNER QUESTION, not decided here: should S-110 (proof by recovery
 * code) cancel EVERY waiting change of the account (wallets, methods, login name, team), not only
 * the superseded password changes? While false, the M1 test records today's behaviour: a thief's
 * waiting payout wallet still applies 24 h later. Flip it with the owner's ruling (and the code).
 */
const OWNER_RULED_S110_CANCELS_ALL_WAITING_CHANGES = false;

beforeAll(async () => {
  const fixture = await fixtureLeakedList();
  cleanup = fixture.cleanup;
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await tradeApp({}, { leaked: fixture.list, addresses: fakeValidator }));
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
});

let seq = 0;
const unique = (p: string) => `${p}${++seq}r`;
const errorOf = (r: LightMyRequestResponse) => (r.json() as { error?: string }).error;

const onboarding = (accountId: string, until: Date | null) =>
  deps.db.query('update sessions set onboarding_until = $2 where account_id = $1', [accountId, until]);

/** A password trader with the recovery code (made inside the sign-up window); the window is then over, so its changes wait. */
async function ownerWithCode() {
  const b = new Browser(app);
  const name = unique('recov');
  const res = await b.post('/v1/register/password', { displayName: `P${name}`, loginName: name, password: GOOD, deviceLabel: 'Laptop', acceptedTerms: TERMS, termsSignature: SIG });
  expect(res.statusCode).toBe(201);
  const id = (await accountIdByLoginName(deps, name))!;
  const codes = (await b.post('/v1/account/recovery-codes', {})).json() as { codes: string[] };
  // Review M2: a password alone is setup-only; the password session below is still the weak one.
  await addUnusedSecurityKey(deps, id);
  await onboarding(id, null);
  return { b, name, id, code: codes.codes[0]! };
}

async function sessionOf(b: Browser): Promise<string> {
  const res = await b.get('/v1/account/sessions');
  expect(res.statusCode).toBe(200);
  return (res.json() as Array<{ id: string; current: boolean }>).find((s) => s.current)!.id;
}

const tokenFor = async (b: Browser, accountId: string, action: ConfirmAction = { kind: 'set-password' }) =>
  issueConfirmToken(deps, { sessionId: await sessionOf(b), accountId, action, method: 'password' });

/** A second (weak, password) session of the account in a new browser, approved from `t.b`: the thief. */
async function thiefSession(t: { b: Browser; name: string }): Promise<Browser> {
  const thief = new Browser(app);
  const w = (await thief.post('/v1/login/password', { loginName: t.name, password: GOOD, deviceLabel: 'Thief' })).json() as { approvalId: string; number: number };
  expect((await t.b.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ outcome: 'approved' });
  expect((await thief.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toMatchObject({ status: 'ok' });
  return thief;
}

/**
 * Runs `runs` at once and holds each just after its query starting with `prefix` until all have
 * made it, so they truly race on whatever comes next (as recovery.test.ts's `racing`).
 */
async function racing<T>(prefix: string, runs: Array<() => Promise<T>>): Promise<T[]> {
  const query = deps.db.query.bind(deps.db) as (text: string, values?: unknown[]) => Promise<unknown>;
  let reached = 0;
  let release!: () => void;
  const barrier = new Promise<void>((r) => { release = r; });
  const spy = vi.spyOn(deps.db, 'query').mockImplementation((async (text: string, values?: unknown[]) => {
    const result = await query(text, values);
    if (text.startsWith(prefix)) {
      if (++reached === runs.length) release();
      await barrier;
    }
    return result;
  }) as never);
  try {
    const results = await Promise.all(runs.map((r) => r()));
    expect(reached).toBe(runs.length);
    return results;
  } finally {
    spy.mockRestore();
  }
}

const backupLogin = (b: Browser, name: string, code: string) =>
  b.post('/v1/login/backup', { loginName: name, kind: 'recovery-code', code, deviceLabel: 'Tor Browser' });

async function throttleRows(accountId: string): Promise<Array<{ key: string; failures: number }>> {
  const { rows } = await deps.db.query<{ key: string; failures: number }>(
    "select key, failures from login_throttle where key like 'recovery-code:' || $1 || ':%' order by key",
    [accountId],
  );
  return rows;
}

const unusedCodes = async (accountId: string) =>
  (await deps.db.query<{ n: number }>('select count(*)::int as n from recovery_codes where account_id = $1 and used_at is null', [accountId])).rows[0]!.n;

const passwordMatches = async (accountId: string, password: string) => {
  const { rows } = await deps.db.query<{ hash: string; pepper_id: number }>('select hash, pepper_id from passwords where account_id = $1', [accountId]);
  return verifyPassword(deps.config, { hash: rows[0]!.hash, pepperId: rows[0]!.pepper_id }, password);
};

const draftsOf = async (accountId: string) =>
  (await deps.db.query<{ n: number }>('select count(*)::int as n from hold_changes where account_id = $1', [accountId])).rows[0]!.n;

describe('S-109: a correct recovery code always gets in, even when logins are throttled', () => {
  it('after enough wrong codes to slow down (429 slow-down), the correct code logs in at once and the streak is cleared', async () => {
    const t = await ownerWithCode();
    const b = new Browser(app);
    for (let i = 0; i < 4; i++) expect((await backupLogin(b, t.name, WRONG_CODE)).statusCode).toBe(401);
    // The next wrong code waits ...
    const slowed = await backupLogin(b, t.name, WRONG_CODE);
    expect(slowed.statusCode).toBe(429);
    expect(errorOf(slowed)).toBe('slow-down');
    // ... but the right one does not.
    const res = await backupLogin(b, t.name, t.code);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', level: 'recovery' });
    expect(await throttleRows(t.id)).toEqual([]);
  });

  it('after the lock (10 wrong codes, 429 locked), the correct code still logs in', async () => {
    const t = await ownerWithCode();
    const b = new Browser(app);
    // Ten failures in a streak; each waits out the wait before it so it counts.
    for (let i = 0; i < 10; i++) {
      setNow(new Date(now.getTime() + 31_000));
      expect((await backupLogin(b, t.name, WRONG_CODE)).statusCode).toBe(401);
    }
    const locked = await backupLogin(b, t.name, WRONG_CODE);
    expect(locked.statusCode).toBe(429);
    expect(errorOf(locked)).toBe('locked');
    const res = await backupLogin(b, t.name, t.code);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', level: 'recovery' });
  });

  it('a wrong code while throttled is still refused with the wait, and is counted (review L1)', async () => {
    const t = await ownerWithCode();
    const b = new Browser(app);
    for (let i = 0; i < 4; i++) expect((await backupLogin(b, t.name, WRONG_CODE)).statusCode).toBe(401);
    expect((await throttleRows(t.id)).map((r) => r.failures)).toEqual([4]);
    for (let i = 0; i < 3; i++) {
      const r = await backupLogin(b, t.name, WRONG_CODE);
      expect(r.statusCode).toBe(429);
      expect(r.json()).toMatchObject({ error: 'slow-down', retryAfterSeconds: expect.any(Number) });
    }
    // Review L1: the throttled misses count, so the streak stays live and reaches the lock.
    expect((await throttleRows(t.id)).map((r) => r.failures)).toEqual([7]);
    // The code is still unused, and still gets in.
    expect(await unusedCodes(t.id)).toBe(1);
    expect((await backupLogin(b, t.name, t.code)).statusCode).toBe(200);
  });

  it('throttled misses reach the lock and its one login-locked alert (review L1)', async () => {
    const t = await ownerWithCode();
    const b = new Browser(app);
    // Four counted misses, then six more refused with the wait: ten in the streak, no clock moved.
    for (let i = 0; i < 4; i++) expect((await backupLogin(b, t.name, WRONG_CODE)).statusCode).toBe(401);
    for (let i = 0; i < 6; i++) expect((await backupLogin(b, t.name, WRONG_CODE)).statusCode).toBe(429);
    expect((await throttleRows(t.id)).map((r) => r.failures)).toEqual([10]);
    const { rows } = await deps.db.query("select detail from alerts where account_id = $1 and kind = 'login-locked'", [t.id]);
    expect(rows).toEqual([{ detail: { method: 'recovery-code' } }]);
  });

  it('an unknown login name while throttled answers 429 as before (nothing to get in to)', async () => {
    const b = new Browser(app);
    const ghost = unique('ghostname');
    for (let i = 0; i < 4; i++) expect((await backupLogin(b, ghost, WRONG_CODE)).statusCode).toBe(401);
    expect((await backupLogin(b, ghost, WRONG_CODE)).statusCode).toBe(429);
  });
});

describe('S-110: password change with the current password, the new password and the recovery code applies at once', () => {
  it('without the code a username + password session\'s change still waits (202 staged)', async () => {
    const t = await ownerWithCode();
    const r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: await tokenFor(t.b, t.id) });
    expect(r.statusCode).toBe(202);
    expect(await passwordMatches(t.id, GOOD)).toBe(true);
  });

  it('with the correct code: applied now (200), nothing staged, the code spent and replaced, other sessions ended, the person told the code is burned', async () => {
    const t = await ownerWithCode();
    // A thief logged in elsewhere with the same password.
    const thief = new Browser(app);
    const w = (await thief.post('/v1/login/password', { loginName: t.name, password: GOOD, deviceLabel: 'Thief' })).json() as { approvalId: string; number: number };
    expect((await t.b.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ outcome: 'approved' });
    expect((await thief.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toMatchObject({ status: 'ok' });
    const { rows: old } = await deps.db.query<{ id: string }>('select id from recovery_codes where account_id = $1', [t.id]);

    const r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: await tokenFor(t.b, t.id), recoveryCode: t.code.toLowerCase() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, recoveryCodeBurned: true });
    expect(await passwordMatches(t.id, NEW_PASSWORD)).toBe(true);
    expect(await draftsOf(t.id)).toBe(0);
    // The thief is logged out; the owner's session goes on.
    expect((await thief.get('/v1/account/me')).statusCode).toBe(401);
    expect((await t.b.get('/v1/account/me')).statusCode).toBe(200);
    // The used code no longer works; a new one replaced it (hold model v3, one code).
    const { rows: now1 } = await deps.db.query<{ id: string }>('select id from recovery_codes where account_id = $1 and used_at is null', [t.id]);
    expect(now1).toHaveLength(1);
    expect(now1[0]!.id).not.toBe(old[0]!.id);
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(401);
    // No account hold was started.
    expect((await deps.db.query('select 1 from account_holds where account_id = $1', [t.id])).rows).toHaveLength(0);
  });

  it('a wrong code: 401 credentials-invalid, nothing changes or is staged, the failure counts on the recovery-code key, and the confirm token is not used up', async () => {
    const t = await ownerWithCode();
    const token = await tokenFor(t.b, t.id);
    const r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: token, recoveryCode: WRONG_CODE });
    expect(r.statusCode).toBe(401);
    expect(errorOf(r)).toBe('credentials-invalid');
    expect(await passwordMatches(t.id, GOOD)).toBe(true);
    expect(await draftsOf(t.id)).toBe(0);
    expect((await throttleRows(t.id)).map((x) => x.failures)).toEqual([1]);
    expect(await unusedCodes(t.id)).toBe(1);
    // The same token still works with the right code.
    const ok = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: token, recoveryCode: t.code });
    expect(ok.statusCode).toBe(200);
  });

  it('a correct code gets through a throttled recovery-code key (S-109) here too', async () => {
    const t = await ownerWithCode();
    for (let i = 0; i < 4; i++) {
      expect((await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: await tokenFor(t.b, t.id), recoveryCode: WRONG_CODE })).statusCode).toBe(401);
    }
    const slowed = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: await tokenFor(t.b, t.id), recoveryCode: WRONG_CODE });
    expect(slowed.statusCode).toBe(429);
    const r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: await tokenFor(t.b, t.id), recoveryCode: t.code });
    expect(r.statusCode).toBe(200);
    expect(await passwordMatches(t.id, NEW_PASSWORD)).toBe(true);
  });

  it('the code still needs the current password: without a confirm token the change is refused and the code stays unused', async () => {
    const t = await ownerWithCode();
    const r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, recoveryCode: t.code });
    expect(r.statusCode).toBe(403);
    expect(errorOf(r)).toBe('confirm-required');
    expect(await unusedCodes(t.id)).toBe(1);
    expect(await passwordMatches(t.id, GOOD)).toBe(true);
  });

  it('a recoveryCode that is not a string is 400 bad-request', async () => {
    const t = await ownerWithCode();
    const r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: await tokenFor(t.b, t.id), recoveryCode: 12 });
    expect(r.statusCode).toBe(400);
    expect(await unusedCodes(t.id)).toBe(1);
  });

  it('never lifts a running account hold: 403 recovery-hold and the code stays unused', async () => {
    const t = await ownerWithCode();
    await deps.db.query(
      `insert into account_holds (account_id, started_at, hold_until, reason, started_methods) values ($1, $2, $3, 'recovery-code', '{}')`,
      [t.id, now, new Date(now.getTime() + 24 * HOUR)],
    );
    const r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: await tokenFor(t.b, t.id), recoveryCode: t.code });
    expect(r.statusCode).toBe(403);
    expect(errorOf(r)).toBe('recovery-hold');
    expect(await unusedCodes(t.id)).toBe(1);
  });

  it('review M1(a): a waiting password change (a thief\'s, submitted) is superseded and never applies; the wallet follows the owner\'s M1(b) ruling', async () => {
    const t = await ownerWithCode();
    const thief = await thiefSession(t);
    const THIEF_PASSWORD = 'Thief-Horse-77x';
    const pw = await thief.put('/v1/account/password', { password: THIEF_PASSWORD, confirmToken: await tokenFor(thief, t.id) });
    expect(pw.statusCode).toBe(202);
    const address = fakeAddress();
    const wallet = await thief.post('/v1/wallets', { app: 'cake', label: 'Main', address, confirmToken: await tokenFor(thief, t.id, walletAction(address)) });
    expect(wallet.statusCode).toBe(202);
    const ids = [(pw.json() as { changeId: string }).changeId, (wallet.json() as { changeId: string }).changeId];
    expect((await thief.post('/v1/account/hold/changes/submit', { ids })).statusCode).toBe(200);

    // The owner recovers with S-110.
    const r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: await tokenFor(t.b, t.id), recoveryCode: t.code });
    expect(r.statusCode).toBe(200);
    // The superseded password change is gone at once, and the owner is told it was cancelled.
    const { rows: left } = await deps.db.query<{ kind: string }>("select change->>'kind' as kind from hold_changes where account_id = $1", [t.id]);
    expect(left.map((x) => x.kind)).not.toContain('password');
    const { rows: cancelled } = await deps.db.query<{ detail: { count: number; changes: Array<{ kind: string }>; reason?: string } }>(
      "select detail from alerts where account_id = $1 and kind = 'hold-changes-cancelled'", [t.id],
    );
    expect(cancelled.map((c) => c.detail)).toEqual([{ count: 1, changes: [{ kind: 'password' }], reason: 'superseded-by-recovery-code' }]);

    // A day later, the waiting changes' date comes.
    const ownerSession = await sessionOf(t.b);
    setNow(new Date(now.getTime() + HOLD_MS + 60_000));
    await settleDueChanges(deps.config, app.events).run(deps.db, now);
    expect(await passwordMatches(t.id, NEW_PASSWORD)).toBe(true);
    expect(await passwordMatches(t.id, THIEF_PASSWORD)).toBe(false);
    // Nothing the thief left behind logged the owner out (a thief's password change would have).
    const { rows: own } = await deps.db.query<{ revoked_at: Date | null }>('select revoked_at from sessions where id = $1', [ownerSession]);
    expect(own[0]!.revoked_at).toBeNull();
    const { rows: wallets } = await deps.db.query('select id from wallets where account_id = $1 and removed_at is null', [t.id]);
    if (OWNER_RULED_S110_CANCELS_ALL_WAITING_CHANGES) {
      // PENDING owner ruling M1(b): every waiting change is cancelled by S-110.
      expect(wallets).toHaveLength(0);
    } else {
      // Today's behaviour, recorded until the owner rules: the thief's waiting wallet still applies.
      expect(wallets).toHaveLength(1);
    }
  });

  it('review T1: the same code used twice at once (a backup login and S-110): exactly one wins', async () => {
    const t = await ownerWithCode();
    const token = await tokenFor(t.b, t.id);
    const [login, change] = await racing('select id from recovery_codes', [
      () => backupLogin(new Browser(app), t.name, t.code),
      () => t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: token, recoveryCode: t.code }),
    ]);
    expect([login!.statusCode, change!.statusCode].sort()).toEqual([200, 401]);
    // Whichever won, the other left no trace: the password changed only if S-110 won.
    expect(await passwordMatches(t.id, NEW_PASSWORD)).toBe(change!.statusCode === 200);
    const { rows } = await deps.db.query("select 1 from sessions where account_id = $1 and level = 'recovery'", [t.id]);
    expect(rows.length).toBe(login!.statusCode === 200 ? 1 : 0);
  });

  it('review T1: two S-110 changes with the same code at once: exactly one applies', async () => {
    const t = await ownerWithCode();
    const [a, b] = [await tokenFor(t.b, t.id), await tokenFor(t.b, t.id)];
    const results = await racing('select id from recovery_codes', [
      () => t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: a, recoveryCode: t.code }),
      () => t.b.put('/v1/account/password', { password: 'Third-Horse-55y', confirmToken: b, recoveryCode: t.code }),
    ]);
    expect(results.map((r) => r.statusCode).sort()).toEqual([200, 401]);
    const won = results[0]!.statusCode === 200 ? NEW_PASSWORD : 'Third-Horse-55y';
    expect(await passwordMatches(t.id, won)).toBe(true);
  });

  it('review T2: a hold that starts after the preHandler is refused inside the transaction (403 recovery-hold), the code unused', async () => {
    const t = await ownerWithCode();
    const token = await tokenFor(t.b, t.id);
    const query = deps.db.query.bind(deps.db) as (text: string, values?: unknown[]) => Promise<unknown>;
    // The hold starts just after `checkChangeCode` matched the code, past `requireNotHeld`.
    const spy = vi.spyOn(deps.db, 'query').mockImplementation((async (text: string, values?: unknown[]) => {
      const result = await query(text, values);
      if (text.startsWith('select id from recovery_codes')) {
        await query(
          `insert into account_holds (account_id, started_at, hold_until, reason, started_methods) values ($1, $2, $3, 'recovery-code', '{}')`,
          [t.id, now, new Date(now.getTime() + 24 * HOUR)],
        );
      }
      return result;
    }) as never);
    let r: LightMyRequestResponse;
    try {
      r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: token, recoveryCode: t.code });
    } finally {
      spy.mockRestore();
    }
    expect(r.statusCode).toBe(403);
    expect(errorOf(r)).toBe('recovery-hold');
    expect(await unusedCodes(t.id)).toBe(1);
    expect(await passwordMatches(t.id, GOOD)).toBe(true);
  });

  it('a strong session that gives a code: applied as before, and the code is spent too', async () => {
    const t = await ownerWithCode();
    await deps.db.query("update sessions set strength = 'strong' where account_id = $1", [t.id]);
    const r = await t.b.put('/v1/account/password', { password: NEW_PASSWORD, confirmToken: await tokenFor(t.b, t.id), recoveryCode: t.code });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true, recoveryCodeBurned: true });
    expect((await backupLogin(new Browser(app), t.name, t.code)).statusCode).toBe(401);
  });
});
