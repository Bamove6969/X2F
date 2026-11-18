import { createHash, randomUUID } from 'node:crypto';
import { newTradeCode } from '@x2f/core';
import { makeChatKeyRecord, newChatKey, openChat as openV2, openChatKeyRecord, ReplayGuard, sealChat, verifyChatKeyRecord, seal, type Envelope, type Identity, type Participants } from '@x2f/protocol';
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
import sodium from 'libsodium-wrappers';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Deps } from '../src/app.js';
import { CHAT_PURGED_MARK_DAYS, purgeChats } from '../src/chat/retention.js';
import { CHAT_OPEN_BUCKET, CHAT_POST_BUCKET } from '../src/limits.js';
import { buildInternalListener } from '../src/internal/routes.js';
import { RETENTION_JOBS } from '../src/retentionJobs.js';
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

// Design build task 4 (design-chat-membership-keys-2026-11-08 section 2.2): the API files the creator's
// signed key record (first writer wins), serves it to both traders, takes only envelope v2 once a chat
// has one, and deletes it with the chat. It can open none of the wraps.

const keyRecord = (r: Ready, by: 'buyer' | 'seller', tk: Uint8Array) =>
  makeChatKeyRecord({ chat: r.channel, by, tk, me: by === 'buyer' ? r.buyer : r.seller, participants: r.participants });
const side = (r: Ready, by: 'buyer' | 'seller') => (by === 'buyer' ? r.taker : r.poster);

