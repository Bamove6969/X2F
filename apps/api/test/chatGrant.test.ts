import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { newTradeCode } from '@x2f/core';
import { makeChatGrant, makeChatKeyRecord, makeDisputeNotice, makeGrantAccepted, newChatKey, verifyDisputeNotice, unwrapChatKey, verifyChatGrant, seal, type ChatGrant, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import {
  attestationBytes,
  CHAT_BODY_MAX_BYTES,
  channelFor,
  chatIdentityProofBytes,
  INTERNAL_AT_HEADER,
  INTERNAL_SIG_HEADER,
  internalSignedBytes,
  type Attestation,
} from '@x2f/trade';
import type { FastifyInstance, LightMyRequestResponse } from 'fastify';
import { newProofId, sealProofEnvelope } from '@x2f/proof';
import sodium from 'libsodium-wrappers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { CHAT_PURGED_MARK_DAYS, purgeChats } from '../src/chat/retention.js';
import { CHAT_OPEN_BUCKET, CHAT_POST_BUCKET } from '../src/limits.js';
import { buildInternalListener } from '../src/internal/routes.js';
import { RETENTION_JOBS } from '../src/retentionJobs.js';
import { applyEvent } from '../src/trades/store.js';
import { seedAccount } from './helpers/accounts.js';
import { testApp } from './helpers/app.js';
import { Browser, addTestLogin } from './helpers/totp.js';
import { driveTo, seedTrade } from './helpers/trades.js';
import { insertOffer } from './helpers/offers.js';

let app: FastifyInstance;
let deps: Deps;
let logs: string[];
let internal: FastifyInstance;
let modSign: { public: string; secret: Uint8Array };
let now = new Date('2026-10-23T12:00:00Z');
let setNow: (d: Date) => void;
let n = 0;
let reqSeq = 0;

const name = (p: string) => `${p}${String(++n).padStart(4, '0')}`;
const DAY = 86_400_000;

async function trader(): Promise<{ id: string; b: Browser }> {
  const id = await seedAccount(deps, { loginName: name('chl') });
  const b = new Browser(app);
  const res = await b.post('/t/login', { accountId: id });
  expect(res.statusCode).toBe(200);
  return { id, b };
}

/** A live offer posted directly in the table (Task 4's route needs a wallet and prices). */
async function seedOffer(accountId: string, side: 'sell' | 'buy' = 'sell', status = 'live'): Promise<string> {
  return insertOffer(deps.db, {
    accountId, side, methodId: 'zelle', currency: 'USD', marginBps: 100, min: 1000, max: 100000, status: status as 'live' | 'paused' | 'removed', at: now,
  });
}

function keyPair(): Identity {
  const kp = sodium.crypto_sign_keypair();
  return {
    signPublic: sodium.to_hex(kp.publicKey),
    boxPublic: sodium.to_hex(sodium.crypto_sign_ed25519_pk_to_curve25519(kp.publicKey)),
    signSecret: kp.privateKey,
    boxSecret: sodium.crypto_sign_ed25519_sk_to_curve25519(kp.privateKey),
  };
}

function identityBody(chat: string, role: 'buyer' | 'seller', id: Identity = keyPair()): { signPublic: string; boxPublic: string; proof: string } {
  const proof = sodium.to_hex(sodium.crypto_sign_detached(chatIdentityProofBytes(chat, role, id.signPublic, id.boxPublic), id.signSecret));
  return { signPublic: id.signPublic, boxPublic: id.boxPublic, proof };
}

const sha256Hex = (s: string): string => createHash('sha256').update(s).digest('hex');

async function signedInject(method: 'GET' | 'POST', path: string, body?: unknown): Promise<LightMyRequestResponse> {
  const payload = body === undefined ? undefined : JSON.stringify(body);
  const at = now.getTime() + ++reqSeq;
  const headers: Record<string, string> = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const bytes = internalSignedBytes({ method, path, at, bodyHash: sha256Hex(payload ?? '') });
  headers[INTERNAL_AT_HEADER] = String(at);
  headers[INTERNAL_SIG_HEADER] = sodium.to_base64(sodium.crypto_sign_detached(bytes, modSign.secret), sodium.base64_variants.ORIGINAL);
  return internal.inject({ method, url: path, headers, ...(payload === undefined ? {} : { payload }) });
}

interface Opened {
  chat: string;
  poster: { id: string; b: Browser };
  taker: { id: string; b: Browser };
  offerId: string;
}

/** A taker opens a chat on a 'sell' offer: the poster is the seller, the taker the buyer. */
async function openChat(side: 'sell' | 'buy' = 'sell'): Promise<Opened> {
  const poster = await trader();
  const taker = await trader();
  const offerId = await seedOffer(poster.id, side);
  const res = await taker.b.post('/v1/chats', { offerId });
  expect(res.statusCode).toBe(201);
  return { chat: (res.json() as { chat: string }).chat, poster, taker, offerId };
}

interface Ready extends Opened {
  buyer: Identity;
  seller: Identity;
  mod: Identity;
  participants: Participants;
  channel: string;
}

/** Both identities registered and the moderation service's attestation posted. */
async function readyChat(): Promise<Ready> {
  const o = await openChat('sell');
  const buyer = keyPair();
  const seller = keyPair();
  expect((await o.taker.b.post(`/v1/chats/${o.chat}/identity`, identityBody(o.chat, 'buyer', buyer))).statusCode).toBe(201);
  expect((await o.poster.b.post(`/v1/chats/${o.chat}/identity`, identityBody(o.chat, 'seller', seller))).statusCode).toBe(201);
  const mod = keyPair();
  const participants: Participants = {
    buyer: { signPublic: buyer.signPublic, boxPublic: buyer.boxPublic },
    seller: { signPublic: seller.signPublic, boxPublic: seller.boxPublic },
    mod: { signPublic: mod.signPublic, boxPublic: mod.boxPublic },
  };
  const channel = await channelFor(o.chat, 'chat');
  const attestation: Attestation = { v: 1, trade: o.chat, channels: { chat: channel }, participants, issuedAt: now.toISOString() };
  const sig = sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(attestation), modSign.secret));
  const res = await signedInject('POST', '/internal/v1/reports', { kind: 'chat-attestation', attestation, sig });
  expect(res.statusCode).toBe(201);
  return { ...o, buyer, seller, mod, participants, channel };
}

