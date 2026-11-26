// Sign-up login rules (owner 1 Nov 2026, register rows S-012, S-013, S-014; lead job J-09):
// - S-012: a username with an authenticator code alone is no account and no login;
// - S-013: a username alone is no account;
// - S-014 (a strong password) is gone with the passwords (owner 26 Nov 2026): there is no password
//   route at all.
// These pin the server's side; the live meter is the web's (apps/web/test/signupRules.test.tsx).
import { randomBytes } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { Secret } from 'otpauth';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import { sealSecret } from '../src/auth/totp.js';
import { checkMemberName } from '../src/team/members.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { SIG } from './helpers/signature.js';
import { signUpWithKey } from './helpers/signup.js';
import { Browser, addTestLogin, codeAt } from './helpers/totp.js';

const T0 = new Date('2026-11-09T06:00:00Z');
const HOUR = 3600_000;
const TERMS = '2026-10-17';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let cleanup: () => Promise<void>;
let now = T0;
let step = 0;
let n = 0;

beforeAll(async () => {
  cleanup = async () => {};
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await testApp({}));
  setNow = (d) => {
    now = d;
    set(d);
  };
  addTestLogin(app, deps);
});

afterAll(async () => {
  await app.close();
  await cleanup();
});

beforeEach(() => {
  // Each test starts an hour later: request budgets refill.
  setNow(new Date(T0.getTime() + ++step * HOUR));
});

const name = (p = 'rule') => `${p}${String(process.pid % 1000).padStart(3, '0')}x${String(++n).padStart(3, '0')}`;
const names = () => {
  const loginName = name('priv');
  return { loginName, displayName: name('Shown') };
};

async function accountCount(): Promise<number> {
  const { rows } = await deps.db.query<{ n: number }>('select count(*)::int as n from accounts');
  return rows[0]!.n;
}

/** Enrols TOTP directly with a known secret; returns it as base32. */
async function withTotp(accountId: string): Promise<string> {
  const raw = randomBytes(20);
  await deps.db.query('insert into totp (account_id, secret_enc, created_at) values ($1, $2, $3)', [
    accountId, sealSecret(deps, accountId, new Uint8Array(raw)), now,
  ]);
  return new Secret({ buffer: new Uint8Array(raw).buffer }).base32;
}

describe('S-013: a username alone is no account', () => {
  it('every sign-up route refuses the names without a login method, and no account is made', async () => {
    const before = await accountCount();
    const b = new Browser(app);
    const base = { ...names(), deviceLabel: 'Test browser', acceptedTerms: TERMS, termsSignature: SIG };
    // PGP sign-up without a key, or with an empty one.
    expect((await b.post('/v1/register/pgp/start', base)).statusCode).toBe(400);
    expect((await b.post('/v1/register/pgp/start', { ...base, publicKey: '' })).statusCode).toBe(400);
    // Passkey / security key: a finish with no proven credential makes nothing.
    const finish = await b.post('/v1/register/webauthn/finish', { ...base, challengeId: '00000000-0000-0000-0000-000000000000' });
    expect(finish.statusCode).toBeGreaterThanOrEqual(400);
    expect(finish.statusCode).toBeLessThan(500);
    // There is no names-only sign-up route.
    for (const url of ['/v1/register', '/v1/register/name', '/v1/register/username', '/v1/register/password']) {
      expect((await b.post(url, base)).statusCode, url).toBe(404);
    }
    expect(await accountCount()).toBe(before);
  });
});

