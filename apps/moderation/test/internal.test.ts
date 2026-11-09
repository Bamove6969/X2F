// Plan 4 Task 11: the moderation process's internal API. It listens only on a Unix socket; every
// request carries an HMAC over method, path, body and time (30 s); every call names the activity-log
// entry the API wrote for it, which must match, be fresh (60 s), be unused, and belong to a trade
// whose current dispute is not closed. The unblurred proof leaves this process only through those
// calls. NEEDS_P4_CHAT_MEMBERSHIP: there is no chat read here (no `/internal/chat/read`): the
// moderator's read path waits for the per-trade key-membership design (owner p11-2,
// design-chat-membership-keys-2026-11-08), which replaces handing plaintext to the API.
import { createHmac, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newTradeCode } from '@x2f/core';
import { generateIdentity, open, ReplayGuard, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import { channelFor, MOD_INTERNAL_MAC_HEADER, MOD_INTERNAL_TS_HEADER } from '@x2f/trade';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { saveChatIdentity } from '../src/keystore.js';
import { pgApiView } from '../src/internal/apiView.js';
import { internalHandler, startInternalServer, type ApiView, type InternalDeps } from '../src/internal/server.js';
import { MOD_TEMPLATE_DB } from './setup/postgres.js';

const NOW = new Date('2026-11-02T12:00:00Z');
const SECRET = new Uint8Array(randomBytes(32));

let db: pg.Pool;
let keystoreKey: Uint8Array;
let admin: string;

async function newDb(template?: string): Promise<string> {
  const name = `x2f_mod_i_${randomBytes(8).toString('hex')}`;
  const c = new pg.Client({ connectionString: `${inject('modPgUrl')}/postgres` });
  await c.connect();
  try {
    await c.query(`create database ${name}${template ? ` template ${template}` : ''}`);
  } finally {
    await c.end();
  }
  return name;
}

beforeAll(async () => {
  admin = inject('modPgUrl');
  db = new pg.Pool({ connectionString: `${admin}/${await newDb(MOD_TEMPLATE_DB)}`, max: 4 });
  keystoreKey = new Uint8Array(randomBytes(32));
});
afterAll(async () => {
  await db.end();
});

/** The API's tables as the moderation process reads them, in memory. */
class FakeApi implements ApiView {
  log = new Map<string, { id: string; at: Date; action: string; tradeCode: string | null }>();
  disputes = new Map<string, string>();
  chats = new Map<string, string>();
  // One counter for the file: the moderation database (and its used entries) is shared by every test.
  private static next = 1;
  entry(action: string, code: string | null, at = NOW): string {
    const id = String(FakeApi.next++);
    this.log.set(id, { id, at, action, tradeCode: code });
    return id;
  }
  async logEntry(id: string) {
    return this.log.get(id) ?? null;
  }
  async disputeStatus(code: string) {
    return this.disputes.get(code) ?? null;
  }
  async chatOf(code: string) {
    return this.chats.get(code) ?? null;
  }
}

interface Case {
  code: string;
  chat: string;
  channel: string;
  ids: Record<'buyer' | 'seller' | 'mod', Identity>;
  participants: Participants;
}

/** A disputed trade with its chat attested by this process (identity sealed, signed_chats row). */
async function disputedCase(api: FakeApi, status = 'open'): Promise<Case> {
  const code = newTradeCode();
  const chat = newTradeCode();
  const ids = { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
  const participants = Object.fromEntries((['buyer', 'seller', 'mod'] as const).map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
  const channel = await channelFor(chat, 'chat');
  await saveChatIdentity(db, keystoreKey, chat, ids.mod);
  await db.query('insert into signed_chats (chat, attestation, sig) values ($1, $2, $3)', [
    chat, { v: 1, trade: chat, channels: { chat: channel }, participants, issuedAt: NOW.toISOString() }, 'aa',
  ]);
  api.disputes.set(code, status);
  api.chats.set(code, chat);
  return { code, chat, channel, ids, participants };
}

/** A proof source that has a proof for every trade, so an accepted proof read answers 200. */
const PROOFS = { unblurred: async () => ({ mime: 'image/png' as const, bytes: new Uint8Array([1, 2, 3]) }) };
const PROOF = '/internal/proof/read';
const OPENED = 'proof.unblurred-opened';

function deps(api: ApiView, o: Partial<InternalDeps> = {}): InternalDeps {
  return { secret: SECRET, api, db, keystoreKey, now: () => NOW, proofs: PROOFS, ...o };
}

const mac = (secret: Uint8Array, method: string, path: string, body: string, ts: string) =>
  // The documented format, spelled out here on purpose (the API's client test spells out the same).
  createHmac('sha256', secret).update(`x2f/mod-internal/v1\0${method}\0${path}\0${body}\0${ts}`, 'utf8').digest('hex');

interface Answer {
  status: number;
  type: string | undefined;
  body: Buffer;
  json(): Record<string, unknown>;
}

/** One request to the handler through a real HTTP server on a Unix socket. */
async function call(
  d: InternalDeps,
  path: string,
  body: unknown,
  o: { ts?: number; secret?: Uint8Array; method?: string; noMac?: boolean; tamper?: boolean } = {},
): Promise<Answer> {
  const socket = join(tmpdir(), `x2f-mod-${randomBytes(6).toString('hex')}.sock`);
  const srv = await startInternalServer(socket, d);
  try {
    return await send(socket, path, body, o);
  } finally {
    await srv.close();
  }
}

function send(socket: string, path: string, body: unknown, o: { ts?: number; secret?: Uint8Array; method?: string; noMac?: boolean; tamper?: boolean } = {}): Promise<Answer> {
  const text = JSON.stringify(body);
  const method = o.method ?? 'POST';
  const ts = String(o.ts ?? NOW.getTime());
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (!o.noMac) {
    headers[MOD_INTERNAL_MAC_HEADER] = mac(o.secret ?? SECRET, method, path, o.tamper ? `${text} ` : text, ts);
    headers[MOD_INTERNAL_TS_HEADER] = ts;
  }
  return new Promise((resolve, reject) => {
    const req = request({ socketPath: socket, path, method, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        const b = Buffer.concat(chunks);
        resolve({ status: res.statusCode ?? 0, type: res.headers['content-type'], body: b, json: () => JSON.parse(b.toString('utf8')) as Record<string, unknown> });
      });
    });
    req.on('error', reject);
    req.end(text);
  });
}

describe('authentication', () => {
  it('refuses a missing or wrong HMAC, a changed body, and a time more than 30 s off, with 401', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const body = () => ({ code: c.code, logEntryId: api.entry(OPENED, c.code) });
    const d = deps(api);
    for (const o of [{ noMac: true }, { secret: new Uint8Array(randomBytes(32)) }, { tamper: true }, { ts: NOW.getTime() - 31_000 }, { ts: NOW.getTime() + 31_000 }]) {
      const res = await call(d, PROOF, body(), o);
      expect({ o, status: res.status, error: res.json().error }).toEqual({ o, status: 401, error: 'unauthorized' });
    }
    expect((await call(d, PROOF, body(), { ts: NOW.getTime() - 29_000 })).status).toBe(200);
  });

  it('answers only its two POST paths', async () => {
    const api = new FakeApi();
    const d = deps(api);
    expect((await call(d, PROOF, {}, { method: 'GET' })).status).toBe(404);
    expect((await call(d, '/internal/nothing', {})).status).toBe(404);
    expect((await call(d, PROOF, { code: 'nope', logEntryId: '1' })).status).toBe(400);
    expect((await call(d, PROOF, { code: newTradeCode(), logEntryId: '1', extra: 1 })).status).toBe(400);
  });

  it('NEEDS_P4_CHAT_MEMBERSHIP: has no chat read, even for a signed call naming a fresh chat.read entry', async () => {
    // The moderator's chat read is NOT built: the key-membership design (owner p11-2) replaces
    // this process opening the chat and handing plaintext to the API. Build it from that design
    // (design-chat-membership-keys-2026-11-08 in the comms folder), then replace this test.
    const api = new FakeApi();
    const c = await disputedCase(api);
    const d = deps(api);
    const id = api.entry('chat.read', c.code);
    const res = await call(d, '/internal/chat/read', { code: c.code, logEntryId: id });
    expect({ status: res.status, error: res.json().error }).toEqual({ status: 404, error: 'not-found' });
    // Nothing was used up.
    expect((await db.query('select 1 from used_log_entries where id = $1', [id])).rows).toEqual([]);
    const src = await readFile(new URL('../src/internal/server.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/'\/internal\/chat\/read'|readChat|envelopes\(/);
    const chatSrc = await readFile(new URL('../src/internal/chat.ts', import.meta.url), 'utf8');
    expect(chatSrc).not.toMatch(/\bopen\(/);
  });

  it('listens on a Unix socket only, readable by its owner only', async () => {
    const socket = join(tmpdir(), `x2f-mod-${randomBytes(6).toString('hex')}.sock`);
    const srv = await startInternalServer(socket, deps(new FakeApi()));
    try {
      expect(srv.address).toBe(socket);
      expect((await stat(socket)).mode & 0o777).toBe(0o600);
    } finally {
      await srv.close();
    }
    const src = await readFile(new URL('../src/internal/server.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/listen\(\s*\{?\s*(port|host)/);
  });
});

describe('the log entry each call names', () => {
  it('refuses an entry that is used, older than 60 s, from another trade, of another action, or unknown', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const other = await disputedCase(api);
    const d = deps(api);
    const used = api.entry(OPENED, c.code);
    expect((await call(d, PROOF, { code: c.code, logEntryId: used })).status).toBe(200);
    const cases = {
      used,
      old: api.entry(OPENED, c.code, new Date(NOW.getTime() - 61_000)),
      otherTrade: api.entry(OPENED, other.code),
      otherAction: api.entry('chat.message-sent', c.code),
      chatRead: api.entry('chat.read', c.code),
      noTrade: api.entry(OPENED, null),
      unknown: '999999',
    };
    for (const [why, id] of Object.entries(cases)) {
      const res = await call(d, PROOF, { code: c.code, logEntryId: id });
      expect({ why, status: res.status, error: res.json().error }).toEqual({ why, status: 403, error: 'log-entry-invalid' });
    }
    // 59 s old is still fresh.
    expect((await call(d, PROOF, { code: c.code, logEntryId: api.entry(OPENED, c.code, new Date(NOW.getTime() - 59_000)) })).status).toBe(200);
    // Each path takes its own action only.
    for (const action of [OPENED, 'chat.read']) {
      const res = await call(d, '/internal/chat/send', { code: c.code, logEntryId: api.entry(action, c.code), text: 'Hi' });
      expect(res.json().error).toBe('log-entry-invalid');
    }
  });

  it('refuses a fresh entry when the trade has no dispute, or its dispute is closed', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const d = deps(api);
    api.disputes.delete(c.code);
    let res = await call(d, PROOF, { code: c.code, logEntryId: api.entry(OPENED, c.code) });
    expect({ status: res.status, error: res.json().error }).toEqual({ status: 403, error: 'log-entry-invalid' });
    api.disputes.set(c.code, 'closed');
    res = await call(d, PROOF, { code: c.code, logEntryId: api.entry(OPENED, c.code) });
    expect({ status: res.status, error: res.json().error }).toEqual({ status: 403, error: 'log-entry-invalid' });
    for (const s of ['open', 'awaiting-approval', 'published', 'appealed', 'final', 'complying']) {
      api.disputes.set(c.code, s);
      expect((await call(d, PROOF, { code: c.code, logEntryId: api.entry(OPENED, c.code) })).status, s).toBe(200);
    }
  });

  it('a refused call does not use up its entry; an accepted one does, even when it then finds no chat', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    api.chats.delete(c.code);
    const d = deps(api);
    const id = api.entry('chat.message-sent', c.code);
    const res = await call(d, '/internal/chat/send', { code: c.code, logEntryId: id, text: 'Hi' });
    expect({ status: res.status, error: res.json().error }).toEqual({ status: 404, error: 'no-chat' });
    expect((await call(d, '/internal/chat/send', { code: c.code, logEntryId: id, text: 'Hi' })).json().error).toBe('log-entry-invalid');
  });
});

describe('the moderator\'s message', () => {
  it('sends as the moderator: one envelope that opens for buyer and seller, with a rising seq', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const d = deps(api);
    const envs: Envelope[] = [];
    for (const text of ['First.', 'Second.']) {
      const res = await call(d, '/internal/chat/send', { code: c.code, logEntryId: api.entry('chat.message-sent', c.code), text });
      expect(res.status).toBe(200);
      envs.push(res.json().envelope as Envelope);
    }
    expect(envs.map((e) => [e.from, e.trade, e.seq])).toEqual([['mod', c.channel, 0], ['mod', c.channel, 1]]);
    for (const role of ['buyer', 'seller'] as const) {
      const guard = new ReplayGuard(c.channel);
      const got = [];
      for (const e of envs) got.push(await open(e, { me: c.ids[role], myRole: role, participants: c.participants, trade: c.channel, guard }));
      expect(got).toEqual([
        { from: 'mod', type: 'chat.msg', payload: { text: 'First.' } },
        { from: 'mod', type: 'chat.msg', payload: { text: 'Second.' } },
      ]);
    }
  });

  it('refuses a bad text, and a chat this process never attested', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const d = deps(api);
    for (const b of [{ text: '' }, { text: '  ' }, { text: 'x'.repeat(2001) }, { text: 'é'.repeat(1001) }, { text: 5 }, { text: 'bell\u0007' }]) {
      const res = await call(d, '/internal/chat/send', { code: c.code, logEntryId: api.entry('chat.message-sent', c.code), ...b });
      expect(res.status, JSON.stringify(b)).toBe(400);
    }
    const unattested = newTradeCode();
    api.disputes.set(unattested, 'open');
    api.chats.set(unattested, newTradeCode());
    const res = await call(d, '/internal/chat/send', { code: unattested, logEntryId: api.entry('chat.message-sent', unattested), text: 'Hi' });
    expect({ status: res.status, error: res.json().error }).toEqual({ status: 404, error: 'no-chat' });
  });
});