async function envelope(r: Ready, from: 'buyer' | 'seller', seq: number, text = 'hello'): Promise<Envelope> {
  return seal({
    trade: r.channel,
    from,
    seq,
    type: 'chat.msg',
    payload: { text },
    to: ['buyer', 'seller', 'mod'],
    me: from === 'buyer' ? r.buyer : r.seller,
    participants: r.participants,
  });
}

beforeAll(async () => {
  await sodium.ready;
  let setter: (d: Date) => void;
  ({ app, deps, logs, setNow: setter } = await testApp());
  setNow = (d) => {
    now = d;
    setter(d);
  };
  setNow(now);
  addTestLogin(app, deps);
  const kp = sodium.crypto_sign_keypair();
  modSign = { public: sodium.to_hex(kp.publicKey), secret: kp.privateKey };
  internal = await buildInternalListener({ db: deps.db, modSigningPublic: modSign.public, now: () => now.getTime() });
});

afterAll(async () => {
  await internal.close();
  await app.close();
});


// Design build task 6 (design-chat-membership-keys-2026-11-08 section 3, T1): the disputer's signed
// grant of the chat key to the moderator rides with the dispute, the API checks what it can (the
// signature, the side, the chat, the tkh, the time) and files it; moderation's signed acceptance is
// stored only when it verifies; the counterparty's fallback grant only while it is needed.

const CONFIRM_WINDOW_MIN = 120;
const MIN = 60_000;

interface Keyed extends Ready {
  trade: string;
  tk: Uint8Array;
  tkh: string;
}

/** A paid trade whose confirm window has passed, its chat linked, attested and keyed (by the buyer). */
async function keyedTrade(o: { key?: boolean } = {}): Promise<Keyed> {
  const at = now;
  setNow(new Date(at.getTime() - CONFIRM_WINDOW_MIN * MIN));
  const seller = await trader();
  const buyer = await trader();
  const { trade } = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller' });
  const t = await driveTo(deps, trade, 'paid');
  setNow(at);
  for (const p of [seller, buyer]) expect((await p.b.post('/t/login', { accountId: p.id })).statusCode).toBe(200);
  const opened = await buyer.b.post(`/v1/trades/${t.code}/chat`, {});
  expect(opened.statusCode, opened.body).toBe(200);
  const chat = (opened.json() as { chat: string }).chat;
  const ids = { buyer: keyPair(), seller: keyPair(), mod: keyPair() };
  expect((await buyer.b.post(`/v1/chats/${chat}/identity`, identityBody(chat, 'buyer', ids.buyer))).statusCode).toBe(201);
  expect((await seller.b.post(`/v1/chats/${chat}/identity`, identityBody(chat, 'seller', ids.seller))).statusCode).toBe(201);
  const participants = Object.fromEntries((['buyer', 'seller', 'mod'] as const).map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
  const channel = await channelFor(chat, 'chat');
  const attestation: Attestation = { v: 1, trade: chat, channels: { chat: channel }, participants, issuedAt: now.toISOString() };
  const sig = sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(attestation), modSign.secret));
  expect((await signedInject('POST', '/internal/v1/reports', { kind: 'chat-attestation', attestation, sig })).statusCode).toBe(201);
  const tk = await newChatKey();
  const rec = await makeChatKeyRecord({ chat: channel, by: 'buyer', tk, me: ids.buyer, participants });
  if (o.key !== false) expect((await buyer.b.post(`/v1/chats/${chat}/key`, rec)).statusCode).toBe(201);
  return { chat, poster: seller, taker: buyer, offerId: '', buyer: ids.buyer, seller: ids.seller, mod: ids.mod, participants, channel, trade: t.code, tk, tkh: rec.tkh };
}