describe('S-012: a username with an authenticator code alone is no account and no login', () => {
  it('there is no sign-up with an authenticator code', async () => {
    const before = await accountCount();
    const b = new Browser(app);
    const base = { ...names(), deviceLabel: 'Test browser', acceptedTerms: TERMS, termsSignature: SIG };
    for (const url of ['/v1/register/totp', '/v1/register/totp/start', '/v1/register/totp/finish', '/v1/register/authenticator']) {
      expect((await b.post(url, { ...base, code: '123456' })).statusCode, url).toBe(404);
    }
    expect(await accountCount()).toBe(before);
  });

  it('an authenticator app is added only from a signed-in session (never as the first login method)', async () => {
    const b = new Browser(app);
    expect((await b.post('/v1/account/totp/start', {})).statusCode).toBe(401);
    expect((await b.post('/v1/account/totp/finish', { code: '123456' })).statusCode).toBe(401);
  });

  it('a username with a correct authenticator code logs in nowhere: no backup login, no second factor', async () => {
    const loginName = name('totp');
    const id = await seedAccount(deps, { loginName });
    const secret = await withTotp(id);
    const code = codeAt(secret, now);
    const b = new Browser(app);
    const backup = await b.post('/v1/login/backup', { loginName, kind: 'totp', code, deviceLabel: 'Test browser' });
    // Hold model v3 (owner Q81, 2 Nov): an authenticator code is no backup login at all: 403 method-not-allowed (was a 400 input refusal).
    expect(backup.statusCode).toBe(403);
    expect(backup.json()).toMatchObject({ error: 'method-not-allowed' });
    // There is no second-factor step (it finished a password login).
    expect((await b.post('/v1/login/second-factor', { pendingId: '00000000-0000-0000-0000-000000000000', code })).statusCode).toBe(404);
    expect(Object.keys(b.cookies)).not.toContain(SESSION_COOKIE);
    const { rows } = await deps.db.query('select 1 from sessions where account_id = $1', [id]);
    expect(rows).toEqual([]);
  });
});

describe('no passwords (owner 26 Nov 2026)', () => {
  it('there is no password sign-up, login, change or confirm', async () => {
    const b = new Browser(app);
    for (const [method, url] of [['POST', '/v1/register/password'], ['POST', '/v1/login/password'], ['PUT', '/v1/account/password'], ['POST', '/v1/confirm/password']] as const) {
      const res = method === 'PUT' ? await b.put(url, { password: 'Correct-Horse-9' }) : await b.post(url, { password: 'Correct-Horse-9' });
      expect(res.statusCode, url).toBe(404);
    }
  });
});

// Signup round 3, lead call (13 Nov 2026): a display name may hold most printable characters.
// Owner demo note #108 (17 Nov 2026): but no spaces inside it (the ends are still trimmed).
/** A passkey sign-up with these names: the refusal of its start, else its finish. */
const register = async (body: { displayName: string; loginName: string }) =>
  (await signUpWithKey(new Browser(app), { ...body, deviceLabel: 'Test browser', acceptedTerms: TERMS })).res;

describe('signup round 3: display names with Unicode letters and common symbols', () => {
  it('signs up as "  Cash$Ölaf " (stored as normalised), and the name is found again by any case', async () => {
    const b = new Browser(app);
    const shown = `Cash$Ölaf${n++}`;
    const res = await register({ displayName: `  ${shown} `, loginName: name('priv') });
    expect(res.statusCode).toBe(201);
    const { rows } = await deps.db.query<{ display_name: string; display_key: string }>('select display_name, display_key from accounts where display_name = $1', [shown]);
    expect(rows).toEqual([{ display_name: shown, display_key: shown.toLowerCase() }]);
    // Someone else with the same name in another case is refused as taken.
    const twin = await register({ displayName: shown.toUpperCase(), loginName: name('priv') });
    expect(twin.statusCode).toBe(409);
  });

  it.each(['bob‮smith', 'שלום עולם', 'аlice.k', 'X2F Support'])('refuses %j at sign-up', async (displayName) => {
    const res = await register({ displayName, loginName: name('priv') });
    expect(res.statusCode).toBe(400);
  });

  it('a look-alike of a staff name with an accent or a Cyrillic letter is reserved', async () => {
    const staff = await seedAccount(deps, { kind: 'staff', loginName: null, displayName: `Miranda${n++}` });
    const { rows } = await deps.db.query<{ display_name: string }>('select display_name from accounts where id = $1', [staff]);
    const res = await register({ displayName: rows[0]!.display_name.replace('i', 'í'), loginName: name('priv') });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'display-name-reserved' });
  });
});

