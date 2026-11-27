// Owner 27 Nov (docs/security/private-mod-chat-2026-11-27.md): private moderator lanes, the
// moderation side. `/internal/chat/grant` makes both lanes of a chat on its first grant (PK random,
// sealed here under MOD_KEYSTORE_KEY, a lane record signed with the chat's moderator identity against
// the attested traders) and answers each lane's PK re-wrapped to the certified staff device;
// `/internal/chat/send` with `to` signs, as the moderator, a v3 lane envelope a staff device sealed
// under that lane's PK and countersigned for exactly that lane, with a seq per lane. Without `to`,
// the shared chat as before (internal.test.ts holds the rest of that route).
import { createHmac, randomBytes } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newTradeCode } from '@x2f/core';
import {
  encryptChat,
  encryptPrivate,
  generateIdentity,
  makeChatGrant,
  makeModCountersign,
  makeModPrivateCountersign,
  newChatKey,
  openChat,
  openPrivate,
  openPrivateLaneRecord,
  ReplayGuard,
  unwrapPrivateKey,
  verifyPrivateLaneRecord,
  type ChatEnvelopeV3,
  type Identity,
  type Lane,
  type Participants,
  type PrivateLaneRecord,
} from '@x2f/protocol';
import sodium from 'libsodium-wrappers';
import { CHAT_MSG_TYPE, channelFor, MOD_INTERNAL_MAC_HEADER, MOD_INTERNAL_TS_HEADER } from '@x2f/trade';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { saveChatIdentity } from '../src/keystore.js';
import { deviceKeyIdOf, type DeviceCertificates, type StaffDirectory } from '../src/internal/grant.js';
import { startInternalServer, type ApiView, type InternalDeps } from '../src/internal/server.js';
import { MOD_TEMPLATE_DB } from './setup/postgres.js';

const NOW = new Date('2026-11-27T12:00:00Z');
const SECRET = new Uint8Array(randomBytes(32));
const GRANT = '/internal/chat/grant';
const SEND = '/internal/chat/send';
const REQUESTED = 'chat.message-requested';
const GID = process.getgid!() === 0 ? 65_534 : process.getgid!();
const STAFF = '00000000-0000-4000-8000-0000000000aa';

let db: pg.Pool;
let keystoreKey: Uint8Array;
let DEVICE_ID: Identity;
let DEVICE: string;

beforeAll(async () => {
  const admin = inject('modPgUrl');
  const name = `x2f_mod_l_${randomBytes(8).toString('hex')}`;
  const c = new pg.Client({ connectionString: `${admin}/postgres` });
  await c.connect();
  try {
    await c.query(`create database ${name} template ${MOD_TEMPLATE_DB}`);
  } finally {
    await c.end();
  }
  db = new pg.Pool({ connectionString: `${admin}/${name}`, max: 6 });
  keystoreKey = new Uint8Array(randomBytes(32));
  await sodium.ready;
  DEVICE_ID = await generateIdentity();
  DEVICE = deviceKeyIdOf(sodium.from_hex(DEVICE_ID.signPublic));
});
afterAll(async () => {
  await db.end();
});

