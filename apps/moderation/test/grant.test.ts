// Design build task 9 groundwork (lead call 18 Nov, option C; design-chat-membership-keys-2026-11-08):
// the moderation side of `/internal/chat/grant`. Before this process ever re-wraps a chat key to a
// staff device, it checks, on its own records wherever it has them and never on the request alone:
// - the HMAC and the named `chat.read` activity-log entry (this trade, fresh, never used, written
//   with the staff member named in the request as its actor);
// - who the staff member is, from the ruling gate (owner-rooted), never from the API's staff table:
//   the assigned moderator, or a senior or the owner (OWNER p12-4);
// - the trade is disputed in this process's own view (`mod_dispute_seen`) AND the API's dispute is
//   not closed; the owner is no exception (OWNER p12-1);
// - the staff device key is a live certified one (design task 8; none exist yet);
// - the chat is one this process attested.
// Design build task 9: then the trader grant this process accepted is read back and checked again,
// its wrap opened with the chat's moderator identity and the key re-wrapped to the certified device's
// box key; only then is the entry used up and a `mod_chat_access` row (`grant`) written.
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdtemp, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newTradeCode } from '@x2f/core';
import { generateIdentity, makeChatGrant, newChatKey, unwrapChatKey, type Identity, type Participants } from '@x2f/protocol';
import sodium from 'libsodium-wrappers';
import { channelFor, MOD_INTERNAL_MAC_HEADER, MOD_INTERNAL_TS_HEADER } from '@x2f/trade';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { emptyGate, type GateState } from '../src/gate/index.js';
import { saveChatIdentity } from '../src/keystore.js';
import {
  deviceKeyIdOf,
  gateStaffDirectory,
  NO_CERTIFIED_DEVICES,
  OWNER_NEEDS_DISPUTE,
  SENIOR_OR_OWNER_JOINS_ANY_CASE,
  type DeviceCertificates,
  type StaffDirectory,
} from '../src/internal/grant.js';
import { startInternalServer, type ApiView, type InternalDeps } from '../src/internal/server.js';
import { MOD_TEMPLATE_DB } from './setup/postgres.js';

const NOW = new Date('2026-11-18T12:00:00Z');
const SECRET = new Uint8Array(randomBytes(32));
const GRANT = '/internal/chat/grant';
const GID = process.getgid!() === 0 ? 65_534 : process.getgid!();

let db: pg.Pool;
let keystoreKey: Uint8Array;

beforeAll(async () => {
  const admin = inject('modPgUrl');
  const name = `x2f_mod_g_${randomBytes(8).toString('hex')}`;
  const c = new pg.Client({ connectionString: `${admin}/postgres` });
  await c.connect();
  try {
    await c.query(`create database ${name} template ${MOD_TEMPLATE_DB}`);
  } finally {
    await c.end();
  }
  db = new pg.Pool({ connectionString: `${admin}/${name}`, max: 4 });
  keystoreKey = new Uint8Array(randomBytes(32));
});
afterAll(async () => {
  await db.end();
});

class FakeApi implements ApiView {
  log = new Map<string, { id: string; at: Date; action: string; tradeCode: string | null; actorKind: string; actorId: string | null }>();
  disputes = new Map<string, string>();
  assignees = new Map<string, string | null>();
  chats = new Map<string, string>();
  private static next = 1;
  entry(action: string, code: string | null, actorId: string | null, o: { at?: Date; actorKind?: string } = {}): string {
    const id = String(FakeApi.next++);
    this.log.set(id, { id, at: o.at ?? NOW, action, tradeCode: code, actorKind: o.actorKind ?? 'staff', actorId });
    return id;
  }
  async logEntry(id: string) {
    return this.log.get(id) ?? null;
  }
  async disputeStatus(code: string) {
    return this.disputes.get(code) ?? null;
  }
  async disputeAssignee(code: string) {
    return this.assignees.get(code) ?? null;
  }
  async chatOf(code: string) {
    return this.chats.get(code) ?? null;
  }
  /** The moderator grants as the API files them, by chat, side and signature. */
  grants = new Map<string, unknown>();
  async modGrant(chat: string, by: string, sig: string) {
    return this.grants.get(`${chat}/${by}/${sig}`) ?? null;
  }
}

