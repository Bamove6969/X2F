import { createHash, randomUUID } from 'node:crypto';
import { newTradeCode } from '@x2f/core';
import { open, ReplayGuard, seal, type Envelope, type Identity, type Participants } from '@x2f/protocol';
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
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { insertBan } from './helpers/bans.js';

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

describe('POST /v1/chats', () => {
  it('opens a chat with roles fixed by the offer side, and reuses it', async () => {
    const o = await openChat('sell');
    expect(o.chat).toMatch(/^[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}$/);
    const again = await o.taker.b.post('/v1/chats', { offerId: o.offerId });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toEqual({ chat: o.chat, role: 'buyer' });
    const { rows } = await deps.db.query('select buyer_account_id, seller_account_id from chats where code = $1', [o.chat]);
    expect(rows).toEqual([{ buyer_account_id: o.taker.id, seller_account_id: o.poster.id }]);

    const b = await openChat('buy');
    const r = await deps.db.query('select buyer_account_id, seller_account_id from chats where code = $1', [b.chat]);
    expect(r.rows).toEqual([{ buyer_account_id: b.poster.id, seller_account_id: b.taker.id }]);
  });

  it('refuses the poster on their own offer, an unlisted offer and a strict-body violation', async () => {
    const poster = await trader();
    const offerId = await seedOffer(poster.id);
    expect((await poster.b.post('/v1/chats', { offerId })).json()).toMatchObject({ error: 'own-offer' });
    const other = await trader();
    const removed = await seedOffer(poster.id, 'sell', 'removed');
    expect((await other.b.post('/v1/chats', { offerId: removed })).statusCode).toBe(404);
    expect((await other.b.post('/v1/chats', { offerId: randomUUID() })).statusCode).toBe(404);
    expect((await other.b.post('/v1/chats', { offerId: 'nope' })).statusCode).toBe(404);
    expect((await other.b.post('/v1/chats', { offerId, role: 'seller' })).statusCode).toBe(400);
    expect((await other.b.post('/v1/chats', {})).statusCode).toBe(400);
  });

  it('an offer stored as fixed before the market-only rule (owner Q1) is not found', async () => {
    const poster = await trader();
    const other = await trader();
    // Migration 345 refuses new fixed rows; lift it for this one insert, as a row from before the rule.
    await deps.db.query('alter table offers drop constraint if exists offers_market_only');
    const legacy = await insertOffer(deps.db, { accountId: poster.id, side: 'sell', methodId: 'zelle', currency: 'USD', min: 1000, max: 100000, at: now });
    await deps.db.query(`update offers set price_mode = 'fixed', fixed_cents_per_xmr = 34000 where id = $1`, [legacy]);
    await deps.db.query(`alter table offers add constraint offers_market_only check (price_mode = 'market' and fixed_cents_per_xmr is null) not valid`);
    const res = await other.b.post('/v1/chats', { offerId: legacy });
    expect(res.statusCode, res.body).toBe(404);
    expect(res.json()).toEqual({ error: 'not-found' });
  });

  it('needs a session', async () => {
    const poster = await trader();
    const offerId = await seedOffer(poster.id);
    const res = await new Browser(app).post('/v1/chats', { offerId });
    expect(res.statusCode).toBe(401);
  });
});