class FakeApi implements ApiView {
  log = new Map<string, { id: string; at: Date; action: string; tradeCode: string | null; actorKind: string; actorId: string | null }>();
  disputes = new Map<string, string>();
  chats = new Map<string, string>();
  grants = new Map<string, unknown>();
  private static next = 1;
  entry(action: string, code: string): string {
    const id = String(FakeApi.next++);
    this.log.set(id, { id, at: NOW, action, tradeCode: code, actorKind: 'staff', actorId: STAFF });
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
  async modGrant(chat: string, by: string, sig: string) {
    return this.grants.get(`${chat}/${by}/${sig}`) ?? null;
  }
}

const STAFF_DIR: StaffDirectory = { standing: async (id) => (id === STAFF ? { kind: 'staff', role: 'mod' } : null) };
const DEVICES: DeviceCertificates = { device: async (who, key) => (who === STAFF && key === DEVICE ? { signPublic: DEVICE_ID.signPublic, boxPublic: DEVICE_ID.boxPublic } : null) };
const deps = (api: ApiView): InternalDeps => ({ secret: SECRET, api, db, keystoreKey, now: () => NOW, staff: STAFF_DIR, devices: DEVICES });

interface Case {
  code: string;
  chat: string;
  channel: string;
  ids: Record<'buyer' | 'seller' | 'mod', Identity>;
  participants: Participants;
  tk: Uint8Array;
}

/** A disputed trade, its chat attested here, and the buyer's dispute grant accepted (task 6) and filed. */
async function disputedCase(api: FakeApi): Promise<Case> {
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
  api.disputes.set(code, 'open');
  api.chats.set(code, chat);
  const tk = await newChatKey();
  const g = await makeChatGrant({ chat: channel, by: 'buyer', tk, disputeAt: NOW.toISOString(), me: ids.buyer, participants });
  await db.query('insert into mod_chat_grants (chat, grant_by, grant_sig, tkh, accepted_at) values ($1, $2, $3, $4, $5)', [chat, 'buyer', g.sig, g.tkh, NOW]);
  api.grants.set(`${chat}/buyer/${g.sig}`, g);
  return { code, chat, channel, ids, participants, tk };
}

const mac = (path: string, body: string, ts: string) =>
  createHmac('sha256', SECRET).update(`x2f/mod-internal/v1\0POST\0${path}\0${body}\0${ts}`, 'utf8').digest('hex');

async function call(d: InternalDeps, path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const dir = await mkdtemp(join(tmpdir(), 'x2f-mod-'));
  await chmod(dir, 0o750);
  const socket = join(dir, 'mod.sock');
  const srv = await startInternalServer({ path: socket, gid: GID }, d);
  try {
    const text = JSON.stringify(body);
    const ts = String(NOW.getTime());
    const headers = { 'content-type': 'application/json', [MOD_INTERNAL_MAC_HEADER]: mac(path, text, ts), [MOD_INTERNAL_TS_HEADER]: ts };
    return await new Promise((resolve, reject) => {
      const req = request({ socketPath: socket, path, method: 'POST', headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, json: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown> }));
      });
      req.on('error', reject);
      req.end(text);
    });
  } finally {
    await srv.close();
    await rm(dir, { recursive: true, force: true });
  }
}

interface LaneAnswer {
  to: Lane;
  pkh: string;
  wrap: string;
  nextSeq: number;
  record: PrivateLaneRecord;
}

async function grant(api: FakeApi, c: Case) {
  const res = await call(deps(api), GRANT, { code: c.code, logEntryId: api.entry('chat.read', c.code), staffAccountId: STAFF, deviceKeyId: DEVICE });
  expect(res.status, JSON.stringify(res.json)).toBe(200);
  return res.json as { wrap: string; tkh: string; boxPublic: string; nextSeq: number; lanes: LaneAnswer[] };
}

/** The lane keys as the staff device opens them from a grant (pkh-pinned). */
async function laneKeys(api: FakeApi, c: Case): Promise<Record<Lane, Uint8Array>> {
  const g = await grant(api, c);
  const out = {} as Record<Lane, Uint8Array>;
  for (const l of g.lanes) out[l.to] = await unwrapPrivateKey(DEVICE_ID, l.wrap, l.pkh);
  return out;
}

/**
 * A countersigned moderator lane message as staff-web makes it: sealed under `pk` as `from: 'mod'`
 * in lane `lane` at `seq`, countersigned for that lane by the certified device key; sent with `to`
 * (default: the lane it was sealed for). `o` overrides any wire field.
 */
async function laneBody(api: FakeApi, c: Case, pk: Uint8Array, lane: Lane, seq: number, o: { text?: string; to?: unknown } & Record<string, unknown> = {}) {
  const body = await encryptPrivate({ trade: c.channel, from: 'mod', to: lane, seq, type: CHAT_MSG_TYPE, payload: { text: o.text ?? 'Only you.' }, pk });
  const cs = await makeModPrivateCountersign({ body, requestId: randomBytes(16).toString('hex'), issuedAt: NOW.toISOString(), me: DEVICE_ID });
  const { text: _t, ...rest } = o;
  return {
    code: c.code, logEntryId: api.entry(REQUESTED, c.code), staffAccountId: STAFF, deviceKeyId: DEVICE,
    to: lane, seq, nonce: body.nonce, ct: body.ct, ctSha256: cs.ctSha256, requestId: cs.requestId, issuedAt: cs.issuedAt, sig: cs.sig, ...rest,
  };
}

const used = async (id: unknown) => (await db.query('select 1 from used_log_entries where id = $1', [id])).rows.length > 0;
const laneSeq = async (chat: string, lane: Lane) =>
  Number((await db.query<{ n: string }>('select coalesce((select next_seq from mod_private_lane_seq where chat = $1 and lane = $2), 0)::text as n', [chat, lane])).rows[0]!.n);
