// Plan 4 Task 11: the moderation process's internal API. It listens only on a Unix socket; every
// request carries an HMAC over method, path, body and time (30 s); every call names the activity-log
// entry the API wrote for it, which must match, be fresh (60 s), be unused, and belong to a trade
// whose current dispute is not closed. Design build task 9 (landed): no chat or proof text passes
// through here. The moderator's read is the chat key re-wrapped to a certified staff device
// (`/internal/chat/grant`, grant.test.ts), and the moderator's message (`/internal/chat/send`) is
// ciphertext a certified staff device on the case sealed and countersigned (x2f/mod-countersign/v1),
// which this process only signs as the moderator. NEEDS_P5_PROOF_ENVELOPE: the unblurred proof's key
// re-wrap (design 2.4 step 5) is not built, so there is still no proof read.
import { createHmac, randomBytes } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newTradeCode } from '@x2f/core';
import { encryptChat, generateIdentity, makeModCountersign, newChatKey, openChat, ReplayGuard, type ChatEnvelopeV2, type Identity, type Participants } from '@x2f/protocol';
import sodium from 'libsodium-wrappers';
import { CHAT_MSG_TYPE, channelFor, MOD_INTERNAL_MAC_HEADER, MOD_INTERNAL_TS_HEADER } from '@x2f/trade';
import { deviceKeyIdOf, type DeviceCertificates, type StaffDirectory } from '../src/internal/grant.js';
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
  log = new Map<string, { id: string; at: Date; action: string; tradeCode: string | null; actorKind: string; actorId: string | null }>();
  disputes = new Map<string, string>();
  chats = new Map<string, string>();
  // One counter for the file: the moderation database (and its used entries) is shared by every test.
  private static next = 1;
  entry(action: string, code: string | null, at = NOW, actorId: string = STAFF): string {
    const id = String(FakeApi.next++);
    this.log.set(id, { id, at, action, tradeCode: code, actorKind: 'staff', actorId });
    return id;
  }
  async logEntry(id: string) {
    return this.log.get(id) ?? null;
  }
  async disputeStatus(code: string) {
    return this.disputes.get(code) ?? null;
  }
  async disputeAssignee() {
    return STAFF;
  }
  async chatOf(code: string) {
    return this.chats.get(code) ?? null;
  }
  async modGrant() {
    return null;
  }
}

/** The assigned moderator as the gate knows them, and their certified staff device. */
const STAFF = '00000000-0000-4000-8000-0000000000aa';
const OTHER = '00000000-0000-4000-8000-0000000000bb';
let DEVICE_ID: Identity;
let DEVICE: string;
beforeAll(async () => {
  await sodium.ready;
  DEVICE_ID = await generateIdentity();
  DEVICE = deviceKeyIdOf(sodium.from_hex(DEVICE_ID.signPublic));
});
const STAFF_DIR: StaffDirectory = { standing: async (id) => (id === STAFF || id === OTHER ? { kind: 'staff', role: 'mod' } : null) };
const DEVICES: DeviceCertificates = { device: async (who, key) => (who === STAFF && key === DEVICE ? { signPublic: DEVICE_ID.signPublic, boxPublic: DEVICE_ID.boxPublic } : null) };

interface Case {
  code: string;
  chat: string;
  channel: string;
  ids: Record<'buyer' | 'seller' | 'mod', Identity>;
  participants: Participants;
  /** The chat key as the traders and the staff device hold it (this process never needs it to send). */
  tk: Uint8Array;
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
  await db.query('insert into mod_dispute_seen (trade, first_seen_at, last_seen_at) values ($1, $2, $2)', [code, NOW]);
  api.disputes.set(code, status);
  api.chats.set(code, chat);
  return { code, chat, channel, ids, participants, tk: await newChatKey() };
}

/**
 * A countersigned moderator message as staff-web makes it: sealed under the chat key as `from:
 * 'mod'` at `seq`, countersigned by the certified device key. `o` overrides any wire field.
 */
