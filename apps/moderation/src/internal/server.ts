import { createHmac, timingSafeEqual } from 'node:crypto';
import { chmod, chown, lstat, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import sodium from 'libsodium-wrappers';
import { normalizeTradeCode } from '@x2f/core';
import {
  isLane,
  makePrivateLaneRecord,
  newPrivateKey,
  privateKeyHash,
  ProtocolError,
  signChatEnvelope,
  signPrivateEnvelope,
  unwrapChatKey,
  verifyChatGrant,
  verifyModCountersign,
  verifyModPrivateCountersign,
  verifyPrivateLaneRecord,
  wrapChatKey,
  wrapPrivateKey,
  type ChatEnvelopeV2Body,
  type ChatEnvelopeV3Body,
  type Lane,
  type Participants,
} from '@x2f/protocol';
import { CHAT_AFTER_DISPUTE_DAYS, channelFor, MOD_INTERNAL_MAC_HEADER, MOD_INTERNAL_MAX_SKEW_MS, MOD_INTERNAL_TS_HEADER, modInternalMacInput } from '@x2f/trade';
import type pg from 'pg';
import { loadChatIdentity, loadPrivateLane, savePrivateLane, type Queryable } from '../keystore.js';
import type { ApiView } from './apiView.js';
import { DEVICE_KEY_ID, NO_CERTIFIED_DEVICES, OWNER_NEEDS_DISPUTE, onCase, type DeviceCertificates, type StaffDirectory } from './grant.js';

export type { ApiView } from './apiView.js';

/**
 * The moderation process's internal API (Plan 4 Task 11; design-chat-membership-keys-2026-11-08
 * build task 9). It listens ONLY on a Unix socket (`MOD_INTERNAL_SOCKET`, mode 0660, group
 * `MOD_INTERNAL_SOCKET_GID`, in a directory this process owns); there is no TCP listener. No chat
 * text ever passes through it: the moderator's read is the chat key re-wrapped to a certified staff
 * device, which decrypts in staff-web, and the moderator's message is ciphertext that device sealed
 * and countersigned.
 *
 * Both routes take `{code, logEntryId, staffAccountId, deviceKeyId, ...}` and check, in this order,
 * refusing at the first that fails:
 * 1. the HMAC (401), then the body's shape (400);
 * 2. the ruling gate is present (503 `gate-unavailable`);
 * 3. the named API activity-log entry, read from the API's database (never taken from the request),
 *    has this route's action (`chat.read` for a grant, `chat.message-requested` for a send), is of
 *    this trade, at most 60 s old (30 s of skew), never used, and its actor is a staff member, exactly
 *    the one named (403 `log-entry-invalid`);
 * 4. the trade's current dispute is not closed AND this process itself saw it disputed within
 *    CHAT_AFTER_DISPUTE_DAYS (`mod_dispute_seen`), the owner included (OWNER p12-1) (403 `not-disputed`);
 * 5. the person, as the gate knows them, is the assigned moderator, a senior or the owner (OWNER
 *    p12-4); a helper never (403 `not-on-case`);
 * 6. the device key id is certified to them and live at this process's clock (403 `device-not-certified`);
 * 7. the chat is one this process attested (404 `no-chat`).
 *
 * - `POST /internal/chat/grant` → 200 `{ wrap, tkh, boxPublic, nextSeq, lanes }`: then the accepted trader
 *   grant this process recorded (`mod_chat_grants`) is read back from the API, verified again against
 *   the attested traders and this process's recorded signature and tkh (409 `no-grant`), its wrap is
 *   opened with the chat's sealed moderator identity to a key of that tkh, re-wrapped to the device's
 *   certified box key (`crypto_box_seal`), and the key wiped. Owner 27 Nov (private lanes): `lanes`
 *   is `[{ to, pkh, wrap, nextSeq, record }]` for `to` buyer then seller, each lane made on the chat's
 *   first grant (PK random, sealed in `mod_private_lanes` under MOD_KEYSTORE_KEY; `record` the lane
 *   record, PK sealed to `to`'s attested box key and signed with the chat's moderator identity, which
 *   the API files), `wrap` PK re-wrapped to the device's certified box key (every grant is an audit
 *   read of both lanes), `nextSeq` the moderator's next seq in that lane; every PK is wiped after use.
 *   Only then, in one statement, the entry is used up and a `mod_chat_access` row (`grant`) written
 *   (a replay finds the entry used).
 * - `POST /internal/chat/send` (+ `seq, nonce, ct, ctSha256, requestId, issuedAt, sig`, optional `to`) → 200 `{ envelope }`:
 *   the countersign (x2f/mod-countersign/v1, lead 18 Nov) must verify by the device's certified
 *   signing key over this exact message (400 `bad-countersign`), its issuedAt be at most 5 minutes
 *   old and 1 minute ahead (403 `stale-countersign`), its requestId never seen (403 `replayed`; review
 *   N6: the requestId of a countersign that verified is taken at once, so one refused for any later
 *   reason is spent), and `seq` this chat's next moderator seq (409 `stale-seq`, with `nextSeq`). The
 *   countersign binds the nonce too (review N7). Then, in one transaction,
 *   the entry is used, the seq taken and a `mod_chat_access` row (`send`) written;
 *   then the envelope is signed as `from: 'mod'` with the chat's moderator identity. With `to`
 *   ('buyer' | 'seller', owner 27 Nov), the same in that private lane: the body is envelope v3
 *   `{v:3, trade, from:'mod', to, seq, nonce, ct}`, the countersign the lane one
 *   (x2f/mod-countersign-private/v1, binding `to`, so the API cannot move it to the other lane), the
 *   lane made by a grant (409 `no-lane`), `seq` that lane's next moderator seq (`mod_private_lane_seq`,
 *   409 `stale-seq` with `nextSeq`), the access row carrying `lane`, and the envelope signed by
 *   `signPrivateEnvelope`. This process never decrypts either: it signs only what a staff device on
 *   the case sealed and signed.
 *
 * Every request carries `X-X2F-Internal` (hex HMAC-SHA-256 under MOD_INTERNAL_SECRET of
 * `modInternalMacInput`) and `X-X2F-Internal-Ts` within 30 s of this process's clock; else 401.
 */
export interface InternalDeps {
  /** MOD_INTERNAL_SECRET: 32 bytes, shared with the API only. */
  secret: Uint8Array;
  /** The API's database, read-only (`x2f_mod_reader`). */
  api: ApiView;
  /** The moderation database (keystore, signed chats, used entries, the moderator's seq). */
  db: Queryable & { connect(): Promise<pg.PoolClient> };
  keystoreKey: Uint8Array;
  now?: () => Date;
  /** The ruling gate's view of staff (`gateStaffDirectory`). Omitted (no gate): every call is refused. */
  staff?: StaffDirectory;
  /** Live certified staff device keys (`gateDevices`, design task 8). Omitted: none. */
  devices?: DeviceCertificates;
}

/** How old the named log entry may be. */
export const LOG_ENTRY_MAX_AGE_MS = 60_000;
/** Lead 18 Nov: a countersign older than 5 minutes is refused. Builder's call: 1 minute ahead at most. */
export const COUNTERSIGN_MAX_AGE_MS = 5 * 60_000;
export const COUNTERSIGN_MAX_AHEAD_MS = 60_000;
const BODY_MAX = 256 * 1024;
const LOG_ID = /^[1-9][0-9]{0,18}$/;
const TS = /^[0-9]{1,16}$/;
const MAC = /^[0-9a-f]{64}$/;

const CASE_KEYS = ['code', 'logEntryId', 'staffAccountId', 'deviceKeyId'] as const;
const ROUTES = {
  // The API commits one `chat.read` per read, with the staff member as its actor (lead 18 Nov: the
  // activity log until the per-trade audit, design task 12; `mod_chat_access` is authoritative).
  '/internal/chat/grant': { action: 'chat.read', keys: [...CASE_KEYS], optional: [] },
  // The API commits `chat.message-requested` before asking, and `chat.message-sent {envelopeId}`
  // once it stored the envelope (review 8 Nov M-2); only the first authorises a send.
  // Owner 27 Nov: `to` names a private lane (envelope v3); without it, the shared chat (v2).
  '/internal/chat/send': { action: 'chat.message-requested', keys: [...CASE_KEYS, 'seq', 'nonce', 'ct', 'ctSha256', 'requestId', 'issuedAt', 'sig'], optional: ['to'] },
} as const;
type RoutePath = keyof typeof ROUTES;

class Refusal extends Error {
  constructor(readonly status: number, readonly code: string, readonly extra: Record<string, unknown> = {}) {
    super(code);
  }
}

function answer(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > BODY_MAX) {
        reject(new Refusal(413, 'too-large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function header(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name];
  return typeof v === 'string' ? v : null;
}

function authentic(d: InternalDeps, req: IncomingMessage, path: string, body: string, now: Date): boolean {
  const ts = header(req, MOD_INTERNAL_TS_HEADER);
  const mac = header(req, MOD_INTERNAL_MAC_HEADER);
  if (ts === null || mac === null || !TS.test(ts) || !MAC.test(mac)) return false;
  if (Math.abs(now.getTime() - Number(ts)) > MOD_INTERNAL_MAX_SKEW_MS) return false;
  const want = createHmac('sha256', d.secret).update(modInternalMacInput({ method: req.method ?? '', path, body, ts }), 'utf8').digest();
  return timingSafeEqual(want, Buffer.from(mac, 'hex'));
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY_MS = 86_400_000;

interface Parsed {
  code: string;
  logEntryId: string;
  staffId: string;
  deviceKeyId: string;
  o: Record<string, unknown>;
}

function parse(path: RoutePath, body: string): Parsed {
  let v: unknown;
  try {
    v = JSON.parse(body);
  } catch {
    throw new Refusal(400, 'bad-request');
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new Refusal(400, 'bad-request');
  const o = v as Record<string, unknown>;
  const keys = ROUTES[path].keys as readonly string[];
  const optional = ROUTES[path].optional as readonly string[];
  if (!keys.every((k) => Object.hasOwn(o, k)) || !Object.keys(o).every((k) => keys.includes(k) || optional.includes(k))) throw new Refusal(400, 'bad-request');
  const code = typeof o.code === 'string' ? normalizeTradeCode(o.code) : null;
  if (code === null || typeof o.logEntryId !== 'string' || !LOG_ID.test(o.logEntryId)) throw new Refusal(400, 'bad-request');
  if (typeof o.staffAccountId !== 'string' || !UUID.test(o.staffAccountId) || typeof o.deviceKeyId !== 'string' || !DEVICE_KEY_ID.test(o.deviceKeyId)) throw new Refusal(400, 'bad-request');
  return { code, logEntryId: o.logEntryId, staffId: o.staffAccountId, deviceKeyId: o.deviceKeyId, o };
}

/** The trade's chat as this process attested it: its channel, the moderator identity and the participants it signed. */
async function attestedChat(d: InternalDeps, code: string) {
  const chat = await d.api.chatOf(code);
  if (chat === null) throw new Refusal(404, 'no-chat');
  const { rows } = await d.db.query<{ attestation: { participants?: Participants; channels?: { chat?: string } } }>(
    'select attestation from signed_chats where chat = $1',
    [chat],
  );
  const mod = await loadChatIdentity(d.db, d.keystoreKey, chat);
  const att = rows[0]?.attestation;
  const channel = await channelFor(chat, 'chat');
  if (!att?.participants || att.channels?.chat !== channel || mod === null) throw new Refusal(404, 'no-chat');
  return { chat, channel, mod, participants: att.participants };
}

/** Checks 2-7 of the header, in order; nothing is used or recorded here. */
async function caseChecks(d: InternalDeps, path: RoutePath, b: Parsed, now: Date) {
  const staff = d.staff;
  if (staff === undefined) throw new Refusal(503, 'gate-unavailable');
  const invalid = new Refusal(403, 'log-entry-invalid');
  const e = await d.api.logEntry(b.logEntryId);
  if (e === null || e.action !== ROUTES[path].action || e.tradeCode === null || normalizeTradeCode(e.tradeCode) !== b.code) throw invalid;
  const age = now.getTime() - e.at.getTime();
  if (age > LOG_ENTRY_MAX_AGE_MS || age < -MOD_INTERNAL_MAX_SKEW_MS) throw invalid;
  if ((await d.db.query('select 1 from used_log_entries where id = $1', [b.logEntryId])).rows.length > 0) throw invalid;
  // The log must name this person as the one acting: a staff actor, exactly this account.
  if (e.actorKind !== 'staff' || e.actorId === null || e.actorId.toLowerCase() !== b.staffId) throw invalid;
  let who;
  try {
    who = await staff.standing(b.staffId);
  } catch {
    throw new Refusal(503, 'gate-unavailable');
  }
  const status = await d.api.disputeStatus(b.code);
  const { rows: seen } = await d.db.query('select 1 from mod_dispute_seen where trade = $1 and last_seen_at >= $2', [
    b.code, new Date(now.getTime() - CHAT_AFTER_DISPUTE_DAYS * DAY_MS),
  ]);
  const disputed = status !== null && status !== 'closed' && seen.length > 0;
  if (!disputed && (who?.kind !== 'owner' || OWNER_NEEDS_DISPUTE)) throw new Refusal(403, 'not-disputed');
  if (!onCase(who, b.staffId, await d.api.disputeAssignee(b.code))) throw new Refusal(403, 'not-on-case');
  let device;
  try {
    device = await (d.devices ?? NO_CERTIFIED_DEVICES).device(b.staffId, b.deviceKeyId, now);
  } catch {
    throw new Refusal(503, 'gate-unavailable');
  }
  if (device === null) throw new Refusal(403, 'device-not-certified');
  const c = await attestedChat(d, b.code);
  return { e, device, c };
}

/** The chat's next moderator seq (envelope v2 is single-use per seq). */
async function nextSeqOf(d: InternalDeps, chat: string): Promise<number> {
  const { rows } = await d.db.query<{ next_seq: string }>('select next_seq::text from mod_chat_seq where chat = $1', [chat]);
  return rows[0] === undefined ? 0 : Number(rows[0].next_seq);
}

/** A lane's next moderator seq (envelope v3: seq per (from, to) lane). */
async function laneSeqOf(d: InternalDeps, chat: string, lane: Lane): Promise<number> {
  const { rows } = await d.db.query<{ next_seq: string }>('select next_seq::text from mod_private_lane_seq where chat = $1 and lane = $2', [chat, lane]);
  return rows[0] === undefined ? 0 : Number(rows[0].next_seq);
}

const LANES: readonly Lane[] = ['buyer', 'seller'];

/**
 * Owner 27 Nov: both private lanes of the chat, made on its first grant, each with PK re-wrapped to
 * the device's certified box key. A lane is made once (first insert wins, then read back, so racing
 * grants agree on one PK); its stored record is checked again (moderator signature, this channel,
 * the stored pkh) and PK against its pkh before any wrap. Every PK is wiped after use.
 */
async function laneGrants(d: InternalDeps, c: Awaited<ReturnType<typeof attestedChat>>, boxPublic: string) {
  const out: Array<{ to: Lane; pkh: string; wrap: string; nextSeq: number; record: Record<string, unknown> }> = [];
  for (const to of LANES) {
    let lane = await loadPrivateLane(d.db, d.keystoreKey, c.chat, to);
    if (lane === null) {
      const pk = await newPrivateKey();
      try {
        const record = await makePrivateLaneRecord({ chat: c.channel, to, pk, mod: c.mod, participants: c.participants });
        await savePrivateLane(d.db, d.keystoreKey, c.chat, to, pk, record.pkh, record);
      } finally {
        sodium.memzero(pk);
      }
      lane = await loadPrivateLane(d.db, d.keystoreKey, c.chat, to);
      if (lane === null) throw new Error('moderation: a private lane was not stored');
    }
    try {
      const rec = await verifyPrivateLaneRecord(lane.record, { chat: c.channel, participants: c.participants });
      if (rec.to !== to || rec.pkh !== lane.pkh || (await privateKeyHash(lane.pk)) !== lane.pkh) throw new Error('moderation: a private lane does not match its record');
      out.push({ to, pkh: lane.pkh, wrap: await wrapPrivateKey(boxPublic, lane.pk), nextSeq: await laneSeqOf(d, c.chat, to), record: lane.record });
    } finally {
      sodium.memzero(lane.pk);
    }
  }
  return out;
}

/** `/internal/chat/grant` (design build task 9): every check, the re-wrap, then the use and the record together. */
async function grant(d: InternalDeps, b: Parsed, now: Date, res: ServerResponse): Promise<void> {
  const { e, device, c } = await caseChecks(d, '/internal/chat/grant', b, now);
  // The trader grant this process accepted (one key per chat, review F4), read back and checked again.
  const { rows } = await d.db.query<{ grant_by: string; grant_sig: string; tkh: string }>(
    'select grant_by, grant_sig, tkh from mod_chat_grants where chat = $1 order by accepted_at, grant_by',
    [c.chat],
  );
  let wrap: string | null = null;
  let tkh = '';
  for (const g of rows) {
    const statement = await d.api.modGrant(c.chat, g.grant_by, g.grant_sig);
    if (statement === null) continue;
    try {
      const v = await verifyChatGrant(statement, { chat: c.channel, participants: c.participants });
      if (v.sig !== g.grant_sig || v.by !== g.grant_by || v.tkh !== g.tkh) continue;
      const tk = await unwrapChatKey({ boxPublic: c.mod.boxPublic, boxSecret: c.mod.boxSecret }, v.wrap, g.tkh);
      try {
        wrap = await wrapChatKey(device.boxPublic, tk);
      } finally {
        sodium.memzero(tk);
      }
      tkh = g.tkh;
      break;
    } catch (err) {
      if (err instanceof ProtocolError || err instanceof TypeError) continue;
      throw err;
    }
  }
  if (wrap === null) throw new Refusal(409, 'no-grant');
  const lanes = await laneGrants(d, c, device.boxPublic);
  // One statement: the entry is used up and the access recorded together, or neither (a replay finds the entry used).
  const { rowCount } = await d.db.query(
    `with u as (insert into used_log_entries (id, action, trade) values ($1, $2, $3) on conflict (id) do nothing returning id)
     insert into mod_chat_access (chat, trade, at, staff_id, device_key_id, log_entry_id, action)
     select $4, $3, $5, $6, $7, id, 'grant' from u`,
    [b.logEntryId, e.action, b.code, c.chat, now, b.staffId, b.deviceKeyId],
  );
  if (rowCount !== 1) throw new Refusal(403, 'log-entry-invalid');
  answer(res, 200, { wrap, tkh, boxPublic: device.boxPublic, nextSeq: await nextSeqOf(d, c.chat), lanes });
}

/**
 * `/internal/chat/send` (design build task 9, the countersign; owner 27 Nov, a lane with `to`): every
 * check, then the use, the request id, the seq and the record in one transaction.
 */
async function send(d: InternalDeps, b: Parsed, now: Date, res: ServerResponse): Promise<void> {
  const o = b.o;
  if (typeof o.seq !== 'number' || !Number.isSafeInteger(o.seq) || o.seq < 0 || typeof o.nonce !== 'string' || typeof o.ct !== 'string') throw new Refusal(400, 'bad-request');
  const to: Lane | null = Object.hasOwn(o, 'to') ? (isLane(o.to) ? o.to : null) : null;
  if (Object.hasOwn(o, 'to') && to === null) throw new Refusal(400, 'bad-request');
  const { e, device, c } = await caseChecks(d, '/internal/chat/send', b, now);
  const wire = { chat: c.channel, seq: o.seq, nonce: o.nonce, ctSha256: o.ctSha256, requestId: o.requestId, issuedAt: o.issuedAt, sig: o.sig };
  const shared: ChatEnvelopeV2Body = { v: 2, trade: c.channel, from: 'mod', seq: o.seq, nonce: o.nonce, ct: o.ct };
  const lane: ChatEnvelopeV3Body | null = to === null ? null : { v: 3, trade: c.channel, from: 'mod', to, seq: o.seq, nonce: o.nonce, ct: o.ct };
  let cs;
  try {
    // By the device's CERTIFIED signing key (the gate's record), over this channel, seq and ciphertext;
    // for a lane, the lane countersign (x2f/mod-countersign-private/v1), which binds `to` as well.
    cs = lane === null
      ? await verifyModCountersign(wire, { body: shared, signPublic: device.signPublic })
      : await verifyModPrivateCountersign({ ...wire, to }, { body: lane, signPublic: device.signPublic });
  } catch (err) {
    if (err instanceof ProtocolError || err instanceof TypeError) throw new Refusal(400, 'bad-countersign');
    throw err;
  }
  // Review N6: a countersign that verified is spent at once, in its own committed statement, before
  // any later check can refuse it (freshness, the lane, the seq): one refused for a seq that is not
  // next can never be shown again once the seq catches up. Staff-web seals a retry with a new requestId.
  const fresh = await d.db.query('insert into mod_countersign_requests (request_id, chat, at) values ($1, $2, $3) on conflict (request_id) do nothing', [cs.requestId, c.chat, now]);
  if (fresh.rowCount !== 1) throw new Refusal(403, 'replayed');
  const age = now.getTime() - Date.parse(cs.issuedAt);
  if (age > COUNTERSIGN_MAX_AGE_MS || age < -COUNTERSIGN_MAX_AHEAD_MS) throw new Refusal(403, 'stale-countersign');
  // Signed only once everything is taken, so a refused send signs nothing; checked before it is taken.
  let envelope;
  try {
    envelope = lane === null ? await signChatEnvelope(shared, c.mod) : await signPrivateEnvelope(lane, c.mod);
  } catch (err) {
    if (err instanceof ProtocolError || err instanceof TypeError) throw new Refusal(400, 'bad-request');
    throw err;
  }
  const client = await d.db.connect();
  try {
    await client.query('begin');
    const used = await client.query('insert into used_log_entries (id, action, trade) values ($1, $2, $3) on conflict (id) do nothing', [b.logEntryId, e.action, b.code]);
    if (used.rowCount !== 1) throw new Refusal(403, 'log-entry-invalid');
    let next: number;
    if (to === null) {
      await client.query('insert into mod_chat_seq (chat, next_seq) values ($1, 0) on conflict (chat) do nothing', [c.chat]);
      const { rows } = await client.query<{ next_seq: string }>('select next_seq::text from mod_chat_seq where chat = $1 for update', [c.chat]);
      next = Number(rows[0]!.next_seq);
      if (o.seq !== next) throw new Refusal(409, 'stale-seq', { nextSeq: next });
      await client.query('update mod_chat_seq set next_seq = next_seq + 1 where chat = $1', [c.chat]);
    } else {
      // The lane is made by a grant (the staff device holds PK only from one); none: nothing to seal under.
      if ((await client.query('select 1 from mod_private_lanes where chat = $1 and lane = $2', [c.chat, to])).rows.length === 0) throw new Refusal(409, 'no-lane');
      await client.query('insert into mod_private_lane_seq (chat, lane, next_seq) values ($1, $2, 0) on conflict (chat, lane) do nothing', [c.chat, to]);
      const { rows } = await client.query<{ next_seq: string }>('select next_seq::text from mod_private_lane_seq where chat = $1 and lane = $2 for update', [c.chat, to]);
      next = Number(rows[0]!.next_seq);
      if (o.seq !== next) throw new Refusal(409, 'stale-seq', { nextSeq: next });
      await client.query('update mod_private_lane_seq set next_seq = next_seq + 1 where chat = $1 and lane = $2', [c.chat, to]);
    }
    await client.query(
      `insert into mod_chat_access (chat, trade, at, staff_id, device_key_id, log_entry_id, action, lane) values ($1, $2, $3, $4, $5, $6, 'send', $7)`,
      [c.chat, b.code, now, b.staffId, b.deviceKeyId, b.logEntryId, to],
    );
    await client.query('commit');
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
  answer(res, 200, { envelope });
}

async function handle(d: InternalDeps, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const path = (req.url ?? '') as RoutePath;
  if (req.method !== 'POST' || !Object.hasOwn(ROUTES, path)) {
    // Drain and refuse without reading anything else.
    req.resume();
    answer(res, 404, { error: 'not-found' });
    return;
  }
  const body = await readBody(req);
  const now = (d.now ?? (() => new Date()))();
  if (!authentic(d, req, path, body, now)) throw new Refusal(401, 'unauthorized');
  const b = parse(path, body);
  if (path === '/internal/chat/grant') return grant(d, b, now, res);
  return send(d, b, now, res);
}

/** The request handler (exported for tests); errors answer with a code only, never a detail. */
export function internalHandler(d: InternalDeps): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    handle(d, req, res).catch((e: unknown) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      if (e instanceof Refusal) answer(res, e.status, { error: e.code, ...e.extra });
      else answer(res, 500, { error: 'internal' });
    });
  };
}

/** Where the socket lives and which group may connect (review 8 Nov I-3). */
export interface InternalSocket {
  /** MOD_INTERNAL_SOCKET: an absolute path in a directory this process's user owns (e.g. /run/x2f-mod, 0750). */
  path: string;
  /** MOD_INTERNAL_SOCKET_GID: the dedicated group whose only other member is the API's user (never 0). */
  gid: number;
}

/**
 * Listens on `socket.path` only (a stale socket file from an earlier run is removed first; any other
 * file there is refused). Review 8 Nov I-3: the API runs as its OWN user (the same uid could read
 * this process's `/proc/<pid>/environ`, keystore key and signing secret included), so the socket is
 * created under umask 0177, given the dedicated group `socket.gid` and set to 0660: only this user
 * and that group's members (the API's user alone) can connect. Its directory must be owned by this
 * user and closed to others, with no group write (0750 or 0700), so nobody else can swap the socket.
 */
export async function startInternalServer(socket: InternalSocket, d: InternalDeps): Promise<{ address: string; close(): Promise<void> }> {
  if (!(d.secret instanceof Uint8Array) || d.secret.length !== 32) throw new TypeError('moderation: MOD_INTERNAL_SECRET must be 32 bytes');
  if (!Number.isSafeInteger(socket.gid) || socket.gid <= 0) throw new TypeError('moderation: MOD_INTERNAL_SOCKET_GID must be a dedicated group id (not 0)');
  const socketPath = socket.path;
  const dir = await lstat(dirname(socketPath));
  if (!dir.isDirectory() || dir.uid !== process.getuid!() || (dir.mode & 0o027) !== 0) {
    throw new Error('moderation: MOD_INTERNAL_SOCKET must be in a directory owned by this user, mode 0750 or 0700');
  }
  try {
    const st = await lstat(socketPath);
    if (!st.isSocket()) throw new Error('moderation: MOD_INTERNAL_SOCKET names a file that is not a socket');
    await unlink(socketPath);
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
  }
  const server: Server = createServer(internalHandler(d));
  const old = process.umask(0o177);
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, () => resolve());
    });
  } finally {
    process.umask(old);
  }
  const close = () =>
    new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  try {
    // The group first, then the group bits: the socket is never open to a group other than this one.
    await chown(socketPath, -1, socket.gid);
    await chmod(socketPath, 0o660);
  } catch (e) {
    await close();
    throw e;
  }
  return { address: socketPath, close };
}
