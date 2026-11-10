// J-23 (S-075) phase 1 groundwork (docs/security/multi-device-2026-11-09.md, sections 3.1, 4.2,
// 6.1): the chat-key envelopes the API carries between a person's own devices. The API is a courier:
// it stores and serves sealed bytes to the account's own strong sessions and never opens them.
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AccountKind } from '@x2f/accounts';
import { generateBoxKeyPair, openSealed, sealTo } from '@x2f/protocol';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { CHAT_KEY_ENVELOPE_TTL_MS, MAX_OPEN_CHAT_KEY_ENVELOPES, keysOffered, strongForKeys } from '../src/auth/chatKeys.js';
import { ensureDeviceCookie } from '../src/auth/device.js';
import { HOLD_BLOCKED_ROUTES, LIVE_SESSION_ROUTES, WEAK_LIMITED_ROUTES } from '../src/auth/hold.js';
import { OWN_DATA_READS, OWN_DATA_WRITES } from '../src/auth/frontDoor.js';
import { completeLogin, type LoginFactor } from '../src/auth/login.js';
import { accountIdByLoginName, seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { fixtureLeakedList } from './helpers/leaked.js';
import { SIG } from './helpers/signature.js';
import { createSoftAuthenticator } from './helpers/softAuthenticator.js';
import { rolesToAbilities } from '../src/team/abilities.js';

const ORIGIN = 'https://x2f.test';
const T0 = new Date('2026-10-17T12:00:00Z');
const HOUR = 3600_000;
const TERMS = '2026-10-17';
const GOOD = 'Correct-Horse-9';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let step = 0;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  const fixture = await fixtureLeakedList();
  cleanup = fixture.cleanup;
  let set: (d: Date) => void;
  ({ app, deps, setNow: set } = await testApp({ leaked: fixture.list }));
  setNow = (d) => {
    now = d;
    set(d);
  };
  app.post('/t/complete', async (req, reply) => {
    ensureDeviceCookie(req, reply);
    const { accountId, factor, pendingId } = req.body as { accountId: string; factor: LoginFactor; pendingId?: string };
    const { rows } = await deps.db.query<{ kind: AccountKind }>('select kind from accounts where id = $1', [accountId]);
    return completeLogin(deps, req, reply, {
      account: { id: accountId, kind: rows[0]!.kind }, factor, deviceLabel: 'Desk', ...(pendingId !== undefined ? { pendingId } : {}),
    });
  });
});

afterAll(async () => {
  await app.close();
  await cleanup();
});

beforeEach(() => {
  setNow(new Date(T0.getTime() + ++step * HOUR));
});

/** One browser: its own cookie jar. */
class Browser {
  cookies: Record<string, string> = {};
  constructor(readonly label = 'Browser on Linux') {}
  private keep(res: LightMyRequestResponse): LightMyRequestResponse {
    for (const c of res.cookies) {
      if (c.maxAge === 0 || c.value === '') delete this.cookies[c.name];
      else this.cookies[c.name] = c.value;
    }
    return res;
  }
  async send(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown): Promise<LightMyRequestResponse> {
    return this.keep(
      await app.inject({
        method, url, headers: { origin: ORIGIN }, cookies: this.cookies,
        ...(payload !== undefined ? { payload: payload as Record<string, unknown> } : {}),
      }),
    );
  }
  get = (url: string) => this.send('GET', url);
  post = (url: string, payload: unknown = {}) => this.send('POST', url, payload);
  delete = (url: string) => this.send('DELETE', url);
  login(name: string, password = GOOD) {
    return this.post('/v1/login/password', { loginName: name, password, deviceLabel: this.label });
  }
}

let seq = 0;
const unique = (p: string) => `${p}${++seq}x${step}`;

