import { randomBytes } from 'node:crypto';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { addAlert } from '../src/alerts.js';
import { startSession } from '../src/auth/sessions.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { Browser } from './helpers/totp.js';

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
    const b = req.body as { accountId: string; level?: 'full' | 'recovery'; holdUntil?: string; deviceLabel?: string };
    const sessionId = await startSession(deps, req, reply, {
      accountId: b.accountId, level: b.level ?? 'full', deviceLabel: b.deviceLabel ?? 'Test browser', method: 'passkey',
      firstSession: false, ...(b.holdUntil ? { holdUntil: new Date(b.holdUntil) } : {}),
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

async function account(kind: 'trader' | 'staff' = 'trader') {
  const username = `acct${String(++n).padStart(4, '0')}x`;
  return { id: await seedAccount(deps, { username, kind }), username };
}

async function loggedIn(
  accountId: string,
  o: { level?: 'full' | 'recovery'; holdUntil?: Date; deviceLabel?: string } = {},
): Promise<Browser & { sessionId: string }> {
  const b = new Browser(app) as Browser & { sessionId: string };
  const res = await b.post('/t/login', {
    accountId, ...(o.level ? { level: o.level } : {}), ...(o.holdUntil ? { holdUntil: o.holdUntil.toISOString() } : {}),
    ...(o.deviceLabel ? { deviceLabel: o.deviceLabel } : {}),
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
async function addPassword(accountId: string): Promise<void> {
  await deps.db.query('insert into passwords (account_id, hash, updated_at) values ($1, $2, $3)', [accountId, '$argon2id$stub', now]);
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
  username: string;
  kind: string;
  level: string;
  holdUntil: string | null;
  methods: string[];
  hasBackup: boolean;
  suggestions: string[];
  logoutTimer: { idleHours: number; adjustable: boolean };
  termsCurrent: boolean;
}

async function me(b: Browser): Promise<Me> {
  const res = await b.get('/v1/account/me');
  expect(res.statusCode).toBe(200);
  return res.json() as Me;
}

describe('GET /v1/account/me', () => {
  it('describes the account; a password-only account is told to add an authenticator and a backup', async () => {
    const { id, username } = await account();
    await addPassword(id);
    const b = await loggedIn(id);
    expect(await me(b)).toEqual({
      username, kind: 'trader', level: 'full', holdUntil: null, methods: ['password'], hasBackup: false,
      suggestions: ['add-authenticator', 'add-backup'], logoutTimer: { idleHours: 12, adjustable: true }, termsCurrent: true,
    });
    await addTotp(id);
    const after = await me(b);
    expect(after.suggestions).toEqual([]);
    expect(after.hasBackup).toBe(true);
    expect(after.methods).toEqual(['password', 'totp']);
  });

  it('lists methods in a fixed order; spent recovery codes are not a method', async () => {
    const { id } = await account();
    await addRecoveryCodes(id, 2, true);
    await addTotp(id);
    await addPassword(id);
    await addCredential(id, 'security-key');
    await addCredential(id, 'passkey');
    await addPgp(id);
    await addPgp(id);
    const b = await loggedIn(id);
    expect((await me(b)).methods).toEqual(['pgp', 'passkey', 'security-key', 'password', 'totp']);
    await addRecoveryCodes(id, 1);
    expect((await me(b)).methods).toEqual(['pgp', 'passkey', 'security-key', 'password', 'totp', 'recovery-codes']);
  });

  it('shows the logout timer: the trader’s choice, or a fixed 2 hours for staff', async () => {
    const { id } = await account();
    await addPgp(id);
    await deps.db.query('update accounts set idle_hours = 4 where id = $1', [id]);
    expect((await me(await loggedIn(id))).logoutTimer).toEqual({ idleHours: 4, adjustable: true });
    const staff = await account('staff');
    expect((await me(await loggedIn(staff.id))).logoutTimer).toEqual({ idleHours: 2, adjustable: false });
  });

  it('a held recovery session sees its level and hold; at the hold time it is no longer held', async () => {
    const { id } = await account();
    await addPgp(id);
    await addTotp(id);
    const holdUntil = at(DAY);
    const b = await loggedIn(id, { level: 'recovery', holdUntil });
    const res = await me(b);
    expect(res.level).toBe('recovery');
    expect(res.holdUntil).toBe(holdUntil.toISOString());
    setNow(holdUntil);
    const later = await me(b);
    expect(later.level).toBe('recovery');
    expect(later.holdUntil).toBeNull();
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

describe('hasBackup (R11: a password never counts as the backup)', () => {
  const cases: Array<[string, (id: string) => Promise<void>, boolean]> = [
    ['password only', async (id) => addPassword(id), false],
    ['PGP + password', async (id) => { await addPgp(id); await addPassword(id); }, false],
    ['one passkey only', async (id) => addCredential(id, 'passkey'), false],
    ['one security key only', async (id) => addCredential(id, 'security-key'), false],
    ['password + passkey', async (id) => { await addPassword(id); await addCredential(id, 'passkey'); }, true],
    ['PGP + security key', async (id) => { await addPgp(id); await addCredential(id, 'security-key'); }, true],
    ['two passkeys', async (id) => { await addCredential(id, 'passkey'); await addCredential(id, 'passkey'); }, true],
    ['two PGP keys', async (id) => { await addPgp(id); await addPgp(id); }, true],
    ['PGP + TOTP', async (id) => { await addPgp(id); await addTotp(id); }, true],
    ['PGP + unused recovery codes', async (id) => { await addPgp(id); await addRecoveryCodes(id, 3); }, true],
    ['PGP + spent recovery codes', async (id) => { await addPgp(id); await addRecoveryCodes(id, 3, true); }, false],
  ];
  for (const [label, setup, expected] of cases) {
    it(`${label} → ${expected}`, async () => {
      const { id } = await account();
      await setup(id);
      const res = await me(await loggedIn(id));
      expect(res.hasBackup).toBe(expected);
      expect(res.suggestions.includes('add-backup')).toBe(!expected);
    });
  }

  it('PGP + password suggests a backup and an authenticator', async () => {
    const { id } = await account();
    await addPgp(id);
    await addPassword(id);
    expect((await me(await loggedIn(id))).suggestions).toEqual(['add-authenticator', 'add-backup']);
  });

  it('no password → no authenticator suggestion', async () => {
    const { id } = await account();
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
      lastSeenAt: now.toISOString(), current: true,
    });
    expect(list).toContainEqual({
      id: b.sessionId, deviceLabel: 'Phone', level: 'full', createdAt: now.toISOString(), lastSeenAt: now.toISOString(),
      current: false,
    });
    expect(list.filter((s) => s.current)).toHaveLength(1);
    for (const s of list) expect(Object.keys(s).sort()).toEqual(['createdAt', 'current', 'deviceLabel', 'id', 'lastSeenAt', 'level']);

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

  it('a recovery session may list sessions (even while held) but not end one', async () => {
    const { id } = await account();
    await addPgp(id);
    await addTotp(id);
    const full = await loggedIn(id);
    const held = await loggedIn(id, { level: 'recovery', holdUntil: at(DAY) });
    const list = await held.get('/v1/account/sessions');
    expect(list.statusCode).toBe(200);
    expect((list.json() as Array<{ id: string; level: string }>).find((s) => s.id === held.sessionId)?.level).toBe('recovery');
    const res = await held.delete(`/v1/account/sessions/${full.sessionId}`);
    expect(res.statusCode).toBe(403);
    expect(errorOf(res)).toBe('recovery-session');
    expect((await full.get('/v1/account/me')).statusCode).toBe(200);
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

  it('a held recovery session can read its alerts but cannot mark them seen', async () => {
    const { id } = await account();
    await addPgp(id);
    await addTotp(id);
    const held = await loggedIn(id, { level: 'recovery', holdUntil: at(DAY) });
    const list = (await held.get('/v1/account/alerts')).json() as Array<{ id: string; kind: string }>;
    expect(list.map((a) => a.kind)).toContain('recovery-login');
    const alert = list.find((a) => a.kind === 'recovery-login')!;
    const res = await held.post(`/v1/account/alerts/${alert.id}/seen`);
    expect(res.statusCode).toBe(403);
    expect((res.json() as { error: string }).error).toBe('recovery-session');
    const { rows } = await deps.db.query<{ seen_at: Date | null }>('select seen_at from alerts where id = $1', [alert.id]);
    expect(rows[0]!.seen_at).toBeNull();
  });

  it('a recovery session without a hold cannot mark its alerts seen either', async () => {
    const { id } = await account();
    await addPgp(id);
    await addTotp(id);
    const rec = await loggedIn(id, { level: 'recovery' });
    const list = (await rec.get('/v1/account/alerts')).json() as Array<{ id: string; kind: string }>;
    const alert = list.find((a) => a.kind === 'recovery-login')!;
    expect((await rec.post(`/v1/account/alerts/${alert.id}/seen`)).statusCode).toBe(403);
  });
});

describe('logout timer (owner, 2026-10-23)', () => {
  const URL = '/v1/account/security/logout-timer';
  const setTimer = (b: Browser, idleHours: unknown) => b.put(URL, { idleHours });

  it('reads 12 hours by default and sets each allowed choice', async () => {
    const { id } = await account();
    const b = await loggedIn(id);
    const res = await b.get(URL);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ idleHours: 12, adjustable: true });
    for (const h of [2, 4, 6, 8, 10, 12]) {
      const put = await setTimer(b, h);
      expect(put.statusCode).toBe(200);
      expect(put.json()).toEqual({ idleHours: h, adjustable: true });
      expect((await b.get(URL)).json()).toEqual({ idleHours: h, adjustable: true });
    }
  });

  it('refuses any other value with 400 bad-request and keeps the setting', async () => {
    const { id } = await account();
    const b = await loggedIn(id);
    expect((await setTimer(b, 6)).statusCode).toBe(200);
    for (const v of [0, 1, 3, 5, 7, 11, 13, 14, 24, 2.5, -2, '6', null, true, [6], { h: 6 }]) {
      const res = await setTimer(b, v);
      expect(res.statusCode, JSON.stringify(v)).toBe(400);
      expect(res.json()).toEqual({ error: 'bad-request' });
    }
    expect((await b.put(URL, {})).json()).toEqual({ error: 'bad-request' });
    expect((await b.get(URL)).json()).toEqual({ idleHours: 6, adjustable: true });
  });

  it('applies a shorter timer to the current session at once', async () => {
    const { id } = await account();
    const b = await loggedIn(id);
    expect((await setTimer(b, 2)).statusCode).toBe(200);
    setNow(at(2 * HOUR - MIN));
    expect((await b.get(URL)).statusCode).toBe(200);
    setNow(at(2 * HOUR - MIN));
    expect((await b.get(URL)).statusCode).toBe(200);
    setNow(at(2 * HOUR));
    expect(errorOf(await b.get(URL))).toBe('not-authenticated');
    const { rows } = await deps.db.query<{ expires_at: Date; last_seen_at: Date }>(
      'select expires_at, last_seen_at from sessions where id = $1',
      [b.sessionId],
    );
    expect(rows[0]!.expires_at.getTime()).toBe(rows[0]!.last_seen_at.getTime() + 2 * HOUR);
  });

  it('applies a longer timer to the current session at once, and to the account’s other sessions', async () => {
    const { id } = await account();
    const b = await loggedIn(id);
    const other = await loggedIn(id);
    expect((await setTimer(b, 2)).statusCode).toBe(200);
    setNow(at(HOUR));
    expect((await setTimer(b, 12)).statusCode).toBe(200);
    const { rows } = await deps.db.query<{ id: string; expires_at: Date; last_seen_at: Date }>(
      'select id, expires_at, last_seen_at from sessions where account_id = $1',
      [id],
    );
    for (const r of rows) expect(r.expires_at.getTime(), r.id).toBe(r.last_seen_at.getTime() + 12 * HOUR);
    // The other session was last used an hour ago; it now lasts 12 hours from then.
    setNow(at(11 * HOUR - MIN));
    expect((await other.get(URL)).statusCode).toBe(200);
    expect((await b.get(URL)).statusCode).toBe(200);
    setNow(at(12 * HOUR));
    expect(errorOf(await other.get(URL))).toBe('not-authenticated');
  });

  it('a shorter timer also ends the account’s other sessions that have been idle that long', async () => {
    const { id } = await account();
    const b = await loggedIn(id);
    const other = await loggedIn(id);
    setNow(at(3 * HOUR));
    expect((await setTimer(b, 2)).statusCode).toBe(200);
    expect(errorOf(await other.get(URL))).toBe('not-authenticated');
    expect((await b.get(URL)).statusCode).toBe(200);
  });

  it('keeps the 30-day absolute cap whatever the timer', async () => {
    const { id } = await account();
    const b = await loggedIn(id);
    const start = now;
    for (let h = 10; h < 30 * 24; h += 10) {
      setNow(new Date(start.getTime() + h * HOUR));
      expect((await b.get(URL)).statusCode, `${h} h`).toBe(200);
    }
    setNow(new Date(start.getTime() + 30 * DAY));
    expect(errorOf(await b.get(URL))).toBe('not-authenticated');
  });

  it('staff cannot change theirs (403 wrong-account-kind) and read a fixed 2 hours', async () => {
    const { id } = await account('staff');
    const b = await loggedIn(id);
    expect((await b.get(URL)).json()).toEqual({ idleHours: 2, adjustable: false });
    const res = await setTimer(b, 12);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'wrong-account-kind' });
    const { rows } = await deps.db.query<{ idle_hours: number }>('select idle_hours from accounts where id = $1', [id]);
    expect(rows[0]!.idle_hours).toBe(12);
    setNow(at(2 * HOUR));
    expect(errorOf(await b.get(URL))).toBe('not-authenticated');
  });

  it('a recovery session, held or not, can read the timer but not change it', async () => {
    const { id } = await account();
    await addPgp(id);
    await addTotp(id);
    for (const o of [{ level: 'recovery' as const, holdUntil: at(DAY) }, { level: 'recovery' as const }]) {
      const b = await loggedIn(id, o);
      expect((await b.get(URL)).json()).toEqual({ idleHours: 12, adjustable: true });
      const res = await setTimer(b, 2);
      expect(res.statusCode).toBe(403);
      expect(res.json()).toEqual({ error: 'recovery-session' });
    }
    const { rows } = await deps.db.query<{ idle_hours: number }>('select idle_hours from accounts where id = $1', [id]);
    expect(rows[0]!.idle_hours).toBe(12);
  });

  it('needs a session', async () => {
    const b = new Browser(app);
    expect(errorOf(await b.get(URL))).toBe('not-authenticated');
    expect(errorOf(await setTimer(b, 2))).toBe('not-authenticated');
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
      expect((await b.get('/v1/account/sessions')).statusCode).toBe(200);

      const wrong = await b.post('/v1/account/terms', { version: oldVersion });
      expect(wrong.statusCode).toBe(400);
      expect(wrong.json()).toEqual({ error: 'terms-not-accepted', version: newVersion });
      for (const bad of [{}, { version: 7 }, { version: null }]) {
        const r = await b.post('/v1/account/terms', bad);
        expect(r.statusCode).toBe(400);
        expect(errorOf(r)).toBe('terms-not-accepted');
      }

      setNow(at(MIN));
      const ok = await b.post('/v1/account/terms', { version: newVersion });
      expect(ok.statusCode).toBe(204);
      const { rows } = await deps.db.query<{ terms_version: string; terms_accepted_at: Date }>(
        'select terms_version, terms_accepted_at from accounts where id = $1', [id],
      );
      expect(rows[0]).toEqual({ terms_version: newVersion, terms_accepted_at: now });
      expect((await b.get('/v1/account/alerts')).statusCode).toBe(200);
      expect((await me(b)).termsCurrent).toBe(true);

      // Staff carry no Terms version and are unaffected.
      expect((await s.get('/v1/account/alerts')).statusCode).toBe(200);
      expect((await me(s)).termsCurrent).toBe(true);
    } finally {
      deps.config.termsVersion = oldVersion;
    }
  });

  it('accepting needs a session', async () => {
    const res = await new Browser(app).post('/v1/account/terms', { version: deps.config.termsVersion });
    expect(res.statusCode).toBe(401);
  });
});
