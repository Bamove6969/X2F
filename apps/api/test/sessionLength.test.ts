// Session length chosen at every login, and "Stay logged in?" (owner, 2 Nov 2026; boards
// SessionLength, SessionExtend, Devices). The chosen time is the session length: using the session
// never moves its end, and there is no fixed maximum. Extending re-proves a login method on the
// server (a confirm token for `extend-session`), never a client flag.
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Deps } from '../src/app.js';
import { SESSION_CHOICE_WINDOW_MS } from '@x2f/accounts';
import { issueConfirmToken } from '../src/auth/confirm.js';
import { insertPgpKey } from '../src/auth/pgp.js';
import { SESSION_COOKIE } from '../src/auth/sessions.js';
import { sessionAccountType } from '../src/routes/account.js';
import { accountIdByLoginName, addUnusedKeys, confirmTokenMethod, seedAccount } from './helpers/accounts.js';
import { signUpWithKey } from './helpers/signup.js';
import { codeOf, decrypt, genKey } from './helpers/pgpKeys.js';
import { createSoftAuthenticator, type SoftAuthenticator } from './helpers/softAuthenticator.js';
import { testApp } from './helpers/app.js';
import { SIG } from './helpers/signature.js';
import { Browser, ORIGIN, addTestLogin } from './helpers/totp.js';

const T0 = new Date('2026-11-02T12:00:00Z');
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TERMS = '2026-10-17';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let n = 0;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  cleanup = async () => {};
  ({ app, deps, setNow } = await testApp({}));
  addTestLogin(app, deps);
});

afterAll(async () => {
  await app.close();
  await cleanup();
});

beforeEach(() => {
  setNow(T0);
});

const at = (ms: number) => setNow(new Date(T0.getTime() + ms));
const iso = (ms: number) => new Date(T0.getTime() + ms).toISOString();
const errorOf = (res: LightMyRequestResponse) => (res.json() as { error?: string }).error;

interface SessionInfo {
  lengthHours: number | null;
  choices: number[];
  expiresAt: string;
  canExtend: boolean;
  serverNow: string;
}

async function sessionOf(b: Browser): Promise<SessionInfo | null> {
  const res = await b.get('/v1/account/me');
  expect(res.statusCode, res.body).toBe(200);
  return (res.json() as { session: SessionInfo | null }).session;
}

async function loggedIn(accountId: string, o: { method?: 'passkey' | 'recovery-code' } = {}): Promise<Browser & { sessionId: string }> {
  const b = new Browser(app) as Browser & { sessionId: string };
  const res = await b.post('/t/login', { accountId, ...o });
  expect(res.statusCode, res.body).toBe(200);
  b.sessionId = (res.json() as { sessionId: string }).sessionId;
  return b;
}

async function trader(kind: 'trader' | 'staff' | 'owner' = 'trader') {
  const id = await seedAccount(deps, { loginName: `len${String(++n).padStart(4, '0')}x`, kind });
  return { id, b: await loggedIn(id) };
}

/** A passkey sign-up through the real routes (with an unused second kind of method). */
async function keyTrader(prefix: string) {
  const b = new Browser(app);
  const name = `${prefix}${String(++n).padStart(5, '0')}x`;
  const { res, auth } = await signUpWithKey(b, { displayName: `P${name}`, loginName: name, acceptedTerms: TERMS });
  expect(res.statusCode, res.body).toBe(201);
  const accountId = (await accountIdByLoginName(deps, name))!;
  await addUnusedKeys(deps, accountId);
  return { b, auth, accountId };
}

/** The confirm route with `auth`'s key for `action`: the finish's response. */
async function keyConfirm(b: Browser, auth: SoftAuthenticator, action: object): Promise<LightMyRequestResponse> {
  const st = await b.post('/v1/confirm/webauthn/start', { action });
  const { challengeId, options } = st.json() as { challengeId: string; options: Parameters<SoftAuthenticator['authenticate']>[0] };
  return b.post('/v1/confirm/webauthn/finish', { challengeId, response: auth.authenticate(options, ORIGIN) });
}

const setLength = (b: Browser, hours: unknown) => b.put('/v1/account/session/length', { hours });
const extendToken = (b: Browser & { sessionId: string }, accountId: string) =>
  issueConfirmToken(deps, { sessionId: b.sessionId, accountId, action: { kind: 'extend-session' }, method: 'passkey' });