describe('the unblurred proof', () => {
  // NEEDS_P5_PROOF_ENVELOPE: the proof package (Plan 5: `proof.unblurred` sealed to the mod only,
  // PROOF_RECIPIENTS / sealProofEnvelope) is not on this branch; the reader is a seam until then.
  it('answers no-proof when the source has none, and the bytes with their type from one', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    let res = await call(deps(api, { proofs: { unblurred: async () => null } }), '/internal/proof/read', { code: c.code, logEntryId: api.entry('proof.unblurred-opened', c.code) });
    expect({ status: res.status, error: res.json().error }).toEqual({ status: 404, error: 'no-proof' });
    const proofs = { unblurred: async (code: string) => (code === c.code ? { mime: 'image/png' as const, bytes: new Uint8Array([1, 2, 3]) } : null) };
    res = await call(deps(api, { proofs }), '/internal/proof/read', { code: c.code, logEntryId: api.entry('proof.unblurred-opened', c.code) });
    expect(res.status).toBe(200);
    expect(res.type).toBe('image/png');
    expect([...res.body]).toEqual([1, 2, 3]);
  });
});

describe('pgApiView on the API schema (x2f_mod_reader only)', () => {
  it('reads the log entry, the current dispute and the trade chat, and never an envelope', async () => {
    // The API's real schema: its migrations, in name order, as `migrate()` applies them.
    const name = await newDb();
    const owner = new pg.Pool({ connectionString: `${admin}/${name}`, max: 1 });
    const pass = randomBytes(12).toString('hex');
    let reader: pg.Pool | null = null;
    try {
      const dir = new URL('../../api/migrations/', import.meta.url);
      const { readdir } = await import('node:fs/promises');
      for (const f of (await readdir(dir)).filter((n) => /^\d{3}_[a-z0-9_]+\.sql$/.test(n)).sort()) {
        await owner.query(await readFile(new URL(f, dir), 'utf8'));
      }
      const login = `modr_${randomBytes(4).toString('hex')}`;
      await owner.query(`create role ${login} login password '${pass}' in role x2f_mod_reader`);
      const code = newTradeCode();
      const chat = newTradeCode();
      const at = '2026-11-02T12:00:00.000Z';
      // The rows the view reads, written directly as the owner (foreign keys off: the API's own
      // tests cover how they get there). The log row passes the chain trigger.
      await owner.query(
        `insert into activity_log (id, at, actor_kind, trade_code, action, detail, prev_hash, hash)
         values (1, $1, 'system', $2, 'chat.read', '{}', null, sha256(convert_to('1|' || $3 || '|system|||' || $2 || '|chat.read|{}', 'UTF8')))`,
        [at, code, at],
      );
      const c = await owner.connect();
      try {
        await c.query(`set session_replication_role = replica`);
        const u1 = '00000000-0000-4000-8000-000000000001';
        const u2 = '00000000-0000-4000-8000-000000000002';
        for (const [seq, status] of [[1, 'closed'], [2, 'appealed']] as const) {
          await c.query(
            `insert into disputes (code, seq, opened_by, reason, note, opened_at, after_refund, status, closed_at, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents)
             values ($1, $2, 'buyer', 'paid', '', $3, false, $4, $5, $3, $3, 0, 100000)`,
            [code, seq, at, status, status === 'closed' ? at : null],
          );
        }
        await c.query(`insert into chats (code, offer_id, buyer_account_id, seller_account_id, trade_code, created_at) values ($1, $2, $3, $4, $5, $6)`, [chat, u1, u1, u2, code, at]);
        await c.query(`insert into chat_envelopes (chat, sender_role, seq, envelope, created_at) values ($1, 'buyer', 0, '{"a":1}', $2), ($1, 'mod', 0, '{"b":2}', $2)`, [chat, at]);
      } finally {
        c.release();
      }

      const u = new URL(admin);
      reader = new pg.Pool({ connectionString: `postgres://${login}:${pass}@${u.host}/${name}`, max: 1 });
      const view = pgApiView(reader);
      expect(await view.logEntry('1')).toEqual({ id: '1', at: new Date(at), action: 'chat.read', tradeCode: code });
      expect(await view.logEntry('2')).toBeNull();
      // The current dispute is the highest seq.
      expect(await view.disputeStatus(code)).toBe('appealed');
      expect(await view.disputeStatus(newTradeCode())).toBeNull();
      expect(await view.chatOf(code)).toBe(chat);
      expect(await view.chatOf(newTradeCode())).toBeNull();
      // NEEDS_P4_CHAT_MEMBERSHIP: no chat read yet, so the reader cannot read a chat's envelopes.
      await expect(reader.query('select envelope from chat_envelopes')).rejects.toMatchObject({ code: '42501' });
      // Nothing else is readable to the reader role.
      await expect(reader.query('select * from accounts')).rejects.toMatchObject({ code: '42501' });
      await expect(reader.query('select detail from activity_log')).rejects.toMatchObject({ code: '42501' });
      await expect(reader.query('select note from disputes')).rejects.toMatchObject({ code: '42501' });
      await expect(reader.query(`insert into chat_envelopes (chat, sender_role, seq, envelope, created_at) values ('x', 'mod', 0, '{}', now())`)).rejects.toMatchObject({ code: '42501' });
    } finally {
      await reader?.end();
      await owner.end();
    }
  });
});