describe('GET /v1/chats/:chat', () => {
  it('shows a party its role and the other side by Trade Tag; a non-participant gets 404', async () => {
    const o = await openChat();
    const res = await o.taker.b.get(`/v1/chats/${o.chat}`);
    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    expect(body).toMatchObject({ chat: o.chat, role: 'buyer', offerId: o.offerId, tradeCode: null, disputeOpen: false, tradeSecuredAt: null, attested: false, mySignPublic: null });
    expect((body.counterparty as { tradeTag: string }).tradeTag).toMatch(/^Dchl/);
    expect(JSON.stringify(body)).not.toContain(`"chl`);
    const stranger = await trader();
    const miss = await stranger.b.get(`/v1/chats/${o.chat}`);
    expect(miss.statusCode).toBe(404);
    const unknown = await stranger.b.get(`/v1/chats/${newTradeCode()}`);
    expect(unknown.statusCode).toBe(404);
    expect(miss.json()).toEqual(unknown.json());
  });

  it("review M8 (pay details): a chat linked to a secured trade carries that trade's secured_at, the same for both parties; a stranger still gets 404", async () => {
    const o = await openChat();
    const { trade } = await seedTrade(deps, { sellerId: o.poster.id, buyerId: o.taker.id, poster: 'seller', offerId: o.offerId });
    expect((await o.taker.b.post(`/v1/trades/${trade.code}/chat`, {})).json()).toEqual({ chat: o.chat, role: 'buyer' });
    // Linked, not yet secured: still null.
    const linked = (await o.taker.b.get(`/v1/chats/${o.chat}`)).json() as { tradeCode: string; tradeSecuredAt: string | null };
    expect(linked).toMatchObject({ tradeCode: trade.code, tradeSecuredAt: null });
    await driveTo(deps, trade, 'secured');
    const { rows } = await deps.db.query<{ secured_at: Date | null }>('select secured_at from trades where code = $1', [trade.code]);
    const at = rows[0]!.secured_at!.toISOString();
    expect(at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const buyer = (await o.taker.b.get(`/v1/chats/${o.chat}`)).json() as { tradeSecuredAt: string | null };
    const seller = (await o.poster.b.get(`/v1/chats/${o.chat}`)).json() as { tradeSecuredAt: string | null };
    expect(buyer.tradeSecuredAt).toBe(at);
    expect(seller.tradeSecuredAt).toBe(at);
    const stranger = await trader();
    const miss = await stranger.b.get(`/v1/chats/${o.chat}`);
    expect(miss.statusCode).toBe(404);
    expect(miss.body).not.toContain(at.slice(0, 10));
  });

  it("hides the other side's online status from a trader they blocked (review M5: presence through the viewer-aware summary)", async () => {
    const o = await openChat();
    // Linked to an open trade, so the chat stays open under the block (Task 37).
    const t = await seedTrade(deps, { sellerId: o.poster.id, buyerId: o.taker.id, poster: 'seller', offerId: o.offerId });
    expect((await o.taker.b.post(`/v1/trades/${t.code}/chat`, {})).json()).toEqual({ chat: o.chat, role: 'buyer' });
    // The poster is online (signed in just now) and blocks the taker.
    await deps.db.query('insert into account_blocks (account_id, blocked_id, created_at) values ($1, $2, $3)', [o.poster.id, o.taker.id, now]);
    const seen = (await o.taker.b.get(`/v1/chats/${o.chat}`)).json() as { counterparty: { online: boolean; lastSeenAt: string | null } };
    expect(seen.counterparty).toMatchObject({ online: false, lastSeenAt: null });
    // The blocker still sees the taker's status.
    const other = (await o.poster.b.get(`/v1/chats/${o.chat}`)).json() as { counterparty: { online: boolean } };
    expect(other.counterparty.online).toBe(true);
  });

  it('lists my chats', async () => {
    const o = await openChat();
    const res = await o.poster.b.get('/v1/chats');
    expect(res.statusCode).toBe(200);
    expect((res.json() as { chats: { chat: string; role: string }[] }).chats).toEqual([expect.objectContaining({ chat: o.chat, role: 'seller' })]);
  });
});

describe('chat identities and the attestation', () => {
  it('registers the session role once, with the chat proof (never the trade one)', async () => {
    const o = await openChat();
    expect((await o.taker.b.post(`/v1/chats/${o.chat}/identity`, { ...identityBody(o.chat, 'buyer'), signSecret: 'ff' })).statusCode).toBe(400);
    // A proof for the seller slot, posted by the buyer, is a bad proof: the role comes from the session.
    expect((await o.taker.b.post(`/v1/chats/${o.chat}/identity`, identityBody(o.chat, 'seller'))).json()).toMatchObject({ error: 'bad-proof' });
    const first = await o.taker.b.post(`/v1/chats/${o.chat}/identity`, identityBody(o.chat, 'buyer'));
    expect(first.statusCode).toBe(201);
    expect(first.json()).toEqual({ ok: true, role: 'buyer' });
    const mine = (await o.taker.b.get(`/v1/chats/${o.chat}`)).json() as { mySignPublic: string | null };
    expect(mine.mySignPublic).toMatch(/^[0-9a-f]{64}$/);
    expect(((await o.poster.b.get(`/v1/chats/${o.chat}`)).json() as { mySignPublic: string | null }).mySignPublic).toBeNull();
    expect((await o.taker.b.post(`/v1/chats/${o.chat}/identity`, identityBody(o.chat, 'buyer'))).json()).toMatchObject({ error: 'identity-exists' });
    const stranger = await trader();
    expect((await stranger.b.post(`/v1/chats/${o.chat}/identity`, identityBody(o.chat, 'buyer'))).statusCode).toBe(404);
  });

  it('refuses the key the other slot holds', async () => {
    const o = await openChat();
    const id = keyPair();
    expect((await o.taker.b.post(`/v1/chats/${o.chat}/identity`, identityBody(o.chat, 'buyer', id))).statusCode).toBe(201);
    const res = await o.poster.b.post(`/v1/chats/${o.chat}/identity`, identityBody(o.chat, 'seller', id));
    expect(res.json()).toMatchObject({ error: 'identity-conflict' });
  });

  it('is pending, then served to both parties once the moderation service posts it', async () => {
    const o = await openChat();
    expect((await o.taker.b.get(`/v1/chats/${o.chat}/attestation`)).statusCode).toBe(202);
    const buyer = keyPair();
    const seller = keyPair();
    await o.taker.b.post(`/v1/chats/${o.chat}/identity`, identityBody(o.chat, 'buyer', buyer));
    await o.poster.b.post(`/v1/chats/${o.chat}/identity`, identityBody(o.chat, 'seller', seller));
    const work = await signedInject('GET', '/internal/v1/chat-work');
    expect(work.statusCode).toBe(200);
    const item = (work.json() as { work: { chat: string; participants: Record<string, { signPublic: string; proof: string }> }[] }).work.find((w) => w.chat === o.chat);
    expect(item?.participants.buyer?.signPublic).toBe(buyer.signPublic);
    expect(item?.participants.seller?.signPublic).toBe(seller.signPublic);

    const mod = keyPair();
    const participants: Participants = {
      buyer: { signPublic: buyer.signPublic, boxPublic: buyer.boxPublic },
      seller: { signPublic: seller.signPublic, boxPublic: seller.boxPublic },
      mod: { signPublic: mod.signPublic, boxPublic: mod.boxPublic },
    };
    const channel = await channelFor(o.chat, 'chat');
    const sign = (a: Attestation) => sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(a), modSign.secret));
    // Wrong channel set (a trade's channels) and a swapped participant are refused.
    const bad: Attestation = { v: 1, trade: o.chat, channels: { escrow: await channelFor(o.chat, 'escrow') }, participants, issuedAt: now.toISOString() };
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'chat-attestation', attestation: bad, sig: sign(bad) })).statusCode).toBe(400);
    const swapped: Attestation = { v: 1, trade: o.chat, channels: { chat: channel }, participants: { ...participants, buyer: participants.mod }, issuedAt: now.toISOString() };
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'chat-attestation', attestation: swapped, sig: sign(swapped) })).statusCode).toBe(409);
    const withTerms = { v: 1, trade: o.chat, channels: { chat: channel }, participants, issuedAt: now.toISOString(), terms: {} } as unknown as Attestation;
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'chat-attestation', attestation: withTerms, sig: sign(withTerms) })).statusCode).toBe(400);

    const good: Attestation = { v: 1, trade: o.chat, channels: { chat: channel }, participants, issuedAt: now.toISOString() };
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'chat-attestation', attestation: good, sig: 'ab'.repeat(64) })).statusCode).toBe(400);
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'chat-attestation', attestation: good, sig: sign(good) })).statusCode).toBe(201);
    for (const b of [o.taker.b, o.poster.b]) {
      const res = await b.get(`/v1/chats/${o.chat}/attestation`);
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ attestation: good, sig: sign(good) });
    }
    const after = await signedInject('GET', '/internal/v1/chat-work');
    expect((after.json() as { work: { chat: string }[] }).work.map((w) => w.chat)).not.toContain(o.chat);
  });

  it('a refused chat answers attestation-refused and leaves the work list', async () => {
    const o = await openChat();
    await o.taker.b.post(`/v1/chats/${o.chat}/identity`, identityBody(o.chat, 'buyer'));
    await o.poster.b.post(`/v1/chats/${o.chat}/identity`, identityBody(o.chat, 'seller'));
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'chat-refused', chat: o.chat, reason: 'bad-proof' })).statusCode).toBe(201);
    expect((await o.taker.b.get(`/v1/chats/${o.chat}/attestation`)).json()).toMatchObject({ error: 'attestation-refused' });
    const work = await signedInject('GET', '/internal/v1/chat-work');
    expect((work.json() as { work: { chat: string }[] }).work.map((w) => w.chat)).not.toContain(o.chat);
  });
});

