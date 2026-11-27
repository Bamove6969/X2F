import { randomBytes } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { addAlert } from '../src/alerts.js';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { RECOVERY_WINDOW_MS, startSession } from '../src/auth/sessions.js';
import { isLoginNameClash } from '../src/routes/account.js';
import { currentLoginTag, seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { Browser } from './helpers/totp.js';
import { SIG } from './helpers/signature.js';
import { openTermsSignature } from '../src/termsSignature.js';

const T0 = new Date('2026-10-17T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let step = 0;
let n = 0;

beforeAll(async () => {
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await testApp());
  setNow = (d) => {
    now = d;
    set(d);
  };
  app.post('/t/login', async (req, reply) => {
    const b = req.body as { accountId: string; method?: 'passkey' | 'recovery-code'; deviceLabel?: string };
    const sessionId = await startSession(deps, req, reply, {
      accountId: b.accountId, level: 'full', deviceLabel: b.deviceLabel ?? 'Test browser', method: b.method ?? 'passkey',
      firstSession: false,
    });
    return { sessionId };
  });
});

afterAll(async () => {
  await app.close();
});

beforeEach(() => {
  setNow(new Date(T0.getTime() + ++step * DAY));
});

const errorOf = (res: LightMyRequestResponse) => (res.json() as { error?: string }).error;
const at = (ms: number) => new Date(now.getTime() + ms);

/** A seeded account; `methods: false` for one with no login method yet (a test adds its own). */
async function account(kind: 'trader' | 'staff' = 'trader', methods = true) {
  const username = `acct${String(++n).padStart(4, '0')}x`;
  return { id: await seedAccount(deps, { loginName: username, kind, methods }), username };
}

async function loggedIn(
  accountId: string,
  o: { method?: 'passkey' | 'recovery-code'; deviceLabel?: string } = {},
): Promise<Browser & { sessionId: string }> {
  const b = new Browser(app) as Browser & { sessionId: string };
  const res = await b.post('/t/login', {
    accountId, ...(o.method ? { method: o.method } : {}), ...(o.deviceLabel ? { deviceLabel: o.deviceLabel } : {}),
  });
  expect(res.statusCode).toBe(200);
  b.sessionId = (res.json() as { sessionId: string }).sessionId;
  return b;
}

// Methods inserted directly: Task 11 only reads them.
async function addPgp(accountId: string): Promise<void> {
  await deps.db.query('insert into pgp_keys (account_id, fingerprint, armored_enc, created_at) values ($1, $2, $3, $4)', [
    accountId, randomBytes(20).toString('hex'), randomBytes(64), now,
  ]);
}
async function addCredential(accountId: string, kind: 'passkey' | 'security-key'): Promise<void> {
  await deps.db.query(
    `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, label, created_at)
     values ($1, $2, $3, 0, $4, false, 'singleDevice', 'key', $5)`,
    [accountId, randomBytes(32), randomBytes(77), kind, now],
  );
}
async function addTotp(accountId: string): Promise<void> {
  await deps.db.query('insert into totp (account_id, secret_enc, created_at) values ($1, $2, $3)', [accountId, randomBytes(48), now]);
}
async function addRecoveryCodes(accountId: string, count: number, used = false): Promise<void> {
  for (let i = 0; i < count; i++) {
    await deps.db.query('insert into recovery_codes (account_id, code_hash, used_at) values ($1, $2, $3)', [
      accountId, randomBytes(32), used ? now : null,
    ]);
  }
}

interface Me {
  tradeTag: string;
  needsLoginName: boolean;
  kind: string;
  level: string;
  recoveryUntil: string | null;
  methods: string[];
  hasBackup: boolean;
  suggestions: string[];
  session: { lengthHours: number | null; choices: number[]; expiresAt: string; canExtend: boolean; serverNow: string } | null;
  termsCurrent: boolean;
}

async function me(b: Browser): Promise<Me> {
  const res = await b.get('/v1/account/me');
  expect(res.statusCode).toBe(200);
  return res.json() as Me;
}

describe('GET /v1/account/me', () => {
  it('an account from before login names reads needsLoginName: true until POST /v1/account/login-name sets a distinct one (review I3)', async () => {
    const id = await seedAccount(deps, { loginName: null, tradeTag: 'Old.Timer1' });
    const { id: other, username: otherLogin } = await account();
    const b = await loggedIn(id);
    expect(await me(b)).toMatchObject({ tradeTag: 'Old.Timer1', needsLoginName: true });
    // Re-review 2: a stolen session must not quietly change how the account logs in.
    const bare = await b.post('/v1/account/login-name', { loginName: 'Private.OT1' });
    expect(bare.statusCode).toBe(403);
    expect(errorOf(bare)).toBe('confirm-required');
    const token = () => issueConfirmToken(deps, { sessionId: b.sessionId, accountId: id, action: { kind: 'set-login-name' }, method: 'passkey' });
    const wrong = await issueConfirmToken(deps, { sessionId: b.sessionId, accountId: id, action: { kind: 'key-test' }, method: 'passkey' });
    expect(errorOf(await b.post('/v1/account/login-name', { loginName: 'Private.OT1', confirmToken: wrong }))).toBe('confirm-invalid');
    const set = async (loginName: unknown) => b.post('/v1/account/login-name', { loginName, confirmToken: await token() });
    expect(errorOf(await set('old.TIMER1'))).toBe('names-same');
    expect(errorOf(await set('bad name'))).toBe('login-name-invalid');
    expect(errorOf(await set(42))).toBe('login-name-invalid');
    const { rows: taken } = await deps.db.query<{ trade_tag: string }>('select trade_tag from accounts where id = $1', [other]);
    expect(errorOf(await set(otherLogin.toUpperCase()))).toBe('names-unavailable'); // another account's login name
    expect(errorOf(await set(taken[0]!.trade_tag))).toBe('names-unavailable'); // another account's Trade Tag
    expect(await me(b)).toMatchObject({ needsLoginName: true });
    const ok = await set('Private.OT1');
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });
    expect(await me(b)).toMatchObject({ tradeTag: 'Old.Timer1', needsLoginName: false });
    // FU-D: stored only as its tag under the current key.
    const { rows } = await deps.db.query('select login_name, login_key, login_tag, login_tag_key_id, legacy_login_name from accounts where id = $1', [id]);
    expect(rows).toEqual([{
      login_name: null, login_key: null, login_tag: currentLoginTag(deps, 'private.ot1'), login_tag_key_id: deps.config.loginNameKeys.current,
      legacy_login_name: false,
    }]);
    // One alert, without the name (refusals wrote none).
    const { rows: alerts } = await deps.db.query("select kind, detail from alerts where account_id = $1 and kind = 'login-name-set'", [id]);
    expect(alerts).toEqual([{ kind: 'login-name-set', detail: {} }]);
    // name_keys keeps the public display key only: the login name is in no table in plaintext.
    expect((await deps.db.query('select key, kind from name_keys where account_id = $1 order by key', [id])).rows).toEqual([
      { key: 'old.timer1', kind: 'display' },
    ]);
    // Once set, the route is closed (changing a login name is not this route's job).
    const again = await set('Another.OT1');
    expect(again.statusCode).toBe(409);
    expect(errorOf(again)).toBe('login-name-set');
    // An account that chose its names at sign-up never needs one.
    const ob = await loggedIn(other);
    const otherToken = await issueConfirmToken(deps, { sessionId: ob.sessionId, accountId: other, action: { kind: 'set-login-name' }, method: 'passkey' });
    expect(errorOf(await ob.post('/v1/account/login-name', { loginName: 'Fresh.OT1', confirmToken: otherToken }))).toBe('login-name-set');
  });

  it('two pre-009 accounts swapping Trade Tags as login names at once both get names-unavailable, never a 500 (round-2 Minor 1)', async () => {
    // Not every round deadlocks (the interleaving is up to the scheduler); the mapping itself has a unit test below.
    for (let round = 0; round < 10; round++) {
      const [na, nb] = [`Swap.A${n}r${round}`, `Swap.B${n}r${round}`];
      const a = await seedAccount(deps, { loginName: null, tradeTag: na });
      const b = await seedAccount(deps, { loginName: null, tradeTag: nb });
      const ba = await loggedIn(a);
      const bb = await loggedIn(b);
      const ta = await issueConfirmToken(deps, { sessionId: ba.sessionId, accountId: a, action: { kind: 'set-login-name' }, method: 'passkey' });
      const tb = await issueConfirmToken(deps, { sessionId: bb.sessionId, accountId: b, action: { kind: 'set-login-name' }, method: 'passkey' });
      const [ra, rb] = await Promise.all([
        ba.post('/v1/account/login-name', { loginName: nb, confirmToken: ta }),
        bb.post('/v1/account/login-name', { loginName: na, confirmToken: tb }),
      ]);
      // Each one's login name is the other's public Trade Tag, so neither may win.
      expect([ra.statusCode, rb.statusCode]).toEqual([409, 409]);
      expect([errorOf(ra), errorOf(rb)]).toEqual(['names-unavailable', 'names-unavailable']);
    }
    n++;
  });

  it('maps a deadlock and a taken key to a clash, nothing else (round-2 Minor 1)', () => {
    expect(isLoginNameClash({ code: '40P01' })).toBe(true);
    expect(isLoginNameClash({ code: '23505', constraint: 'name_keys_pkey' })).toBe(true);
    expect(isLoginNameClash({ code: '23505', constraint: 'accounts_login_key_key' })).toBe(true);
    expect(isLoginNameClash({ code: '23505', constraint: 'accounts_login_tag_key' })).toBe(true);
    expect(isLoginNameClash({ code: '23505', constraint: 'accounts_display_key_key' })).toBe(false);
    expect(isLoginNameClash({ code: '23514' })).toBe(false);
    expect(isLoginNameClash(new Error('x'))).toBe(false);
    expect(isLoginNameClash(null)).toBe(false);
  });

  it('the login-name route needs a session', async () => {
    expect((await new Browser(app).post('/v1/account/login-name', { loginName: 'Private.OT2' })).statusCode).toBe(401);
  });

  it('describes the account; an account with one kind of method is setup-only and told to add a backup', async () => {
    const { id, username } = await account('trader', false);
    await addCredential(id, 'passkey');
    const b = await loggedIn(id);
    const res = await b.get('/v1/account/me');
    // The private login name is never sent, not even to its owner.
    expect(res.body).not.toContain(`"${username}"`);
    expect(await me(b)).toEqual({
      tradeTag: `D${username}`, needsLoginName: false, kind: 'trader', level: 'full', recoveryUntil: null, stage: 'starter', completedTrades: 0, methods: ['passkey'], hasBackup: false,
      // Owner 26 Nov 2026: one kind of method, outside the sign-up window: the session is setup-only.
      suggestions: ['add-backup'], termsCurrent: true, setupOnly: true, recoveryCodeToShow: false, member: null,
      session: { lengthHours: null, choices: [2, 4, 8, 12], expiresAt: at(2 * HOUR).toISOString(), canExtend: true, serverNow: now.toISOString() },
      idleReminderMinutes: null,
      accountType: 'trader',
    });
    // Owner 27 Nov 2026: no security rating any more (every trader account holds two kinds, one a key).
    expect(res.json()).not.toHaveProperty('securityRating');
    await addTotp(id);
    const after = await me(b);
    expect(after.suggestions).toEqual([]);
    expect(after.hasBackup).toBe(true);
    expect(after.methods).toEqual(['passkey', 'totp']);
    expect((after as unknown as { setupOnly: boolean }).setupOnly).toBe(false);
  });

  it('lists methods in a fixed order; spent recovery codes are not a method', async () => {
    const { id } = await account('trader', false);
    await addRecoveryCodes(id, 2, true);
    await addTotp(id);
    await addCredential(id, 'security-key');
    await addCredential(id, 'passkey');
    await addPgp(id);
    await addPgp(id);
    const b = await loggedIn(id);
    expect((await me(b)).methods).toEqual(['pgp', 'passkey', 'security-key', 'totp']);
    await addRecoveryCodes(id, 1);
    expect((await me(b)).methods).toEqual(['pgp', 'passkey', 'security-key', 'totp', 'recovery-codes']);
  });

  it('shows no session length for staff (their sessions keep fixed rules; sessionLength.test.ts has the rest)', async () => {
    const staff = await account('staff');
    expect((await me(await loggedIn(staff.id))).session).toBeNull();
  });

  it('a recovery-code login shows when its window to change anything without a confirm ends (owner 26 Nov 2026)', async () => {
    const { id } = await account();
    const b = await loggedIn(id, { method: 'recovery-code' });
    const res = await me(b);
    expect(res.level).toBe('full');
    expect(res.recoveryUntil).toBe(at(RECOVERY_WINDOW_MS).toISOString());
    setNow(at(RECOVERY_WINDOW_MS));
    expect((await me(b)).recoveryUntil).toBeNull();
    expect((await me(await loggedIn(id))).recoveryUntil).toBeNull();
  });

  it('needs a session', async () => {
    const res = await new Browser(app).get('/v1/account/me');
    expect(res.statusCode).toBe(401);
    expect(errorOf(res)).toBe('not-authenticated');
  });

  it('carries no IP address or user agent', async () => {
    const { id } = await account();
    await addPgp(id);
    const b = await loggedIn(id);
    const res = await app.inject({
      method: 'GET', url: '/v1/account/me', cookies: b.cookies,
      headers: { 'user-agent': 'UA-Marker/1.0', 'x-forwarded-for': '203.0.113.9' },
    });
    expect(res.body).not.toContain('UA-Marker');
    expect(res.body).not.toContain('203.0.113.9');
    expect(res.body).not.toContain('127.0.0.1');
  });
});