/** The people, as the ruling gate knows them. */
const OWNER = randomUUID();
const SENIOR = randomUUID();
const MOD = randomUUID();
const OTHER_MOD = randomUUID();
const HELPER = randomUUID();
const SWITCHED_OFF = randomUUID();
const REMOVED = randomUUID();
const NOT_JOINED = randomUUID();

function staffDir(): StaffDirectory {
  const people: Record<string, { kind: 'owner' } | { kind: 'staff'; role: 'senior' | 'mod' | 'helper' }> = {
    [OWNER]: { kind: 'owner' },
    [SENIOR]: { kind: 'staff', role: 'senior' },
    [MOD]: { kind: 'staff', role: 'mod' },
    [OTHER_MOD]: { kind: 'staff', role: 'mod' },
    [HELPER]: { kind: 'staff', role: 'helper' },
  };
  return { standing: async (id) => people[id] ?? null };
}

/** A staff device key, certified (stands in for the gate's record, design task 8). */
let DEVICE_ID: Identity;
let DEVICE: string;
beforeAll(async () => {
  await sodium.ready;
  DEVICE_ID = await generateIdentity();
  DEVICE = deviceKeyIdOf(sodium.from_hex(DEVICE_ID.signPublic));
});
const ALL_CERTIFIED: DeviceCertificates = { device: async () => ({ signPublic: DEVICE_ID.signPublic, boxPublic: DEVICE_ID.boxPublic }) };

interface Case {
  code: string;
  chat: string;
  tk: Uint8Array;
  tkh: string;
}

/** A trade disputed in this process's own view and the API's, with its chat attested here. */
async function disputedCase(api: FakeApi, o: { status?: string; seen?: boolean; assignee?: string | null; grant?: boolean } = {}): Promise<Case> {
  const code = newTradeCode();
  const chat = newTradeCode();
  const ids = { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
  const participants = Object.fromEntries((['buyer', 'seller', 'mod'] as const).map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
  const channel = await channelFor(chat, 'chat');
  await saveChatIdentity(db, keystoreKey, chat, ids.mod);
  await db.query('insert into signed_chats (chat, attestation, sig) values ($1, $2, $3)', [
    chat, { v: 1, trade: chat, channels: { chat: channel }, participants, issuedAt: NOW.toISOString() }, 'aa',
  ]);
  if (o.seen ?? true) await db.query('insert into mod_dispute_seen (trade, first_seen_at, last_seen_at) values ($1, $2, $2)', [code, NOW]);
  api.disputes.set(code, o.status ?? 'open');
  api.assignees.set(code, o.assignee === undefined ? MOD : o.assignee);
  api.chats.set(code, chat);
  // The buyer's dispute grant, accepted by this process (task 6), filed by the API.
  const tk = await newChatKey();
  const g = await makeChatGrant({ chat: channel, by: 'buyer', tk, disputeAt: NOW.toISOString(), me: ids.buyer, participants });
  if (o.grant !== false) {
    await db.query('insert into mod_chat_grants (chat, grant_by, grant_sig, tkh, accepted_at) values ($1, $2, $3, $4, $5)', [chat, 'buyer', g.sig, g.tkh, NOW]);
    api.grants.set(`${chat}/buyer/${g.sig}`, g);
  }
  return { code, chat, tk, tkh: g.tkh };
}

function deps(api: ApiView, o: Partial<InternalDeps> = {}): InternalDeps {
  return { secret: SECRET, api, db, keystoreKey, now: () => NOW, staff: staffDir(), devices: ALL_CERTIFIED, ...o };
}

const mac = (method: string, path: string, body: string, ts: string) =>
  createHmac('sha256', SECRET).update(`x2f/mod-internal/v1\0${method}\0${path}\0${body}\0${ts}`, 'utf8').digest('hex');

/** The last answer's whole body (a grant's wrap). */
let last: Record<string, unknown> = {};
async function call(d: InternalDeps, body: unknown, o: { noMac?: boolean } = {}): Promise<{ status: number; error: unknown }> {
  const dir = await mkdtemp(join(tmpdir(), 'x2f-mod-'));
  await chmod(dir, 0o750);
  const socket = join(dir, 'mod.sock');
  const srv = await startInternalServer({ path: socket, gid: GID }, d);
  try {
    const text = JSON.stringify(body);
    const ts = String(NOW.getTime());
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (!o.noMac) {
      headers[MOD_INTERNAL_MAC_HEADER] = mac('POST', GRANT, text, ts);
      headers[MOD_INTERNAL_TS_HEADER] = ts;
    }
    return await new Promise((resolve, reject) => {
      const req = request({ socketPath: socket, path: GRANT, method: 'POST', headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          last = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
          resolve({ status: res.statusCode ?? 0, error: last.error });
        });
      });
      req.on('error', reject);
      req.end(text);
    });
  } finally {
    await srv.close();
    await rm(dir, { recursive: true, force: true });
  }
}

