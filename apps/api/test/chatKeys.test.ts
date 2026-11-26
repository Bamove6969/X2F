// J-23 (S-075) phase 1 groundwork (docs/security/multi-device-2026-11-09.md, sections 3.1, 4.2,
// 6.1): the chat-key envelopes the API carries between a person's own devices. The API is a courier:
// it stores and serves sealed bytes to the account owner's own sessions and never opens them.
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { AccountKind } from '@x2f/accounts';
import { generateBoxKeyPair, openSealed, sealTo } from '@x2f/protocol';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { CHAT_KEY_ENVELOPE_TTL_MS, MAX_OPEN_CHAT_KEY_ENVELOPES, purgeChatKeyEnvelopes } from '../src/auth/chatKeys.js';
import { CHAT_KEY_COLLECT_BUCKET, CHAT_KEY_POST_BUCKET } from '../src/limits.js';
import { RETENTION_JOBS } from '../src/retentionJobs.js';
import { ensureDeviceCookie } from '../src/auth/device.js';
import { LIVE_SESSION_ROUTES } from '../src/auth/liveSession.js';
import { OWN_DATA_READS, OWN_DATA_WRITES } from '../src/auth/frontDoor.js';
import { completeLogin, type LoginFactor } from '../src/auth/login.js';
import { accountIdByLoginName, addUnusedKeys, seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { SIG } from './helpers/signature.js';
import { createSoftAuthenticator } from './helpers/softAuthenticator.js';
import { rolesToAbilities } from '../src/team/abilities.js';

const ORIGIN = 'https://x2f.test';
const T0 = new Date('2026-10-17T12:00:00Z');
const HOUR = 3600_000;
const TERMS = '2026-10-17';

let app: FastifyInstance;
let deps: Deps;
let setNow: (d: Date) => void;
let now = T0;
let step = 0;
let cleanup: () => Promise<void>;
let logs: string[];

beforeAll(async () => {
  cleanup = async () => {};
  let set: (d: Date) => void;
  ({ app, deps, setNow: set, logs } = await testApp({}));
  setNow = (d) => {
    now = d;
    set(d);
  };
  // Review F4: a constraint error on this table, raised the way a route would raise it.
  app.post('/t/envelope-check-fails', async (req) => {
    const { accountId, marker } = req.body as { accountId: string; marker: string };
    await deps.db.query(
      `insert into chat_key_envelopes (account_id, recipient_public, sealed, epoch, created_at, expires_at) values ($1, $2, $3, 0, $4, $4)`,
      [accountId, Buffer.from(marker, 'hex'), Buffer.from(marker.repeat(3), 'hex'), deps.clock()],
    );
    return { ok: true };
  });
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
}

let seq = 0;
const unique = (p: string) => `${p}${String(++seq).padStart(4, '0')}x${step}`;

/** A passkey trader in a fresh browser (and an unused second kind of method, owner 26 Nov 2026: two kinds). */
async function passkeyTrader() {
  const auth = createSoftAuthenticator({ backedUp: true, userVerified: true });
  const b = new Browser('Chrome on Windows');
  const name = unique('pk');
  const start = await b.post('/v1/register/webauthn/start', { displayName: `D.${name}`, loginName: name, kind: 'passkey' });
  const { challengeId, options } = start.json();
  const fin = await b.post('/v1/register/webauthn/finish', { challengeId, response: auth.register(options, ORIGIN), deviceLabel: 'Laptop', acceptedTerms: TERMS, termsSignature: SIG });
  expect(fin.statusCode, fin.body).toBe(201);
  const accountId = (await accountIdByLoginName(deps, name))!;
  await addUnusedKeys(deps, accountId);
  return { b, name, accountId, auth };
}

/** A second browser of the same passkey account (approved from the first). */
async function secondBrowser(t: Awaited<ReturnType<typeof passkeyTrader>>): Promise<Browser> {
  const b = new Browser('Safari on iOS');
  const s = (await b.post('/v1/login/webauthn/start', {})).json();
  const res = await b.post('/v1/login/webauthn/finish', { challengeId: s.challengeId, response: t.auth.authenticate(s.options, ORIGIN), deviceLabel: 'Phone' });
  const w = res.json() as { status: string; approvalId: string; number: number };
  expect(w.status).toBe('approve-on-device');
  expect((await t.b.post(`/v1/account/approvals/${w.approvalId}`, { choice: w.number })).json()).toEqual({ outcome: 'approved' });
  expect((await b.post(`/v1/login/approval/${w.approvalId}/poll`)).json()).toMatchObject({ status: 'ok' });
  return b;
}

/** A sealed 32-byte key to `recipient`, as the posting device would send it. */
async function envelopeFor(recipient: { boxPublic: string }, epoch = 0) {
  const ack = randomBytes(32);
  const sealed = Buffer.from(await sealTo(recipient.boxPublic, new Uint8Array(ack)));
  return { ack, body: { recipientPublic: recipient.boxPublic, sealed: sealed.toString('base64url'), epoch } };
}

type Listed = { epoch: number; envelopes: Array<{ id: string; recipientPublic: string; sealed: string; epoch: number; createdAt: string; expiresAt: string }> };

describe('the courier: the account owner\'s sessions store and read sealed envelopes', () => {
  it('a session posts a box to a device key; the second device lists it byte for byte and opens it with its own secret; the server could not', async () => {
    const t = await passkeyTrader();
    const device = await generateBoxKeyPair();
    const { ack, body } = await envelopeFor(device);
    const posted = await t.b.post('/v1/account/chat-keys', body);
    expect(posted.statusCode, posted.body).toBe(201);
    const { id, expiresAt } = posted.json() as { id: string; expiresAt: string };
    expect(expiresAt).toBe(new Date(now.getTime() + CHAT_KEY_ENVELOPE_TTL_MS).toISOString());

    const phone = await secondBrowser(t);
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
    const t = await passkeyTrader();
    const theirs = await generateBoxKeyPair();
    const mine = await generateBoxKeyPair();
    const { body } = await envelopeFor(theirs);
    expect((await t.b.post('/v1/account/chat-keys', body)).statusCode).toBe(201);
    const list = (await t.b.get('/v1/account/chat-keys')).json() as Listed;
    await expect(openSealed(mine, new Uint8Array(Buffer.from(list.envelopes[0]!.sealed, 'base64url')))).rejects.toMatchObject({ code: 'not-for-me' });
  });

  it('collected once: the receiving device deletes it, then nobody is served it and a second delete is 404', async () => {
    const t = await passkeyTrader();
    const device = await generateBoxKeyPair();
    const { body } = await envelopeFor(device);
    const { id } = (await t.b.post('/v1/account/chat-keys', body)).json() as { id: string };
    const phone = await secondBrowser(t);
    expect(((await phone.get('/v1/account/chat-keys')).json() as Listed).envelopes).toHaveLength(1);
    expect((await phone.delete(`/v1/account/chat-keys/${id}`)).statusCode).toBe(204);
    expect(((await phone.get('/v1/account/chat-keys')).json() as Listed).envelopes).toEqual([]);
    expect(((await t.b.get('/v1/account/chat-keys')).json() as Listed).envelopes).toEqual([]);
    expect((await phone.delete(`/v1/account/chat-keys/${id}`)).statusCode).toBe(404);
    expect((await phone.delete('/v1/account/chat-keys/not-a-uuid')).statusCode).toBe(404);
    // Review F5: collecting deletes the row, sealed bytes and all.
    expect((await deps.db.query('select 1 from chat_key_envelopes where id = $1', [id])).rows).toEqual([]);
  });

  it('expires unread after its time; a later post sweeps the expired and collected rows of the account', async () => {
    const t = await passkeyTrader();
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
    const t = await passkeyTrader();
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

  it('review F4: a second box to the same device in the same millisecond replaces the first (no 500); the cap holds at one instant too', async () => {
    const t = await passkeyTrader();
    const device = await generateBoxKeyPair();
    const a = await t.b.post('/v1/account/chat-keys', (await envelopeFor(device)).body);
    const b = await t.b.post('/v1/account/chat-keys', (await envelopeFor(device)).body);
    expect(a.statusCode, a.body).toBe(201);
    expect(b.statusCode, b.body).toBe(201);
    const second = (b.json() as { id: string }).id;
    expect(((await t.b.get('/v1/account/chat-keys')).json() as Listed).envelopes.map((e) => e.id)).toEqual([second]);
    // Eleven more, still at the same instant: always the newest kept, never more than the cap.
    let last = second;
    for (let i = 0; i < MAX_OPEN_CHAT_KEY_ENVELOPES + 1; i++) {
      const r = await t.b.post('/v1/account/chat-keys', (await envelopeFor(await generateBoxKeyPair())).body);
      expect(r.statusCode, r.body).toBe(201);
      last = (r.json() as { id: string }).id;
    }
    const open = ((await t.b.get('/v1/account/chat-keys')).json() as Listed).envelopes.map((e) => e.id);
    expect(open).toHaveLength(MAX_OPEN_CHAT_KEY_ENVELOPES);
    expect(open).toContain(last);
    expect((await deps.db.query<{ n: number }>('select count(*)::int as n from chat_key_envelopes where account_id = $1', [t.accountId])).rows[0]!.n).toBe(MAX_OPEN_CHAT_KEY_ENVELOPES);
  });

  it("review F4: a constraint error on this table is a 500 whose log holds none of the row's bytes", async () => {
    const t = await passkeyTrader();
    const marker = 'c0ffee'.repeat(5) + 'ab';
    const before = logs.length;
    const res = await app.inject({ method: 'POST', url: '/t/envelope-check-fails', headers: { origin: ORIGIN }, payload: { accountId: t.accountId, marker } });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: 'internal' });
    const written = logs.slice(before).join('\n');
    expect(written).toContain('request failed');
    expect(written).not.toContain('c0ffee');
    expect(written).not.toContain(t.accountId);
    expect(written).not.toMatch(/Failing row|detail/i);
  });

  it('review F5: a retention job deletes expired envelopes, whoever they belong to; open ones stay', async () => {
    expect(RETENTION_JOBS).toContain(purgeChatKeyEnvelopes);
    const t = await passkeyTrader();
    const old = (await t.b.post('/v1/account/chat-keys', (await envelopeFor(await generateBoxKeyPair())).body)).json() as { id: string };
    setNow(new Date(now.getTime() + CHAT_KEY_ENVELOPE_TTL_MS - 1));
    const fresh = (await t.b.post('/v1/account/chat-keys', (await envelopeFor(await generateBoxKeyPair())).body)).json() as { id: string };
    setNow(new Date(now.getTime() + 1));
    expect(await purgeChatKeyEnvelopes.run(deps.db, now)).toBeGreaterThanOrEqual(1);
    const ids = (await deps.db.query<{ id: string }>('select id from chat_key_envelopes where account_id = $1', [t.accountId])).rows.map((r) => r.id);
    expect(ids).toEqual([fresh.id]);
    expect(ids).not.toContain(old.id);
  });

  it('review F6: posting and collecting are rate limited per account (429 slow-down)', async () => {
    const t = await passkeyTrader();
    let refused: LightMyRequestResponse | null = null;
    for (let i = 0; i < CHAT_KEY_POST_BUCKET.capacity + 1 && refused === null; i++) {
      const r = await t.b.post('/v1/account/chat-keys', (await envelopeFor(await generateBoxKeyPair())).body);
      if (r.statusCode !== 201) refused = r;
    }
    expect(refused?.statusCode).toBe(429);
    expect(refused?.json()).toMatchObject({ error: 'slow-down' });
    let gone: LightMyRequestResponse | null = null;
    for (let i = 0; i < CHAT_KEY_COLLECT_BUCKET.capacity + 1 && gone === null; i++) {
      const r = await t.b.delete(`/v1/account/chat-keys/${randomUUID()}`);
      if (r.statusCode !== 404) gone = r;
    }
    expect(gone?.statusCode).toBe(429);
    expect(gone?.json()).toMatchObject({ error: 'slow-down' });
  });

  it("the epoch must be the account's current one (0 until a rotation exists); the refusal names it", async () => {
    const t = await passkeyTrader();
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
    const t = await passkeyTrader();
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
  it('a team member never sees or posts envelopes; another account sees nothing and collects nothing', async () => {
    const t = await passkeyTrader();
    const device = await generateBoxKeyPair();
    const { id } = (await t.b.post('/v1/account/chat-keys', (await envelopeFor(device)).body)).json() as { id: string };

    // Another trader: their own list is empty and the id is not theirs.
    const other = await passkeyTrader();
    expect((await other.b.get('/v1/account/chat-keys')).json()).toEqual({ epoch: 0, envelopes: [] });
    expect((await other.b.delete(`/v1/account/chat-keys/${id}`)).statusCode).toBe(404);

    // A team member's session (two factors, a session of the team account): owner-only routes.
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

    expect((await deps.db.query('select collected_at from chat_key_envelopes where id = $1', [id])).rows).toEqual([{ collected_at: null }]);
  });

  it('logged out, there is no courier at all', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/account/chat-keys' });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ error: 'not-authenticated' });
    expect((await app.inject({ method: 'POST', url: '/v1/account/chat-keys', headers: { origin: ORIGIN }, payload: {} })).statusCode).toBe(401);
  });

  it('the routes are classified: own-data lists and live-session', () => {
    expect(OWN_DATA_READS['GET /v1/account/chat-keys']).toBeDefined();
    expect(OWN_DATA_WRITES['POST /v1/account/chat-keys']).toBeDefined();
    expect(OWN_DATA_WRITES['DELETE /v1/account/chat-keys/:id']).toBeDefined();
    for (const r of ['POST /v1/account/chat-keys', 'DELETE /v1/account/chat-keys/:id']) {
      expect(LIVE_SESSION_ROUTES, r).toContain(r);
    }
  });
});

describe('the table', () => {
  it('cascades with the account and refuses a key or a box of the wrong size', async () => {
    const t = await passkeyTrader();
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