/** A password trader in a fresh browser: a username-and-password session, `weak-single`. */
async function weakTrader(label = 'Firefox on Linux') {
  const b = new Browser(label);
  const name = unique('ck');
  const res = await b.post('/v1/register/password', { displayName: `P${name}`, loginName: name, password: GOOD, deviceLabel: label, acceptedTerms: TERMS, termsSignature: SIG });
  expect(res.statusCode).toBe(201);
  const accountId = (await accountIdByLoginName(deps, name))!;
  return { b, name, accountId };
}

/** A passkey trader in a fresh browser: a strong session (a passkey alone is on the owner's list). */
async function strongTrader() {
  const auth = createSoftAuthenticator({ backedUp: true, userVerified: true });
  const b = new Browser('Chrome on Windows');
  const name = unique('pk');
  const start = await b.post('/v1/register/webauthn/start', { displayName: `D.${name}`, loginName: name, kind: 'passkey' });
  const { challengeId, options } = start.json();
  const fin = await b.post('/v1/register/webauthn/finish', { challengeId, response: auth.register(options, ORIGIN), deviceLabel: 'Laptop', acceptedTerms: TERMS, termsSignature: SIG });
  expect(fin.statusCode, fin.body).toBe(201);
  const accountId = (await accountIdByLoginName(deps, name))!;
  return { b, name, accountId, auth };
}