describe('choosing the session length', () => {
  it('a new trader session lasts 2 hours until a length is chosen, and me offers the choices with none chosen', async () => {
    const { b } = await trader();
    expect(await sessionOf(b)).toEqual({ lengthHours: null, choices: [2, 4, 8, 12], expiresAt: iso(2 * HOUR), canExtend: true, serverNow: iso(0) });
    // Using the session never moves its end.
    at(2 * HOUR - MIN);
    expect((await sessionOf(b))!.expiresAt).toBe(iso(2 * HOUR));
    at(2 * HOUR);
    expect((await b.get('/v1/account/me')).statusCode).toBe(401);
  });

  it('the chosen length starts when it is chosen (owner G24), and using the session never moves the end', async () => {
    const { b } = await trader();
    at(5 * MIN);
    const res = await setLength(b, 8);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ lengthHours: 8, expiresAt: iso(8 * HOUR + 5 * MIN) });
    for (let m = 60; m < 8 * 60; m += 60) {
      at(m * MIN);
      expect((await b.get('/v1/account/me')).statusCode).toBe(200);
    }
    at(8 * HOUR + 4 * MIN);
    expect((await sessionOf(b))!.expiresAt).toBe(iso(8 * HOUR + 5 * MIN));
    at(8 * HOUR + 5 * MIN);
    expect((await b.get('/v1/account/me')).statusCode).toBe(401);
  });

  it('refuses a length that is not one of the account type’s choices', async () => {
    const { b } = await trader();
    for (const bad of [0, 1, 3, 6, 10, 24, 2.5, '8', null, true, [8]]) {
      const res = await setLength(b, bad);
      expect(res.statusCode, String(bad)).toBe(400);
      expect(errorOf(res)).toBe('bad-request');
    }
    expect((await b.put('/v1/account/session/length', {})).statusCode).toBe(400);
    expect((await sessionOf(b))!.lengthHours).toBeNull();
  });

  it('partway through, a new length starts now (owner G24): a shorter one at once, never in the past (review M3)', async () => {
    const { b } = await trader();
    expect((await setLength(b, 8)).statusCode).toBe(200);
    at(3 * HOUR);
    expect((await setLength(b, 4)).json()).toMatchObject({ lengthHours: 4, expiresAt: iso(7 * HOUR) });
    at(5 * HOUR);
    expect((await setLength(b, 2)).json()).toMatchObject({ lengthHours: 2, expiresAt: iso(7 * HOUR) });
    at(7 * HOUR - MIN);
    expect((await b.get('/v1/account/me')).statusCode).toBe(200);
    at(7 * HOUR);
    expect((await b.get('/v1/account/me')).statusCode).toBe(401);
  });

  it('partway through, a length that would end later needs a login method: then it starts now (G24, G10)', async () => {
    // A stolen cookie must not stretch a session with no proof (lead decision 6 Nov 2026, kept):
    // the person confirms it's them, and the extend makes the new length start now.
    const { id, b } = await trader();
    expect((await setLength(b, 4)).statusCode).toBe(200);
    at(3 * HOUR);
    const longer = await setLength(b, 4);
    expect(longer.statusCode).toBe(403);
    expect(longer.json()).toEqual({ error: 'confirm-required', action: 'extend-session' });
    expect(await sessionOf(b)).toMatchObject({ lengthHours: 4, expiresAt: iso(4 * HOUR) });
    const res = await b.post('/v1/account/session/extend', { confirmToken: await extendToken(b, id), hours: 4 });
    expect(res.json()).toMatchObject({ lengthHours: 4, expiresAt: iso(7 * HOUR) });
  });

  it('the free first choice is open only right after the login: later, a longer length needs a proof', async () => {
    // Lead decision 6 Nov 2026 (risk 1 of the sessions review): a stolen cookie must not stretch an
    // unchosen 2-hour session to 12 hours. Inside SESSION_CHOICE_WINDOW_MS the question after the
    // login sets the end from now; after it a later end needs "Stay logged in" with a login method.
    const early = await trader();
    at(SESSION_CHOICE_WINDOW_MS - 1);
    expect((await setLength(early.b, 12)).json()).toMatchObject({ lengthHours: 12, expiresAt: iso(12 * HOUR + SESSION_CHOICE_WINDOW_MS - 1) });

    setNow(T0);
    const late = await trader();
    at(SESSION_CHOICE_WINDOW_MS);
    const res = await setLength(late.b, 12);
    expect(res.statusCode, res.body).toBe(403);
    expect(errorOf(res)).toBe('confirm-required');
    expect(await sessionOf(late.b)).toMatchObject({ lengthHours: null, expiresAt: iso(2 * HOUR) });
    at(2 * HOUR);
    expect((await late.b.get('/v1/account/me')).statusCode).toBe(401);
  });

  it("a shorter length ends the session's live streams, so none outlives the new end (review M1)", async () => {
    const { b } = await trader();
    expect((await setLength(b, 12)).statusCode).toBe(200);
    const spy = vi.spyOn(app.events, 'closeSession');
    try {
      at(HOUR);
      expect((await setLength(b, 2)).statusCode).toBe(200);
      expect(spy).toHaveBeenCalledWith(expect.any(String), b.sessionId);
    } finally {
      spy.mockRestore();
    }
  });

  it('changes only the calling session', async () => {
    const { id, b } = await trader();
    const other = await loggedIn(id);
    expect((await setLength(b, 12)).statusCode).toBe(200);
    expect(await sessionOf(other)).toMatchObject({ lengthHours: null, expiresAt: iso(2 * HOUR) });
  });
});