describe('envelopes', () => {
  it("review lead-trades-list-2 m3 (G19): a trade chat's line is published with the trade's part; an offer chat's with none", async () => {
    const r = await readyChat();
    const spy = vi.spyOn(app.events, 'publish');
    const partsOf = () => spy.mock.calls.filter(([, ev]) => (ev as { chat?: string }).chat === r.chat).map(([, , o]) => o);
    try {
      expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', 0))).statusCode).toBe(201);
      expect(partsOf()).toEqual([{}, {}]);
      const { code } = await seedTrade(deps, { sellerId: r.poster.id, buyerId: r.taker.id, poster: 'seller', offerId: r.offerId });
      expect((await r.taker.b.post(`/v1/trades/${code}/chat`, {})).json()).toMatchObject({ chat: r.chat });
      spy.mockClear();
      expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', 1))).statusCode).toBe(201);
      expect(partsOf()).toEqual([{ closed: false }, { closed: false }]);
      await deps.db.query("update trades set state = 'released', closed_at = $2 where code = $1", [code, now]);
      spy.mockClear();
      expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', 2))).statusCode).toBe(201);
      expect(partsOf()).toEqual([{ closed: true }, { closed: true }]);
    } finally {
      spy.mockRestore();
    }
  });

  it('waits for the attestation', async () => {
    const o = await openChat();
    const res = await o.taker.b.post(`/v1/chats/${o.chat}/envelopes`, {});
    expect(res.json()).toMatchObject({ error: 'chat-not-ready' });
  });

  it("an envelope from the buyer opens for the seller and the mod identity, and for nobody else", async () => {
    const r = await readyChat();
    const env = await envelope(r, 'buyer', 0, 'Sending via Zelle now');
    const posted = await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, env);
    expect(posted.statusCode).toBe(201);
    const got = await r.poster.b.get(`/v1/chats/${r.chat}/envelopes?after=0`);
    expect(got.statusCode).toBe(200);
    const list = (got.json() as { envelopes: { id: string; senderRole: string; envelope: Envelope }[] }).envelopes;
    expect(list).toHaveLength(1);
    expect(list[0]!.senderRole).toBe('buyer');
    expect((list[0] as unknown as { at: string }).at).toBe(now.toISOString());
    for (const [role, me] of [['seller', r.seller], ['mod', r.mod]] as const) {
      const opened = await open(list[0]!.envelope, { me, myRole: role, participants: r.participants, trade: r.channel, guard: new ReplayGuard(r.channel) });
      expect(opened.payload).toEqual({ text: 'Sending via Zelle now' });
    }
    const outsider = keyPair();
    await expect(open(list[0]!.envelope, { me: outsider, myRole: 'seller', participants: { ...r.participants, seller: outsider }, trade: r.channel, guard: new ReplayGuard(r.channel) })).rejects.toThrow();
    // The server holds ciphertext only.
    const { rows } = await deps.db.query<{ envelope: unknown }>('select envelope from chat_envelopes where chat = $1', [r.chat]);
    expect(JSON.stringify(rows)).not.toContain('Zelle');
  });

  it('stores the session role, never a body field', async () => {
    const r = await readyChat();
    // The buyer posts an envelope claiming to be the seller: refused, nothing stored.
    const forged = await envelope(r, 'seller', 0);
    const res = await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, forged);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'wrong-sender' });
    expect((await r.poster.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'seller', 0))).statusCode).toBe(201);
    const { rows } = await deps.db.query<{ sender_role: string; from: string }>(
      `select sender_role, envelope->>'from' as from from chat_envelopes where chat = $1`,
      [r.chat],
    );
    expect(rows).toEqual([{ sender_role: 'seller', from: 'seller' }]);
  });

  it('refuses a seq that is not above the sender\'s last with 409', async () => {
    const r = await readyChat();
    expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', 3))).statusCode).toBe(201);
    for (const seq of [3, 2]) {
      const res = await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', seq));
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ error: 'stale-seq' });
    }
    // The other sender's counter is its own.
    expect((await r.poster.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'seller', 0))).statusCode).toBe(201);
  });

  it('16 KiB + 1 → 413, an envelope for another channel and a bad shape → 400', async () => {
    const r = await readyChat();
    const env = (await envelope(r, 'buyer', 0)) as unknown as Record<string, unknown>;
    const big = JSON.stringify({ ...env, ct: 'A'.repeat(CHAT_BODY_MAX_BYTES) });
    const res = await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, JSON.parse(big));
    expect(res.statusCode).toBe(413);
    const other = await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, { ...env, trade: await channelFor(newTradeCode(), 'chat') });
    expect(other.json()).toMatchObject({ error: 'wrong-channel' });
    expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, { ...env, extra: 1 })).json()).toMatchObject({ error: 'bad-request' });
  });

  it('a non-participant gets 404 on both envelope routes, the same as an unknown chat', async () => {
    const r = await readyChat();
    const stranger = await trader();
    const env = await envelope(r, 'buyer', 0);
    const post = await stranger.b.post(`/v1/chats/${r.chat}/envelopes`, env);
    const get = await stranger.b.get(`/v1/chats/${r.chat}/envelopes`);
    const unknown = await stranger.b.get(`/v1/chats/${newTradeCode()}/envelopes`);
    expect([post.statusCode, get.statusCode, unknown.statusCode]).toEqual([404, 404, 404]);
    expect(get.json()).toEqual(unknown.json());
  });

  it('pages in id order across a digit boundary (ids ordered as numbers, never as their text)', async () => {
    const r = await readyChat();
    // Move the id sequence forward (never back) so this chat's ids go from 4 to 5 digits.
    const { rows: top } = await deps.db.query<{ m: string }>('select coalesce(max(id), 0)::text as m from chat_envelopes');
    await deps.db.query(`select setval(pg_get_serial_sequence('chat_envelopes', 'id'), $1)`, [Math.max(9998, Number(top[0]!.m))]);
    for (let i = 0; i < 3; i++) expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', i))).statusCode).toBe(201);
    const ids = (await deps.db.query<{ id: string }>('select id::text as id from chat_envelopes where chat = $1 order by chat_envelopes.id', [r.chat])).rows.map((x) => x.id);
    const all = (await r.taker.b.get(`/v1/chats/${r.chat}/envelopes`)).json() as { envelopes: { id: string }[] };
    expect(all.envelopes.map((e) => e.id)).toEqual(ids);
    const rest = (await r.taker.b.get(`/v1/chats/${r.chat}/envelopes?after=${ids[0]}`)).json() as { envelopes: { id: string }[] };
    expect(rest.envelopes.map((e) => e.id)).toEqual(ids.slice(1));
  });

  it('pages with after= and updates last_message_at', async () => {
    const r = await readyChat();
    for (let i = 0; i < 3; i++) expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', i))).statusCode).toBe(201);
    const all = (await r.taker.b.get(`/v1/chats/${r.chat}/envelopes`)).json() as { envelopes: { id: string }[] };
    expect(all.envelopes).toHaveLength(3);
    const rest = (await r.taker.b.get(`/v1/chats/${r.chat}/envelopes?after=${all.envelopes[0]!.id}`)).json() as { envelopes: { id: string }[] };
    expect(rest.envelopes.map((e) => e.id)).toEqual(all.envelopes.slice(1).map((e) => e.id));
    expect((await r.taker.b.get(`/v1/chats/${r.chat}/envelopes?after=x`)).statusCode).toBe(400);
    const { rows } = await deps.db.query<{ last_message_at: Date }>('select last_message_at from chats where code = $1', [r.chat]);
    expect(rows[0]!.last_message_at.toISOString()).toBe(now.toISOString());
  });

  it("tells both traders' open streams to re-read, with the chat code only", async () => {
    const r = await readyChat();
    const frames: Record<string, string[]> = { buyer: [], seller: [], stranger: [] };
    const stranger = await trader();
    const detach = [
      app.events.attach(r.taker.id, { send: (f) => frames.buyer!.push(f), close: () => undefined }),
      app.events.attach(r.poster.id, { send: (f) => frames.seller!.push(f), close: () => undefined }),
      app.events.attach(stranger.id, { send: (f) => frames.stranger!.push(f), close: () => undefined }),
    ];
    try {
      expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', 0))).statusCode).toBe(201);
      const want = `data: ${JSON.stringify({ type: 'chat', chat: r.chat })}\n\n`;
      expect(frames.buyer).toEqual([want]);
      expect(frames.seller).toEqual([want]);
      expect(frames.stranger).toEqual([]);
      // A refused post sends nothing.
      await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', 0));
      expect(frames.seller).toHaveLength(1);
    } finally {
      for (const d of detach) d?.();
    }
  });

  it('never logs the chat code or the ciphertext', async () => {
    const r = await readyChat();
    const env = await envelope(r, 'buyer', 0);
    await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, { ...env, ct: 'not base64' });
    await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, env);
    const text = logs.join('\n');
    expect(text).not.toContain(r.chat);
    expect(text).not.toContain(env.ct.slice(0, 40));
  });
});