/** A second strong browser of the same passkey account (approved from the first: both strong). */
async function secondStrongBrowser(t: Awaited<ReturnType<typeof strongTrader>>): Promise<Browser> {
  const b = new Browser('Safari on iOS');
  const s = (await b.post('/v1/login/webauthn/start', {})).json();
  const res = await b.post('/v1/login/webauthn/finish', { challengeId: s.challengeId, response: t.auth.authenticate(s.options, ORIGIN), deviceLabel: 'Phone' });
  const w = res.json() as { status: string; approvalId: string; number: number };
  expect(w.status).toBe('approve-on-device');
  expect((await t.b.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ outcome: 'approved' });
  expect((await b.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toMatchObject({ status: 'ok' });
  return b;
}

const strengthOf = async (accountId: string) =>
  (await deps.db.query<{ strength: string | null }>('select strength from sessions where account_id = $1 and revoked_at is null order by created_at', [accountId])).rows.map((r) => r.strength);

/** A sealed 32-byte key to `recipient`, as the posting device would send it. */
async function envelopeFor(recipient: { boxPublic: string }, epoch = 0) {
  const ack = randomBytes(32);
  const sealed = Buffer.from(await sealTo(recipient.boxPublic, new Uint8Array(ack)));
  return { ack, body: { recipientPublic: recipient.boxPublic, sealed: sealed.toString('base64url'), epoch } };
}

type Listed = { epoch: number; envelopes: Array<{ id: string; recipientPublic: string; sealed: string; epoch: number; createdAt: string; expiresAt: string }> };

describe('the strength rule, strictly (section 3.1 rule 2)', () => {
  it("is 'strong' exactly on both sides: null and weak-single never offer keys", () => {
    expect(strongForKeys('strong')).toBe(true);
    expect(strongForKeys('weak-single')).toBe(false);
    expect(strongForKeys(null)).toBe(false);
    expect(strongForKeys(undefined)).toBe(false);
    expect(keysOffered('strong', 'strong')).toBe(true);
    expect(keysOffered('strong', 'weak-single')).toBe(false);
    expect(keysOffered('weak-single', 'strong')).toBe(false);
    expect(keysOffered('weak-single', 'weak-single')).toBe(false);
    expect(keysOffered('strong', null)).toBe(false);
    expect(keysOffered(null, 'strong')).toBe(false);
  });
});

describe('the courier: strong sessions of the account store and read sealed envelopes', () => {
  it('a strong session posts a box to a device key; the second strong device lists it byte for byte and opens it with its own secret; the server could not', async () => {
    const t = await strongTrader();
    expect(await strengthOf(t.accountId)).toEqual(['strong']);
    const device = await generateBoxKeyPair();
    const { ack, body } = await envelopeFor(device);
    const posted = await t.b.post('/v1/account/chat-keys', body);
    expect(posted.statusCode, posted.body).toBe(201);
    const { id, expiresAt } = posted.json() as { id: string; expiresAt: string };
    expect(expiresAt).toBe(new Date(now.getTime() + CHAT_KEY_ENVELOPE_TTL_MS).toISOString());

    const phone = await secondStrongBrowser(t);
    expect(await strengthOf(t.accountId)).toEqual(['strong', 'strong']);
    const list = (await phone.get('/v1/account/chat-keys')).json() as Listed;
    expect(list).toEqual({
      epoch: 0,
      envelopes: [{ id, recipientPublic: device.boxPublic, sealed: body.sealed, epoch: 0, createdAt: now.toISOString(), expiresAt }],
    });
    const opened = await openSealed(device, new Uint8Array(Buffer.from(list.envelopes[0]!.sealed, 'base64url')));
    expect(Buffer.from(opened)).toEqual(ack);
    // What the database holds is the sealed bytes only: the key is nowhere in it.
    const { rows } = await deps.db.query<{ sealed: Buffer; recipient_public: Buffer; created_by: string }>('select sealed, recipient_public, created_by from chat_key_envelopes where id = $1', [id]);
    expect(rows[0]!.sealed.toString('base64url')).toBe(body.sealed);
    expect(rows[0]!.recipient_public.toString('hex')).toBe(device.boxPublic);
    expect(rows[0]!.sealed.toString('hex')).not.toContain(ack.toString('hex'));
    const whole = JSON.stringify((await deps.db.query('select * from chat_key_envelopes where id = $1', [id])).rows);
    expect(whole).not.toContain(ack.toString('hex'));
    expect(whole).not.toContain(ack.toString('base64url'));
  });

  it('a box sealed to another device is only ciphertext to this one', async () => {
    const t = await strongTrader();
    const theirs = await generateBoxKeyPair();
    const mine = await generateBoxKeyPair();
    const { body } = await envelopeFor(theirs);
    expect((await t.b.post('/v1/account/chat-keys', body)).statusCode).toBe(201);
    const list = (await t.b.get('/v1/account/chat-keys')).json() as Listed;
    await expect(openSealed(mine, new Uint8Array(Buffer.from(list.envelopes[0]!.sealed, 'base64url')))).rejects.toMatchObject({ code: 'not-for-me' });
  });

  it('collected once: the receiving device deletes it, then nobody is served it and a second delete is 404', async () => {
    const t = await strongTrader();
    const device = await generateBoxKeyPair();
    const { body } = await envelopeFor(device);
    const { id } = (await t.b.post('/v1/account/chat-keys', body)).json() as { id: string };
    const phone = await secondStrongBrowser(t);
    expect(((await phone.get('/v1/account/chat-keys')).json() as Listed).envelopes).toHaveLength(1);
    expect((await phone.delete(`/v1/account/chat-keys/${id}`)).statusCode).toBe(204);
    expect(((await phone.get('/v1/account/chat-keys')).json() as Listed).envelopes).toEqual([]);
    expect(((await t.b.get('/v1/account/chat-keys')).json() as Listed).envelopes).toEqual([]);
    expect((await phone.delete(`/v1/account/chat-keys/${id}`)).statusCode).toBe(404);
    expect((await phone.delete('/v1/account/chat-keys/not-a-uuid')).statusCode).toBe(404);
    const { rows } = await deps.db.query<{ collected_at: Date | null }>('select collected_at from chat_key_envelopes where id = $1', [id]);
    expect(rows[0]!.collected_at).toEqual(now);
  });

  it('expires unread after its time; a later post sweeps the expired and collected rows of the account', async () => {
    const t = await strongTrader();
    const a = await generateBoxKeyPair();
    const b = await generateBoxKeyPair();
    const first = (await t.b.post('/v1/account/chat-keys', (await envelopeFor(a)).body)).json() as { id: string };
    const second = (await t.b.post('/v1/account/chat-keys', (await envelopeFor(b)).body)).json() as { id: string };
    expect((await t.b.delete(`/v1/account/chat-keys/${second.id}`)).statusCode).toBe(204);
    setNow(new Date(now.getTime() + CHAT_KEY_ENVELOPE_TTL_MS));
    expect(((await t.b.get('/v1/account/chat-keys')).json() as Listed).envelopes).toEqual([]);
    expect((await t.b.delete(`/v1/account/chat-keys/${first.id}`)).statusCode).toBe(404);
    const c = await generateBoxKeyPair();
    const third = (await t.b.post('/v1/account/chat-keys', (await envelopeFor(c)).body)).json() as { id: string };
    const ids = (await deps.db.query<{ id: string }>('select id from chat_key_envelopes where account_id = $1', [t.accountId])).rows.map((r) => r.id);
    expect(ids).toEqual([third.id]);
  });

  it('a newer box to the same device supersedes the open one; at most the limit are open, the oldest expiring', async () => {
    const t = await strongTrader();
    const device = await generateBoxKeyPair();
    const first = (await t.b.post('/v1/account/chat-keys', (await envelopeFor(device)).body)).json() as { id: string };
    setNow(new Date(now.getTime() + 1000));
    const again = (await t.b.post('/v1/account/chat-keys', (await envelopeFor(device)).body)).json() as { id: string };
    const list = (await t.b.get('/v1/account/chat-keys')).json() as Listed;
    expect(list.envelopes.map((e) => e.id)).toEqual([again.id]);
    expect((await t.b.delete(`/v1/account/chat-keys/${first.id}`)).statusCode).toBe(404);
    const ids = [again.id];
    for (let i = 1; i < MAX_OPEN_CHAT_KEY_ENVELOPES + 1; i++) {
      setNow(new Date(now.getTime() + 1000));
      ids.push(((await t.b.post('/v1/account/chat-keys', (await envelopeFor(await generateBoxKeyPair())).body)).json() as { id: string }).id);
    }
    const open = ((await t.b.get('/v1/account/chat-keys')).json() as Listed).envelopes.map((e) => e.id);
    expect(open).toEqual(ids.slice(1));
    expect(open).toHaveLength(MAX_OPEN_CHAT_KEY_ENVELOPES);
  });

  it("the epoch must be the account's current one (0 until a rotation exists); the refusal names it", async () => {
    const t = await strongTrader();
    const device = await generateBoxKeyPair();
    const res = await t.b.post('/v1/account/chat-keys', (await envelopeFor(device, 1)).body);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'bad-request', epoch: 0 });
    expect((await deps.db.query('select 1 from chat_key_envelopes where account_id = $1', [t.accountId])).rows).toEqual([]);
    await deps.db.query('update accounts set chat_key_epoch = 3 where id = $1', [t.accountId]);
    expect((await t.b.post('/v1/account/chat-keys', (await envelopeFor(device, 0)).body)).json()).toEqual({ error: 'bad-request', epoch: 3 });
    expect((await t.b.post('/v1/account/chat-keys', (await envelopeFor(device, 3)).body)).statusCode).toBe(201);
    const list = (await t.b.get('/v1/account/chat-keys')).json() as Listed;
    expect(list.epoch).toBe(3);
    expect(list.envelopes[0]).toMatchObject({ epoch: 3 });
  });

  it('refuses malformed posts without storing anything', async () => {
    const t = await strongTrader();
    const device = await generateBoxKeyPair();
    const { body } = await envelopeFor(device);
    const bad: unknown[] = [
      {},
      [],
      { ...body, extra: 1 },
      { recipientPublic: body.recipientPublic, sealed: body.sealed },
      { ...body, recipientPublic: body.recipientPublic.toUpperCase() },
      { ...body, recipientPublic: body.recipientPublic.slice(2) },
      { ...body, recipientPublic: 'zz'.repeat(32) },
      { ...body, sealed: `${body.sealed}=` },
      // Standard base64 alphabet, not base64url.
      { ...body, sealed: '+'.repeat(80) },
      { ...body, sealed: Buffer.alloc(47).toString('base64url') },
      { ...body, sealed: Buffer.alloc(1025).toString('base64url') },
      { ...body, sealed: 42 },
      { ...body, epoch: '0' },
      { ...body, epoch: -1 },
      { ...body, epoch: 1.5 },
      { ...body, epoch: 2 ** 31 },
    ];
    for (const b of bad) {
      const res = await t.b.post('/v1/account/chat-keys', b);
      expect(res.statusCode, JSON.stringify(b).slice(0, 80)).toBe(400);
    }
    // A bare string is not even JSON to the route: Fastify refuses its content type first.
    expect((await t.b.post('/v1/account/chat-keys', 'x')).statusCode).toBe(415);
    expect((await deps.db.query('select 1 from chat_key_envelopes where account_id = $1', [t.accountId])).rows).toEqual([]);
    // The bounds themselves are fine: 48 and 1024 bytes.
    expect((await t.b.post('/v1/account/chat-keys', { ...body, sealed: Buffer.alloc(48, 1).toString('base64url') })).statusCode).toBe(201);
    expect((await t.b.post('/v1/account/chat-keys', { ...body, recipientPublic: (await generateBoxKeyPair()).boxPublic, sealed: Buffer.alloc(1024, 2).toString('base64url') })).statusCode).toBe(201);
  });
});