describe('"Stay logged in?": extending the session', () => {
  it('needs a confirm token for exactly extend-session, then adds the length from now', async () => {
    const { id, b } = await trader();
    expect((await setLength(b, 4)).statusCode).toBe(200);
    at(4 * HOUR - 2 * MIN);
    const bare = await b.post('/v1/account/session/extend', {});
    expect(bare.statusCode).toBe(403);
    expect(bare.json()).toEqual({ error: 'confirm-required', action: 'extend-session' });
    const wrong = await issueConfirmToken(deps, { sessionId: b.sessionId, accountId: id, action: { kind: 'key-test' }, method: 'passkey' });
    expect(errorOf(await b.post('/v1/account/session/extend', { confirmToken: wrong }))).toBe('confirm-invalid');
    const token = b.cookies[SESSION_COOKIE];
    const res = await b.post('/v1/account/session/extend', { confirmToken: await extendToken(b, id) });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ lengthHours: 4, expiresAt: iso(8 * HOUR - 2 * MIN) });
    // The same session goes on under a new token (review S-m1), with a fresh cookie lifetime.
    const fresh = res.cookies.find((c) => c.name === SESSION_COOKIE);
    expect(fresh?.value).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(fresh?.value).not.toBe(token);
    expect(fresh?.maxAge).toBe(30 * 24 * 3600);
    at(8 * HOUR - 3 * MIN);
    expect((await b.get('/v1/account/me')).statusCode).toBe(200);
    at(8 * HOUR - 2 * MIN);
    expect((await b.get('/v1/account/me')).statusCode).toBe(401);
  });

  it('issues a new token on every extend: a copied cookie dies at the old end, the browser goes on (review S-m1)', async () => {
    const { id, b } = await trader();
    expect((await setLength(b, 4)).statusCode).toBe(200);
    at(4 * HOUR - 5 * MIN);
    // Someone copied the cookie (a shared machine, a stolen profile) before the person extended.
    const copied = new Browser(app);
    copied.cookies = { ...b.cookies };
    const res = await b.post('/v1/account/session/extend', { confirmToken: await extendToken(b, id) });
    expect(res.statusCode, res.body).toBe(200);
    expect(b.cookies[SESSION_COOKIE]).not.toBe(copied.cookies[SESSION_COOKIE]);
    // A tab whose request still carries the old cookie is not logged out by the swap: the old token
    // keeps the old end, so nobody sees a logout.
    const meOld = await copied.get('/v1/account/me');
    expect(meOld.statusCode).toBe(200);
    expect((meOld.json() as { session: SessionInfo }).session.expiresAt).toBe(iso(4 * HOUR));
    // A copied cookie never gets the new end, and cannot stretch itself without a proof.
    expect(errorOf(await copied.put('/v1/account/session/length', { hours: 12 }))).toBe('confirm-required');
    at(4 * HOUR);
    expect((await copied.get('/v1/account/me')).statusCode).toBe(401);
    expect((await b.get('/v1/account/me')).statusCode).toBe(200);
    // The next extend swaps again; the token before that one is no longer kept at all.
    const first = copied.cookies[SESSION_COOKIE]!;
    const before = b.cookies[SESSION_COOKIE]!;
    at(8 * HOUR - 10 * MIN);
    expect((await b.post('/v1/account/session/extend', { confirmToken: await extendToken(b, id) })).statusCode).toBe(200);
    copied.cookies = { [SESSION_COOKIE]: before };
    expect((await copied.get('/v1/account/me')).statusCode).toBe(200);
    copied.cookies = { [SESSION_COOKIE]: first };
    expect((await copied.get('/v1/account/me')).statusCode).toBe(401);
    copied.cookies = { [SESSION_COOKIE]: before };
    at(8 * HOUR - 5 * MIN);
    expect((await copied.get('/v1/account/me')).statusCode).toBe(401);
    expect((await b.get('/v1/account/me')).statusCode).toBe(200);
  });

  it('the old token never outlives the session, and a logout with it ends the session (review S-m1)', async () => {
    const { id, b } = await trader();
    expect((await setLength(b, 4)).statusCode).toBe(200);
    at(4 * HOUR - 5 * MIN);
    const copied = new Browser(app);
    copied.cookies = { ...b.cookies };
    expect((await b.post('/v1/account/session/extend', { confirmToken: await extendToken(b, id), hours: 4 })).statusCode).toBe(200);
    // The session's own end comes first when it is earlier than the old token's end.
    await deps.db.query('update sessions set expires_at = $2 where id = $1', [b.sessionId, new Date(T0.getTime() + 4 * HOUR - 3 * MIN)]);
    at(4 * HOUR - 4 * MIN);
    expect((await copied.get('/v1/account/me')).statusCode).toBe(200);
    at(4 * HOUR - 3 * MIN);
    expect((await copied.get('/v1/account/me')).statusCode).toBe(401);

    // A logout sent with the old cookie (a tab that had not seen the swap) still logs the session out.
    const c = await trader();
    at(4 * HOUR + 2 * MIN);
    const old = new Browser(app);
    old.cookies = { ...c.b.cookies };
    expect((await c.b.post('/v1/account/session/extend', { confirmToken: await extendToken(c.b, c.id) })).statusCode).toBe(200);
    expect((await old.post('/v1/logout')).statusCode).toBe(200);
    expect((await c.b.get('/v1/account/me')).statusCode).toBe(401);
  });

  it('a token is single use and bound to the session it was earned on', async () => {
    const { id, b } = await trader();
    const other = await loggedIn(id);
    const token = await extendToken(b, id);
    expect(errorOf(await other.post('/v1/account/session/extend', { confirmToken: token }))).toBe('confirm-invalid');
    expect((await b.post('/v1/account/session/extend', { confirmToken: token })).statusCode).toBe(200);
    expect(errorOf(await b.post('/v1/account/session/extend', { confirmToken: token }))).toBe('confirm-invalid');
  });

  it('works through the real confirm route with the passkey (owner: any login method)', async () => {
    const { b, auth } = await keyTrader('pw');
    expect((await setLength(b, 2)).statusCode).toBe(200);
    at(2 * HOUR - MIN);
    const other = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const miss = await keyConfirm(b, other, { kind: 'extend-session' });
    expect(miss.statusCode).toBe(401);
    const ok = await keyConfirm(b, auth, { kind: 'extend-session' });
    expect(ok.statusCode, ok.body).toBe(200);
    const { confirmToken } = ok.json() as { confirmToken: string };
    const res = await b.post('/v1/account/session/extend', { confirmToken });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ lengthHours: 2, expiresAt: iso(4 * HOUR - MIN) });
  });

  it('has no fixed maximum: extended every time, a session outlives 30 days', async () => {
    const { id, b } = await trader();
    expect((await setLength(b, 12)).statusCode).toBe(200);
    for (let h = 11; h < 35 * 24; h += 11) {
      at(h * HOUR);
      const res = await b.post('/v1/account/session/extend', { confirmToken: await extendToken(b, id) });
      expect(res.statusCode, `${h} h`).toBe(200);
    }
    at(35 * DAY);
    expect((await b.get('/v1/account/me')).statusCode).toBe(200);
  });

  it('once the time is up the session is over: extending is refused', async () => {
    const { id, b } = await trader();
    const token = await extendToken(b, id);
    at(2 * HOUR);
    expect((await b.post('/v1/account/session/extend', { confirmToken: token })).statusCode).toBe(401);
  });

  it('extends for any of the choices offered at login (owner, Q73): the chosen one becomes the length', async () => {
    const { id, b } = await trader();
    expect((await setLength(b, 2)).statusCode).toBe(200);
    at(2 * HOUR - 4 * MIN);
    const res = await b.post('/v1/account/session/extend', { confirmToken: await extendToken(b, id), hours: 8 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ lengthHours: 8, expiresAt: iso(10 * HOUR - 4 * MIN) });
    expect(await sessionOf(b)).toMatchObject({ lengthHours: 8, expiresAt: iso(10 * HOUR - 4 * MIN) });
  });

  it('refuses hours that are not a choice, before the token is spent', async () => {
    const { id, b } = await trader();
    const token = await extendToken(b, id);
    for (const bad of [0, 3, 6, 24, '8', null, true, [8]]) {
      const res = await b.post('/v1/account/session/extend', { confirmToken: token, hours: bad });
      expect(res.statusCode, String(bad)).toBe(400);
      expect(errorOf(res)).toBe('bad-request');
    }
    expect((await b.post('/v1/account/session/extend', { confirmToken: token, hours: 4 })).json()).toMatchObject({ lengthHours: 4, expiresAt: iso(4 * HOUR) });
  });

  it('a session whose length was never chosen extends by the shortest choice, which becomes its length (review M4)', async () => {
    const { id, b } = await trader();
    at(HOUR);
    const res = await b.post('/v1/account/session/extend', { confirmToken: await extendToken(b, id) });
    expect(res.json()).toMatchObject({ lengthHours: 2, expiresAt: iso(3 * HOUR) });
    expect(await sessionOf(b)).toMatchObject({ lengthHours: 2, expiresAt: iso(3 * HOUR) });
  });

  it('extending raises no alert (owner G9)', async () => {
    const { id, b } = await trader();
    const count = async () => Number((await deps.db.query<{ n: string }>('select count(*) as n from alerts where account_id = $1', [id])).rows[0]!.n);
    const before = await count();
    at(HOUR);
    expect((await b.post('/v1/account/session/extend', { confirmToken: await extendToken(b, id), hours: 4 })).statusCode).toBe(200);
    expect(await count()).toBe(before);
  });

  it('a session on old Terms can still prove itself to stay logged in, and only for that (review M5)', async () => {
    const { b, auth, accountId } = await keyTrader('ps');
    await deps.db.query(`update accounts set terms_version = '2000-01-01' where id = $1`, [accountId]);
    expect(errorOf(await b.post('/v1/confirm/webauthn/start', { action: { kind: 'add-method', method: 'pgp' } }))).toBe('terms-required');
    const ok = await keyConfirm(b, auth, { kind: 'extend-session' });
    expect(ok.statusCode, ok.body).toBe(200);
    expect((await b.post('/v1/account/session/extend', ok.json() as { confirmToken: string })).statusCode).toBe(200);
  });
});