const grantOf = (k: Keyed, by: 'buyer' | 'seller', o: { me?: Identity; tk?: Uint8Array; at?: Date; chat?: string } = {}) =>
  makeChatGrant({ chat: o.chat ?? k.channel, by, tk: o.tk ?? k.tk, disputeAt: (o.at ?? now).toISOString(), me: o.me ?? (by === 'buyer' ? k.buyer : k.seller), participants: { ...k.participants, ...(o.me ? { [by]: { signPublic: o.me.signPublic, boxPublic: o.me.boxPublic } } : {}) } });
const dispute = (k: Keyed, grant?: unknown) => k.taker.b.post(`/v1/trades/${k.trade}/dispute`, grant === undefined ? { reason: 'paid', note: '' } : { reason: 'paid', note: '', grant });
const modRows = async (chat: string) =>
  (await deps.db.query<{ granted_by: string; accepted: unknown }>("select granted_by, accepted from chat_members where chat = $1 and member_kind = 'mod' order by id", [chat])).rows;
const disputed = async (code: string) => (await deps.db.query<{ state: string }>('select state from trades where code = $1', [code])).rows[0]!.state;

describe('the dispute grant (T1)', () => {
  it('re-review m5: moderation\'s chat-notice-stopped report raises one owner alert naming the chat, the dispute and the status; anything else in it is 400', async () => {
    const { seedStaff } = await import('./helpers/staffApp.js');
    const owner = await seedStaff(deps, { role: 'owner' });
    const k = await keyedTrade();
    const res = await signedInject('POST', '/internal/v1/reports', { kind: 'chat-notice-stopped', chat: k.chat, disputeSeq: 1, status: 400 });
    expect(res.statusCode, res.body).toBe(201);
    const { rows } = await deps.db.query<{ detail: Record<string, unknown> }>("select detail from alerts where account_id = $1 and kind = 'chat-notice-refused'", [owner.id]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.detail).toMatchObject({ chat: k.chat, disputeSeq: 1, status: 400 });
    for (const bad of [{ kind: 'chat-notice-stopped', chat: k.chat, disputeSeq: 0, status: 400 }, { kind: 'chat-notice-stopped', chat: k.chat, disputeSeq: 1, status: 503 }, { kind: 'chat-notice-stopped', chat: 'nope', disputeSeq: 1, status: 400 }, { kind: 'chat-notice-stopped', chat: k.chat, disputeSeq: 1, status: 400, x: 1 }]) {
      expect((await signedInject('POST', '/internal/v1/reports', bad)).statusCode, JSON.stringify(bad)).toBe(400);
    }
  });

  it('re-review m1, migration 716: a staff row never carries a signed statement (23514); a moderator row may', async () => {
    const k = await keyedTrade();
    const ins = (kind: 'mod' | 'staff', ref: string, statement: string | null) =>
      deps.db.query(
        `insert into chat_members (chat, member_kind, member_ref, box_public, wrap, tkh, trigger, granted_by, granted_at, sig, statement)
         values ($1, $2, $3, $4, 'w', $5, 'assigned', 'mod', $6, '', $7)`,
        [k.chat, kind, ref, 'a'.repeat(64), k.tkh, now, statement],
      );
    await expect(ins('staff', `00000000-0000-4000-8000-000000000001/${'d'.repeat(32)}`, '{"s":1}')).rejects.toMatchObject({ code: '23514' });
    await expect(ins('staff', `00000000-0000-4000-8000-000000000001/${'d'.repeat(32)}`, null)).resolves.toBeDefined();
  });

  it('a keyed chat: no grant is 400 grant-required and opens nothing; the disputer\'s grant opens the dispute and is filed for the moderator', async () => {
    const k = await keyedTrade();
    let res = await dispute(k);
    expect({ s: res.statusCode, e: res.json().error }).toEqual({ s: 400, e: 'grant-required' });
    expect(await disputed(k.trade)).toBe('paid');
    const g = await grantOf(k, 'buyer');
    res = await dispute(k, g);
    expect(res.statusCode, res.body).toBe(200);
    expect(await disputed(k.trade)).toBe('disputed');
    expect(await modRows(k.chat)).toEqual([{ granted_by: 'buyer', accepted: null }]);
    // Both traders see the grant (signed, verifiable) and that it is not accepted yet.
    for (const side of [k.taker, k.poster]) {
      const view = (await side.b.get(`/v1/chats/${k.chat}`)).json() as { grants: Array<{ grant: unknown; accepted: unknown }> };
      expect(view.grants).toHaveLength(1);
      expect(view.grants[0]!.accepted).toBeNull();
      expect(await verifyChatGrant(view.grants[0]!.grant, { chat: k.channel, participants: k.participants })).toEqual(g);
    }
    // The wrap opens only with the moderator's identity, to the chat's key.
    const tk = await unwrapChatKey(k.mod, g.wrap, k.tkh);
    expect(sodium.memcmp(tk, k.tk)).toBe(true);
  });

  it('refuses a grant signed by a stranger or the other side, claiming the other side, of another key, for another chat, or dated far off: 400 bad-grant, no dispute', async () => {
    const k = await keyedTrade();
    const stranger = keyPair();
    const bads: Record<string, ChatGrant> = {
      stranger: await grantOf(k, 'buyer', { me: stranger }),
      otherSide: await grantOf(k, 'seller'),
      otherKey: await grantOf(k, 'buyer', { tk: await newChatKey() }),
      otherChat: await grantOf(k, 'buyer', { chat: await channelFor(newTradeCode(), 'chat') }),
      early: await grantOf(k, 'buyer', { at: new Date(now.getTime() - 11 * MIN) }),
      late: await grantOf(k, 'buyer', { at: new Date(now.getTime() + 11 * MIN) }),
    };
    for (const [why, g] of Object.entries(bads)) {
      const res = await dispute(k, g);
      expect({ why, s: res.statusCode, e: res.json().error }).toEqual({ why, s: 400, e: 'bad-grant' });
    }
    expect((await dispute(k, { ...(await grantOf(k, 'buyer')), extra: 1 })).statusCode).toBe(400);
    expect(await disputed(k.trade)).toBe('paid');
    expect(await modRows(k.chat)).toEqual([]);
  });

  it('a chat with no key record needs no grant, and a grant sent anyway is refused', async () => {
    const k = await keyedTrade({ key: false });
    const res = await dispute(k, await grantOf(k, 'buyer'));
    expect({ s: res.statusCode, e: res.json().error }).toEqual({ s: 400, e: 'bad-request' });
    expect((await dispute(k)).statusCode).toBe(200);
  });
});