// Review of third-signup-r3 (16 Nov 2026): the review's attack names, at the API.
describe('signup round 3 review: invisible characters and staff look-alikes', () => {
  const reg = (displayName: string) => register({ displayName, loginName: name('priv') });

  it('B1: a pixel-identical copy of a trader name with a variation selector, and a blank name, are refused', async () => {
    const base = `Alice${n++}x`;
    expect((await reg(base)).statusCode).toBe(201);
    for (const attack of [`${base}\ufe0f`, `${base}\u{e0100}`, `${base.slice(0, 3)}\u034f${base.slice(3)}`, `${base}\u180b`]) {
      const copy = await reg(attack);
      expect(copy.statusCode, JSON.stringify(attack)).toBe(400);
      expect(copy.json()).toEqual({ error: 'display-name-invalid' });
    }
    for (const blank of ['\u3164\u3164\u3164\u3164\u3164', 'Bob\u3164Smith', 'Bob\uffa0Smith', 'Bob\u115fSmith', 'Bob\u1160Smith', '\u115f\u1160\u115f\u1160\u115f']) {
      const res = await reg(blank);
      expect(res.statusCode, JSON.stringify(blank)).toBe(400);
      expect(res.json()).toEqual({ error: 'display-name-invalid' });
    }
  });

  it('M1/M2: a staff name with a dotless i, a comma or a space for its dot, and "Admın Desk", are reserved', async () => {
    const staff = await seedAccount(deps, { kind: 'staff', loginName: null, displayName: `Mira.K${n++}` });
    const s = (await deps.db.query<{ display_name: string }>('select display_name from accounts where id = $1', [staff])).rows[0]!.display_name;
    for (const attack of [s.replace('i', 'ı'), s.replace('.', ','), s.replace('.', '_'), s.replace('.', '-'), s.replace('M', 'ᴍ')]) {
      const res = await reg(attack);
      expect(res.statusCode, attack).toBe(400);
      expect(res.json()).toEqual({ error: 'display-name-reserved' });
    }
    // Owner demo note #108: a space for its dot is now refused for the space itself.
    const spaced = await reg(s.replace('.', ' '));
    expect(spaced.statusCode).toBe(400);
    expect(spaced.json()).toEqual({ error: 'display-name-invalid' });
    const adm = await reg('Admın Desk');
    expect(adm.statusCode, adm.body).toBe(400);
    expect(adm.json()).toEqual({ error: 'display-name-reserved' });
  });

  it('M2: a team member name is held to the same staff comparison', async () => {
    const staff = await seedAccount(deps, { kind: 'staff', loginName: null, displayName: `Kim.Lor${n++}` });
    const s = (await deps.db.query<{ display_name: string }>('select display_name from accounts where id = $1', [staff])).rows[0]!.display_name;
    for (const attack of [s.replace('.', ','), s.replace('i', 'ı')]) {
      await expect(checkMemberName(deps.db, attack), attack).rejects.toMatchObject({ status: 400, code: 'display-name-reserved' });
    }
    // Owner demo note #108: a member name with a space is refused for the space.
    await expect(checkMemberName(deps.db, s.replace('.', ' '))).rejects.toMatchObject({ status: 400, code: 'display-name-invalid' });
    await expect(checkMemberName(deps.db, `${s}\ufe0f`)).rejects.toMatchObject({ status: 400, code: 'display-name-invalid' });
  });
});