const sharedSeq = async (chat: string) => Number((await db.query<{ n: string }>('select coalesce((select next_seq from mod_chat_seq where chat = $1), 0)::text as n', [chat])).rows[0]!.n);

describe('the grant gives both private lanes', () => {
  it('answers lanes buyer and seller: records signed as the moderator, each opened only by its trader, PK re-wrapped to the device (pkh-pinned)', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const g = await grant(api, c);
    expect(Object.keys(g).sort()).toEqual(['boxPublic', 'lanes', 'nextSeq', 'tkh', 'wrap']);
    expect(g.lanes.map((l) => l.to)).toEqual(['buyer', 'seller']);
    const pks: Uint8Array[] = [];
    for (const l of g.lanes) {
      expect(Object.keys(l).sort()).toEqual(['nextSeq', 'pkh', 'record', 'to', 'wrap']);
      expect(l.nextSeq).toBe(0);
      // Verifies as the attested moderator over this channel, for this lane and pkh.
      const rec = await verifyPrivateLaneRecord(l.record, { chat: c.channel, participants: c.participants });
      expect({ to: rec.to, pkh: rec.pkh }).toEqual({ to: l.to, pkh: l.pkh });
      await expect(verifyPrivateLaneRecord(l.record, { chat: c.channel, participants: { ...c.participants, mod: c.participants.buyer } })).rejects.toBeDefined();
      // The device and the lane's trader open the same PK; the other trader and a wrong pkh never do.
      const pk = await unwrapPrivateKey(DEVICE_ID, l.wrap, l.pkh);
      expect(await openPrivateLaneRecord(rec, c.ids[l.to])).toEqual(pk);
      await expect(openPrivateLaneRecord(rec, c.ids[l.to === 'buyer' ? 'seller' : 'buyer'])).rejects.toBeDefined();
      await expect(unwrapPrivateKey(DEVICE_ID, l.wrap, 'ab'.repeat(32))).rejects.toBeDefined();
      pks.push(pk);
    }
    expect(pks[0]).not.toEqual(pks[1]);
    expect(pks[0]).not.toEqual(c.tk);
    // PK is stored sealed: no row holds it in the clear.
    const { rows } = await db.query<{ sealed: Buffer }>('select sealed from mod_private_lanes where chat = $1 order by lane', [c.chat]);
    expect(rows).toHaveLength(2);
    for (const [i, r] of rows.entries()) expect(r.sealed.includes(Buffer.from(pks[i]!))).toBe(false);
  });

  it('a lane is made once: stable across grants, and two grants at once agree on one key per lane', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const [a, b] = await Promise.all([grant(api, c), grant(api, c)]);
    const again = await grant(api, c);
    for (const g of [b, again]) {
      expect(g.lanes.map((l) => [l.to, l.pkh, l.record])).toEqual(a.lanes.map((l) => [l.to, l.pkh, l.record]));
    }
    // Each grant wraps PK anew to the device; the key behind every wrap is the same.
    for (const [i, l] of again.lanes.entries()) {
      expect(l.wrap).not.toBe(a.lanes[i]!.wrap);
      expect(await unwrapPrivateKey(DEVICE_ID, l.wrap, l.pkh)).toEqual(await unwrapPrivateKey(DEVICE_ID, a.lanes[i]!.wrap, l.pkh));
    }
    expect((await db.query('select 1 from mod_private_lanes where chat = $1', [c.chat])).rows).toHaveLength(2);
  });

  it('a refused grant (no accepted trader grant) makes no lane', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    api.grants.clear();
    const res = await call(deps(api), GRANT, { code: c.code, logEntryId: api.entry('chat.read', c.code), staffAccountId: STAFF, deviceKeyId: DEVICE });
    expect({ status: res.status, error: res.json.error }).toEqual({ status: 409, error: 'no-grant' });
    expect((await db.query('select 1 from mod_private_lanes where chat = $1', [c.chat])).rows).toHaveLength(0);
  });
});