describe('hasBackup (R11)', () => {
  const cases: Array<[string, (id: string) => Promise<void>, boolean]> = [
    ['one passkey only', async (id) => addCredential(id, 'passkey'), false],
    ['one security key only', async (id) => addCredential(id, 'security-key'), false],
    ['PGP + security key', async (id) => { await addPgp(id); await addCredential(id, 'security-key'); }, true],
    ['two passkeys', async (id) => { await addCredential(id, 'passkey'); await addCredential(id, 'passkey'); }, true],
    ['two PGP keys', async (id) => { await addPgp(id); await addPgp(id); }, true],
    ['PGP + TOTP', async (id) => { await addPgp(id); await addTotp(id); }, true],
    ['PGP + unused recovery codes', async (id) => { await addPgp(id); await addRecoveryCodes(id, 3); }, true],
    ['PGP + spent recovery codes', async (id) => { await addPgp(id); await addRecoveryCodes(id, 3, true); }, false],
  ];
  for (const [label, setup, expected] of cases) {
    it(`${label} → ${expected}`, async () => {
      const { id } = await account('trader', false);
      await setup(id);
      const res = await me(await loggedIn(id));
      expect(res.hasBackup).toBe(expected);
      expect(res.suggestions.includes('add-backup')).toBe(!expected);
    });
  }

  it('no authenticator suggestion (it was a password\'s second factor)', async () => {
    const { id } = await account('trader', false);
    await addPgp(id);
    expect((await me(await loggedIn(id))).suggestions).toEqual(['add-backup']);
  });
});