describe('internalFromEnv', () => {
  it('starts nothing without MOD_INTERNAL_SOCKET; with it, needs the secret and the reader URL', async () => {
    const { internalFromEnv } = await import('../src/main.js');
    expect(internalFromEnv({})).toBeNull();
    const secret = Buffer.from(SECRET).toString('base64');
    const ok = internalFromEnv({ MOD_INTERNAL_SOCKET: '/run/x2f/mod.sock', MOD_INTERNAL_SECRET: secret, MOD_API_READER_DATABASE_URL: 'postgres://r@db/x2f' });
    expect(ok).toEqual({ socketPath: '/run/x2f/mod.sock', secret: SECRET, apiReaderUrl: 'postgres://r@db/x2f' });
    for (const [env, name] of [
      [{ MOD_INTERNAL_SOCKET: 'mod.sock', MOD_INTERNAL_SECRET: secret, MOD_API_READER_DATABASE_URL: 'x' }, 'MOD_INTERNAL_SOCKET'],
      [{ MOD_INTERNAL_SOCKET: '/run/x2f/mod.sock', MOD_API_READER_DATABASE_URL: 'x' }, 'MOD_INTERNAL_SECRET'],
      [{ MOD_INTERNAL_SOCKET: '/run/x2f/mod.sock', MOD_INTERNAL_SECRET: 'c2hvcnQ=', MOD_API_READER_DATABASE_URL: 'x' }, 'MOD_INTERNAL_SECRET'],
      [{ MOD_INTERNAL_SOCKET: '/run/x2f/mod.sock', MOD_INTERNAL_SECRET: secret }, 'MOD_API_READER_DATABASE_URL'],
    ] as const) {
      expect(() => internalFromEnv(env)).toThrow(name);
    }
  });
});