describe('the moderator\'s lane message (`to`, envelope v3)', () => {
  it('signs a v3 envelope the lane key opens (and nothing else), with a seq per lane apart from the shared one, recorded with its lane', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const pk = await laneKeys(api, c);
    const envs: ChatEnvelopeV3[] = [];
    for (const [i, text] of ['First, privately.', 'Second.'].entries()) {
      const res = await call(deps(api), SEND, await laneBody(api, c, pk.buyer, 'buyer', i, { text }));
      expect(res.status, JSON.stringify(res.json)).toBe(200);
      expect(Object.keys(res.json)).toEqual(['envelope']);
      envs.push(res.json.envelope as ChatEnvelopeV3);
    }
    // The seller lane starts at 0 on its own.
    const s = await call(deps(api), SEND, await laneBody(api, c, pk.seller, 'seller', 0, { text: 'To the seller.' }));
    expect(s.status).toBe(200);
    expect(envs.map((e) => [e.v, e.from, e.to, e.trade, e.seq])).toEqual([[3, 'mod', 'buyer', c.channel, 0], [3, 'mod', 'buyer', c.channel, 1]]);
    const guard = new ReplayGuard(c.channel);
    const got = [];
    for (const e of envs) got.push(await openPrivate(e, { pk: pk.buyer, trade: c.channel, to: 'buyer', participants: c.participants, guard }));
    expect(got).toEqual([
      { from: 'mod', to: 'buyer', type: 'chat.msg', payload: { text: 'First, privately.' } },
      { from: 'mod', to: 'buyer', type: 'chat.msg', payload: { text: 'Second.' } },
    ]);
    expect(await openPrivate(s.json.envelope, { pk: pk.seller, trade: c.channel, to: 'seller', participants: c.participants, guard: new ReplayGuard(c.channel) }))
      .toEqual({ from: 'mod', to: 'seller', type: 'chat.msg', payload: { text: 'To the seller.' } });
    // Never under the other lane's key, nor as another lane, nor under TK.
    await expect(openPrivate(envs[0], { pk: pk.seller, trade: c.channel, to: 'buyer', participants: c.participants, guard: new ReplayGuard(c.channel) })).rejects.toBeDefined();
    await expect(openPrivate(envs[0], { pk: pk.buyer, trade: c.channel, to: 'seller', participants: c.participants, guard: new ReplayGuard(c.channel) })).rejects.toBeDefined();
    await expect(openChat(envs[0], { tk: c.tk, trade: c.channel, participants: c.participants, guard: new ReplayGuard(c.channel) })).rejects.toBeDefined();
    expect([await laneSeq(c.chat, 'buyer'), await laneSeq(c.chat, 'seller'), await sharedSeq(c.chat)]).toEqual([2, 1, 0]);
    // The next grant answers each lane's next seq.
    expect((await grant(api, c)).lanes.map((l) => [l.to, l.nextSeq])).toEqual([['buyer', 2], ['seller', 1]]);
    const { rows } = await db.query<{ lane: string | null }>("select lane from mod_chat_access where chat = $1 and action = 'send' order by log_entry_id", [c.chat]);
    expect(rows.map((r) => r.lane)).toEqual(['buyer', 'buyer', 'seller']);
  });

  it('refuses a countersign for another lane or for the shared chat (the API cannot move a message), a lane countersign without `to`, and a bad `to`; nothing is taken', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const pk = await laneKeys(api, c);
    const forBuyer = await laneBody(api, c, pk.buyer, 'buyer', 0);
    const shared = await encryptChat({ trade: c.channel, from: 'mod', seq: 0, type: CHAT_MSG_TYPE, payload: { text: 'Everyone.' }, tk: c.tk });
    const sharedCs = await makeModCountersign({ body: shared, requestId: randomBytes(16).toString('hex'), issuedAt: NOW.toISOString(), me: DEVICE_ID });
    const { to: _to, ...noTo } = await laneBody(api, c, pk.buyer, 'buyer', 0);
    const cases: Array<[string, Record<string, unknown>, number, string]> = [
      ['moved to the seller lane', { ...forBuyer, to: 'seller' }, 400, 'bad-countersign'],
      ['sealed for the seller lane, sent as the buyer lane', await laneBody(api, c, pk.seller, 'seller', 0, { to: 'buyer' }), 400, 'bad-countersign'],
      ['a shared countersign sent into a lane', {
        code: c.code, logEntryId: api.entry(REQUESTED, c.code), staffAccountId: STAFF, deviceKeyId: DEVICE, to: 'buyer',
        seq: 0, nonce: shared.nonce, ct: shared.ct, ctSha256: sharedCs.ctSha256, requestId: sharedCs.requestId, issuedAt: sharedCs.issuedAt, sig: sharedCs.sig,
      }, 400, 'bad-countersign'],
      ['a lane countersign without `to`', { ...noTo, logEntryId: api.entry(REQUESTED, c.code) }, 400, 'bad-countersign'],
      ['to: mod', await laneBody(api, c, pk.buyer, 'buyer', 0, { to: 'mod' }), 400, 'bad-request'],
      ['to: null', await laneBody(api, c, pk.buyer, 'buyer', 0, { to: null }), 400, 'bad-request'],
    ];
    for (const [why, b, status, error] of cases) {
      const res = await call(deps(api), SEND, b);
      expect({ why, status: res.status, error: res.json.error }).toEqual({ why, status, error });
      expect(await used(b.logEntryId), why).toBe(false);
    }
    expect([await laneSeq(c.chat, 'buyer'), await laneSeq(c.chat, 'seller'), await sharedSeq(c.chat)]).toEqual([0, 0, 0]);
    expect((await call(deps(api), SEND, forBuyer)).status).toBe(200);
  });

  it('refuses a lane seq that is not next (409 stale-seq with the lane\'s nextSeq) and a lane no grant made (409 no-lane); nothing is taken', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const pk = await laneKeys(api, c);
    expect((await call(deps(api), SEND, await laneBody(api, c, pk.seller, 'seller', 0))).status).toBe(200);
    // The shared seq says nothing of a lane's.
    expect((await call(deps(api), SEND, await sharedBody(api, c, 0))).status).toBe(200);
    for (const [lane, seq, next] of [['seller', 0, 1], ['seller', 5, 1], ['buyer', 1, 0]] as const) {
      const b = await laneBody(api, c, pk[lane], lane, seq);
      const res = await call(deps(api), SEND, b);
      expect({ status: res.status, error: res.json.error, nextSeq: res.json.nextSeq }).toEqual({ status: 409, error: 'stale-seq', nextSeq: next });
      expect(await used(b.logEntryId)).toBe(false);
    }
    expect([await laneSeq(c.chat, 'buyer'), await laneSeq(c.chat, 'seller'), await sharedSeq(c.chat)]).toEqual([0, 1, 1]);

    const fresh = await disputedCase(api);
    const b = await laneBody(api, fresh, await newChatKey(), 'buyer', 0);
    const res = await call(deps(api), SEND, b);
    expect({ status: res.status, error: res.json.error }).toEqual({ status: 409, error: 'no-lane' });
    expect(await used(b.logEntryId)).toBe(false);
  });

  it('without `to`, the shared send is unchanged: a v2 envelope under TK, the shared seq, no lane on the record', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    await laneKeys(api, c);
    const res = await call(deps(api), SEND, await sharedBody(api, c, 0, 'Both of you.'));
    expect(res.status).toBe(200);
    const env = res.json.envelope as { v: number; from: string; seq: number };
    expect([env.v, env.from, env.seq, Object.hasOwn(env, 'to')]).toEqual([2, 'mod', 0, false]);
    expect(await openChat(env, { tk: c.tk, trade: c.channel, participants: c.participants, guard: new ReplayGuard(c.channel) })).toEqual({ from: 'mod', type: 'chat.msg', payload: { text: 'Both of you.' } });
    expect([await laneSeq(c.chat, 'buyer'), await laneSeq(c.chat, 'seller'), await sharedSeq(c.chat)]).toEqual([0, 0, 1]);
    const { rows } = await db.query<{ lane: string | null }>("select lane from mod_chat_access where chat = $1 and action = 'send'", [c.chat]);
    expect(rows).toEqual([{ lane: null }]);
  });
});

/** A shared (v2) countersigned moderator message, as internal.test.ts sends it. */
async function sharedBody(api: FakeApi, c: Case, seq: number, text = 'Everyone.') {
  const body = await encryptChat({ trade: c.channel, from: 'mod', seq, type: CHAT_MSG_TYPE, payload: { text }, tk: c.tk });
  const cs = await makeModCountersign({ body, requestId: randomBytes(16).toString('hex'), issuedAt: NOW.toISOString(), me: DEVICE_ID });
  return {
    code: c.code, logEntryId: api.entry(REQUESTED, c.code), staffAccountId: STAFF, deviceKeyId: DEVICE,
    seq, nonce: body.nonce, ct: body.ct, ctSha256: cs.ctSha256, requestId: cs.requestId, issuedAt: cs.issuedAt, sig: cs.sig,
  };
}