describe('moderation\'s acceptance and the counterparty\'s fallback', () => {
  it('moderation pulls the unaccepted grant with the key record; its signed acceptance is stored only when the moderator identity signed it for that grant', async () => {
    const k = await keyedTrade();
    const g = await grantOf(k, 'buyer');
    expect((await dispute(k, g)).statusCode).toBe(200);
    const pulled = (await signedInject('GET', '/internal/v1/chat-grants')).json() as { grants: Array<{ chat: string; grant: unknown; record: { tkh: string } }> };
    const mine = pulled.grants.find((x) => x.chat === k.chat)!;
    expect(mine.grant).toEqual(g);
    expect(mine.record.tkh).toBe(k.tkh);
    const forged = await makeGrantAccepted({ grant: g, mod: k.seller });
    let res = await signedInject('POST', '/internal/v1/reports', { kind: 'chat-grant-accepted', chat: k.chat, accepted: forged });
    expect(res.statusCode).toBe(400);
    const other = await makeGrantAccepted({ grant: { ...g, sig: 'b'.repeat(128) }, mod: k.mod });
    res = await signedInject('POST', '/internal/v1/reports', { kind: 'chat-grant-accepted', chat: k.chat, accepted: other });
    expect(res.statusCode).toBe(404);
    const acc = await makeGrantAccepted({ grant: g, mod: k.mod });
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'chat-grant-accepted', chat: k.chat, accepted: acc })).statusCode).toBe(201);
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'chat-grant-accepted', chat: k.chat, accepted: acc })).statusCode).toBe(201);
    expect(await modRows(k.chat)).toEqual([{ granted_by: 'buyer', accepted: acc }]);
    const again = (await signedInject('GET', '/internal/v1/chat-grants')).json() as { grants: Array<{ chat: string }> };
    expect(again.grants.some((x) => x.chat === k.chat)).toBe(false);
    // An unsigned pull is refused like every internal route.
    expect((await internal.inject({ method: 'GET', url: '/internal/v1/chat-grants' })).statusCode).toBe(401);
  });

  it('the counterparty may grant only while the trade is disputed, the other side\'s grant is unaccepted, and only once', async () => {
    const k = await keyedTrade();
    const fallback = async () => k.poster.b.post(`/v1/chats/${k.chat}/grant`, await grantOf(k, 'seller'));
    let res = await fallback();
    expect({ s: res.statusCode, e: res.json().error }).toEqual({ s: 409, e: 'grant-not-needed' });
    const g = await grantOf(k, 'buyer');
    expect((await dispute(k, g)).statusCode).toBe(200);
    // The disputer cannot "fall back" on its own grant, and a bad one is refused.
    res = await k.taker.b.post(`/v1/chats/${k.chat}/grant`, await grantOf(k, 'buyer'));
    expect(res.statusCode).toBe(409);
    res = await k.poster.b.post(`/v1/chats/${k.chat}/grant`, await grantOf(k, 'buyer'));
    expect({ s: res.statusCode, e: res.json().error }).toEqual({ s: 400, e: 'bad-grant' });
    expect((await fallback()).statusCode).toBe(201);
    expect((await fallback()).statusCode).toBe(409);
    expect((await modRows(k.chat)).map((r) => r.granted_by)).toEqual(['buyer', 'seller']);
  });

  it('no fallback once moderation accepted the disputer\'s grant', async () => {
    const k = await keyedTrade();
    const g = await grantOf(k, 'buyer');
    expect((await dispute(k, g)).statusCode).toBe(200);
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'chat-grant-accepted', chat: k.chat, accepted: await makeGrantAccepted({ grant: g, mod: k.mod }) })).statusCode).toBe(201);
    const res = await k.poster.b.post(`/v1/chats/${k.chat}/grant`, await grantOf(k, 'seller'));
    expect({ s: res.statusCode, e: res.json().error }).toEqual({ s: 409, e: 'grant-not-needed' });
  });
});