const body = (api: FakeApi, c: Case, staff: string, o: { deviceKeyId?: string; logEntryId?: string } = {}) => ({
  code: c.code,
  logEntryId: o.logEntryId ?? api.entry('chat.read', c.code, staff),
  staffAccountId: staff,
  deviceKeyId: o.deviceKeyId ?? DEVICE,
});

const used = async (id: string) => (await db.query('select 1 from used_log_entries where id = $1', [id])).rows.length === 1;
const accessRows = async (chat: string) =>
  (await db.query<{ staff_id: string; device_key_id: string; log_entry_id: string; action: string }>(
    'select staff_id::text, device_key_id, log_entry_id::text, action from mod_chat_access where chat = $1 order by at, log_entry_id',
    [chat],
  )).rows;

describe('the owner questions this is built to (recommendations, to be confirmed)', () => {
  it('OWNER p12-1: the owner too needs a dispute; OWNER p12-4: a senior or the owner may join any disputed case', () => {
    expect(OWNER_NEEDS_DISPUTE).toBe(true);
    expect(SENIOR_OR_OWNER_JOINS_ANY_CASE).toBe(true);
  });
});

describe('/internal/chat/grant: who may be granted', () => {
  it('passes every check for the assigned moderator, a senior and the owner: re-wraps the chat key to the certified device only, and records the grant', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const d = deps(api);
    const ids: string[] = [];
    for (const who of [MOD, SENIOR, OWNER]) {
      const b = body(api, c, who);
      ids.push(b.logEntryId);
      expect(await call(d, b), who).toEqual({ status: 200 });
      expect({ tkh: last.tkh, boxPublic: last.boxPublic, nextSeq: last.nextSeq }).toEqual({ tkh: c.tkh, boxPublic: DEVICE_ID.boxPublic, nextSeq: 0 });
      // Only the device's box key opens it, to the chat's key.
      const tk = await unwrapChatKey(DEVICE_ID, last.wrap, c.tkh);
      expect(sodium.memcmp(tk, c.tk)).toBe(true);
      const stranger = await generateIdentity();
      await expect(unwrapChatKey(stranger, last.wrap, c.tkh)).rejects.toBeDefined();
      expect(await used(b.logEntryId)).toBe(true);
    }
    expect(await accessRows(c.chat)).toEqual([MOD, SENIOR, OWNER].map((who, i) => ({ staff_id: who, device_key_id: DEVICE, log_entry_id: ids[i], action: 'grant' })));
  });

  it('with no accepted grant, or a filed statement that does not match what this process accepted, nothing is granted and nothing is used (409 no-grant)', async () => {
    const api = new FakeApi();
    const none = await disputedCase(api, { grant: false });
    const b = body(api, none, MOD);
    expect(await call(deps(api), b)).toEqual({ status: 409, error: 'no-grant' });
    expect(await used(b.logEntryId)).toBe(false);
    // The API serves another statement under the accepted signature: refused.
    const c = await disputedCase(api);
    for (const [k, v] of api.grants) if (k.startsWith(`${c.chat}/`)) api.grants.set(k, { ...(v as object), disputeAt: '2026-11-18T12:01:00.000Z' });
    const b2 = body(api, c, MOD);
    expect(await call(deps(api), b2)).toEqual({ status: 409, error: 'no-grant' });
    expect(await used(b2.logEntryId)).toBe(false);
    expect(await accessRows(c.chat)).toEqual([]);
  });

  it('refuses a moderator who is not the one assigned, and any moderator on an unassigned case', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const b = body(api, c, OTHER_MOD);
    expect(await call(deps(api), b)).toEqual({ status: 403, error: 'not-on-case' });
    const unassigned = await disputedCase(api, { assignee: null });
    expect(await call(deps(api), body(api, unassigned, MOD))).toEqual({ status: 403, error: 'not-on-case' });
    expect(await used(b.logEntryId)).toBe(false);
    expect(await accessRows(c.chat)).toEqual([]);
  });

  it('refuses a helper even when assigned, and anyone the gate does not know as live staff', async () => {
    const api = new FakeApi();
    for (const who of [HELPER, SWITCHED_OFF, REMOVED, NOT_JOINED, randomUUID()]) {
      const c = await disputedCase(api, { assignee: who });
      expect(await call(deps(api), body(api, c, who)), who).toEqual({ status: 403, error: 'not-on-case' });
      expect(await accessRows(c.chat)).toEqual([]);
    }
  });

  it('takes the role from the gate, never from the API: an API that names a moderator as assignee does not make a stranger one', async () => {
    const api = new FakeApi();
    const stranger = randomUUID();
    const c = await disputedCase(api, { assignee: stranger });
    expect(await call(deps(api), body(api, c, stranger))).toEqual({ status: 403, error: 'not-on-case' });
  });

  it('with no gate (MOD_STATE_DIR unset) every grant is refused before anything is read or used', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const b = body(api, c, MOD);
    const d = deps(api);
    delete (d as { staff?: StaffDirectory }).staff;
    expect(await call(d, b)).toEqual({ status: 503, error: 'gate-unavailable' });
    expect(await used(b.logEntryId)).toBe(false);
  });
});