// Owner demo note #108 (17 Nov 2026): "Do not allow spaces in username or passwords or display
// names". New and changed values only: an account made before the rule keeps logging in.
describe('note #108: no spaces in new usernames or display names', () => {
  const reg = (body: { displayName?: string; loginName?: string }) => register({ displayName: `Plain${n++}x`, loginName: name('priv'), ...body });

  it('sign-up refuses a display name with a space inside, and makes no account', async () => {
    const before = await accountCount();
    for (const displayName of [`Bob Smith${n++}`, `Bob   Smith${n++}`, `R&B Trader${n++}`]) {
      const res = await reg({ displayName });
      expect(res.statusCode, displayName).toBe(400);
      expect(res.json()).toEqual({ error: 'display-name-invalid' });
    }
    expect(await accountCount()).toBe(before);
    expect((await reg({ displayName: `  BobSmith${n++}  ` })).statusCode).toBe(201);
  });

  it('sign-up refuses a username with a space (as it always did)', async () => {
    const res = await reg({ loginName: `bob smith${n++}` });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'login-name-invalid' });
  });

});

it('migration 800 (610 on wip/third-demo-r3): no database check compares display_key with lower(display_name) any more', async () => {
  const { rows } = await deps.db.query(
    `select conname from pg_constraint where conrelid in ('accounts'::regclass, 'team_members'::regclass) and pg_get_constraintdef(oid) like '%lower(display_name)%'`,
  );
  expect(rows).toEqual([]);
});

// Security review of wip/lead-notes-all, L3: the display key became a full case fold
// (@x2f/accounts displayKeyOf). Migration 810 recomputes every stored key with the same fold in SQL
// (display_key_fold, ICU case mapping), and refuses loudly (rekey_display_names raises) when two
// names would then share a key.
describe('review L3: migration 810 refolds stored display keys', () => {
  const CORPUS = ['ΑΒΓΔΣ', 'αβγδς', 'Straße', 'STRASSE', 'ﬀabcd', 'Ǆabcd', 'ǅabcd', 'İstanbul', 'Ꮇira.Ꮶ', 'Ｆｕｌｌname', 'Ἀθηνᾶ', '東京の取引者', 'Zoë-Ann', 'Ölaf_Ünal', 'Привет мир', '  Bob   Smith ', 'Satoshi.N'];

  it('the SQL fold equals the app fold on every name', async () => {
    const { displayKeyOf } = await import('@x2f/accounts');
    for (const name of CORPUS) {
      const { rows } = await deps.db.query<{ k: string }>('select display_key_fold($1) as k', [name]);
      expect(rows[0]!.k, name).toBe(displayKeyOf(name));
    }
  });

  it('rekey_display_names recomputes a stale key, and fails on a collision, changing nothing', async () => {
    const a = await seedAccount(deps, { loginName: `rk${++n}aa`, displayName: `ΑΒΓΔΣ${n}` });
    await deps.db.query("update accounts set display_key = lower(display_name) where id = $1", [a]);
    await deps.db.query('select rekey_display_names()');
    const { rows } = await deps.db.query<{ display_key: string }>('select display_key from accounts where id = $1', [a]);
    expect(rows[0]!.display_key).toBe(`αβγδσ${n}`);

    const s1 = await seedAccount(deps, { loginName: `rk${++n}bb`, displayName: `Straße${n}` });
    // Stored before the fold: two keys that differ (seeded apart, as the old key made them).
    const s2 = await seedAccount(deps, { loginName: `rk${n}cc`, displayName: `Stras${n}` });
    await deps.db.query('update accounts set display_name = $2 where id = $1', [s2, `STRASSE${n}`]);
    await deps.db.query("update accounts set display_key = lower(display_name) where id = any($1)", [[s1, s2]]);
    await expect(deps.db.query('select rekey_display_names()')).rejects.toThrow(/display key collision/);
    const after = await deps.db.query<{ display_key: string }>('select display_key from accounts where id = any($1)', [[s1, s2]]);
    expect(after.rows.map((r) => r.display_key).sort()).toEqual([`strasse${n}`, `straße${n}`].sort());
    await deps.db.query('delete from accounts where id = any($1)', [[s1, s2]]);
  });
});