async function sendBody(api: FakeApi, c: Case, seq: number, o: { text?: string; me?: Identity; issuedAt?: string; requestId?: string; logEntryId?: string; staff?: string } & Record<string, unknown> = {}) {
  const body = await encryptChat({ trade: c.channel, from: 'mod', seq, type: CHAT_MSG_TYPE, payload: { text: o.text ?? 'Moderator here.' }, tk: c.tk });
  const cs = await makeModCountersign({ body, requestId: o.requestId ?? randomBytes(16).toString('hex'), issuedAt: o.issuedAt ?? NOW.toISOString(), me: o.me ?? DEVICE_ID });
  const { text: _t, me: _m, issuedAt: _i, requestId: _r, logEntryId, staff, ...rest } = o;
  return {
    code: c.code, logEntryId: logEntryId ?? api.entry(REQUESTED, c.code), staffAccountId: staff ?? STAFF, deviceKeyId: DEVICE,
    seq, nonce: body.nonce, ct: body.ct, ctSha256: cs.ctSha256, requestId: cs.requestId, issuedAt: cs.issuedAt, sig: cs.sig, ...rest,
  };
}
/** The chat's next moderator seq as this process holds it. */
const nextSeq = async (chat: string) => Number((await db.query<{ n: string }>('select coalesce((select next_seq from mod_chat_seq where chat = $1), 0)::text as n', [chat])).rows[0]!.n);

const SEND = '/internal/chat/send';
/** The entry the API commits before it asks for a message (review 8 Nov M-2). */
const REQUESTED = 'chat.message-requested';
const OPENED = 'proof.unblurred-opened';
/**
 * The socket's group in these tests: this process's own (a deployment uses a dedicated one). Run as
 * root (gid 0, which startInternalServer rightly refuses), it is nogroup (65534) instead: root may
 * give a file any group, so the chown and the gid check below still run for real.
 */
const GID = process.getgid!() === 0 ? 65_534 : process.getgid!();

/** Production deps: the gate's staff directory and certified devices (stand-ins). */
function deps(api: ApiView, o: Partial<InternalDeps> = {}): InternalDeps {
  return { secret: SECRET, api, db, keystoreKey, now: () => NOW, staff: STAFF_DIR, devices: DEVICES, ...o };
}