describe('/internal/chat/grant: only on a disputed trade', () => {
  it('refuses a trade with no dispute, a closed dispute, or one this process never saw disputed, for everyone including the owner', async () => {
    const api = new FakeApi();
    const none = await disputedCase(api);
    api.disputes.delete(none.code);
    const closed = await disputedCase(api, { status: 'closed' });
    const unseen = await disputedCase(api, { seen: false });
    for (const c of [none, closed, unseen]) {
      for (const who of [MOD, SENIOR, OWNER]) {
        const b = body(api, c, who);
        expect(await call(deps(api), b), `${c.code} ${who}`).toEqual({ status: 403, error: 'not-disputed' });
        expect(await used(b.logEntryId)).toBe(false);
      }
      expect(await accessRows(c.chat)).toEqual([]);
    }
  });

  it('refuses a dispute this process last saw longer ago than the keep time', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api, { seen: false });
    const old = new Date(NOW.getTime() - 91 * 86_400_000);
    await db.query('insert into mod_dispute_seen (trade, first_seen_at, last_seen_at) values ($1, $2, $2)', [c.code, old]);
    expect(await call(deps(api), body(api, c, MOD))).toEqual({ status: 403, error: 'not-disputed' });
  });

  it('accepts every open dispute status', async () => {
    const api = new FakeApi();
    for (const s of ['open', 'awaiting-approval', 'published', 'appealed', 'final', 'complying']) {
      const c = await disputedCase(api, { status: s });
      expect(await call(deps(api), body(api, c, MOD)), s).toEqual({ status: 200 });
    }
  });
});