describe('who may use the courier', () => {
  it('a username-and-password session may neither read nor post nor collect (403 weak-session), whatever the account holds', async () => {
    const w = await weakTrader();
    expect(await strengthOf(w.accountId)).toEqual(['weak-single']);
    const device = await generateBoxKeyPair();
    const { body } = await envelopeFor(device);
    expect((await w.b.post('/v1/account/chat-keys', body)).json()).toEqual({ error: 'weak-session' });
    expect((await w.b.get('/v1/account/chat-keys')).json()).toEqual({ error: 'weak-session' });
    // A strong session of the account posts one; the weak one still sees nothing and collects nothing.
    await deps.db.query("update sessions set strength = 'strong' where account_id = $1", [w.accountId]);
    const { id } = (await w.b.post('/v1/account/chat-keys', body)).json() as { id: string };
    await deps.db.query("update sessions set strength = 'weak-single' where account_id = $1", [w.accountId]);
    expect((await w.b.get('/v1/account/chat-keys')).json()).toEqual({ error: 'weak-session' });
    expect((await w.b.delete(`/v1/account/chat-keys/${id}`)).json()).toEqual({ error: 'weak-session' });
    expect((await deps.db.query('select collected_at from chat_key_envelopes where id = $1', [id])).rows).toEqual([{ collected_at: null }]);
  });

  it("a sign-up's first 30 minutes do not count: strictly 'strong', not merely 'not weak' (weakOf would let it through)", async () => {
    const w = await weakTrader();
    const { rows } = await deps.db.query<{ onboarding_until: Date | null }>('select onboarding_until from sessions where account_id = $1', [w.accountId]);
    expect(rows[0]!.onboarding_until!.getTime()).toBeGreaterThan(now.getTime());
    expect((await w.b.get('/v1/account/chat-keys')).json()).toEqual({ error: 'weak-session' });
    expect((await w.b.post('/v1/account/chat-keys', (await envelopeFor(await generateBoxKeyPair())).body)).json()).toEqual({ error: 'weak-session' });
  });

  it('a session from before strength was stored (null) is not strong', async () => {
    const t = await strongTrader();
    await deps.db.query('update sessions set strength = null where account_id = $1', [t.accountId]);
    expect((await t.b.get('/v1/account/chat-keys')).json()).toEqual({ error: 'weak-session' });
  });

  it('a recovery session and a team member never see or post envelopes; another account sees nothing and collects nothing', async () => {
    const t = await strongTrader();
    const device = await generateBoxKeyPair();
    const { id } = (await t.b.post('/v1/account/chat-keys', (await envelopeFor(device)).body)).json() as { id: string };

    // Another trader, strong: their own list is empty and the id is not theirs.
    const other = await strongTrader();
    expect((await other.b.get('/v1/account/chat-keys')).json()).toEqual({ epoch: 0, envelopes: [] });
    expect((await other.b.delete(`/v1/account/chat-keys/${id}`)).statusCode).toBe(404);

    // A team member's session (two factors, strong, a session of the team account): owner-only routes.
    const name = unique('mem');
    const loginId = await seedAccount(deps, { loginName: name, displayName: `m-${name}-placeholder`, kind: 'member' });
    await deps.db.query(
      `insert into team_members (account_id, display_name, display_key, abilities, invite_expires_at, member_account_id, joined_at, created_at)
       values ($1, $2, $3, $6, $4, $5, $4, $4)`,
      [t.accountId, `M${name}`, `m${name}`.toLowerCase(), now, loginId, rolesToAbilities(['offers', 'trades'])],
    );
    const pgp = (c: string): LoginFactor => ({ method: 'pgp', fingerprint: c.repeat(40), fingerprints: [c.repeat(40)] });
    const mb = new Browser();
    const first = (await mb.post('/t/complete', { accountId: loginId, factor: pgp('A') })).json() as { status: string; pendingId: string };
    expect(first.status).toBe('second-factor');
    expect((await mb.post('/t/complete', { accountId: loginId, pendingId: first.pendingId, factor: pgp('B') })).json()).toEqual({ status: 'ok' });
    expect((await mb.get('/v1/account/chat-keys')).json()).toEqual({ error: 'owner-only' });
    expect((await mb.post('/v1/account/chat-keys', (await envelopeFor(device)).body)).json()).toEqual({ error: 'owner-only' });
    expect((await mb.delete(`/v1/account/chat-keys/${id}`)).json()).toEqual({ error: 'owner-only' });

    // A recovery session (a backup login) of the account itself.
    await deps.db.query(`update sessions set level = 'recovery' where account_id = $1 and member_id is null`, [t.accountId]);
    expect((await t.b.get('/v1/account/chat-keys')).json()).toMatchObject({ error: 'recovery-session' });
    expect((await t.b.post('/v1/account/chat-keys', (await envelopeFor(device)).body)).json()).toMatchObject({ error: 'recovery-session' });
    expect((await t.b.delete(`/v1/account/chat-keys/${id}`)).json()).toMatchObject({ error: 'recovery-session' });
    expect((await deps.db.query('select collected_at from chat_key_envelopes where id = $1', [id])).rows).toEqual([{ collected_at: null }]);
  });

  it('nothing is handed over during an account hold (403 recovery-hold), and the envelope stays uncollected', async () => {
    const t = await strongTrader();
    const device = await generateBoxKeyPair();
    const { id } = (await t.b.post('/v1/account/chat-keys', (await envelopeFor(device)).body)).json() as { id: string };
    const until = new Date(now.getTime() + 24 * HOUR);
    await deps.db.query(
      `insert into account_holds (account_id, started_at, hold_until, reason, started_methods) values ($1, $2, $3, 'recovery-code', '{}')`,
      [t.accountId, now, until],
    );
    try {
      expect((await t.b.post('/v1/account/chat-keys', (await envelopeFor(await generateBoxKeyPair())).body)).json()).toEqual({ error: 'recovery-hold', holdUntil: until.toISOString() });
      expect((await t.b.delete(`/v1/account/chat-keys/${id}`)).json()).toEqual({ error: 'recovery-hold', holdUntil: until.toISOString() });
      // Review F3: the listing too (the box is what is handed over, not the DELETE).
      expect((await t.b.get('/v1/account/chat-keys')).json()).toEqual({ error: 'recovery-hold', holdUntil: until.toISOString() });
      expect((await deps.db.query('select collected_at from chat_key_envelopes where id = $1', [id])).rows).toEqual([{ collected_at: null }]);
      expect((await deps.db.query('select count(*)::int as n from chat_key_envelopes where account_id = $1', [t.accountId])).rows[0]).toEqual({ n: 1 });
    } finally {
      await deps.db.query('delete from account_holds where account_id = $1', [t.accountId]);
    }
  });

  it('logged out, there is no courier at all', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/account/chat-keys' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'not-authenticated' });
    expect((await app.inject({ method: 'POST', url: '/v1/account/chat-keys', headers: { origin: ORIGIN }, payload: {} })).statusCode).toBe(401);
  });

  it('the routes are classified: own-data lists, live-session, hold-blocked and weak-limited', () => {
    expect(OWN_DATA_READS['GET /v1/account/chat-keys']).toBeDefined();
    expect(OWN_DATA_WRITES['POST /v1/account/chat-keys']).toBeDefined();
    expect(OWN_DATA_WRITES['DELETE /v1/account/chat-keys/:id']).toBeDefined();
    for (const r of ['POST /v1/account/chat-keys', 'DELETE /v1/account/chat-keys/:id']) {
      expect(LIVE_SESSION_ROUTES, r).toContain(r);
      expect(HOLD_BLOCKED_ROUTES, r).toContain(r);
      expect(WEAK_LIMITED_ROUTES, r).toContain(r);
    }
  });
});