describe('chat write budgets (review M7)', () => {
  it('a trader opens at most CHAT_OPEN_BUCKET new chats at once (429 slow-down); reopening an existing chat costs nothing', async () => {
    const taker = await trader();
    let first: { offerId: string; chat: string } | null = null;
    for (let i = 0; i < CHAT_OPEN_BUCKET.capacity; i++) {
      const poster = await trader();
      const offerId = await seedOffer(poster.id);
      const res = await taker.b.post('/v1/chats', { offerId });
      expect(res.statusCode).toBe(201);
      first ??= { offerId, chat: (res.json() as { chat: string }).chat };
    }
    const poster = await trader();
    const offerId = await seedOffer(poster.id);
    const over = await taker.b.post('/v1/chats', { offerId });
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ error: 'slow-down', retryAfterSeconds: expect.any(Number) });
    // The chat already open on an offer is answered with no new budget.
    const again = await taker.b.post('/v1/chats', { offerId: first!.offerId });
    expect(again.statusCode).toBe(200);
    expect(again.json()).toMatchObject({ chat: first!.chat });
    // Another trader's budget is their own.
    expect((await (await trader()).b.post('/v1/chats', { offerId })).statusCode).toBe(201);
    // It refills with time.
    setNow(new Date(now.getTime() + 60 * 60_000));
    expect((await taker.b.post('/v1/chats', { offerId })).statusCode).toBe(201);
  });

  it('a trader posts at most CHAT_POST_BUCKET envelopes at once (429 slow-down, nothing stored); the other side is not affected', async () => {
    const r = await readyChat();
    for (let i = 0; i < CHAT_POST_BUCKET.capacity; i++) expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', i))).statusCode).toBe(201);
    const over = await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', CHAT_POST_BUCKET.capacity));
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ error: 'slow-down' });
    const { rows } = await deps.db.query<{ n: number }>(`select count(*)::int as n from chat_envelopes where chat = $1 and sender_role = 'buyer'`, [r.chat]);
    expect(rows[0]!.n).toBe(CHAT_POST_BUCKET.capacity);
    expect((await r.poster.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'seller', 0))).statusCode).toBe(201);
    // A stranger is still a 404, never a 429.
    expect((await (await trader()).b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', 99))).statusCode).toBe(404);
    setNow(new Date(now.getTime() + 60_000));
    expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', CHAT_POST_BUCKET.capacity))).statusCode).toBe(201);
  });

  it('m5: malformed posts (400) do not spend the budget', async () => {
    const r = await readyChat();
    for (let i = 0; i < CHAT_POST_BUCKET.capacity + 5; i++) expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, { not: 'an envelope' })).statusCode).toBe(400);
    expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', 0))).statusCode).toBe(201);
  });
});