// Design build task 7 (design section 3, T2): a dispute no trader's grant reached the moderator
// through. Moderation signs a dispute notice with the chat's moderator identity; the API files it
// only when it verifies and names the trade's current open dispute; then either side's device may
// grant once (trigger `notice`), and none once a grant is accepted.
describe('the dispute notice (T2)', () => {
  const candidates = async () =>
    ((await signedInject('GET', '/internal/v1/chat-notices')).json() as { candidates: Array<{ chat: string; trade: string; disputeSeq: number; openedAt: string; openedBy: string }> }).candidates;
  const report = (chat: string, notice: unknown) => signedInject('POST', '/internal/v1/reports', { kind: 'chat-dispute-notice', chat, notice });
  /** The watcher's 6 h fallback for a settlement it was not shown: the system opens the dispute. */
  const escalate = async (k: Keyed) => {
    if ((await disputed(k.trade)) !== 'settling') await applyEvent(deps, k.trade, { type: 'release-started' }, 'seller');
    await applyEvent(deps, k.trade, { type: 'escalate' }, 'system');
  };

  it('a system escalation of a keyed chat is listed for moderation; only the attested moderator\'s notice naming the current dispute is filed, and both traders see it', async () => {
    const k = await keyedTrade();
    expect((await candidates()).some((c) => c.chat === k.chat)).toBe(false);
    await escalate(k);
    const c = (await candidates()).find((x) => x.chat === k.chat)!;
    expect(c).toMatchObject({ trade: k.trade, disputeSeq: 1, openedBy: 'system' });
    const good = { chat: k.channel, disputeSeq: c.disputeSeq, openedAt: c.openedAt, openedBy: 'system' as const };
    // Signed by anyone but the attested moderator identity: 400; another dispute or opener: 409.
    expect((await report(k.chat, await makeDisputeNotice({ ...good, mod: k.seller }))).statusCode).toBe(400);
    expect((await report(k.chat, await makeDisputeNotice({ ...good, chat: await channelFor(newTradeCode(), 'chat'), mod: k.mod }))).statusCode).toBe(400);
    expect((await report(k.chat, await makeDisputeNotice({ ...good, disputeSeq: 2, mod: k.mod }))).statusCode).toBe(409);
    expect((await report(k.chat, await makeDisputeNotice({ ...good, openedBy: 'buyer', mod: k.mod }))).statusCode).toBe(409);
    expect((await report(k.chat, await makeDisputeNotice({ ...good, openedAt: new Date(Date.parse(good.openedAt) - 1000).toISOString(), mod: k.mod }))).statusCode).toBe(409);
    expect((await report(newTradeCode(), await makeDisputeNotice({ ...good, mod: k.mod }))).statusCode).toBe(404);
    for (const side of [k.taker, k.poster]) expect(((await side.b.get(`/v1/chats/${k.chat}`)).json() as { notice: unknown }).notice).toBeNull();
    const notice = await makeDisputeNotice({ ...good, mod: k.mod });
    expect((await report(k.chat, notice)).statusCode).toBe(201);
    expect((await report(k.chat, notice)).statusCode).toBe(201);
    for (const side of [k.taker, k.poster]) {
      const view = (await side.b.get(`/v1/chats/${k.chat}`)).json() as { notice: unknown; disputeOpen: boolean };
      expect(view.disputeOpen).toBe(true);
      expect(await verifyDisputeNotice(view.notice, { chat: k.channel, participants: k.participants })).toEqual(notice);
    }
    expect((await candidates()).some((x) => x.chat === k.chat)).toBe(false);
  });

  it('with a filed notice and no accepted grant, either side may grant once (trigger notice); none once a grant is accepted; none without a notice', async () => {
    const k = await keyedTrade();
    await escalate(k);
    const grant = async (side: 'buyer' | 'seller') => (side === 'buyer' ? k.taker : k.poster).b.post(`/v1/chats/${k.chat}/grant`, await grantOf(k, side));
    // No notice yet and no other grant: nothing to fall back on.
    let res = await grant('seller');
    expect({ s: res.statusCode, e: res.json().error }).toEqual({ s: 409, e: 'grant-not-needed' });
    const c = (await candidates()).find((x) => x.chat === k.chat)!;
    expect((await report(k.chat, await makeDisputeNotice({ chat: k.channel, disputeSeq: c.disputeSeq, openedAt: c.openedAt, openedBy: 'system', mod: k.mod }))).statusCode).toBe(201);
    expect((await grant('seller')).statusCode).toBe(201);
    expect((await grant('seller')).statusCode).toBe(409);
    const { rows } = await deps.db.query<{ granted_by: string; trigger: string }>("select granted_by, trigger from chat_members where chat = $1 and member_kind = 'mod' order by id", [k.chat]);
    expect(rows).toEqual([{ granted_by: 'seller', trigger: 'notice' }]);
    const g = (await deps.db.query<{ statement: ChatGrant }>("select statement from chat_members where chat = $1 and granted_by = 'seller'", [k.chat])).rows[0]!.statement;
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'chat-grant-accepted', chat: k.chat, accepted: await makeGrantAccepted({ grant: g, mod: k.mod }) })).statusCode).toBe(201);
    res = await grant('buyer');
    expect({ s: res.statusCode, e: res.json().error }).toEqual({ s: 409, e: 'grant-not-needed' });
  });

  it('treats a chat as in dispute when disputes.status <> closed even after trades.state leaves disputed (fix-dispute-open)', async () => {
    const k = await keyedTrade();
    await escalate(k);
    // Simulate a closed/refunded trade whose dispute is still open (e.g. published during appeal window).
    await deps.db.query("update trades set state = 'refunded', closed_at = $2 where code = $1", [k.trade, now]);
    await deps.db.query("update disputes set status = 'published' where code = $1", [k.trade]);

    // 1. GET /v1/chats/:chat returns disputeOpen: true.
    for (const side of [k.taker, k.poster]) {
      const view = (await side.b.get(`/v1/chats/${k.chat}`)).json() as { disputeOpen: boolean };
      expect(view.disputeOpen).toBe(true);
    }

    // 2. GET /internal/v1/chat-notices includes the chat.
    const c = (await candidates()).find((x) => x.chat === k.chat);
    expect(c).toMatchObject({ chat: k.chat, trade: k.trade, disputeSeq: 1, openedBy: 'system' });

    // 3. POST /internal/v1/reports (chat-dispute-notice) returns 201.
    const notice = await makeDisputeNotice({ chat: k.channel, disputeSeq: c!.disputeSeq, openedAt: c!.openedAt, openedBy: 'system', mod: k.mod });
    expect((await report(k.chat, notice)).statusCode).toBe(201);

    // 4. POST /v1/chats/:chat/grant (fallback grant) returns 201.
    const grantRes = await k.poster.b.post(`/v1/chats/${k.chat}/grant`, await grantOf(k, 'seller'));
    expect(grantRes.statusCode, grantRes.body).toBe(201);

    // Negative case: once the dispute is closed (and trade is not disputed), all 4 paths treat it as closed.
    await deps.db.query("update disputes set status = 'closed', closed_at = $2 where code = $1", [k.trade, now]);
    const closedView = (await k.taker.b.get(`/v1/chats/${k.chat}`)).json() as { disputeOpen: boolean; notice: unknown };
    expect(closedView.disputeOpen).toBe(false);
    expect(closedView.notice).toBeNull();
    const lateGrant = await k.taker.b.post(`/v1/chats/${k.chat}/grant`, await grantOf(k, 'buyer'));
    expect({ s: lateGrant.statusCode, e: lateGrant.json().error }).toEqual({ s: 409, e: 'grant-not-needed' });

    const k2 = await keyedTrade();
    await escalate(k2);
    const d2 = (await deps.db.query<{ seq: number; opened_at: Date }>('select seq, opened_at from disputes where code = $1', [k2.trade])).rows[0]!;
    await deps.db.query("update trades set state = 'refunded', closed_at = $2 where code = $1", [k2.trade, now]);
    await deps.db.query("update disputes set status = 'closed', closed_at = $2 where code = $1", [k2.trade, now]);
    expect((await candidates()).some((x) => x.chat === k2.chat)).toBe(false);
    const closedNotice = await makeDisputeNotice({ chat: k2.channel, disputeSeq: d2.seq, openedAt: d2.opened_at.toISOString(), openedBy: 'system', mod: k2.mod });
    expect((await report(k2.chat, closedNotice)).statusCode).toBe(409);
  });
});