describe('the table', () => {
  it('cascades with the account and refuses a key or a box of the wrong size', async () => {
    const t = await strongTrader();
    const device = await generateBoxKeyPair();
    const { id } = (await t.b.post('/v1/account/chat-keys', (await envelopeFor(device)).body)).json() as { id: string };
    const ins = (cols: { recipient?: number; sealed?: number; epoch?: number }) =>
      deps.db.query(
        `insert into chat_key_envelopes (account_id, recipient_public, sealed, epoch, created_at, expires_at) values ($1, $2, $3, $4, $5, $6)`,
        [t.accountId, randomBytes(cols.recipient ?? 32), randomBytes(cols.sealed ?? 80), cols.epoch ?? 0, now, new Date(now.getTime() + 1000)],
      );
    await expect(ins({ recipient: 31 })).rejects.toMatchObject({ code: '23514' });
    await expect(ins({ sealed: 47 })).rejects.toMatchObject({ code: '23514' });
    await expect(ins({ sealed: 1025 })).rejects.toMatchObject({ code: '23514' });
    await expect(ins({ epoch: -1 })).rejects.toMatchObject({ code: '23514' });
    await expect(deps.db.query('update accounts set chat_key_epoch = -1 where id = $1', [t.accountId])).rejects.toMatchObject({ code: '23514' });
    await deps.db.query('delete from accounts where id = $1', [t.accountId]);
    expect((await deps.db.query('select 1 from chat_key_envelopes where id = $1', [id])).rows).toEqual([]);
  });
});