/** A directory this process owns, mode 0750 (as /run/x2f-mod in a deployment). */
async function socketDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'x2f-mod-'));
  await chmod(dir, 0o750);
  return dir;
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
  const dir = await socketDir();
  const socket = join(dir, 'mod.sock');
  const srv = await startInternalServer({ path: socket, gid: GID }, d);
  try {
    return await send(socket, path, body, o);
  } finally {
    await srv.close();
    await rm(dir, { recursive: true, force: true });
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
    const d = deps(api);
    for (const o of [{ noMac: true }, { secret: new Uint8Array(randomBytes(32)) }, { tamper: true }, { ts: NOW.getTime() - 31_000 }, { ts: NOW.getTime() + 31_000 }]) {
      const res = await call(d, SEND, await sendBody(api, c, 0), o);
      expect({ o, status: res.status, error: res.json().error }).toEqual({ o, status: 401, error: 'unauthorized' });
    }
    expect((await call(d, SEND, await sendBody(api, c, 0), { ts: NOW.getTime() - 29_000 })).status).toBe(200);
  });

  it('answers only its two POST paths, with exactly their fields', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const d = deps(api);
    expect((await call(d, SEND, {}, { method: 'GET' })).status).toBe(404);
    expect((await call(d, '/internal/nothing', {})).status).toBe(404);
    const good = await sendBody(api, c, 0);
    expect((await call(d, SEND, { ...good, code: 'nope' })).status).toBe(400);
    expect((await call(d, SEND, { ...good, extra: 1 })).status).toBe(400);
    const { sig: _s, ...noSig } = good;
    expect((await call(d, SEND, noSig)).status).toBe(400);
    expect((await call(d, SEND, { ...good, seq: -1 })).status).toBe(400);
  });

  it('NEEDS_P5_PROOF_ENVELOPE: has no proof read, even for a signed call naming a fresh proof.unblurred-opened entry', async () => {
    // Review 8 Nov I-1: `/internal/proof/read` sent the unblurred image to the API. The design (2.4
    // step 5) re-wraps the proof key to the staff device key instead; that re-wrap is not built (no
    // proof.unblurred upload exists yet). Plan 5 must not wire a proof source into this process.
    const api = new FakeApi();
    const c = await disputedCase(api);
    const id = api.entry(OPENED, c.code);
    const res = await call(deps(api), '/internal/proof/read', { code: c.code, logEntryId: id });
    expect({ status: res.status, error: res.json().error }).toEqual({ status: 404, error: 'not-found' });
    expect((await db.query('select 1 from used_log_entries where id = $1', [id])).rows).toEqual([]);
    const src = await readFile(new URL('../src/internal/server.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/'\/internal\/proof\/read'|ProofSource|\.unblurred\(/);
  });

  it('landed (was NEEDS_P4_MOD_COUNTERSIGN): the message route is on in production and takes only a countersigned ciphertext, never text', async () => {
    // Review 8 Nov I-2: the old route sealed any text the API named. Now a plaintext body is refused
    // before anything is read, and there is no dev switch left.
    const api = new FakeApi();
    const c = await disputedCase(api);
    const id = api.entry(REQUESTED, c.code);
    const res = await call(deps(api), SEND, { code: c.code, logEntryId: id, text: 'Seller, release now.' });
    expect({ status: res.status, error: res.json().error }).toEqual({ status: 400, error: 'bad-request' });
    expect((await db.query('select 1 from used_log_entries where id = $1', [id])).rows).toEqual([]);
    const src = await readFile(new URL('../src/internal/server.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/devModChat|X2F_DEV_MOD_CHAT|NEEDS_P4_MOD_COUNTERSIGN|checkModText|\bseal\(/);
  });

  it('landed (was NEEDS_P4_CHAT_MEMBERSHIP): no chat read returns text; the read is the grant (a re-wrap), and this process never opens a chat', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const id = api.entry('chat.read', c.code);
    const res = await call(deps(api), '/internal/chat/read', { code: c.code, logEntryId: id });
    expect({ status: res.status, error: res.json().error }).toEqual({ status: 404, error: 'not-found' });
    expect((await db.query('select 1 from used_log_entries where id = $1', [id])).rows).toEqual([]);
    const src = await readFile(new URL('../src/internal/server.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/'\/internal\/chat\/read'|readChat|openChat|NEEDS_P4_CHAT_MEMBERSHIP/);
    expect(src).toMatch(/'\/internal\/chat\/grant'/);
  });

  it('listens on a Unix socket only: mode 0660, its own group, in a directory this process owns (review 8 Nov I-3)', async () => {
    const dir = await socketDir();
    const socket = join(dir, 'mod.sock');
    try {
      const srv = await startInternalServer({ path: socket, gid: GID }, deps(new FakeApi()));
      try {
        expect(srv.address).toBe(socket);
        const st = await stat(socket);
        expect(st.mode & 0o777).toBe(0o660);
        expect(st.gid).toBe(GID);
      } finally {
        await srv.close();
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
    const src = await readFile(new URL('../src/internal/server.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/listen\(\s*\{?\s*(port|host)/);
    expect(src).not.toMatch(/0o600/);
  });

  it('refuses a socket directory others may write to or enter, and a missing or root group', async () => {
    // A shared directory (/tmp) would let another user replace the socket; "other" access would let
    // anyone outside the group reach it.
    await expect(startInternalServer({ path: join(tmpdir(), `x2f-mod-${randomBytes(6).toString('hex')}.sock`), gid: GID }, deps(new FakeApi())))
      .rejects.toThrow('MOD_INTERNAL_SOCKET');
    for (const mode of [0o770, 0o755, 0o751]) {
      const dir = await socketDir();
      try {
        await chmod(dir, mode);
        await expect(startInternalServer({ path: join(dir, 'mod.sock'), gid: GID }, deps(new FakeApi())), mode.toString(8)).rejects.toThrow('MOD_INTERNAL_SOCKET');
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
    const dir = await socketDir();
    try {
      await mkdir(join(dir, 'sub'), { mode: 0o700 });
      for (const gid of [0, -1, 1.5, Number.NaN]) {
        await expect(startInternalServer({ path: join(dir, 'sub', 'mod.sock'), gid }, deps(new FakeApi())), String(gid)).rejects.toThrow('MOD_INTERNAL_SOCKET_GID');
      }
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('the log entry each call names', () => {
  it('refuses an entry that is used, older than 60 s, from another trade, of another action or person, or unknown', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const other = await disputedCase(api);
    const d = deps(api);
    const used = api.entry(REQUESTED, c.code);
    expect((await call(d, SEND, await sendBody(api, c, 0, { logEntryId: used }))).status).toBe(200);
    const cases = {
      used,
      old: api.entry(REQUESTED, c.code, new Date(NOW.getTime() - 61_000)),
      otherTrade: api.entry(REQUESTED, other.code),
      // The entry the API writes AFTER storing the envelope (M-2) never authorises a send.
      sent: api.entry('chat.message-sent', c.code),
      opened: api.entry(OPENED, c.code),
      chatRead: api.entry('chat.read', c.code),
      noTrade: api.entry(REQUESTED, null),
      otherPerson: api.entry(REQUESTED, c.code, NOW, OTHER),
      unknown: '999999',
    };
    for (const [why, id] of Object.entries(cases)) {
      const res = await call(d, SEND, await sendBody(api, c, 1, { logEntryId: id }));
      expect({ why, status: res.status, error: res.json().error }).toEqual({ why, status: 403, error: 'log-entry-invalid' });
    }
    // 59 s old is still fresh.
    expect((await call(d, SEND, await sendBody(api, c, 1, { logEntryId: api.entry(REQUESTED, c.code, new Date(NOW.getTime() - 59_000)) }))).status).toBe(200);
  });

  it('refuses a fresh entry when the trade has no dispute, or its dispute is closed', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const d = deps(api);
    api.disputes.delete(c.code);
    let res = await call(d, SEND, await sendBody(api, c, 0));
    expect({ status: res.status, error: res.json().error }).toEqual({ status: 403, error: 'not-disputed' });
    api.disputes.set(c.code, 'closed');
    res = await call(d, SEND, await sendBody(api, c, 0));
    expect({ status: res.status, error: res.json().error }).toEqual({ status: 403, error: 'not-disputed' });
    let seq = 0;
    for (const st of ['open', 'awaiting-approval', 'published', 'appealed', 'final', 'complying']) {
      api.disputes.set(c.code, st);
      expect((await call(d, SEND, await sendBody(api, c, seq++))).status, st).toBe(200);
    }
  });

  it('a refused call uses nothing: a chat this process never attested leaves the entry unused', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    api.chats.set(c.code, newTradeCode());
    const d = deps(api);
    const id = api.entry(REQUESTED, c.code);
    const res = await call(d, SEND, await sendBody(api, c, 0, { logEntryId: id }));
    expect({ status: res.status, error: res.json().error }).toEqual({ status: 404, error: 'no-chat' });
    expect((await db.query('select 1 from used_log_entries where id = $1', [id])).rows).toEqual([]);
  });
});

describe('the moderator\'s message: a countersign (build task 9, x2f/mod-countersign/v1)', () => {
  it('signs as the moderator what the staff device sealed: v2 envelopes both traders open under the chat key, with a rising seq, recorded as sends', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const d = deps(api);
    const envs: ChatEnvelopeV2[] = [];
    for (const [i, text] of ['First.', 'Second.'].entries()) {
      const res = await call(d, SEND, await sendBody(api, c, i, { text }));
      expect(res.status).toBe(200);
      envs.push(res.json().envelope as ChatEnvelopeV2);
    }
    expect(envs.map((e) => [e.v, e.from, e.trade, e.seq])).toEqual([[2, 'mod', c.channel, 0], [2, 'mod', c.channel, 1]]);
    const guard = new ReplayGuard(c.channel);
    const got = [];
    for (const e of envs) got.push(await openChat(e, { tk: c.tk, trade: c.channel, participants: c.participants, guard }));
    expect(got).toEqual([
      { from: 'mod', type: 'chat.msg', payload: { text: 'First.' } },
      { from: 'mod', type: 'chat.msg', payload: { text: 'Second.' } },
    ]);
    const { rows } = await db.query<{ action: string; staff_id: string; device_key_id: string }>('select action, staff_id::text, device_key_id from mod_chat_access where chat = $1 order by log_entry_id', [c.chat]);
    expect(rows).toEqual([0, 1].map(() => ({ action: 'send', staff_id: STAFF, device_key_id: DEVICE })));
  });

  it('refuses a countersign by any other key, for other words than the ciphertext sent, a used requestId, an issuedAt over 5 minutes old or a minute ahead, and a seq that is not next; nothing is taken', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const d = deps(api);
    const stranger = await generateIdentity();
    const ok = await sendBody(api, c, 0, { requestId: 'e'.repeat(32) });
    const otherWords = await sendBody(api, c, 0);
    const cases: Array<[string, Record<string, unknown>, number, string]> = [
      ['another key', await sendBody(api, c, 0, { me: stranger }), 400, 'bad-countersign'],
      ['ciphertext swapped after signing', { ...otherWords, ct: ok.ct, nonce: ok.nonce }, 400, 'bad-countersign'],
      ['too old', await sendBody(api, c, 0, { issuedAt: new Date(NOW.getTime() - 5 * 60_000 - 1).toISOString() }), 403, 'stale-countersign'],
      ['ahead', await sendBody(api, c, 0, { issuedAt: new Date(NOW.getTime() + 61_000).toISOString() }), 403, 'stale-countersign'],
      ['not the next seq', await sendBody(api, c, 3), 409, 'stale-seq'],
      ['someone not on the case', await sendBody(api, c, 0, { staff: OTHER, logEntryId: api.entry(REQUESTED, c.code, NOW, OTHER) }), 403, 'not-on-case'],
      ['a device key not certified to them', await sendBody(api, c, 0, { deviceKeyId: 'f'.repeat(32) }), 403, 'device-not-certified'],
    ];
    for (const [why, b, status, error] of cases) {
      const res = await call(d, SEND, b);
      expect({ why, status: res.status, error: res.json().error }, why).toEqual({ why, status, error });
      expect((await db.query('select 1 from used_log_entries where id = $1', [b.logEntryId])).rows, why).toEqual([]);
    }
    expect((await call(d, SEND, await sendBody(api, c, 3))).json().nextSeq).toBe(0);
    expect(await nextSeq(c.chat)).toBe(0);
    expect((await call(d, SEND, ok)).status).toBe(200);
    // The same requestId again, even in a fresh request for the next seq: refused, nothing taken.
    const again = await sendBody(api, c, 1, { requestId: 'e'.repeat(32) });
    const res = await call(d, SEND, again);
    expect({ status: res.status, error: res.json().error }).toEqual({ status: 403, error: 'replayed' });
    expect((await db.query('select 1 from used_log_entries where id = $1', [again.logEntryId])).rows).toEqual([]);
    expect(await nextSeq(c.chat)).toBe(1);
  });

  it('review N6: a countersign refused once it verified (a seq that is not next) is spent: shown again once the seq catches up, it is refused as replayed', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const d = deps(api);
    // Told a nextSeq one too high, the device sealed seq 1 while the chat is at 0.
    const early = await sendBody(api, c, 1, { text: 'Said once.' });
    const r1 = await call(d, SEND, early);
    expect({ status: r1.status, error: r1.json().error, nextSeq: r1.json().nextSeq }).toEqual({ status: 409, error: 'stale-seq', nextSeq: 0 });
    expect((await call(d, SEND, await sendBody(api, c, 0))).status).toBe(200);
    // The held countersign, with a fresh log entry, now that seq 1 is next: refused, nothing taken.
    const replay = { ...early, logEntryId: api.entry(REQUESTED, c.code) };
    const r2 = await call(d, SEND, replay);
    expect({ status: r2.status, error: r2.json().error }).toEqual({ status: 403, error: 'replayed' });
    expect((await db.query('select 1 from used_log_entries where id = $1', [replay.logEntryId])).rows).toEqual([]);
    expect(await nextSeq(c.chat)).toBe(1);
  });

  it('review N7: a nonce swapped after the device signed is refused (bad-countersign); nothing is signed or taken', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const d = deps(api);
    const a = await sendBody(api, c, 0);
    const other = await sendBody(api, c, 0);
    const swapped = { ...a, nonce: other.nonce };
    const res = await call(d, SEND, swapped);
    expect({ status: res.status, error: res.json().error }).toEqual({ status: 400, error: 'bad-countersign' });
    expect((await db.query('select 1 from used_log_entries where id = $1', [swapped.logEntryId])).rows).toEqual([]);
    expect(await nextSeq(c.chat)).toBe(0);
  });

  it('two identical sends at once: exactly one is signed', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const b = await sendBody(api, c, 0);
    const got = await Promise.all([call(deps(api), SEND, b), call(deps(api), SEND, b)]);
    expect(got.map((g) => g.status).sort()).toEqual([200, 403]);
    expect(await nextSeq(c.chat)).toBe(1);
  });

  it('with no gate, every send is refused before anything is read', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const d = deps(api);
    delete (d as { staff?: StaffDirectory }).staff;
    const b = await sendBody(api, c, 0);
    expect((await call(d, SEND, b)).json().error).toBe('gate-unavailable');
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
      const login = `modr_${randomBytes(4).toString('hex')}`;
      // One run of the API's migrations at a time on this cluster (their roles: apiSchema.ts).
      const { withApiSchemaLock } = await import('./apiSchema.js');
      await withApiSchemaLock(async () => {
        for (const f of (await readdir(dir)).filter((n) => /^\d{3}_[a-z0-9_]+\.sql$/.test(n)).sort()) {
          await owner.query(await readFile(new URL(f, dir), 'utf8'));
        }
        await owner.query(`create role ${login} login password '${pass}' in role x2f_mod_reader`);
      });
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
          await c.query('update disputes set assignee = $3 where code = $1 and seq = $2', [code, seq, seq === 2 ? u2 : u1]);
        }
        await c.query(`insert into chats (code, offer_id, buyer_account_id, seller_account_id, trade_code, created_at) values ($1, $2, $3, $4, $5, $6)`, [chat, u1, u1, u2, code, at]);
        await c.query(`insert into chat_envelopes (chat, sender_role, seq, envelope, created_at) values ($1, 'buyer', 0, '{"a":1}', $2), ($1, 'mod', 0, '{"b":2}', $2)`, [chat, at]);
        // Design build task 9 (migration 714): a moderator grant row, and a staff row with its own wrap.
        await c.query(
          `insert into chat_members (chat, member_kind, member_ref, box_public, wrap, tkh, trigger, granted_by, granted_at, sig, grant_at, statement)
           values ($1, 'mod', 'mod', $2, 'modwrap', $3, 'dispute', 'buyer', $4, $5, $4, '{"g":1}'),
                  ($1, 'staff', $6, $2, 'staffwrap', $3, 'assigned', 'mod', $4, '', null, null)`,
          [chat, 'a'.repeat(64), 'b'.repeat(64), at, 'c'.repeat(128), `${u1}/${'d'.repeat(32)}`],
        );
        // Review N11 (a), migration 716: the reader may see `statement` on every row, so a staff row never carries one.
        await expect(c.query(
          `insert into chat_members (chat, member_kind, member_ref, box_public, wrap, tkh, trigger, granted_by, granted_at, sig, grant_at, statement)
           values ($1, 'staff', $2, $3, 'staffwrap2', $4, 'assigned', 'mod', $5, '', null, '{"s":1}')`,
          [chat, `${u2}/${'e'.repeat(32)}`, 'a'.repeat(64), 'b'.repeat(64), at],
        )).rejects.toMatchObject({ code: '23514' });
      } finally {
        c.release();
      }

      const u = new URL(admin);
      reader = new pg.Pool({ connectionString: `postgres://${login}:${pass}@${u.host}/${name}`, max: 1 });
      const view = pgApiView(reader);
      expect(await view.logEntry('1')).toEqual({ id: '1', at: new Date(at), action: 'chat.read', tradeCode: code, actorKind: 'system', actorId: null });
      expect(await view.logEntry('2')).toBeNull();
      // The current dispute is the highest seq.
      expect(await view.disputeStatus(code)).toBe('appealed');
      expect(await view.disputeStatus(newTradeCode())).toBeNull();
      // Design task 9 groundwork (migration 710): the current dispute's assignee, nothing else new.
      expect(await view.disputeAssignee(code)).toBe('00000000-0000-4000-8000-000000000002');
      expect(await view.disputeAssignee(newTradeCode())).toBeNull();
      expect(await view.chatOf(code)).toBe(chat);
      expect(await view.chatOf(newTradeCode())).toBeNull();
      // Design build task 9: the moderator grant's signed statement, by side and signature, and nothing else of chat_members.
      expect(await view.modGrant(chat, 'buyer', 'c'.repeat(128))).toEqual({ g: 1 });
      expect(await view.modGrant(chat, 'seller', 'c'.repeat(128))).toBeNull();
      await expect(reader.query('select wrap from chat_members')).rejects.toMatchObject({ code: '42501' });
      await expect(reader.query('select member_ref from chat_members')).rejects.toMatchObject({ code: '42501' });
      // The chat is read only by re-wrap (staff-web decrypts): the reader never reads a chat's envelopes.
      await expect(reader.query('select envelope from chat_envelopes')).rejects.toMatchObject({ code: '42501' });
      // Nothing else is readable to the reader role.
      await expect(reader.query('select * from accounts')).rejects.toMatchObject({ code: '42501' });
      // Plan 4 Task 14 (migration 212, reviewed widening): the reader reads every column the log's
      // chain hashes, so this process recomputes the chain itself for its checkpoints. The log holds
      // ids, enums, codes and amounts only (Task 3). It still writes nothing.
      await expect(reader.query('select detail, prev_hash, hash from activity_log')).resolves.toBeDefined();
      await expect(reader.query("update activity_log set detail = '{}'")).rejects.toMatchObject({ code: '42501' });
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
    const base = { MOD_INTERNAL_SOCKET: '/run/x2f-mod/mod.sock', MOD_INTERNAL_SOCKET_GID: '991', MOD_INTERNAL_SECRET: secret, MOD_API_READER_DATABASE_URL: 'postgres://r@db/x2f' };
    expect(internalFromEnv(base)).toEqual({ socketPath: '/run/x2f-mod/mod.sock', gid: 991, secret: SECRET, apiReaderUrl: 'postgres://r@db/x2f' });
    for (const [env, name] of [
      [{ ...base, MOD_INTERNAL_SOCKET: 'mod.sock' }, 'MOD_INTERNAL_SOCKET'],
      [{ ...base, MOD_INTERNAL_SECRET: undefined }, 'MOD_INTERNAL_SECRET'],
      [{ ...base, MOD_INTERNAL_SECRET: 'c2hvcnQ=' }, 'MOD_INTERNAL_SECRET'],
      [{ ...base, MOD_API_READER_DATABASE_URL: undefined }, 'MOD_API_READER_DATABASE_URL'],
      // Review 8 Nov I-3: a dedicated group, never root's and never left out.
      [{ ...base, MOD_INTERNAL_SOCKET_GID: undefined }, 'MOD_INTERNAL_SOCKET_GID'],
      [{ ...base, MOD_INTERNAL_SOCKET_GID: '0' }, 'MOD_INTERNAL_SOCKET_GID'],
      [{ ...base, MOD_INTERNAL_SOCKET_GID: 'x2f-mod' }, 'MOD_INTERNAL_SOCKET_GID'],
      [{ ...base, MOD_INTERNAL_SOCKET_GID: '-5' }, 'MOD_INTERNAL_SOCKET_GID'],
    ] as const) {
      expect(() => internalFromEnv(env)).toThrow(name);
    }
  });

  it('landed (was NEEDS_P4_MOD_COUNTERSIGN): the dev switch X2F_DEV_MOD_CHAT is gone, and a stale one is refused, never silently ignored', async () => {
    const { internalFromEnv } = await import('../src/main.js');
    const base = { MOD_INTERNAL_SOCKET: '/run/x2f-mod/mod.sock', MOD_INTERNAL_SOCKET_GID: '991', MOD_INTERNAL_SECRET: Buffer.from(SECRET).toString('base64'), MOD_API_READER_DATABASE_URL: 'x' };
    for (const v of ['1', 'true']) for (const ne of ['test', 'development', 'production']) expect(() => internalFromEnv({ ...base, X2F_DEV_MOD_CHAT: v, NODE_ENV: ne })).toThrow('X2F_DEV_MOD_CHAT');
    expect(internalFromEnv({ ...base, X2F_DEV_MOD_CHAT: '' })).not.toBeNull();
    const src = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
    expect(src).not.toMatch(/devModChat|NEEDS_P4_MOD_COUNTERSIGN/);
  });
});