describe('who has a session length', () => {
  it('the choices follow the account type (review M7): accounts.account_type when it is there, else trader', async () => {
    const { id } = await trader();
    // This database has no account_type column yet (the vendor branch adds it): every account is a trader.
    expect(await sessionAccountType(deps.db, id)).toBe('trader');
    const vendor = { query: async () => ({ rows: [{ account_type: 'vendor' }] }) } as unknown as Parameters<typeof sessionAccountType>[0];
    expect(await sessionAccountType(vendor, id)).toBe('vendor');
    const odd = { query: async () => ({ rows: [{ account_type: 'something-else' }] }) } as unknown as Parameters<typeof sessionAccountType>[0];
    expect(await sessionAccountType(odd, id)).toBe('trader');
  });

  it('staff and owner sessions keep their fixed rules: no length to choose', async () => {
    for (const kind of ['staff', 'owner'] as const) {
      const { b } = await trader(kind);
      expect(await sessionOf(b)).toBeNull();
      expect(errorOf(await setLength(b, 2))).toBe('wrong-account-kind');
      expect(errorOf(await b.post('/v1/account/session/extend', {}))).toBe('wrong-account-kind');
    }
  });

  async function member(abilities: string[] = ['trades-see-active']) {
    const { id: teamId } = await trader();
    const loginId = await seedAccount(deps, { loginName: `mlen${++n}x`, displayName: `m-len-${n}`, kind: 'member' });
    const now = deps.clock();
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $5, $5)`,
      [teamId, `Member${n}`, `member${n}`, abilities, now, loginId],
    );
    return { teamId, loginId, m: await loggedIn(loginId) };
  }

  it('a team member chooses the length of their own session and extends it (owner, Q73)', async () => {
    const { teamId, m } = await member();
    expect(await sessionOf(m)).toMatchObject({ lengthHours: null, choices: [2, 4, 8, 12], canExtend: true });
    expect((await setLength(m, 4)).json()).toMatchObject({ lengthHours: 4, expiresAt: iso(4 * HOUR) });
    expect(errorOf(await m.post('/v1/account/session/extend', {}))).toBe('confirm-required');
    at(4 * HOUR - 4 * MIN);
    const res = await m.post('/v1/account/session/extend', { confirmToken: await extendToken(m, teamId), hours: 2 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ lengthHours: 2, expiresAt: iso(6 * HOUR - 4 * MIN), canExtend: true });
  });

  it("a team member proves it's them with their own PGP key, never the owner's, and only to stay logged in", async () => {
    const { teamId, loginId, m } = await member();
    const own = await genKey();
    const owners = await genKey();
    await insertPgpKey(deps.db, deps.config, { accountId: loginId, fingerprint: own.fingerprint, armored: own.publicKey, now: deps.clock() });
    await insertPgpKey(deps.db, deps.config, { accountId: teamId, fingerprint: owners.fingerprint, armored: owners.publicKey, now: deps.clock() });
    // Any other confirm stays the account owner's (Task 18: members get owner-only).
    expect(errorOf(await m.post('/v1/confirm/pgp/start', { action: { kind: 'become-vendor' } }))).toBe('owner-only');
    at(2 * HOUR - 4 * MIN);
    const start = await m.post('/v1/confirm/pgp/start', { action: { kind: 'extend-session' } });
    expect(start.statusCode, start.body).toBe(200);
    const { challengeId, encryptedMessage } = start.json() as { challengeId: string; encryptedMessage: string };
    // Encrypted to the member's own key only.
    await expect(decrypt(encryptedMessage, owners.privateKey)).rejects.toThrow();
    const code = codeOf(await decrypt(encryptedMessage, own.privateKey));
    const fin = await m.post('/v1/confirm/pgp/finish', { challengeId, code });
    expect(fin.statusCode, fin.body).toBe(200);
    const { confirmToken } = fin.json() as { confirmToken: string };
    expect(await confirmTokenMethod(deps, confirmToken)).toBe('pgp');
    const res = await m.post('/v1/account/session/extend', { confirmToken, hours: 4 });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toMatchObject({ lengthHours: 4, expiresAt: iso(6 * HOUR - 4 * MIN) });
  });

  it("a team member proves it's them with their own passkey; the account owner's passkey does not count", async () => {
    const { teamId, loginId, m } = await member();
    const insertPasskey = async (accountId: string, auth: SoftAuthenticator) =>
      deps.db.query(
        `insert into webauthn_credentials (account_id, credential_id, public_key, counter, kind, backed_up, device_type, attested, label, created_at)
         values ($1, $2, $3, 0, 'passkey', true, 'multiDevice', false, 'k', $4)`,
        [accountId, Buffer.from(auth.credentialId, 'base64url'), auth.cosePublicKey, deps.clock()],
      );
    const own = createSoftAuthenticator({ backedUp: true, userVerified: true });
    const owners = createSoftAuthenticator({ backedUp: true, userVerified: true });
    await insertPasskey(loginId, own);
    await insertPasskey(teamId, owners);
    const start = async () => {
      const r = await m.post('/v1/confirm/webauthn/start', { action: { kind: 'extend-session' } });
      expect(r.statusCode, r.body).toBe(200);
      return r.json() as { challengeId: string; options: Parameters<SoftAuthenticator['authenticate']>[0] };
    };
    // Only the member's own credential is offered.
    const first = await start();
    expect((first.options.allowCredentials ?? []).map((c) => c.id)).toEqual([own.credentialId]);
    const byOwner = await m.post('/v1/confirm/webauthn/finish', { challengeId: first.challengeId, response: owners.authenticate(first.options, ORIGIN) });
    expect(byOwner.statusCode).not.toBe(200);
    const second = await start();
    const fin = await m.post('/v1/confirm/webauthn/finish', { challengeId: second.challengeId, response: own.authenticate(second.options, ORIGIN) });
    expect(fin.statusCode, fin.body).toBe(200);
    const { confirmToken } = fin.json() as { confirmToken: string };
    expect(await confirmTokenMethod(deps, confirmToken)).toBe('passkey');
    expect((await m.post('/v1/account/session/extend', { confirmToken })).statusCode).toBe(200);
  });

  it('a team member with no PGP key of their own gets method-not-allowed, even when the owner has one', async () => {
    const { teamId, m } = await member();
    const owners = await genKey();
    await insertPgpKey(deps.db, deps.config, { accountId: teamId, fingerprint: owners.fingerprint, armored: owners.publicKey, now: deps.clock() });
    expect(errorOf(await m.post('/v1/confirm/pgp/start', { action: { kind: 'extend-session' } }))).toBe('method-not-allowed');
    expect(errorOf(await m.post('/v1/confirm/webauthn/start', { action: { kind: 'extend-session' } }))).toBe('method-not-allowed');
  });

});

describe('the idle reminder (owner, Q75): a reminder in personal settings, never a logout', () => {
  const setReminder = (b: Browser, minutes: unknown) => b.put('/v1/account/idle-reminder', { minutes });
  const reminderOf = async (b: Browser) => ((await b.get('/v1/account/me')).json() as { idleReminderMinutes: number | null }).idleReminderMinutes;

  it('is off by default; turned on with one of the intervals, and off again with null', async () => {
    const { b } = await trader();
    expect(await reminderOf(b)).toBeNull();
    const on = await setReminder(b, 30);
    expect(on.statusCode, on.body).toBe(200);
    expect(on.json()).toEqual({ idleReminderMinutes: 30 });
    expect(await reminderOf(b)).toBe(30);
    expect((await setReminder(b, null)).json()).toEqual({ idleReminderMinutes: null });
    expect(await reminderOf(b)).toBeNull();
  });

  it('is the person\'s own: every session of the account sees it, and it never moves the session end', async () => {
    const { id, b } = await trader();
    const other = await loggedIn(id);
    expect((await setReminder(b, 15)).statusCode).toBe(200);
    expect(await reminderOf(other)).toBe(15);
    expect((await sessionOf(b))!.expiresAt).toBe(iso(2 * HOUR));
  });

  it('refuses anything but an interval or null', async () => {
    const { b } = await trader();
    for (const bad of [0, 5, 20, 240, 15.5, '15', true, [15], undefined]) {
      const res = await setReminder(b, bad);
      expect(res.statusCode, String(bad)).toBe(400);
      expect(errorOf(res)).toBe('bad-request');
    }
    expect((await b.put('/v1/account/idle-reminder', {})).statusCode).toBe(400);
    expect(await reminderOf(b)).toBeNull();
  });

  it("a team member's reminder is their own, not the account owner's", async () => {
    const { id: teamId, b: owner } = await trader();
    const loginId = await seedAccount(deps, { loginName: `midle${++n}x`, displayName: `m-idle-${n}`, kind: 'member' });
    const now = deps.clock();
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, $2, $3, $4, $5, $6, $5, $5)`,
      [teamId, `Member${n}`, `member${n}`, ['offers-see'], now, loginId],
    );
    const m = await loggedIn(loginId);
    expect((await setReminder(m, 60)).statusCode).toBe(200);
    expect(await reminderOf(m)).toBe(60);
    expect(await reminderOf(owner)).toBeNull();
    expect((await setReminder(owner, 10)).statusCode).toBe(200);
    expect(await reminderOf(m)).toBe(60);
  });

  it('staff sessions have none', async () => {
    // (One owner account per database: the owner's refusal is the same kinds check, in "who has a session length".)
    const { b } = await trader('staff');
    expect(errorOf(await setReminder(b, 30))).toBe('wrong-account-kind');
  });
});