describe('the chat key record', () => {
  it('a trader files it once attested; both read it back and open their own copy; the second writer gets 409', async () => {
    const r = await readyChat();
    const tk = await newChatKey();
    const rec = await keyRecord(r, 'seller', tk);
    expect((await side(r, 'seller').b.post(`/v1/chats/${r.chat}/key`, rec)).statusCode).toBe(201);
    const other = await keyRecord(r, 'buyer', await newChatKey());
    const res = await side(r, 'buyer').b.post(`/v1/chats/${r.chat}/key`, other);
    expect({ s: res.statusCode, e: res.json().error }).toEqual({ s: 409, e: 'key-exists' });
    for (const by of ['buyer', 'seller'] as const) {
      const got = await side(r, by).b.get(`/v1/chats/${r.chat}/key`);
      expect(got.statusCode).toBe(200);
      const v = await verifyChatKeyRecord(got.json().record, { chat: r.channel, participants: r.participants });
      expect(v).toEqual(rec);
      const mine = await openChatKeyRecord(v, by, by === 'buyer' ? r.buyer : r.seller);
      expect(sodium.memcmp(mine, tk)).toBe(true);
    }
  });

  it('is refused before attestation, for the other role, signed by another key, for another chat, or malformed', async () => {
    const o = await openChat('sell');
    const early = await o.poster.b.post(`/v1/chats/${o.chat}/key`, {});
    expect({ s: early.statusCode, e: early.json().error }).toEqual({ s: 409, e: 'chat-not-ready' });
    const r = await readyChat();
    const tk = await newChatKey();
    const asBuyer = await keyRecord(r, 'buyer', tk);
    // The seller posting a record that claims the buyer made it.
    let res = await side(r, 'seller').b.post(`/v1/chats/${r.chat}/key`, asBuyer);
    expect({ s: res.statusCode, e: res.json().error }).toEqual({ s: 400, e: 'bad-key-record' });
    const stranger = keyPair();
    const forged = await makeChatKeyRecord({ chat: r.channel, by: 'buyer', tk, me: stranger, participants: { ...r.participants, buyer: { signPublic: stranger.signPublic, boxPublic: stranger.boxPublic } } });
    res = await side(r, 'buyer').b.post(`/v1/chats/${r.chat}/key`, forged);
    expect({ s: res.statusCode, e: res.json().error }).toEqual({ s: 400, e: 'bad-key-record' });
    const elsewhere = await makeChatKeyRecord({ chat: await channelFor(newTradeCode(), 'chat'), by: 'buyer', tk, me: r.buyer, participants: r.participants });
    res = await side(r, 'buyer').b.post(`/v1/chats/${r.chat}/key`, elsewhere);
    expect({ s: res.statusCode, e: res.json().error }).toEqual({ s: 400, e: 'bad-key-record' });
    for (const b of [{}, { ...asBuyer, extra: 1 }, { ...asBuyer, tkh: 'x' }]) {
      res = await side(r, 'buyer').b.post(`/v1/chats/${r.chat}/key`, b);
      expect(res.statusCode).toBe(400);
    }
    expect((await side(r, 'buyer').b.get(`/v1/chats/${r.chat}/key`)).json().error).toBe('no-key');
    // Nobody outside the chat sees it.
    const outsider = await trader();
    expect((await outsider.b.get(`/v1/chats/${r.chat}/key`)).statusCode).toBe(404);
  });

  it('once keyed, the chat takes only envelope v2 (no v1 a sender could leave the moderator out of); before, only v1', async () => {
    const r = await readyChat();
    const tk = await newChatKey();
    const v2 = await sealChat({ trade: r.channel, from: 'buyer', seq: 0, type: 'chat.msg', payload: { text: 'v2' }, tk, me: r.buyer });
    let res = await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, v2);
    expect(res.statusCode).toBe(400);
    expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', 0))).statusCode).toBe(201);
    expect((await r.taker.b.post(`/v1/chats/${r.chat}/key`, await keyRecord(r, 'buyer', tk))).statusCode).toBe(201);
    res = await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', 1));
    expect(res.statusCode).toBe(400);
    const v2b = await sealChat({ trade: r.channel, from: 'buyer', seq: 1, type: 'chat.msg', payload: { text: 'v2' }, tk, me: r.buyer });
    expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, v2b)).statusCode).toBe(201);
    // The seller cannot post the buyer's envelope, and a v2 for another channel is refused.
    res = await r.poster.b.post(`/v1/chats/${r.chat}/envelopes`, await sealChat({ trade: r.channel, from: 'buyer', seq: 2, type: 'chat.msg', payload: { text: 'x' }, tk, me: r.buyer }));
    expect({ s: res.statusCode, e: res.json().error }).toEqual({ s: 400, e: 'wrong-sender' });
    res = await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await sealChat({ trade: 'elsewhere', from: 'buyer', seq: 2, type: 'chat.msg', payload: { text: 'x' }, tk, me: r.buyer }));
    expect({ s: res.statusCode, e: res.json().error }).toEqual({ s: 400, e: 'wrong-channel' });
    // The seller reads it with the same key.
    const list = (await r.poster.b.get(`/v1/chats/${r.chat}/envelopes`)).json().envelopes as Array<{ envelope: unknown }>;
    const opened = await openV2(list[1]!.envelope, { tk, trade: r.channel, participants: r.participants, guard: new ReplayGuard(r.channel) });
    expect(opened).toEqual({ type: 'chat.msg', payload: { text: 'v2' }, from: 'buyer' });
  });

  it('goes with the chat when it is purged, and the API holds nothing that opens a wrap', async () => {
    const r = await readyChat();
    const tk = await newChatKey();
    expect((await r.taker.b.post(`/v1/chats/${r.chat}/key`, await keyRecord(r, 'buyer', tk))).statusCode).toBe(201);
    await deps.db.query(
      `insert into chat_members (chat, member_kind, member_ref, box_public, wrap, tkh, trigger, granted_by, granted_at, sig)
       values ($1, 'mod', 'mod', $2, 'AAAA', $3, 'dispute', 'buyer', $4, 'aa')`,
      [r.chat, r.mod.boxPublic, '0'.repeat(64), now],
    );
    const removed = await purgeChats(deps.db, now, () => true);
    expect(removed).toBeGreaterThan(0);
    expect((await deps.db.query('select 1 from chat_keys where chat = $1', [r.chat])).rows).toHaveLength(0);
    expect((await deps.db.query('select 1 from chat_members where chat = $1', [r.chat])).rows).toHaveLength(0);
  });
});