describe('POST /v1/trades/:code/chat', () => {
  /** A trade between the two traders of a chat-less pair, from a real offer of the poster. */
  async function tradeOn(offerId: string, seller: { id: string }, buyer: { id: string }): Promise<string> {
    // A trade's offer is fixed at take (Task 5's trades_set_once_deal), so it is seeded on the offer.
    const t = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', offerId });
    return t.code;
  }

  it("links the pair's pre-trade chat (a take reuses the chat) and gives both sides the same one", async () => {
    const o = await openChat('sell');
    const code = await tradeOn(o.offerId, o.poster, o.taker);
    const buyer = await o.taker.b.post(`/v1/trades/${code}/chat`, {});
    expect(buyer.statusCode).toBe(200);
    expect(buyer.json()).toEqual({ chat: o.chat, role: 'buyer' });
    expect((await o.poster.b.post(`/v1/trades/${code.toLowerCase()}/chat`, {})).json()).toEqual({ chat: o.chat, role: 'seller' });
    const { rows } = await deps.db.query('select trade_code from chats where code = $1', [o.chat]);
    expect(rows).toEqual([{ trade_code: code }]);
    // The next chat on the same offer between the same two is a new pre-trade chat.
    const next = await o.taker.b.post('/v1/chats', { offerId: o.offerId });
    expect(next.statusCode).toBe(201);
    expect((next.json() as { chat: string }).chat).not.toBe(o.chat);
  });

  it('makes one chat for a trade with none, the same for both sides', async () => {
    const seller = await trader();
    const buyer = await trader();
    const offerId = await seedOffer(seller.id);
    const code = await tradeOn(offerId, seller, buyer);
    const [a, b] = await Promise.all([buyer.b.post(`/v1/trades/${code}/chat`, {}), seller.b.post(`/v1/trades/${code}/chat`, {})]);
    expect(a.statusCode).toBe(200);
    const chat = (a.json() as { chat: string }).chat;
    expect(b.json()).toEqual({ chat, role: 'seller' });
    const view = (await buyer.b.get(`/v1/chats/${chat}`)).json() as { tradeCode: string; role: string };
    expect(view).toMatchObject({ tradeCode: code, role: 'buyer' });
  });

  // Lead call (20 Nov, review 2 of wip/lead-fix-chat-attest): a trade in a terminal state that has no
  // chat gets none (409 trade-closed); a chat it already has keeps opening (history, disputes, appeals,
  // ruling compliance and the purge path all use it).
  it.each(['released', 'refunded', 'cancelled', 'lapsed'])('a %s trade with no chat: 409 trade-closed, and no chat is made', async (state) => {
    const seller = await trader();
    const buyer = await trader();
    const offerId = await seedOffer(seller.id);
    const code = await tradeOn(offerId, seller, buyer);
    await deps.db.query('update trades set state = $2, closed_at = $3 where code = $1', [code, state, now]);
    for (const who of [buyer, seller]) {
      const r = await who.b.post(`/v1/trades/${code}/chat`, {});
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ error: 'trade-closed' });
    }
    expect((await deps.db.query('select 1 from chats where trade_code = $1', [code])).rows).toEqual([]);
  });

  it("a closed trade's existing chat keeps opening, for both sides", async () => {
    const seller = await trader();
    const buyer = await trader();
    const offerId = await seedOffer(seller.id);
    const code = await tradeOn(offerId, seller, buyer);
    const chat = ((await buyer.b.post(`/v1/trades/${code}/chat`, {})).json() as { chat: string }).chat;
    await deps.db.query("update trades set state = 'released', closed_at = $2 where code = $1", [code, now]);
    expect((await buyer.b.post(`/v1/trades/${code}/chat`, {})).json()).toEqual({ chat, role: 'buyer' });
    expect((await seller.b.post(`/v1/trades/${code}/chat`, {})).json()).toEqual({ chat, role: 'seller' });
  });

  it("a closed trade still links the pair's pre-trade chat on its offer (a chat that exists)", async () => {
    const o = await openChat('sell');
    const code = await tradeOn(o.offerId, o.poster, o.taker);
    await deps.db.query("update trades set state = 'cancelled', closed_at = $2 where code = $1", [code, now]);
    expect((await o.taker.b.post(`/v1/trades/${code}/chat`, {})).json()).toEqual({ chat: o.chat, role: 'buyer' });
  });

  it('a disputed trade (not terminal) with no chat still gets one', async () => {
    const seller = await trader();
    const buyer = await trader();
    const offerId = await seedOffer(seller.id);
    const code = await tradeOn(offerId, seller, buyer);
    await deps.db.query("update trades set state = 'disputed' where code = $1", [code]);
    expect((await buyer.b.post(`/v1/trades/${code}/chat`, {})).statusCode).toBe(200);
  });

  it('is 404 for anyone else or an unknown code', async () => {
    // (409 chat-unavailable, a trade with no offers row, cannot happen since Task 5's trades_offer_fk.)
    const seller = await trader();
    const buyer = await trader();
    const offerId = await seedOffer(seller.id);
    const code = await tradeOn(offerId, seller, buyer);
    const stranger = await trader();
    expect((await stranger.b.post(`/v1/trades/${code}/chat`, {})).statusCode).toBe(404);
    expect((await buyer.b.post(`/v1/trades/${newTradeCode()}/chat`, {})).statusCode).toBe(404);
    expect((await buyer.b.post('/v1/trades/nope/chat', {})).statusCode).toBe(404);
    expect((await new Browser(app).post(`/v1/trades/${code}/chat`, {})).statusCode).toBe(401);
  });
});