// Lead 10 Nov (J-23): an account close deletes its chat-key envelopes in the same transaction. The
// same scan as the Terms signature's tripwire (termsSignature.test.ts): a file with a statement that
// sets accounts.closed_at must call eraseChatKeyEnvelopes. (Staff removals and cancelled staff
// invites close staff logins, which can never hold an envelope: the routes are trader-only.)
describe('every account close deletes the chat-key envelopes (tripwire)', () => {
  const SRC = fileURLToPath(new URL('../src/', import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => (statSync(dir + f).isDirectory() ? files(`${dir}${f}/`) : f.endsWith('.ts') ? [dir + f] : []));

  it('a statement that sets accounts.closed_at sits in a file that calls eraseChatKeyEnvelopes', () => {
    const CLOSE = /update\s+accounts\b[^;`]*?\bclosed_at\s*=/s;
    const closes = files(SRC).filter((f) => CLOSE.test(readFileSync(f, 'utf8')));
    expect(closes.map((f) => f.slice(SRC.length))).toContain('accountInactivity.ts');
    const missing = closes.filter((f) => !readFileSync(f, 'utf8').includes('eraseChatKeyEnvelopes('));
    expect(missing.map((f) => f.slice(SRC.length)), 'delete the chat-key envelopes in this account close (eraseChatKeyEnvelopes)').toEqual([]);
  });
});