describe('/internal/chat/grant: the staff device key', () => {
  it('refuses a staff device with no certified key (the gate knows no certification of it)', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const b = body(api, c, MOD);
    expect(await call(deps(api, { devices: NO_CERTIFIED_DEVICES }), b)).toEqual({ status: 403, error: 'device-not-certified' });
    expect(await used(b.logEntryId)).toBe(false);
    expect(await accessRows(c.chat)).toEqual([]);
  });

  it('asks about exactly the named person and key at this process\'s time, and refuses a key certified to someone else', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const asked: Array<[string, string, string]> = [];
    const onlySenior: DeviceCertificates = {
      device: async (who, key, at) => {
        asked.push([who, key, at.toISOString()]);
        return who === SENIOR && key === DEVICE ? { signPublic: DEVICE_ID.signPublic, boxPublic: DEVICE_ID.boxPublic } : null;
      },
    };
    expect(await call(deps(api, { devices: onlySenior }), body(api, c, MOD))).toEqual({ status: 403, error: 'device-not-certified' });
    expect(asked).toEqual([[MOD, DEVICE, NOW.toISOString()]]);
  });

  it('refuses a malformed device key id (32 lower-case hex characters, the lead\'s 18 Nov id)', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    for (const k of ['', DEVICE.toUpperCase(), `${DEVICE}00`, DEVICE.slice(0, 31), 'z'.repeat(32), 5]) {
      expect(await call(deps(api), { ...body(api, c, MOD), deviceKeyId: k }), String(k)).toEqual({ status: 400, error: 'bad-request' });
    }
  });

  it('derives the id as SHA-256 of the device signing public key, hex, first 32 characters', async () => {
    const { createHash } = await import('node:crypto');
    const pub = new Uint8Array(randomBytes(32));
    expect(deviceKeyIdOf(pub)).toBe(createHash('sha256').update(pub).digest('hex').slice(0, 32));
    expect(() => deviceKeyIdOf(new Uint8Array(31))).toThrow();
  });
});