describe('purgeChats', () => {
  async function chatAt(created: Date, o: { lastMessage?: Date | null; trade?: { state: string; closedAt: Date | null } } = {}): Promise<string> {
    const saved = now;
    setNow(created);
    const c = await openChat();
    setNow(saved);
    if (o.lastMessage !== undefined) await deps.db.query('update chats set last_message_at = $2 where code = $1', [c.chat, o.lastMessage]);
    if (o.trade) {
      const t = await seedTrade(deps, { sellerId: c.poster.id, buyerId: c.taker.id, poster: 'seller' });
      await deps.db.query('update trades set state = $2, closed_at = $3 where code = $1', [t.code, o.trade.state, o.trade.closedAt]);
      await deps.db.query('update chats set trade_code = $2 where code = $1', [c.chat, t.code]);
    }
    return c.chat;
  }
  const exists = async (chat: string): Promise<boolean> => (await deps.db.query('select 1 from chats where code = $1', [chat])).rows.length === 1;

  it('deletes pre-trade chats after 7 idle days and undisputed trade chats 30 days after close; keeps a disputed chat', async () => {
    const t0 = new Date('2026-06-01T00:00:00Z');
    const idle = await chatAt(t0);
    const talked = await chatAt(t0, { lastMessage: new Date(t0.getTime() + 20 * DAY) });
    const closed = await chatAt(t0, { trade: { state: 'released', closedAt: t0 } });
    const disputed = await chatAt(t0, { trade: { state: 'disputed', closedAt: null } });
    const open = await chatAt(t0, { trade: { state: 'secured', closedAt: null } });
    const at = new Date(t0.getTime() + 31 * DAY);
    await purgeChats(deps.db, new Date(t0.getTime() + 8 * DAY));
    expect(await exists(idle)).toBe(false);
    expect(await exists(talked)).toBe(true);
    await purgeChats(deps.db, at);
    expect(await exists(talked)).toBe(false);
    expect(await exists(closed)).toBe(false);
    expect(await exists(disputed)).toBe(true);
    expect(await exists(open)).toBe(true);
  });

  /** A dispute row on the chat's trade, as the dispute machine leaves it at `status`. */
  async function addDispute(chat: string, seq: number, status: string, o: { openedAt: Date; closedAt?: Date } ): Promise<void> {
    const { rows } = await deps.db.query<{ trade_code: string }>('select trade_code from chats where code = $1', [chat]);
    const published = status === 'published' || status === 'final' || status === 'complying' || status === 'closed';
    await deps.db.query(
      `insert into disputes (code, seq, opened_by, reason, opened_at, status, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents,
         published_at, appeal_ends_at, closed_at)
       values ($1, $2, 'buyer', 'paid', $3, $4, $3, $3, 0, 100000, $5, $5, $6)`,
      [rows[0]!.trade_code, seq, o.openedAt, status, published ? o.openedAt : null, o.closedAt ?? null],
    );
  }
  const plusDays = (t: Date, d: number, ms = 0): Date => new Date(t.getTime() + d * DAY + ms);

  it('undisputed: gone only after exactly 30 days past the close, both sides of the boundary', async () => {
    const t0 = new Date('2026-03-01T00:00:00Z');
    const chat = await chatAt(t0, { trade: { state: 'released', closedAt: t0 } });
    await purgeChats(deps.db, plusDays(t0, 30));
    expect(await exists(chat)).toBe(true);
    await purgeChats(deps.db, plusDays(t0, 30, 1));
    expect(await exists(chat)).toBe(false);
  });

  it('disputed and closed: kept past the 30 days, gone only after 90 days past the dispute closing', async () => {
    const t0 = new Date('2026-02-01T00:00:00Z');
    const chat = await chatAt(t0, { trade: { state: 'released', closedAt: t0 } });
    const closedAt = plusDays(t0, 3);
    await addDispute(chat, 1, 'closed', { openedAt: t0, closedAt });
    await purgeChats(deps.db, plusDays(t0, 31));
    expect(await exists(chat)).toBe(true);
    await purgeChats(deps.db, plusDays(closedAt, 90));
    expect(await exists(chat)).toBe(true);
    await purgeChats(deps.db, plusDays(closedAt, 90, 1));
    expect(await exists(chat)).toBe(false);
  });

  it.each(['open', 'awaiting-approval', 'published', 'appealed', 'final', 'complying'])(
    'never while a dispute is %s, on a trade that has already closed',
    async (status) => {
      const t0 = new Date('2026-01-01T00:00:00Z');
      const chat = await chatAt(t0, { trade: { state: 'released', closedAt: t0 } });
      await addDispute(chat, 1, status, { openedAt: t0 });
      await purgeChats(deps.db, plusDays(t0, 500));
      expect(await exists(chat)).toBe(true);
    },
  );

  it('a later dispute on the same trade: kept while it is open, then 90 days from the last close', async () => {
    const t0 = new Date('2026-01-05T00:00:00Z');
    const chat = await chatAt(t0, { trade: { state: 'released', closedAt: t0 } });
    await addDispute(chat, 1, 'closed', { openedAt: t0, closedAt: plusDays(t0, 1) });
    await addDispute(chat, 2, 'open', { openedAt: plusDays(t0, 2) });
    await purgeChats(deps.db, plusDays(t0, 500));
    expect(await exists(chat)).toBe(true);
    const last = plusDays(t0, 501);
    await deps.db.query(`update disputes set status = 'closed', closed_at = $2 where code = (select trade_code from chats where code = $1) and seq = 2`, [chat, last]);
    await purgeChats(deps.db, plusDays(last, 90));
    expect(await exists(chat)).toBe(true);
    await purgeChats(deps.db, plusDays(last, 90, 1));
    expect(await exists(chat)).toBe(false);
  });

  it('a dispute committed while the purge waits on the chat row lock is seen by the re-read under that lock', async () => {
    const t0 = new Date('2026-01-10T00:00:00Z');
    const chat = await chatAt(t0, { trade: { state: 'released', closedAt: t0 } });
    await raceThePurge(chat, plusDays(t0, 31), async (q) => {
      await q.query(
        `insert into disputes (code, seq, opened_by, reason, opened_at, status, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents)
         values ((select trade_code from chats where code = $1), 1, 'system', 'escalated', $2, 'open', $2, $2, 0, 100000)`,
        [chat, plusDays(t0, 30)],
      );
    });
    expect(await exists(chat)).toBe(true);
  });

  it('M2: a dispute not yet committed makes the purge wait on the trade, and the chat stays', async () => {
    const t0 = new Date('2026-01-12T00:00:00Z');
    const chat = await chatAt(t0, { trade: { state: 'released', closedAt: t0 } });
    const code = (await deps.db.query<{ trade_code: string }>('select trade_code from chats where code = $1', [chat])).rows[0]!.trade_code;
    const dispute = await deps.db.connect();
    try {
      // As applyEvent does when a dispute opens: the trade's row lock, the state, then the dispute row.
      await dispute.query('begin');
      await dispute.query('select 1 from trades where code = $1 for update', [code]);
      await dispute.query(`update trades set state = 'disputed', closed_at = null where code = $1`, [code]);
      await dispute.query(
        `insert into disputes (code, seq, opened_by, reason, opened_at, status, reply_due_at, ruling_due_at, usd_cents, limit_usd_cents)
         values ($1, 1, 'system', 'escalated', $2, 'open', $2, $2, 0, 100000)`,
        [code, plusDays(t0, 30)],
      );
      const purge = purgeChats(deps.db, plusDays(t0, 31));
      for (let i = 0; ; i++) {
        const { rows } = await deps.db.query(
          `select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query like '%for share%'`,
        );
        if (rows.length > 0) break;
        if (i > 200) throw new Error('the purge never waited on the trade lock');
        await new Promise((r) => setTimeout(r, 25));
      }
      await dispute.query('commit');
      expect(await purge).toBe(0);
    } finally {
      dispute.release();
    }
    expect(await exists(chat)).toBe(true);
  });

  // M3: the rule says due, so the scan and the re-read cannot save the chat: only the delete's own
  // checks can. One case per check, so that removing either is caught by itself.
  it.each([
    ['a dispute row not yet closed, on a trade already closed', { t0: '2026-01-14T00:00:00Z', state: 'released', closed: true, row: true }],
    ['a trade in dispute with no dispute row', { t0: '2026-01-15T00:00:00Z', state: 'disputed', closed: false, row: false }],
  ])('the delete keeps a chat the rule calls due: %s', async (_name, c) => {
    const t0 = new Date(c.t0);
    const chat = await chatAt(t0, { trade: { state: c.state, closedAt: c.closed ? t0 : null } });
    if (c.row) await addDispute(chat, 1, 'open', { openedAt: t0 });
    const seen: boolean[] = [];
    const removed = await purgeChats(deps.db, plusDays(t0, 500), (facts) => {
      if (facts.createdAt.getTime() !== t0.getTime()) return false;
      seen.push(facts.disputeOpen);
      return true;
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true); // what the scan tells the rule: the first guard, by itself
    expect(removed).toBe(0);
    expect(await exists(chat)).toBe(true);
  });

  /**
   * Holds the chat's row lock in another transaction (as a post or a take does), starts the purge,
   * waits until the purge waits on that lock, then runs `change` and commits.
   */
  async function raceThePurge(chat: string, at: Date, change: (q: { query: (sql: string, args: unknown[]) => Promise<unknown> }) => Promise<void>): Promise<number> {
    const other = await deps.db.connect();
    try {
      await other.query('begin');
      await other.query('select 1 from chats where code = $1 for update', [chat]);
      const purge = purgeChats(deps.db, at);
      for (let i = 0; ; i++) {
        const { rows } = await deps.db.query(
          `select 1 from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and pid <> pg_backend_pid()`,
        );
        if (rows.length > 0) break;
        if (i > 200) throw new Error('the purge never waited on the chat lock');
        await new Promise((r) => setTimeout(r, 25));
      }
      await change(other);
      await other.query('commit');
      return await purge;
    } finally {
      other.release();
    }
  }

  it('m1: a chat written to after the scan judged it idle stays (re-checked under the row lock)', async () => {
    const t0 = new Date('2026-05-01T00:00:00Z');
    const chat = await chatAt(t0);
    const at = new Date(t0.getTime() + 8 * DAY);
    await raceThePurge(chat, at, async (q) => {
      await q.query('update chats set last_message_at = $2 where code = $1', [chat, at]);
    });
    expect(await exists(chat)).toBe(true);
  });

  it('m1: a pre-trade chat linked by a take after the scan stays with its new trade', async () => {
    const t0 = new Date('2026-04-01T00:00:00Z');
    const chat = await chatAt(t0);
    const owners = await deps.db.query<{ buyer_account_id: string; seller_account_id: string }>('select buyer_account_id, seller_account_id from chats where code = $1', [chat]);
    const t = await seedTrade(deps, { sellerId: owners.rows[0]!.seller_account_id, buyerId: owners.rows[0]!.buyer_account_id, poster: 'seller' });
    await raceThePurge(chat, new Date(t0.getTime() + 8 * DAY), async (q) => {
      await q.query('update chats set trade_code = $2 where code = $1', [chat, t.code]);
    });
    expect(await exists(chat)).toBe(true);
  });

  it('removes the envelopes with the chat, takes its due rule from a function, and is a retention job', async () => {
    const r = await readyChat();
    await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', 0));
    const seen: string[] = [];
    const removed = await purgeChats(deps.db, now, (facts) => {
      seen.push('called');
      return facts.createdAt.getTime() === now.getTime() && facts.lastMessageAt !== null;
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(removed).toBeGreaterThan(0);
    expect(await exists(r.chat)).toBe(false);
    expect((await deps.db.query('select 1 from chat_envelopes where chat = $1', [r.chat])).rows).toHaveLength(0);
    expect(RETENTION_JOBS.map((j) => j.name)).toContain('purgeChats');
  });
});

describe('the purge leaves a shred order for moderation and a purged mark for devices (design 5, tasks 1 and 2)', () => {
  /** A ready chat linked to an undisputed trade that closed at `now`, then purged 31 days later. */
  async function purgedTradeChat(): Promise<Ready & { trade: string; purgedAt: Date }> {
    const r = await readyChat();
    const t = await seedTrade(deps, { sellerId: r.poster.id, buyerId: r.taker.id, poster: 'seller' });
    await deps.db.query(`update trades set state = 'released', closed_at = $2 where code = $1`, [t.code, now]);
    await deps.db.query('update chats set trade_code = $2 where code = $1', [r.chat, t.code]);
    await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', 0));
    const purgedAt = new Date(now.getTime() + 31 * DAY);
    await purgeChats(deps.db, purgedAt);
    expect((await deps.db.query('select 1 from chats where code = $1', [r.chat])).rows).toHaveLength(0);
    return { ...r, trade: t.code, purgedAt };
  }
  const orders = async (): Promise<Array<{ chat: string; trade: string | null; purgedAt: string }>> => {
    const res = await signedInject('GET', '/internal/v1/chat-shred');
    expect(res.statusCode).toBe(200);
    return (res.json() as { orders: Array<{ chat: string; trade: string | null; purgedAt: string }> }).orders;
  };

  it('a purged chat is on the shred list with its trade code until moderation reports it shredded; a repeat report is still done', async () => {
    const r = await purgedTradeChat();
    expect(await orders()).toContainEqual({ chat: r.chat, trade: r.trade, purgedAt: r.purgedAt.toISOString() });
    const done = await signedInject('POST', '/internal/v1/reports', { kind: 'chat-shredded', chat: r.chat });
    expect(done.statusCode).toBe(201);
    expect((await orders()).map((o) => o.chat)).not.toContain(r.chat);
    expect((await signedInject('POST', '/internal/v1/reports', { kind: 'chat-shredded', chat: r.chat })).statusCode).toBe(201);
  });

  it('review M4: the least recently served order comes first, so an order moderation holds does not keep the rest waiting', async () => {
    const start = now;
    const page = internal;
    internal = await buildInternalListener({ db: deps.db, modSigningPublic: modSign.public, now: () => now.getTime(), workLimit: 1 });
    try {
      await deps.db.query('delete from chat_shred_orders');
      const held = await purgedTradeChat();
      const next = await readyChat();
      await purgeChats(deps.db, new Date(now.getTime() + 40 * DAY));
      const served: string[] = [];
      for (let i = 0; i < 3; i++) {
        now = new Date(now.getTime() + 1000);
        served.push(...(await orders()).map((o) => o.chat));
      }
      // Held (never reported shredded), yet the order behind it is served on the next pass.
      expect(served).toEqual([held.chat, next.chat, held.chat]);
    } finally {
      await internal.close();
      internal = page;
      now = start;
    }
  });

  it('a pre-trade chat is ordered shredded too, with no trade', async () => {
    const r = await readyChat();
    const purgedAt = new Date(now.getTime() + 8 * DAY);
    await purgeChats(deps.db, purgedAt);
    expect(await orders()).toContainEqual({ chat: r.chat, trade: null, purgedAt: purgedAt.toISOString() });
  });

  it('the shred list and report are signed like every internal route, and the report takes exactly { kind, chat }', async () => {
    const unsigned = await internal.inject({ method: 'GET', url: '/internal/v1/chat-shred' });
    expect(unsigned.statusCode).toBe(401);
    for (const body of [{ kind: 'chat-shredded' }, { kind: 'chat-shredded', chat: 'nope' }, { kind: 'chat-shredded', chat: newTradeCode(), extra: 1 }]) {
      expect((await signedInject('POST', '/internal/v1/reports', body)).statusCode).toBe(400);
    }
  });

  it("a former member gets 410 chat-purged on every chat route (the device erases its copy); anyone else, and an unknown chat, still 404", async () => {
    const r = await purgedTradeChat();
    const stranger = await trader();
    for (const who of [r.taker, r.poster]) {
      const answers = [
        await who.b.get(`/v1/chats/${r.chat}`),
        await who.b.get(`/v1/chats/${r.chat}/envelopes?after=0`),
        await who.b.get(`/v1/chats/${r.chat}/attestation`),
        await who.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', 1)),
        await who.b.post(`/v1/chats/${r.chat}/identity`, identityBody(r.chat, 'buyer')),
      ];
      expect(answers.map((a) => a.statusCode)).toEqual([410, 410, 410, 410, 410]);
      expect(answers[0]!.json()).toEqual({ error: 'chat-purged' });
    }
    expect((await stranger.b.get(`/v1/chats/${r.chat}`)).statusCode).toBe(404);
    expect((await r.taker.b.get(`/v1/chats/${newTradeCode()}`)).statusCode).toBe(404);
  });

  it('the mark names neither the chat nor its members, and goes CHAT_PURGED_MARK_DAYS after the purge', async () => {
    const r = await purgedTradeChat();
    const { rows } = await deps.db.query<{ tag: Buffer; purged_at: Date }>('select tag, purged_at from chat_purged_marks where purged_at = $1', [r.purgedAt]);
    expect(rows.length).toBeGreaterThanOrEqual(2);
    const dump = rows.map((m) => m.tag.toString('hex') + m.tag.toString('latin1')).join('');
    for (const secret of [r.chat, r.taker.id, r.poster.id, r.chat.replace(/-/g, '')]) expect(dump).not.toContain(secret);
    await purgeChats(deps.db, new Date(r.purgedAt.getTime() + CHAT_PURGED_MARK_DAYS * DAY));
    expect((await r.taker.b.get(`/v1/chats/${r.chat}`)).statusCode).toBe(410);
    await purgeChats(deps.db, new Date(r.purgedAt.getTime() + CHAT_PURGED_MARK_DAYS * DAY + 1));
    expect((await r.taker.b.get(`/v1/chats/${r.chat}`)).statusCode).toBe(404);
  });
});

// Security review of bans onto main, m2: a banned poster's offer is not listed (chat/routes.ts
// LISTED), so a new offer chat on it gets the hidden-offer answer, the same 404 as an unknown offer.
describe('bans (Plan 4 Task 27): no new offer chat on a banned poster\'s offer', () => {
  it('a trade-banned or site-banned poster\'s offer: POST /v1/chats is the unknown offer\'s 404 and opens no chat; once lifted it opens', async () => {
    const seen: Record<string, unknown> = {};
    const lifts: (() => Promise<void>)[] = [];
    for (const kind of ['trade', 'site'] as const) {
      const poster = await trader();
      const taker = await trader();
      const offerId = await seedOffer(poster.id);
      const banId = await insertBan(deps, poster.id, kind, null);
      const res = await taker.b.post('/v1/chats', { offerId });
      const unknown = await taker.b.post('/v1/chats', { offerId: randomUUID() });
      const { rows } = await deps.db.query<{ n: number }>('select count(*)::int as n from chats where offer_id = $1', [offerId]);
      seen[kind] = { status: res.statusCode, sameAsUnknown: res.body === unknown.body, chats: rows[0]!.n };
      lifts.push(async () => {
        await deps.db.query('update account_bans set lifted_at = $2, lifted_by = account_id where id = $1', [banId, deps.clock()]);
        expect((await taker.b.post('/v1/chats', { offerId })).statusCode, kind).toBe(201);
      });
    }
    // Both kinds checked before either is asserted, so a mutant shows on each.
    const hidden = { status: 404, sameAsUnknown: true, chats: 0 };
    expect(seen).toEqual({ trade: hidden, site: hidden });
    for (const lift of lifts) await lift();
  });
});

describe('blocks (Task 37): a blocked pair cannot open or use a chat, except the chat of a trade still open', () => {
  const block = async (blocker: string, blocked: string): Promise<void> => {
    await deps.db.query('insert into account_blocks (account_id, blocked_id, created_at) values ($1, $2, $3)', [blocker, blocked, now]);
  };

  it('POST /v1/chats is the same 404 as an unknown offer, either way round, for a new chat and for reopening one', async () => {
    const poster = await trader();
    const taker = await trader();
    const offerId = await seedOffer(poster.id);
    await block(poster.id, taker.id);
    const res = await taker.b.post('/v1/chats', { offerId });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual((await taker.b.post('/v1/chats', { offerId: randomUUID() })).json());

    const o = await openChat();
    await block(o.taker.id, o.poster.id);
    expect((await o.taker.b.post('/v1/chats', { offerId: o.offerId })).statusCode).toBe(404);
  });

  it('a pre-trade chat answers 404 on every route to both sides and leaves the list', async () => {
    const r = await readyChat();
    expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', 0))).statusCode).toBe(201);
    await block(r.poster.id, r.taker.id);
    for (const who of [r.taker, r.poster]) {
      expect((await who.b.get(`/v1/chats/${r.chat}`)).statusCode).toBe(404);
      expect((await who.b.get(`/v1/chats/${r.chat}/envelopes`)).statusCode).toBe(404);
      expect((await who.b.get(`/v1/chats/${r.chat}/attestation`)).statusCode).toBe(404);
      expect((await who.b.post(`/v1/chats/${r.chat}/identity`, identityBody(r.chat, 'buyer'))).statusCode).toBe(404);
      expect((await who.b.get('/v1/chats')).json()).toEqual({ chats: [] });
    }
    expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', 1))).statusCode).toBe(404);
    expect((await r.poster.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'seller', 0))).statusCode).toBe(404);
    // Unblocking opens it again.
    await deps.db.query('delete from account_blocks where account_id = $1 and blocked_id = $2', [r.poster.id, r.taker.id]);
    expect((await r.taker.b.get(`/v1/chats/${r.chat}`)).statusCode).toBe(200);
  });

  it("the chat of an open trade stays usable (the trade must finish); once the trade closes it answers 404", async () => {
    const r = await readyChat();
    const t = await seedTrade(deps, { sellerId: r.poster.id, buyerId: r.taker.id, poster: 'seller', offerId: r.offerId });
    expect((await r.taker.b.post(`/v1/trades/${t.code}/chat`, {})).json()).toEqual({ chat: r.chat, role: 'buyer' });
    await block(r.taker.id, r.poster.id);
    expect((await r.poster.b.post(`/v1/trades/${t.code}/chat`, {})).json()).toEqual({ chat: r.chat, role: 'seller' });
    expect((await r.poster.b.get(`/v1/chats/${r.chat}`)).statusCode).toBe(200);
    expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', 0))).statusCode).toBe(201);
    expect((await r.poster.b.get(`/v1/chats/${r.chat}/envelopes`)).json()).toMatchObject({ envelopes: [expect.objectContaining({ senderRole: 'buyer' })] });
    expect((await r.poster.b.get('/v1/chats')).json()).toEqual({ chats: [expect.objectContaining({ chat: r.chat })] });

    await deps.db.query("update trades set state = 'released', closed_at = $2 where code = $1", [t.code, now]);
    expect((await r.poster.b.post(`/v1/trades/${t.code}/chat`, {})).statusCode).toBe(404);
    expect((await r.poster.b.get(`/v1/chats/${r.chat}`)).statusCode).toBe(404);
    expect((await r.taker.b.post(`/v1/chats/${r.chat}/envelopes`, await envelope(r, 'buyer', 1))).statusCode).toBe(404);
  });

  it('a new trade chat between a blocked pair is made only while the trade is open', async () => {
    const seller = await trader();
    const buyer = await trader();
    const t = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', offerId: await seedOffer(seller.id) });
    await block(seller.id, buyer.id);
    expect((await buyer.b.post(`/v1/trades/${t.code}/chat`, {})).statusCode).toBe(200);
    const done = await seedTrade(deps, { sellerId: seller.id, buyerId: buyer.id, poster: 'seller', offerId: await seedOffer(seller.id) });
    await deps.db.query("update trades set state = 'released', closed_at = $2 where code = $1", [done.code, now]);
    expect((await buyer.b.post(`/v1/trades/${done.code}/chat`, {})).statusCode).toBe(404);
  });
});