describe('review fixes of tasks 3-6 (F2, F5, F6)', () => {
  it('F6: a grant dated more than 1 minute ahead of the server is refused; 10 minutes back is still taken', async () => {
    const k = await keyedTrade();
    const res = await dispute(k, await grantOf(k, 'buyer', { at: new Date(now.getTime() + 2 * MIN) }));
    expect({ s: res.statusCode, e: res.json().error }).toEqual({ s: 400, e: 'bad-grant' });
    expect((await dispute(k, await grantOf(k, 'buyer', { at: new Date(now.getTime() - 9 * MIN) }))).statusCode).toBe(200);
  });

  it('F5: a key record being posted while the dispute opens (the chat row locked) still requires the grant', async () => {
    const k = await keyedTrade({ key: false });
    const c = await deps.db.connect();
    try {
      await c.query('begin');
      await c.query('select 1 from chats where code = $1 for update', [k.chat]);
      const rec = await makeChatKeyRecord({ chat: k.channel, by: 'buyer', tk: k.tk, me: k.buyer, participants: k.participants });
      await c.query(
        'insert into chat_keys (chat, tkh, created_by_role, wrap_buyer, wrap_seller, sig, created_at) values ($1, $2, $3, $4, $5, $6, $7)',
        [k.chat, rec.tkh, rec.by, rec.wrapBuyer, rec.wrapSeller, rec.sig, now],
      );
      const pending = dispute(k);
      await new Promise((r) => setTimeout(r, 300));
      await c.query('commit');
      const res = await pending;
      expect({ s: res.statusCode, e: res.json().error }).toEqual({ s: 400, e: 'grant-required' });
    } finally {
      c.release();
    }
    expect(await disputed(k.trade)).toBe('paid');
  });

  it('F2: 101 grants moderation refused never hold back a good one: the refused rows leave the queue, the good one is pulled and accepted in one pass', async () => {
    const k = await keyedTrade();
    const g = await grantOf(k, 'buyer');
    expect((await dispute(k, g)).statusCode).toBe(200);
    // 101 garbage grants on 101 copies of this chat (the queue's order is by row id, oldest first).
    const bad: Array<{ chat: string; sig: string }> = [];
    for (let i = 0; i < 101; i++) {
      const chat = newTradeCode();
      const offer = await seedOffer(k.poster.id);
      await deps.db.query(
        `insert into chats select (jsonb_populate_record(null::chats, to_jsonb(c) || jsonb_build_object('code', $2::text, 'trade_code', null, 'offer_id', $3::text))).* from chats c where code = $1`,
        [k.chat, chat, offer],
      );
      await deps.db.query('insert into chat_keys select $2, tkh, created_by_role, wrap_buyer, wrap_seller, sig, created_at from chat_keys where chat = $1', [k.chat, chat]);
      const sig = randomUUID().replace(/-/g, '').repeat(4);
      await deps.db.query(
        `insert into chat_members (chat, member_kind, member_ref, box_public, wrap, tkh, trigger, granted_by, granted_at, sig, grant_at, statement)
         select $2, member_kind, member_ref, box_public, wrap, tkh, trigger, granted_by, granted_at, $3, grant_at, statement from chat_members where chat = $1`,
        [k.chat, chat, sig],
      );
      bad.push({ chat, sig });
    }
    // The good grant was filed first; move it behind the 101 garbage rows.
    await deps.db.query("update chat_members set id = nextval(pg_get_serial_sequence('chat_members', 'id')) where chat = $1", [k.chat]);
    const pull = async () => ((await signedInject('GET', '/internal/v1/chat-grants')).json() as { grants: Array<{ chat: string }> }).grants.map((x) => x.chat);
    expect(await pull()).not.toContain(k.chat);
    // An unknown or malformed refusal marks nothing.
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'chat-grant-refused', chat: bad[0]!.chat, grantBy: 'seller', grantSig: bad[0]!.sig, reason: 'bad' })).statusCode).toBe(404);
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'chat-grant-refused', chat: bad[0]!.chat, grantBy: 'buyer', grantSig: bad[0]!.sig, reason: 'nope' })).statusCode).toBe(400);
    for (const b of bad) {
      expect((await signedInject('POST', '/internal/v1/reports', { kind: 'chat-grant-refused', chat: b.chat, grantBy: 'buyer', grantSig: b.sig, reason: 'wrong-key' })).statusCode).toBe(201);
    }
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'chat-grant-refused', chat: bad[0]!.chat, grantBy: 'buyer', grantSig: bad[0]!.sig, reason: 'wrong-key' })).statusCode).toBe(201);
    const pulled = await pull();
    expect(pulled).toContain(k.chat);
    expect(pulled.some((c) => bad.some((b) => b.chat === c))).toBe(false);
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'chat-grant-accepted', chat: k.chat, accepted: await makeGrantAccepted({ grant: g, mod: k.mod }) })).statusCode).toBe(201);
    // A refused grant counts as unaccepted for the counterparty's fallback.
    const r = await deps.db.query("select refused_at is not null as refused from chat_members where chat = $1", [bad[0]!.chat]);
    expect(r.rows).toEqual([{ refused: true }]);
  });
});