describe('sessions', () => {
  it('lists open sessions with the current one marked; deleting the other ends it at once', async () => {
    const { id } = await account();
    await addPgp(id);
    const a = await loggedIn(id, { deviceLabel: 'Laptop' });
    setNow(at(MIN));
    const b = await loggedIn(id, { deviceLabel: 'Phone' });
    // A revoked session and an expired one are not listed.
    const gone = await loggedIn(id, { deviceLabel: 'Gone' });
    await deps.db.query('update sessions set revoked_at = $2 where id = $1', [gone.sessionId, now]);
    const old = await loggedIn(id, { deviceLabel: 'Old' });
    await deps.db.query('update sessions set expires_at = $2 where id = $1', [old.sessionId, now]);

    const res = await a.get('/v1/account/sessions');
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<Record<string, unknown>>;
    expect(list).toHaveLength(2);
    expect(list).toContainEqual({
      id: a.sessionId, deviceLabel: 'Laptop', level: 'full', createdAt: at(-MIN).toISOString(),
      lastSeenAt: now.toISOString(), current: true, member: null,
    });
    expect(list).toContainEqual({
      id: b.sessionId, deviceLabel: 'Phone', level: 'full', createdAt: now.toISOString(), lastSeenAt: now.toISOString(),
      current: false, member: null,
    });
    expect(list.filter((s) => s.current)).toHaveLength(1);
    for (const s of list) expect(Object.keys(s).sort()).toEqual(['createdAt', 'current', 'deviceLabel', 'id', 'lastSeenAt', 'level', 'member']);

    const del = await a.delete(`/v1/account/sessions/${b.sessionId}`);
    expect(del.statusCode).toBe(204);
    const next = await b.get('/v1/account/me');
    expect(next.statusCode).toBe(401);
    expect(errorOf(next)).toBe('not-authenticated');
    expect((await a.get('/v1/account/me')).statusCode).toBe(200);
    expect((await a.get('/v1/account/sessions')).json()).toHaveLength(1);
  });

  it("another account's session, an unknown id and a malformed id → 404 not-found", async () => {
    const mine = await account();
    const theirs = await account();
    await addPgp(mine.id);
    await addPgp(theirs.id);
    const a = await loggedIn(mine.id);
    const t = await loggedIn(theirs.id);
    for (const sid of [t.sessionId, '00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      const res = await a.delete(`/v1/account/sessions/${sid}`);
      expect(res.statusCode).toBe(404);
      expect(errorOf(res)).toBe('not-found');
    }
    expect((await t.get('/v1/account/me')).statusCode).toBe(200);
  });

  it('a recovery-code login may list sessions and end one (owner 26 Nov 2026: it may change everything)', async () => {
    const { id } = await account();
    const full = await loggedIn(id);
    const rec = await loggedIn(id, { method: 'recovery-code' });
    const list = await rec.get('/v1/account/sessions');
    expect(list.statusCode).toBe(200);
    expect((list.json() as Array<{ id: string; level: string }>).find((s) => s.id === rec.sessionId)?.level).toBe('full');
    expect((await rec.delete(`/v1/account/sessions/${full.sessionId}`)).statusCode).toBe(204);
    expect((await full.get('/v1/account/me')).statusCode).toBe(401);
  });

  it('needs a session', async () => {
    expect((await new Browser(app).get('/v1/account/sessions')).statusCode).toBe(401);
  });
});

describe('alerts', () => {
  it('newest first, at most 50; seen sets seen_at; only the owner may mark one', async () => {
    const { id } = await account();
    await addPgp(id);
    for (let i = 0; i < 52; i++) await addAlert(deps.db, id, 'new-login', { method: 'pgp', deviceLabel: `D${i}` }, at(i * MIN));
    const b = await loggedIn(id);
    // The session outlives the hours this test moves through (session length, owner 2 Nov 2026).
    expect((await b.put('/v1/account/session/length', { hours: 12 })).statusCode).toBe(200);
    const res = await b.get('/v1/account/alerts');
    expect(res.statusCode).toBe(200);
    const list = res.json() as Array<{ id: string; kind: string; detail: { deviceLabel: string }; createdAt: string; seenAt: string | null }>;
    expect(list).toHaveLength(50);
    expect(list[0]).toMatchObject({ kind: 'new-login', detail: { method: 'pgp', deviceLabel: 'D51' }, createdAt: at(51 * MIN).toISOString(), seenAt: null });
    expect(list[49]!.detail.deviceLabel).toBe('D2');
    for (const a of list) expect(Object.keys(a).sort()).toEqual(['createdAt', 'detail', 'id', 'kind', 'seenAt']);

    const other = await account();
    await addPgp(other.id);
    const o = await loggedIn(other.id);
    const foreign = await o.post(`/v1/account/alerts/${list[0]!.id}/seen`);
    expect(foreign.statusCode).toBe(404);
    expect(errorOf(foreign)).toBe('not-found');
    expect((await o.post('/v1/account/alerts/not-a-uuid/seen')).statusCode).toBe(404);

    setNow(at(HOUR));
    const seen = await b.post(`/v1/account/alerts/${list[0]!.id}/seen`);
    expect(seen.statusCode).toBe(204);
    const { rows } = await deps.db.query<{ seen_at: Date | null }>('select seen_at from alerts where id = $1', [list[0]!.id]);
    expect(rows[0]!.seen_at).toEqual(now);
    // Marking again keeps the first time.
    setNow(at(HOUR));
    expect((await b.post(`/v1/account/alerts/${list[0]!.id}/seen`)).statusCode).toBe(204);
    const again = await deps.db.query<{ seen_at: Date | null }>('select seen_at from alerts where id = $1', [list[0]!.id]);
    expect(again.rows[0]!.seen_at).toEqual(at(-HOUR));
    expect(((await b.get('/v1/account/alerts')).json() as Array<{ seenAt: string | null }>)[0]!.seenAt).toBe(at(-HOUR).toISOString());
  });

  it('a recovery-code login can read its alerts and mark them seen', async () => {
    const { id } = await account();
    const rec = await loggedIn(id, { method: 'recovery-code' });
    const list = (await rec.get('/v1/account/alerts')).json() as Array<{ id: string; kind: string }>;
    const alert = list.find((a) => a.kind === 'recovery-login')!;
    expect((await rec.post(`/v1/account/alerts/${alert.id}/seen`)).statusCode).toBe(204);
  });
});

describe('Terms of Service (R10)', () => {
  it('GET /v1/terms needs no session', async () => {
    const res = await new Browser(app).get('/v1/terms');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ version: deps.config.termsVersion });
  });

  it('a raised version blocks alerts until the new one is accepted; me and sessions still answer', async () => {
    const { id } = await account();
    await addPgp(id);
    const staff = await account('staff');
    await addPgp(staff.id);
    const b = await loggedIn(id);
    const s = await loggedIn(staff.id);
    const oldVersion = deps.config.termsVersion;
    const newVersion = '2026-11-01';
    deps.config.termsVersion = newVersion;
    try {
      const blocked = await b.get('/v1/account/alerts');
      expect(blocked.statusCode).toBe(403);
      expect(blocked.json()).toEqual({ error: 'terms-required', version: newVersion });
      expect((await me(b)).termsCurrent).toBe(false);
      // Review of owner demo note #187: on old Terms `me` still answers, with no member, so the
      // web's /terms page shows a trader no signature pad.
      expect(((await me(b)) as { member?: unknown }).member ?? null).toBeNull();
      expect((await b.get('/v1/account/sessions')).statusCode).toBe(200);

      const wrong = await b.post('/v1/account/terms', { version: oldVersion, signature: SIG });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json()).toEqual({ error: 'terms-not-accepted', version: newVersion });
      for (const bad of [{}, { version: 7 }, { version: null }]) {
        const r = await b.post('/v1/account/terms', { ...bad, signature: SIG });
        expect(r.statusCode).toBe(400);
        expect(errorOf(r)).toBe('terms-not-accepted');
      }
      // Owner demo note #187 (25 Nov 2026): a trader need not sign, but a signature that is sent is
      // checked as strictly as before (owner, 8 Nov 2026).
      const unsigned: [unknown, string][] = [
        [null, 'signature-invalid'],
        [{ kind: 'drawn', width: 320, height: 120, path: 'M0 0L321 1' }, 'signature-invalid'],
        [{ kind: 'typed', name: ' ' }, 'signature-invalid'],
        [{ kind: 'drawn', width: 320, height: 120, path: `M0 0${'L100 100'.repeat(8300)}` }, 'signature-too-large'],
      ];
      for (const [signature, error] of unsigned) {
        const r = await b.post('/v1/account/terms', { version: newVersion, signature });
        expect(r.statusCode, error).toBe(400);
        expect(r.json()).toEqual({ error });
      }
      expect((await me(b)).termsCurrent).toBe(false);

      setNow(at(MIN));
      const typed = { kind: 'typed', name: 'Mira K' };
      const ok = await b.post('/v1/account/terms', { version: newVersion, signature: typed });
      expect(ok.statusCode).toBe(204);
      const { rows } = await deps.db.query<{ terms_version: string; terms_accepted_at: Date; terms_signature: Buffer }>(
        'select terms_version, terms_accepted_at, terms_signature from accounts where id = $1', [id],
      );
      expect(rows[0]!.terms_version).toBe(newVersion);
      expect(rows[0]!.terms_accepted_at).toEqual(now);
      expect(openTermsSignature(deps.config, rows[0]!.terms_signature, id)).toEqual(typed);
      // The signature is never sent back (it is not in me).
      expect(JSON.stringify(await me(b))).not.toContain('Mira K');
      expect((await b.get('/v1/account/alerts')).statusCode).toBe(200);
      expect((await me(b)).termsCurrent).toBe(true);

      // Staff carry no Terms version and are unaffected.
      expect((await s.get('/v1/account/alerts')).statusCode).toBe(200);
      expect((await me(s)).termsCurrent).toBe(true);
    } finally {
      deps.config.termsVersion = oldVersion;
    }
  });

  // Security review 2026-11-08, finding 5.
  it('a session cannot replace the signature at the version already signed', async () => {
    const { id } = await account();
    await addPgp(id);
    const b = await loggedIn(id);
    const row = async () =>
      (await deps.db.query<{ terms_accepted_at: Date; terms_signature: Buffer }>('select terms_accepted_at, terms_signature from accounts where id = $1', [id])).rows[0]!;
    const oldVersion = deps.config.termsVersion;
    const newVersion = '2026-11-02';
    deps.config.termsVersion = newVersion;
    try {
      const first = { kind: 'typed', name: 'First Signer' };
      expect((await b.post('/v1/account/terms', { version: newVersion, signature: first })).statusCode).toBe(204);
      const before = await row();
      setNow(at(MIN));
      // Answers the same as a first signing, and changes nothing.
      expect((await b.post('/v1/account/terms', { version: newVersion, signature: { kind: 'typed', name: 'Someone Else' } })).statusCode).toBe(204);
      const after = await row();
      expect(after.terms_accepted_at).toEqual(before.terms_accepted_at);
      expect(after.terms_signature.equals(before.terms_signature)).toBe(true);
      expect(openTermsSignature(deps.config, after.terms_signature, id)).toEqual(first);

      // A later version is signed afresh.
      const later = '2026-11-03';
      deps.config.termsVersion = later;
      const second = { kind: 'typed', name: 'Second Signer' };
      expect((await b.post('/v1/account/terms', { version: later, signature: second })).statusCode).toBe(204);
      expect(openTermsSignature(deps.config, (await row()).terms_signature, id)).toEqual(second);
    } finally {
      deps.config.termsVersion = oldVersion;
    }
  });

  // Owner demo note #187 (25 Nov 2026): the Terms screen asks for the tick alone.
  it('a trader accepts a new version with no signature; the old version\'s signature does not stay beside it', async () => {
    const { id } = await account();
    await addPgp(id);
    const b = await loggedIn(id);
    const row = async () =>
      (await deps.db.query<{ terms_version: string; terms_accepted_at: Date; terms_signature: Buffer | null }>(
        'select terms_version, terms_accepted_at, terms_signature from accounts where id = $1', [id],
      )).rows[0]!;
    const oldVersion = deps.config.termsVersion;
    try {
      deps.config.termsVersion = '2026-11-04';
      expect((await b.post('/v1/account/terms', { version: '2026-11-04', signature: { kind: 'typed', name: 'Old Signer' } })).statusCode).toBe(204);
      expect((await row()).terms_signature).not.toBeNull();

      deps.config.termsVersion = '2026-11-05';
      // The version binding is as strict without a signature.
      for (const bad of [{}, { version: '2026-11-04' }, { version: null }, { version: 7 }]) {
        const r = await b.post('/v1/account/terms', bad);
        expect(r.statusCode).toBe(400);
        expect(r.json()).toEqual({ error: 'terms-not-accepted', version: '2026-11-05' });
      }
      expect((await row()).terms_version).toBe('2026-11-04');
      setNow(at(2 * MIN));
      const ok = await b.post('/v1/account/terms', { version: '2026-11-05' });
      expect(ok.statusCode).toBe(204);
      const after = await row();
      expect(after.terms_version).toBe('2026-11-05');
      expect(after.terms_accepted_at).toEqual(now);
      expect(after.terms_signature).toBeNull();
      expect((await me(b)).termsCurrent).toBe(true);

      // Review of note #187 (test 8): a trader who does send a valid signature (an older page) still
      // has it stored sealed, bound to their account, never in clear.
      deps.config.termsVersion = '2026-11-06';
      const drawn = { kind: 'drawn', width: 320, height: 120, path: 'M10 10L60 60' };
      expect((await b.post('/v1/account/terms', { version: '2026-11-06', signature: drawn })).statusCode).toBe(204);
      const sealed = (await row()).terms_signature!;
      expect(sealed).not.toBeNull();
      expect(sealed.includes('M10 10L60 60')).toBe(false);
      expect(openTermsSignature(deps.config, sealed, id)).toEqual(drawn);
      expect(() => openTermsSignature(deps.config, sealed, '00000000-0000-4000-8000-00000000000a')).toThrow();
    } finally {
      deps.config.termsVersion = oldVersion;
    }
  });

  it('accepting needs a session', async () => {
    const res = await new Browser(app).post('/v1/account/terms', { version: deps.config.termsVersion, signature: SIG });
    expect(res.statusCode).toBe(401);
  });
});