describe('/internal/chat/grant: the chat.read log entry', () => {
  it('refuses a replay: an entry already used authorises nothing more', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const b = body(api, c, MOD);
    expect(await call(deps(api), b)).toEqual({ status: 200 });
    expect(await call(deps(api), b)).toEqual({ status: 403, error: 'log-entry-invalid' });
    // The same entry for another person, the senior, is used up as well.
    expect(await call(deps(api), { ...b, staffAccountId: SENIOR })).toEqual({ status: 403, error: 'log-entry-invalid' });
    expect(await accessRows(c.chat)).toHaveLength(1);
  });

  it('review F11: two identical requests at once: exactly one passes and records one access row, the other is refused', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const b = body(api, c, MOD);
    const got = await Promise.all([call(deps(api), b), call(deps(api), b)]);
    expect(got.map((g) => g.status).sort()).toEqual([200, 403]);
    expect(got.find((g) => g.status === 403)!.error).toBe('log-entry-invalid');
    expect(await accessRows(c.chat)).toHaveLength(1);
  });

  it('review F11: a staff member\'s own chat.read entry cannot be used for another person\'s device', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const mine = api.entry('chat.read', c.code, MOD);
    expect(await call(deps(api), body(api, c, SENIOR, { logEntryId: mine }))).toEqual({ status: 403, error: 'log-entry-invalid' });
    expect(await used(mine)).toBe(false);
    expect(await accessRows(c.chat)).toEqual([]);
  });

  it('refuses an entry of another action, another trade, another or no actor, too old, or unknown', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const other = await disputedCase(api);
    const cases = {
      requested: api.entry('chat.message-requested', c.code, MOD),
      opened: api.entry('proof.unblurred-opened', c.code, MOD),
      otherTrade: api.entry('chat.read', other.code, MOD),
      noTrade: api.entry('chat.read', null, MOD),
      otherActor: api.entry('chat.read', c.code, SENIOR),
      noActor: api.entry('chat.read', c.code, null),
      systemActor: api.entry('chat.read', c.code, MOD, { actorKind: 'system' }),
      old: api.entry('chat.read', c.code, MOD, { at: new Date(NOW.getTime() - 61_000) }),
      future: api.entry('chat.read', c.code, MOD, { at: new Date(NOW.getTime() + 31_000) }),
      unknown: '999999',
    };
    for (const [why, id] of Object.entries(cases)) {
      expect(await call(deps(api), body(api, c, MOD, { logEntryId: id })), why).toEqual({ status: 403, error: 'log-entry-invalid' });
      expect(await used(id), why).toBe(false);
    }
    expect(await call(deps(api), body(api, c, MOD, { logEntryId: api.entry('chat.read', c.code, MOD, { at: new Date(NOW.getTime() - 59_000) }) }))).toEqual({ status: 200 });
  });

  it('refuses a missing HMAC and a malformed body without using anything', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    const b = body(api, c, MOD);
    expect(await call(deps(api), b, { noMac: true })).toEqual({ status: 401, error: 'unauthorized' });
    for (const bad of [{ ...b, extra: 1 }, { ...b, staffAccountId: 'nope' }, { ...b, staffAccountId: MOD.toUpperCase() }, { code: b.code, logEntryId: b.logEntryId, deviceKeyId: DEVICE }]) {
      expect(await call(deps(api), bad)).toEqual({ status: 400, error: 'bad-request' });
    }
    expect(await used(b.logEntryId)).toBe(false);
  });

  it('a chat this process never attested: refused, and the entry stays unused', async () => {
    const api = new FakeApi();
    const c = await disputedCase(api);
    api.chats.set(c.code, newTradeCode());
    const b = body(api, c, MOD);
    expect(await call(deps(api), b)).toEqual({ status: 404, error: 'no-chat' });
    expect(await used(b.logEntryId)).toBe(false);
  });
});

describe('gateStaffDirectory', () => {
  it('reads the owner and live joined staff from the gate state, after a sync; nobody else', async () => {
    const g: GateState = emptyGate();
    g.ownerAccountId = OWNER;
    const entry = (role: 'senior' | 'mod' | 'helper', o: { revoked?: boolean; removed?: boolean; joined?: boolean } = {}) => ({
      role, creds: [], revoked: o.revoked ?? false, removed: o.removed ?? false, joined: o.joined ?? true, inviteId: randomUUID(), inviteClosed: true,
    });
    g.staff = {
      [SENIOR]: entry('senior'),
      [MOD]: entry('mod'),
      [HELPER]: entry('helper'),
      [SWITCHED_OFF]: entry('mod', { revoked: true }),
      [REMOVED]: entry('mod', { removed: true }),
      [NOT_JOINED]: entry('mod', { joined: false }),
    };
    let syncs = 0;
    const dir = gateStaffDirectory({ state: g, sync: async () => { syncs += 1; } });
    expect(await dir.standing(OWNER)).toEqual({ kind: 'owner' });
    expect(await dir.standing(SENIOR)).toEqual({ kind: 'staff', role: 'senior' });
    expect(await dir.standing(MOD)).toEqual({ kind: 'staff', role: 'mod' });
    expect(await dir.standing(HELPER)).toEqual({ kind: 'staff', role: 'helper' });
    for (const id of [SWITCHED_OFF, REMOVED, NOT_JOINED, randomUUID()]) expect(await dir.standing(id), id).toBeNull();
    g.removedIds.push(SENIOR);
    expect(await dir.standing(SENIOR)).toBeNull();
    expect(syncs).toBe(9);
  });
});