// Decision 16 (docs/security/chat-membership-lead-decisions-2026-11-18.md, lead call 18 Nov, option
// i): a keyed chat takes envelope v2 only, with ONE exception: the side an open dispute's moderator
// asked for an unblurred proof may post exactly one v1 envelope per request (the moderator-only
// `proof.unblurred`, which no shared chat key can carry). The API cannot see a v1 envelope's type or
// recipients (both are sealed), so it checks what it can see: a keyed chat, an open request for this
// side, and no v1 envelope from it since that request. Every trader's engine keeps any v1 envelope
// unopened (R16 holds); the moderator's reader is the one that checks its type.
describe("a keyed chat's one v1 exception: the moderator's unblurred-proof request (decision 16)", () => {
  const unblurred = (k: Keyed, from: 'buyer' | 'seller', seq: number) =>
    sealProofEnvelope(
      { type: 'proof.unblurred', payload: { proofId: newProofId(), key: randomBytes(32).toString('base64'), sha256: randomBytes(32).toString('hex'), width: 800, height: 600, mime: 'image/jpeg' } },
      { trade: k.channel, from, seq, me: from === 'buyer' ? k.buyer : k.seller, participants: k.participants },
    );
  const post = (k: Keyed, from: 'buyer' | 'seller', body: unknown) => (from === 'buyer' ? k.taker : k.poster).b.post(`/v1/chats/${k.chat}/envelopes`, body);
  const ask = (k: Keyed, side: 'buyer' | 'seller') =>
    deps.db.query("update disputes set proof_request_side = $2, proof_requested_at = $3, proof_requested_by = 'mod-1', proof_request_sent_at = null where code = $1 and status <> 'closed'", [k.trade, side, now]);
  const disputedKeyed = async (): Promise<Keyed> => {
    const k = await keyedTrade();
    expect((await dispute(k, await grantOf(k, 'buyer'))).statusCode).toBe(200);
    return k;
  };
  const v1Rows = async (chat: string) => (await deps.db.query("select sender_role, seq from chat_envelopes where chat = $1 and envelope->>'v' = '1' order by id", [chat])).rows;

  it('no open request: every v1 is refused (an open dispute alone is not enough)', async () => {
    const k = await disputedKeyed();
    for (const from of ['buyer', 'seller'] as const) {
      const res = await post(k, from, await unblurred(k, from, 0));
      expect({ from, s: res.statusCode }).toEqual({ from, s: 400 });
    }
    // A v1 chat message is refused the same way.
    expect((await post(k, 'buyer', await envelope(k, 'buyer', 0))).statusCode).toBe(400);
    expect(await v1Rows(k.chat)).toEqual([]);
  });

  it('the wrong side is refused: the request names the buyer, so the seller may post no v1', async () => {
    const k = await disputedKeyed();
    await ask(k, 'buyer');
    expect((await post(k, 'seller', await unblurred(k, 'seller', 0))).statusCode).toBe(400);
    expect(await v1Rows(k.chat)).toEqual([]);
  });

  it('the exact one is accepted, and a second v1 for the same request is refused; a new request allows one more', async () => {
    const k = await disputedKeyed();
    await ask(k, 'buyer');
    const res = await post(k, 'buyer', await unblurred(k, 'buyer', 0));
    expect(res.statusCode, res.body).toBe(201);
    expect((await post(k, 'buyer', await unblurred(k, 'buyer', 1))).statusCode).toBe(400);
    // A v1 chat message in its place is refused too (one v1 per request, whatever it holds).
    expect((await post(k, 'buyer', await envelope(k, 'buyer', 1))).statusCode).toBe(400);
    // v2 lines carry on as ever.
    const { sealChat } = await import('@x2f/protocol');
    expect((await post(k, 'buyer', await sealChat({ trade: k.channel, from: 'buyer', seq: 1, type: 'chat.msg', payload: { text: 'after' }, tk: k.tk, me: k.buyer }))).statusCode).toBe(201);
    setNow(new Date(now.getTime() + MIN));
    await ask(k, 'buyer');
    expect((await post(k, 'buyer', await unblurred(k, 'buyer', 2))).statusCode).toBe(201);
    expect(await v1Rows(k.chat)).toEqual([{ sender_role: 'buyer', seq: '0' }, { sender_role: 'buyer', seq: '2' }]);
  });

  it('re-review 5 m2: two v1 posts for one request at the same time give exactly one 201 and one 400', async () => {
    for (let round = 0; round < 3; round++) {
      const k = await disputedKeyed();
      await ask(k, 'buyer');
      const [a, b] = await Promise.all([unblurred(k, 'buyer', 0), unblurred(k, 'buyer', 1)]);
      const codes = (await Promise.all([post(k, 'buyer', a), post(k, 'buyer', b)])).map((r) => r.statusCode).sort();
      expect({ round, codes }).toEqual({ round, codes: [201, 400] });
      expect(await v1Rows(k.chat)).toHaveLength(1);
    }
  });

  it('a request on a dispute that has closed allows nothing', async () => {
    const k = await disputedKeyed();
    await ask(k, 'buyer');
    await deps.db.query("update disputes set status = 'closed', closed_at = $2 where code = $1", [k.trade, now]);
    expect((await post(k, 'buyer', await unblurred(k, 'buyer', 0))).statusCode).toBe(400);
  });
});
