import { newTradeCode, type Role } from '@x2f/core';
import { makeChatGrant, makeDisputeNotice, makeGrantAccepted, unwrapChatKey, verifyChatGrant, openChat, openChatKeyRecord, ProtocolError, ReplayGuard as Guard2, seal, sealChat, verifyChatKeyRecord, makeChatKeyRecord, newChatKey, type ChatEnvelopeV2, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import { attestationBytes, channelFor, chatIdentityProofValid, checkChatEnvelopeV2, type Attestation, type PayDetailsPayload } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import { IDBFactory } from 'fake-indexeddb';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatKeyOf, makeChatKey, newChatState, sealChatMessage, sealPayDetails, type ChatState } from '../src/chat/chatCrypto.js';
import { ChatSendFailed, GRANT_FALLBACK_MS, createChatEngine, type ApiEnvelope, type ChatApi, type ChatApiView, type ChatEngine } from '../src/chat/engine.js';
import { memoryChatStore, openChatStore, type ChatStore } from '../src/chat/store.js';

/** A chat identity made with libsodium (apps/web makes real identities only in the escrow worker). */
async function testIdentity(): Promise<Identity> {
  await sodium.ready;
  const kp = sodium.crypto_sign_keypair();
  return {
    signPublic: sodium.to_hex(kp.publicKey),
    boxPublic: sodium.to_hex(sodium.crypto_sign_ed25519_pk_to_curve25519(kp.publicKey)),
    signSecret: kp.privateKey,
    boxSecret: sodium.crypto_sign_ed25519_sk_to_curve25519(kp.privateKey),
  };
}
const pub = (i: Identity) => ({ signPublic: i.signPublic, boxPublic: i.boxPublic });

let modKey: { publicKey: Uint8Array; privateKey: Uint8Array };
let modSigningPublic: string;

beforeAll(async () => {
  await sodium.ready;
  modKey = sodium.crypto_sign_keypair();
  modSigningPublic = sodium.to_hex(modKey.publicKey);
});

/** An in-memory chat API standing in for apps/api's routes (one chat, seen as the buyer). */
class FakeApi implements ChatApi {
  view: ChatApiView = { role: 'buyer', counterparty: 'Sam', disputeOpen: false, tradeSecuredAt: '2026-10-28T11:00:00.000Z', mySignPublic: null, grants: [], notice: null };
  grantPosts: unknown[] = [];
  async postGrant(_chat: string, grant: unknown) {
    this.check();
    this.grantPosts.push(grant);
    return 'ok' as const;
  }
  identities: Partial<Record<'buyer' | 'seller', { signPublic: string; boxPublic: string; proof: string }>> = {};
  attestation: { attestation: unknown; sig: unknown } | null = null;
  refused = false;
  envelopes: ApiEnvelope[] = [];
  posted: unknown[] = [];
  /** Every `after` the engine asked for (which envelopes a sync fetched). */
  afters: string[] = [];
  nextId = 1;
  /** The API purged the chat: every route answers 410 chat-purged (or 404 for `blocked`). */
  gone: 410 | 404 | null = null;
  calls = 0;
  /** Build task 5: the chat's signed key record (first writer wins), as `GET/POST …/key`. */
  key: unknown = null;
  keyPosts: unknown[] = [];
  constructor(readonly chat: string) {}
  async getKey() {
    this.check();
    return this.key;
  }
  async postKey(_chat: string, record: unknown) {
    this.check();
    this.keyPosts.push(record);
    if (this.key !== null) return 'exists' as const;
    this.key = record;
    return 'ok' as const;
  }
  check(): void {
    this.calls++;
    if (this.gone) throw Object.assign(new Error(`api ${this.gone}`), { status: this.gone, code: this.gone === 410 ? 'chat-purged' : 'not-found' });
  }
  async getChat() {
    this.check();
    return { ...this.view, mySignPublic: this.identities[this.view.role]?.signPublic ?? this.view.mySignPublic };
  }
  async registerIdentity(chat: string, body: { signPublic: string; boxPublic: string; proof: string }) {
    this.check();
    expect(await chatIdentityProofValid(chat, this.view.role, body)).toBe(true);
    if (this.identities[this.view.role]) return 'exists' as const;
    this.identities[this.view.role] = body;
    return 'ok' as const;
  }
  async getAttestation() {
    this.check();
    if (this.refused) throw Object.assign(new Error('refused'), { status: 409, code: 'attestation-refused' });
    return this.attestation;
  }
  async listEnvelopes(_chat: string, after: string) {
    this.check();
    this.afters.push(after);
    const list = this.envelopes.filter((e) => BigInt(e.id) > BigInt(after));
    return { envelopes: list.slice(0, 2), more: list.length > 2 };
  }
  async postEnvelope(_chat: string, envelope: unknown) {
    this.check();
    this.posted.push(envelope);
    return this.add(this.view.role, envelope);
  }
  add(senderRole: string, envelope: unknown): string {
    const id = String(this.nextId++);
    this.envelopes.push({ id, senderRole, envelope, at: `2026-10-28T12:00:0${id.length}Z` });
    return id;
  }
}

let chat: string;
let channel: string;
let api: FakeApi;
let seller: Identity;
let mod: Identity;
let made: Identity[];
let store: ReturnType<typeof memoryChatStore>;

function engine(): ChatEngine {
  return createChatEngine({
    api,
    store,
    newIdentity: async () => {
      const i = await testIdentity();
      made.push(i);
      return i;
    },
    modSigningPublic,
  });
}

/** Moderation attests the chat once both traders registered (with `key` signing it). */
function attest(key = modKey.privateKey, extra: Partial<Attestation> = {}): Participants {
  const buyer = api.identities.buyer!;
  const participants: Participants = { buyer: { signPublic: buyer.signPublic, boxPublic: buyer.boxPublic }, seller: pub(seller), mod: pub(mod) };
  // Issued now: moderation attests after both registered, so never before this device's identity (review M1).
  const a: Attestation = { v: 1, trade: chat, channels: { chat: channel }, participants, issuedAt: new Date().toISOString(), ...extra };
  api.attestation = { attestation: a, sig: sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(a), key)) };
  return participants;
}

/**
 * The chat key as the seller's device holds it (build task 5): from the stored record, or made by
 * the seller when there is none yet (the seller's device came first).
 */
async function tkOf(parts: Participants): Promise<Uint8Array> {
  if (api.key === null) {
    const m = await makeChatKey({ channel, role: 'seller', me: seller, participants: parts });
    api.key = m.record;
    return m.tk;
  }
  return chatKeyOf(api.key, { channel, role: 'seller', me: seller, participants: parts });
}

let sellerState: ChatState;
async function fromSeller(text: string, parts: Participants, senderRole = 'seller', seq?: number): Promise<ChatEnvelopeV2> {
  const state = seq === undefined ? sellerState : { ...sellerState, nextSeq: seq };
  const r = await sealChatMessage({ role: 'seller', me: seller, participants: parts, state, text, tk: await tkOf(parts) });
  sellerState = r.state;
  api.add(senderRole, r.envelope);
  return r.envelope;
}

beforeEach(async () => {
  chat = newTradeCode();
  channel = await channelFor(chat, 'chat');
  api = new FakeApi(chat);
  seller = await testIdentity();
  mod = await testIdentity();
  made = [];
  store = memoryChatStore();
  sellerState = newChatState(channel);
});

describe('chat engine: device binding and the attestation', () => {
  it("makes, saves and registers this device's identity, then waits for the attestation", async () => {
    const snap = await engine().sync(chat);
    expect(snap).toMatchObject({ phase: 'waiting', role: 'buyer', counterparty: 'Sam', lines: [] });
    expect(made).toHaveLength(1);
    expect(api.identities.buyer?.signPublic).toBe(made[0]!.signPublic);
    // Saved before it was registered, with its secrets (only ever inside the worker).
    const rec = await store.load(chat);
    expect(rec).toMatchObject({ registered: true, role: 'buyer', identity: { signPublic: made[0]!.signPublic } });
    // A second sync makes no new identity.
    await engine().sync(chat);
    expect(made).toHaveLength(1);
  });

  it('another device of the account (the API holds another key) is read-only and never seals', async () => {
    api.view.mySignPublic = (await testIdentity()).signPublic;
    const e = engine();
    expect((await e.sync(chat)).phase).toBe('other-device');
    await expect(e.send(chat, 'hello')).rejects.toMatchObject({ code: 'not-ready' });
    expect(made).toHaveLength(0);
    expect(api.posted).toHaveLength(0);
  });

  it('an attestation not signed by the pinned moderation key fails closed: nothing is sealed', async () => {
    await engine().sync(chat);
    attest(sodium.crypto_sign_keypair().privateKey);
    const e = engine();
    expect(await e.sync(chat)).toMatchObject({ phase: 'failed', problem: 'security' });
    await expect(e.send(chat, 'hi')).rejects.toBeInstanceOf(ChatSendFailed);
    expect(api.posted).toHaveLength(0);
    expect((await store.load(chat))?.attestation).toBeNull();
  });

  it('an attestation for another channel (a trade attestation) is refused', async () => {
    await engine().sync(chat);
    attest(modKey.privateKey, { channels: { escrow: await channelFor(chat, 'escrow'), signals: await channelFor(chat, 'signals') } });
    expect(await engine().sync(chat)).toMatchObject({ phase: 'failed', problem: 'security' });
  });

  // Review lead-escrow-harden M1 (16 Nov): the chat record keeps when this device made its chat
  // identity, and an attestation issued before that (a backdated one) is refused.
  it('the record keeps the time its identity was made; an attestation issued before it fails closed', async () => {
    const before = Date.now();
    await engine().sync(chat);
    const made = (await store.load(chat))?.identityCreatedAt;
    expect(made).toBeGreaterThanOrEqual(before);
    expect(made).toBeLessThanOrEqual(Date.now());
    attest(modKey.privateKey, { issuedAt: '2026-10-28T12:00:00.000Z' });
    const e = engine();
    expect(await e.sync(chat)).toMatchObject({ phase: 'failed', problem: 'security' });
    await expect(e.send(chat, 'hi')).rejects.toBeInstanceOf(ChatSendFailed);
    expect(api.posted).toHaveLength(0);
    expect((await store.load(chat))?.attestation).toBeNull();
  });

  it("moderation's refusal is shown as refused", async () => {
    await engine().sync(chat);
    api.refused = true;
    expect(await engine().sync(chat)).toMatchObject({ phase: 'failed', problem: 'refused' });
  });
});

/**
 * Regtest e2e gap 5 (Plan 5 Tasks 15 and 20): a trade's chat is attested only once BOTH traders
 * registered a chat identity, and before this fix a device registered one only when its chat was
 * opened. So the buyer's proof could not be sent until the seller had opened the chat. `prepare`
 * is the identity step of a sync alone, run by the escrow runtime when the device runs the trade.
 */
describe('chat engine: prepare, the chat identity without opening the chat (gap 5)', () => {
  it('makes, saves and registers the identity, and reads nothing else: no attestation, no key, no envelope', async () => {
    const reads: string[] = [];
    for (const m of ['getAttestation', 'getKey', 'postKey', 'listEnvelopes', 'postEnvelope', 'postGrant'] as const) {
      const f = (api[m] as (...a: unknown[]) => Promise<unknown>).bind(api);
      (api as unknown as Record<string, unknown>)[m] = async (...a: unknown[]) => (reads.push(m), f(...a));
    }
    expect(await engine().prepare(chat)).toBe('registered');
    expect(made).toHaveLength(1);
    expect(api.identities.buyer?.signPublic).toBe(made[0]!.signPublic);
    expect(await store.load(chat)).toMatchObject({ registered: true, role: 'buyer', attestation: null, cursor: '0', receipts: [] });
    expect(reads).toEqual([]);
  });

  it('is idempotent, and the chat opened later goes on with that same identity', async () => {
    const e = engine();
    await e.prepare(chat);
    await e.prepare(chat);
    expect(made).toHaveLength(1);
    expect((await e.sync(chat)).phase).toBe('waiting');
    expect(made).toHaveLength(1);
    const parts = attest();
    await fromSeller('hello', parts);
    expect((await engine().sync(chat)).lines.map((l) => l.text)).toEqual(['hello']);
  });

  it('a prepare and a sync at once make one identity (one operation at a time per chat)', async () => {
    const e = engine();
    await Promise.all([e.prepare(chat), e.sync(chat), e.prepare(chat)]);
    expect(made).toHaveLength(1);
    expect((await store.load(chat))?.identity.signPublic).toBe(api.identities.buyer?.signPublic);
  });

  it('another device of the account holds the role: other-device, nothing made or registered', async () => {
    api.view.mySignPublic = (await testIdentity()).signPublic;
    expect(await engine().prepare(chat)).toBe('other-device');
    expect(made).toHaveLength(0);
    expect(api.identities.buyer).toBeUndefined();
  });

  it('410 chat-purged erases the record, as every chat call does', async () => {
    const e = engine();
    await e.prepare(chat);
    api.gone = 410;
    await expect(e.prepare(chat)).rejects.toMatchObject({ status: 410 });
    expect(store.records.has(chat)).toBe(false);
  });
});

/**
 * Review m1 (review-lead-fix-chat-attest-2026-11-20): two tabs are two workers over one IndexedDB
 * store, so the per-chat queue of one engine does not keep them apart. Before the fix the slower tab
 * saved its own identity over the one the faster tab had registered, and the device was left holding
 * a key the API never took: `other-device` in its own chat for good.
 */
describe('chat engine: two tabs over one store (review m1)', () => {
  /** Two engines (two tabs' workers) over two connections to one fake IndexedDB; B makes its identity slowly. */
  async function twoTabs(o: { lock?: (name: string, fn: () => Promise<unknown>) => Promise<unknown> } = {}) {
    const idb = new IDBFactory();
    const [sa, sb] = [await openChatStore({ indexedDB: idb }), await openChatStore({ indexedDB: idb })];
    const madeBy = { a: 0, b: 0 };
    const tab = (s: ChatStore, name: 'a' | 'b', delay: number) =>
      createChatEngine({
        api,
        store: s,
        newIdentity: async () => {
          madeBy[name]++;
          const i = await testIdentity();
          await new Promise((r) => setTimeout(r, delay));
          return i;
        },
        modSigningPublic,
        ...(o.lock ? { lock: o.lock } : {}),
      });
    return { a: tab(sa, 'a', 0), b: tab(sb, 'b', 40), sa, sb, madeBy };
  }

  it('without a lock (the store layer alone): the stored identity is the registered one, and both tabs go on with it', async () => {
    const t = await twoTabs({ lock: (_n, fn) => fn() });
    expect(await Promise.all([t.a.prepare(chat), t.b.prepare(chat)])).toEqual(['registered', 'registered']);
    expect((await t.sa.load(chat))?.identity.signPublic).toBe(api.identities.buyer?.signPublic);
    expect((await t.sb.load(chat))?.identity.signPublic).toBe(api.identities.buyer?.signPublic);
    expect((await t.b.sync(chat)).phase).toBe('waiting');
  });

  it('with a per-chat lock (the first layer): the second tab finds the first one\'s identity and makes none', async () => {
    const held = new Map<string, Promise<unknown>>();
    const names: string[] = [];
    const lock = (name: string, fn: () => Promise<unknown>): Promise<unknown> => {
      names.push(name);
      const run = (held.get(name) ?? Promise.resolve()).then(fn, fn);
      held.set(name, run.catch(() => undefined));
      return run;
    };
    const t = await twoTabs({ lock });
    await Promise.all([t.b.prepare(chat), t.a.prepare(chat)]);
    expect(t.madeBy.a + t.madeBy.b).toBe(1);
    expect(names).toEqual([`x2f-chat-identity:${chat}`, `x2f-chat-identity:${chat}`]);
    expect((await t.sa.load(chat))?.identity.signPublic).toBe(api.identities.buyer?.signPublic);
  });

  /**
   * Review 3 follow-up (wip/lead-chat-tab-lock): tab B loaded the chat's record before tab A pinned the
   * chat key's fingerprint (tkh, review F3), then saved that stale record. Before the fix, the save put
   * a record with no tkh back, and the device lost F3's guard. Every save is watched here: once a tkh is
   * stored, no later save may leave the chat without it (or with another one).
   */
  async function staleTab(lock: (name: string, fn: () => Promise<unknown>) => Promise<unknown>) {
    const idb = new IDBFactory();
    const inner = await openChatStore({ indexedDB: idb });
    const stored: Array<string | undefined> = [];
    const watched = (s: ChatStore): ChatStore => ({
      ...s,
      save: async (rec) => {
        await s.save(rec);
        stored.push((await inner.load(rec.chat))?.tkh);
      },
    });
    const sa = watched(await openChatStore({ indexedDB: idb }));
    const sb = watched(await openChatStore({ indexedDB: idb }));
    const mk = (st: ChatStore, a: ChatApi) => createChatEngine({ api: a, store: st, newIdentity: testIdentity, modSigningPublic, lock });
    await mk(sa, api).prepare(chat);
    attest();
    // Tab B's API answers the attestation slowly: B has loaded the record (no attestation, no tkh) and waits.
    let bWaiting!: () => void;
    const bLoaded = new Promise<void>((r) => (bWaiting = r));
    const bound = (m: keyof ChatApi) => (api[m] as (...x: unknown[]) => Promise<unknown>).bind(api);
    const slowApi = Object.fromEntries((['getChat', 'registerIdentity', 'listEnvelopes', 'postEnvelope', 'getKey', 'postKey', 'postGrant'] as const).map((m) => [m, bound(m)])) as unknown as ChatApi;
    slowApi.getAttestation = async () => {
      bWaiting();
      await new Promise((r) => setTimeout(r, 60));
      return api.getAttestation();
    };
    return { a: mk(sa, api), b: mk(sb, slowApi), inner, stored, bLoaded };
  }
  const neverBackwards = (stored: Array<string | undefined>): void => {
    const first = stored.findIndex((t) => t !== undefined);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(stored.slice(first)).toEqual(stored.slice(first).map(() => stored[first]));
  };

  it('a stale tab never drops the pinned tkh: the record is merged on save (no lock)', async () => {
    const t = await staleTab((_n, fn) => fn());
    const b = t.b.sync(chat);
    await t.bLoaded;
    expect((await t.a.sync(chat)).phase).toBe('ready');
    const tkh = (await t.inner.load(chat))?.tkh;
    expect(tkh).toBeDefined();
    await b;
    expect((await t.inner.load(chat))?.tkh).toBe(tkh);
    neverBackwards(t.stored);
  });

  it('a stale tab never drops the pinned tkh: the per-chat lock holds each whole sync', async () => {
    const held = new Map<string, Promise<unknown>>();
    const lock = (name: string, fn: () => Promise<unknown>): Promise<unknown> => {
      const run = (held.get(name) ?? Promise.resolve()).then(fn, fn);
      held.set(name, run.catch(() => undefined));
      return run;
    };
    const t = await staleTab(lock);
    const b = t.b.sync(chat);
    await t.bLoaded;
    const a = t.a.sync(chat);
    await Promise.all([a, b]);
    expect((await t.inner.load(chat))?.tkh).toBeDefined();
    neverBackwards(t.stored);
  });

  it('a stale tab that the API then tells "no key" (404) makes no second key: the merged record carries the pin', async () => {
    const t = await staleTab((_n, fn) => fn());
    const b = t.b.sync(chat);
    await t.bLoaded;
    await t.a.sync(chat);
    const posts = api.keyPosts.length;
    // A compromised API now hides the key record from tab B.
    const key = api.key;
    api.key = null;
    expect(await b).toMatchObject({ phase: 'failed', problem: 'security' });
    expect(api.keyPosts.length).toBe(posts);
    api.key = key;
  });

  // Review of wip/lead-chat-tab-lock, m1: keep() saves only over a record that exists; a missing one
  // was erased (a purge, or another tab's erase), so the save fails as purged and never re-creates it.
  it('a save that finds the record erased meanwhile fails as purged and never writes it back (m1)', async () => {
    const e = createChatEngine({ api, store, newIdentity: testIdentity, modSigningPublic, lock: (_n, fn) => fn() });
    await e.prepare(chat);
    const parts = attest();
    await fromSeller('one', parts);
    // Another tab erases the chat while this sync reads its envelopes.
    const list = api.listEnvelopes.bind(api);
    api.listEnvelopes = async (c, after) => {
      await store.delete(chat);
      return list(c, after);
    };
    await expect(e.sync(chat)).rejects.toMatchObject({ status: 410 });
    expect(store.records.has(chat)).toBe(false);
  });

  // m2: a keep() refusal wipes this chat's key from the worker's memory before it throws.
  it('a save refused for another pinned tkh forgets the cached chat key (m2)', async () => {
    const e = createChatEngine({ api, store, newIdentity: testIdentity, modSigningPublic, lock: (_n, fn) => fn() });
    await e.prepare(chat);
    const parts = attest();
    await fromSeller('one', parts);
    expect((await e.sync(chat)).phase).toBe('ready');
    const good = (await store.load(chat))!;
    // Another tkh appears in the store between this sync's load and its next save.
    const list = api.listEnvelopes.bind(api);
    api.listEnvelopes = async (c, after) => {
      api.listEnvelopes = list;
      await store.save({ ...(await store.load(chat))!, tkh: 'ab'.repeat(32) });
      return list(c, after);
    };
    await fromSeller('two', parts);
    await expect(e.sync(chat)).rejects.toBeInstanceOf(ProtocolError);
    // The store is put right; the next sync must open the key again (it was not left cached).
    await store.save(good);
    let reads = 0;
    const getKey = api.getKey.bind(api);
    api.getKey = async () => (reads++, getKey());
    await e.sync(chat);
    expect(reads).toBe(1);
  });

  it('the lock is navigator.locks by default, one per chat', async () => {
    const names: string[] = [];
    vi.stubGlobal('navigator', { locks: { request: (name: string, fn: () => Promise<unknown>) => (names.push(name), fn()) } });
    try {
      await engine().prepare(chat);
      await engine().sync(chat);
    } finally {
      vi.unstubAllGlobals();
    }
    expect(names).toEqual([`x2f-chat-identity:${chat}`, `x2f-chat-identity:${chat}`]);
  });
});

describe('chat engine: messages', () => {
  it('sends a sealed v2 message the seller opens with the chat key; the mod identity holds no copy of the key before a dispute grant; the stored line is mine', async () => {
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    const snap = await e.send(chat, 'Sending via Zelle now');
    expect(snap.phase).toBe('ready');
    expect(snap.lines).toEqual([{ id: '1', from: 'buyer', text: 'Sending via Zelle now', at: expect.any(String), mine: true, gapBefore: false }]);
    expect(JSON.stringify(api.posted)).not.toContain('Zelle');
    const o = await openChat(api.posted[0], { tk: await tkOf(parts), trade: channel, participants: parts, guard: new Guard2(channel) });
    expect(o.payload).toEqual({ text: 'Sending via Zelle now' });
    // Design section 3: "only after a dispute" is a lock. The key record holds copies for buyer and seller only.
    const rec = await verifyChatKeyRecord(api.key, { chat: channel, participants: parts });
    await expect(openChatKeyRecord(rec, 'buyer', mod)).rejects.toBeInstanceOf(ProtocolError);
    await expect(openChatKeyRecord(rec, 'seller', mod)).rejects.toBeInstanceOf(ProtocolError);
  });

  it("shows the seller's lines across pages, keeps them after a reload, and drops a replay", async () => {
    await engine().sync(chat);
    const parts = attest();
    const first = await fromSeller('one', parts);
    await fromSeller('two', parts);
    await fromSeller('three', parts);
    const snap = await engine().sync(chat);
    expect(snap.lines.map((l) => [l.text, l.mine])).toEqual([['one', false], ['two', false], ['three', false]]);
    // A server that serves the first envelope again under a new id: the persisted guard refuses it.
    api.add('seller', first);
    const again = await engine().sync(chat);
    expect(again.lines.map((l) => l.text)).toEqual(['one', 'two', 'three']);
  });

  it('a line whose stored sender role differs from its signer is dropped', async () => {
    await engine().sync(chat);
    const parts = attest();
    await fromSeller('forged role', parts, 'buyer');
    expect((await engine().sync(chat)).lines).toEqual([]);
  });

  it('junk from the server never throws out of a sync: every bad line is dropped and the good ones show', async () => {
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    api.add('seller', null);
    api.add('seller', 7);
    api.add('seller', 'not an envelope');
    api.add('seller', []);
    api.add('constructor', { v: 1 });
    await fromSeller('real line', parts);
    const snap = await e.sync(chat);
    expect(snap.phase).toBe('ready');
    expect(snap.lines.map((l) => l.text)).toEqual(['real line']);
  });

  it('a junk attestation fails closed with nothing shown', async () => {
    const e = engine();
    await e.sync(chat);
    api.attestation = { attestation: { v: 'junk' }, sig: 'zz' };
    const snap = await e.sync(chat);
    expect(snap.phase).toBe('failed');
    expect(snap.problem).toBe('security');
    expect(snap.lines).toEqual([]);
  });

  it('marks a gap when a sender skipped a seq', async () => {
    await engine().sync(chat);
    const parts = attest();
    await fromSeller('a', parts, 'seller', 0);
    await fromSeller('c', parts, 'seller', 2);
    expect((await engine().sync(chat)).lines.map((l) => [l.text, l.gapBefore])).toEqual([['a', false], ['c', true]]);
  });

  it("marks a gap before a sender's first line when it is not seq 0 (review M1: the server dropped their first lines)", async () => {
    await engine().sync(chat);
    const parts = attest();
    await fromSeller('c', parts, 'seller', 2);
    await fromSeller('d', parts);
    expect((await engine().sync(chat)).lines.map((l) => [l.text, l.gapBefore])).toEqual([['c', true], ['d', false]]);
  });

  it('says when a sync stopped with more envelopes to read, and the next sync goes on from there (review M8)', async () => {
    await engine().sync(chat);
    const parts = attest();
    // The fake serves 2 a page; one sync reads at most 20 pages (40 envelopes).
    for (let i = 0; i < 45; i++) await fromSeller(`m${i}`, parts);
    const first = await engine().sync(chat);
    expect(first.more).toBe(true);
    expect(first.lines).toHaveLength(40);
    const second = await engine().sync(chat);
    expect(second.more).toBe(false);
    expect(second.lines).toHaveLength(45);
  });

  it('a rate-limited post is slow-down, not a connection problem (review M7)', async () => {
    const e = engine();
    await e.sync(chat);
    attest();
    api.postEnvelope = async () => {
      throw Object.assign(new Error('api 429'), { status: 429, code: 'slow-down' });
    };
    await expect(e.send(chat, 'hi')).rejects.toMatchObject({ code: 'slow-down' });
  });

  it('a moderator line shows only while a dispute is open, and then appears in order', async () => {
    await engine().sync(chat);
    const parts = attest();
    const m = await sealChat({ trade: channel, from: 'mod', seq: 0, type: 'chat.msg', payload: { text: 'Moderator here' }, tk: await tkOf(parts), me: mod });
    api.add('mod', m);
    await fromSeller('after', parts);
    const before = await engine().sync(chat);
    expect(before.lines.map((l) => l.text)).toEqual(['after']);
    api.view.disputeOpen = true;
    const during = await engine().sync(chat);
    expect(during.lines.map((l) => [l.from, l.text])).toEqual([['mod', 'Moderator here'], ['seller', 'after']]);
    expect(during.disputeOpen).toBe(true);
  });

  it('a mod-signed envelope the server recorded as a trader is dropped (the badge needs both)', async () => {
    await engine().sync(chat);
    const parts = attest();
    api.view.disputeOpen = true;
    const m = await sealChat({ trade: channel, from: 'mod', seq: 0, type: 'chat.msg', payload: { text: 'x' }, tk: await tkOf(parts), me: mod });
    api.add('seller', m);
    expect((await engine().sync(chat)).lines).toEqual([]);
  });

  it('refuses empty text and keeps the seq for the next message', async () => {
    const e = engine();
    await e.sync(chat);
    attest();
    await expect(e.send(chat, '   ')).rejects.toMatchObject({ code: 'bad-text' });
    await e.send(chat, 'ok');
    expect((api.posted[0] as Envelope).seq).toBe(0);
  });

  it('after losing the device state, a new send never reuses a seq the server holds', async () => {
    const e = engine();
    await e.sync(chat);
    attest();
    await e.send(chat, 'first');
    // The saved state is rolled back to before the send (an older copy): the guard catches up first.
    const rec = (await store.load(chat))!;
    await store.save({ ...rec, state: null, cursor: '0', receipts: [] });
    await engine().send(chat, 'second');
    expect(api.posted.map((p) => (p as Envelope).seq)).toEqual([0, 1]);
    const lines = (await engine().sync(chat)).lines;
    expect(lines.map((l) => l.text)).toEqual(['first', 'second']);
  });
});

describe('chat engine: no text on the device, and erased on purge (owner p11-10, design 2026-11-08 section 5)', () => {
  it('keeps no message text in the store: only keys, the guard, the cursor and receipts', async () => {
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    await fromSeller('IBAN DE89 3704', parts);
    await e.send(chat, 'Sending via Zelle now');
    expect((await e.sync(chat)).lines.map((l) => l.text)).toEqual(['IBAN DE89 3704', 'Sending via Zelle now']);
    const saved = store.records.get(chat)!;
    expect(saved).not.toContain('IBAN');
    expect(saved).not.toContain('Zelle');
    expect(JSON.parse(saved)).toMatchObject({ v: 2, receipts: [{ id: '1', from: 'seller', seq: 0 }, { id: '2', from: 'buyer', seq: 0 }] });
  });

  it('a reopened app (a new engine) decrypts every line again from the server; a line the server no longer serves shows as a placeholder (review I2)', async () => {
    await engine().sync(chat);
    const parts = attest();
    await fromSeller('one', parts);
    await fromSeller('two', parts);
    await engine().sync(chat);
    const before = api.calls;
    expect((await engine().sync(chat)).lines.map((l) => l.text)).toEqual(['one', 'two']);
    expect(api.calls).toBeGreaterThan(before + 1);
    const at1 = api.envelopes.find((x) => x.id === '1')!.at;
    api.envelopes = api.envelopes.filter((x) => x.id !== '1');
    // The device still holds the receipt (sender, seq, time, signature): the gap is shown, never hidden.
    const after = await engine().sync(chat);
    expect(after.lines).toEqual([
      { id: '1', from: 'seller', text: '', at: at1, mine: false, gapBefore: false, missing: true },
      expect.objectContaining({ id: '2', text: 'two' }),
    ]);
    expect(after.lines[1]).not.toHaveProperty('missing');
  });

  it('a re-read shows a line only for the envelope the guard took: another one the sender signed with that seq is dropped', async () => {
    await engine().sync(chat);
    const parts = attest();
    await fromSeller('pay to account A', parts, 'seller', 0);
    expect((await engine().sync(chat)).lines.map((l) => l.text)).toEqual(['pay to account A']);
    const other = await sealChatMessage({ role: 'seller', me: seller, participants: parts, state: newChatState(channel), text: 'pay to account B', tk: await tkOf(parts) });
    api.envelopes[0] = { ...api.envelopes[0]!, envelope: other.envelope };
    expect((await engine().sync(chat)).lines).toEqual([expect.objectContaining({ id: '1', from: 'seller', text: '', missing: true })]);
  });

  it('review I3: a read that fails partway through the first sync is not taken as done: the next sync reads from the start again', async () => {
    await engine().sync(chat);
    const parts = attest();
    for (const t of ['a', 'b', 'c', 'd', 'e']) await fromSeller(t, parts);
    await engine().sync(chat);
    const e = engine();
    const list = api.listEnvelopes.bind(api);
    let n = 0;
    api.listEnvelopes = async (c, after) => {
      if (++n === 2) throw Object.assign(new Error('circuit dropped'), { status: 502 });
      return list(c, after);
    };
    await expect(e.sync(chat)).rejects.toMatchObject({ status: 502 });
    const lines = (await e.sync(chat)).lines;
    expect(lines.map((l) => l.text)).toEqual(['a', 'b', 'c', 'd', 'e']);
    expect(lines.some((l) => l.missing)).toBe(false);
  });

  it('review M2: a re-read skips an envelope at or below the cursor that it holds no receipt for (a new line given an old id)', async () => {
    await engine().sync(chat);
    const parts = attest();
    await fromSeller('one', parts);
    api.nextId = 3;
    await fromSeller('two', parts);
    await engine().sync(chat);
    // The API slips a new line (the next seq) in at id 2, below the cursor.
    const injected = await sealChatMessage({ role: 'seller', me: seller, participants: parts, state: sellerState, text: 'send to account B', tk: await tkOf(parts) });
    api.envelopes.splice(1, 0, { id: '2', senderRole: 'seller', envelope: injected.envelope, at: null });
    // The seller's real next line (the same seq) follows past the cursor.
    await fromSeller('three', parts);
    expect((await engine().sync(chat)).lines.map((l) => l.text)).toEqual(['one', 'two', 'three']);
    expect((await engine().sync(chat)).lines.map((l) => l.text)).toEqual(['one', 'two', 'three']);
    expect(JSON.parse(store.records.get(chat)!).receipts.map((r: { id: string }) => r.id)).toEqual(['1', '3', '4']);
  });

  it('a v1 record (which kept the text) is upgraded: its text is dropped and its lines come from the server again', async () => {
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    await fromSeller('hello', parts);
    await e.sync(chat);
    const v2 = JSON.parse(store.records.get(chat)!) as Record<string, unknown> & { receipts: Array<Record<string, unknown>> };
    const { receipts, ...rest } = v2;
    store.records.set(chat, JSON.stringify({ ...rest, v: 1, messages: receipts.map(({ sig: _sig, ...m }) => ({ ...m, text: 'hello' })) }));
    expect((await engine().sync(chat)).lines.map((l) => l.text)).toEqual(['hello']);
    expect(store.records.get(chat)).not.toContain('hello');
  });

  it('on 410 chat-purged the device erases its record and the lines it held, and makes no new identity', async () => {
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    await fromSeller('secret line', parts);
    expect((await e.sync(chat)).lines).toHaveLength(1);
    api.gone = 410;
    await expect(e.sync(chat)).rejects.toMatchObject({ status: 410 });
    expect(store.records.has(chat)).toBe(false);
    await expect(e.sync(chat)).rejects.toMatchObject({ status: 410 });
    expect(made).toHaveLength(1);
    expect(store.records.has(chat)).toBe(false);
  });

  it('a send into a purged chat erases it too', async () => {
    const e = engine();
    await e.sync(chat);
    attest();
    await e.sync(chat);
    const postEnvelope = api.postEnvelope.bind(api);
    api.postEnvelope = async (c, env) => {
      api.gone = 410;
      return postEnvelope(c, env);
    };
    await expect(e.send(chat, 'hi')).rejects.toBeInstanceOf(ChatSendFailed);
    expect(store.records.has(chat)).toBe(false);
  });

  it('a 404 (a block hides the chat) keeps the record', async () => {
    const e = engine();
    await e.sync(chat);
    api.gone = 404;
    await expect(e.sync(chat)).rejects.toMatchObject({ status: 404 });
    expect(store.records.has(chat)).toBe(true);
  });

  it('sweep erases every stored chat the API says was purged and keeps the rest, even when one check fails', async () => {
    const e = engine();
    await e.sync(chat);
    const kept = { ...(await store.load(chat))! };
    for (const c of ['AAAA-AAAA-AAAA-AAAA', 'BBBB-BBBB-BBBB-BBBB', 'CCCC-CCCC-CCCC-CCCC']) await store.save({ ...kept, chat: c });
    const answers: Record<string, number> = { 'AAAA-AAAA-AAAA-AAAA': 410, 'BBBB-BBBB-BBBB-BBBB': 503, 'CCCC-CCCC-CCCC-CCCC': 410 };
    api.getChat = async (c?: string) => {
      const status = answers[c ?? ''];
      if (status) throw Object.assign(new Error('x'), { status, code: status === 410 ? 'chat-purged' : 'internal' });
      return { ...api.view, mySignPublic: api.identities.buyer?.signPublic ?? null };
    };
    expect(await e.sweep()).toEqual(['AAAA-AAAA-AAAA-AAAA', 'CCCC-CCCC-CCCC-CCCC']);
    expect([...store.records.keys()].sort()).toEqual([chat, 'BBBB-BBBB-BBBB-BBBB'].sort());
  });
});

describe('the worker side of the chat protocol (serve.ts)', () => {
  it('review M3: sweeps the stored chats for purged ones when the worker starts, before any chat message, and once', async () => {
    const { serveChat } = await import('../src/chat/serve.js');
    let sweeps = 0;
    const fake = { sync: async () => ({}) as never, send: async () => ({}) as never, sendPay: async () => ({}) as never, sendProof: async () => ({}) as never, sendUnblurred: async () => ({}) as never, sendNotice: async () => ({}) as never, grant: async () => ({}) as never, prepare: async () => ({}) as never, sweep: async () => (sweeps++, []) };
    let handler: (e: { data: unknown }) => void = () => undefined;
    const out: unknown[] = [];
    serveChat({ postMessage: (m: unknown) => out.push(m), addEventListener: (_t: 'message', cb: (e: { data: unknown }) => void) => (handler = cb) } as never, async () => fake);
    for (let i = 0; i < 200 && sweeps === 0; i++) await new Promise((r) => setTimeout(r, 5));
    expect(sweeps).toBe(1);
    handler({ data: { t: 'chat-sync', id: 1, chat } });
    handler({ data: { t: 'chat-sync', id: 2, chat } });
    for (let i = 0; i < 200 && out.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
    expect(sweeps).toBe(1);
  });

  it('review M3: a sweep with no live session (401) erases nothing and is tried again on the next chat message', async () => {
    const e = engine();
    await e.sync(chat);
    api.getChat = async () => {
      throw Object.assign(new Error('x'), { status: 401, code: 'unauthenticated' });
    };
    await expect(e.sweep()).rejects.toMatchObject({ status: 401 });
    expect(store.records.has(chat)).toBe(true);
    const { serveChat } = await import('../src/chat/serve.js');
    const results: Array<() => Promise<string[]>> = [
      async () => {
        throw Object.assign(new Error('x'), { status: 401 });
      },
      async () => [],
    ];
    let sweeps = 0;
    const fake = { sync: async () => ({}) as never, send: async () => ({}) as never, sendPay: async () => ({}) as never, sendProof: async () => ({}) as never, sendUnblurred: async () => ({}) as never, sendNotice: async () => ({}) as never, grant: async () => ({}) as never, prepare: async () => ({}) as never, sweep: () => results[Math.min(sweeps++, 1)]!() };
    let handler: (e: { data: unknown }) => void = () => undefined;
    const out: unknown[] = [];
    serveChat({ postMessage: (m: unknown) => out.push(m), addEventListener: (_t: 'message', cb: (e: { data: unknown }) => void) => (handler = cb) } as never, async () => fake);
    for (let i = 0; i < 200 && sweeps === 0; i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 5));
    expect(sweeps).toBe(1);
    handler({ data: { t: 'chat-sync', id: 1, chat } });
    for (let i = 0; i < 200 && out.length < 1; i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 5));
    expect(sweeps).toBe(2);
    handler({ data: { t: 'chat-sync', id: 2, chat } });
    for (let i = 0; i < 200 && out.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
    await new Promise((r) => setTimeout(r, 5));
    expect(sweeps).toBe(2);
  });

  it('answers sync and send with snapshots, refuses a bad chat code, and never posts a key', async () => {
    const { serveChat, chatConfig } = await import('../src/chat/serve.js');
    const out: unknown[] = [];
    let handler: (e: { data: unknown }) => void = () => undefined;
    const port = { postMessage: (m: unknown) => out.push(m), addEventListener: (_t: 'message', cb: (e: { data: unknown }) => void) => (handler = cb) };
    serveChat(port as never, async () => engine());
    const settle = async () => {
      for (let i = 0; i < 200 && out.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    };
    handler({ data: { t: 'chat-sync', id: 1, chat: 'not a code' } });
    await settle();
    expect(out.shift()).toEqual({ t: 'chat', id: 1, ok: false, error: 'not-found' });
    handler({ data: { t: 'chat-sync', id: 2, chat } });
    await settle();
    expect(out.shift()).toMatchObject({ t: 'chat', id: 2, ok: true, snapshot: { phase: 'waiting' } });
    attest();
    handler({ data: { t: 'chat-send', id: 3, chat, text: 'hi' } });
    await settle();
    const sent = out.shift() as { ok: boolean; snapshot: unknown };
    expect(sent.ok).toBe(true);
    const json = JSON.stringify(sent);
    expect(json).not.toContain(made[0]!.signPublic);
    expect(json).not.toContain('Secret');
    handler({ data: { t: 'escrow-thing', id: 4 } });
    await new Promise((r) => setTimeout(r, 20));
    expect(out).toEqual([]);
    api.gone = 410;
    handler({ data: { t: 'chat-sync', id: 5, chat } });
    await settle();
    expect(out.shift()).toEqual({ t: 'chat', id: 5, ok: false, error: 'not-found' });
    expect(() => chatConfig({})).toThrow();
    expect(chatConfig({ VITE_MOD_SIGNING_PUBLIC: modSigningPublic })).toEqual({ modSigningPublic });
  });
});

describe('chat engine: the payment details package (J-08, S-090)', () => {
  const INTERAC: PayDetailsPayload = { v: 2, method: 'INTERAC_E_TRANSFER', fields: [{ key: 'name', value: 'Jane Doe' }, { key: 'email', value: 'jane@example.ca' }] };
  const TEXT = 'Payment details\nFull name: Jane Doe\nEmail: jane@example.ca';

  /** The seller's device sends a package (this device is the buyer here, as everywhere in this file). */
  async function sellerPay(pay: PayDetailsPayload, parts: Participants): Promise<ChatEnvelopeV2> {
    const r = await sealPayDetails({ role: 'seller', me: seller, participants: parts, state: sellerState, pay, tk: await tkOf(parts) });
    sellerState = r.state;
    api.add('seller', r.envelope);
    return r.envelope;
  }

  it('sendPay posts one sealed envelope; every request body the API gets carries none of the boxes in the clear', async () => {
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    const snap = await e.sendPay(chat, INTERAC);
    expect(snap.lines).toEqual([{ id: '1', from: 'buyer', text: TEXT, pay: INTERAC, at: expect.any(String), mine: true, gapBefore: false }]);
    expect(api.posted).toHaveLength(1);
    // The one body posted: a well-formed envelope, and nothing of the package readable in it (each probe has a character base64/hex never produce).
    const wire = JSON.stringify(api.posted[0]);
    expect(() => checkChatEnvelopeV2(JSON.parse(wire), channel, 'buyer')).not.toThrow();
    for (const s of ['Jane Doe', 'jane@example.ca', 'Full name', 'Payment details', 'INTERAC_E_TRANSFER', '"pay"', '"text"', '"name"', '"email"']) expect(wire, s).not.toContain(s);
    // The other side opens the same package with the chat key.
    const o = await openChat(api.posted[0], { tk: await tkOf(parts), trade: channel, participants: parts, guard: new Guard2(channel) });
    expect(o.payload).toEqual({ text: TEXT, pay: INTERAC });
  });

  it('a bad package is refused as bad-details with nothing posted, and the seq is kept for the next line', async () => {
    const e = engine();
    await e.sync(chat);
    attest();
    await expect(e.sendPay(chat, { ...INTERAC, fields: [{ key: 'email', value: 'jane@example.ca' }] })).rejects.toMatchObject({ code: 'bad-details' });
    await expect(e.sendPay(chat, 'not a package' as unknown as PayDetailsPayload)).rejects.toMatchObject({ code: 'bad-details' });
    expect(api.posted).toHaveLength(0);
    await e.send(chat, 'ok');
    expect((api.posted[0] as Envelope).seq).toBe(0);
  });

  it('review M2 (pay details): the worker itself refuses a package while the trade is not secured (not-ready): nothing sealed or posted, the seq kept; a plain line still goes', async () => {
    api.view.tradeSecuredAt = null;
    const e = engine();
    await e.sync(chat);
    attest();
    await expect(e.sendPay(chat, INTERAC)).rejects.toMatchObject({ code: 'not-ready' });
    expect(api.posted).toHaveLength(0);
    expect((await store.load(chat))!.state?.nextSeq ?? 0).toBe(0);
    await e.send(chat, 'the escrow is still securing');
    expect((api.posted[0] as Envelope).seq).toBe(0);
    // Secured: the same package goes.
    api.view.tradeSecuredAt = '2026-10-28T12:30:00.000Z';
    const snap = await e.sendPay(chat, INTERAC);
    expect(snap.lines.map((l) => [l.text, l.pay ?? null])).toEqual([
      ['the escrow is still securing', null],
      [TEXT, INTERAC],
    ]);
    expect(api.posted).toHaveLength(2);
  });

  it("shows the seller's package as a line with `pay`, and again after a reopen (no text or boxes kept on the device)", async () => {
    await engine().sync(chat);
    const parts = attest();
    await fromSeller('Here you go', parts);
    await sellerPay(INTERAC, parts);
    const snap = await engine().sync(chat);
    expect(snap.lines.map((l) => [l.text, l.pay ?? null])).toEqual([
      ['Here you go', null],
      [TEXT, INTERAC],
    ]);
    // Nothing of it on the device.
    const saved = JSON.stringify(store.records.get(chat));
    for (const s of ['Jane Doe', 'jane@example.ca', 'INTERAC_E_TRANSFER']) expect(saved, s).not.toContain(s);
    // A new engine (a reopened app) decrypts it again and shows the package again.
    expect((await engine().sync(chat)).lines[1]?.pay).toEqual(INTERAC);
  });

  it("owner Q12: a package is held while the trade is not secured (the snapshot says so) and shown once it is; a plain line is not held", async () => {
    api.view.tradeSecuredAt = null;
    await engine().sync(chat);
    const parts = attest();
    await sellerPay(INTERAC, parts);
    await fromSeller('sent too early, sorry', parts);
    const early = await engine().sync(chat);
    expect(early.paySecured).toBe(false);
    expect(early.lines.map((l) => l.text)).toEqual(['sent too early, sorry']);
    expect(api.calls).toBeGreaterThan(0);
    // Still not secured on the next sync (and after a reopen): still held, not shown. The guard took
    // it (a held receipt), so the line after it was not stuck behind it, and nothing of it is on the device.
    expect((await engine().sync(chat)).lines.map((l) => l.text)).toEqual(['sent too early, sorry']);
    expect((await store.load(chat))!.receipts.map((r) => [r.seq, r.heldPay === true])).toEqual([[0, true], [1, false]]);
    for (const s of ['Jane Doe', 'jane@example.ca', 'INTERAC_E_TRANSFER']) expect(JSON.stringify(store.records.get(chat)), s).not.toContain(s);
    // Secured: the held envelope is read again and shown, in its place.
    api.view.tradeSecuredAt = '2026-10-28T12:30:00.000Z';
    const now = await engine().sync(chat);
    expect(now.paySecured).toBe(true);
    expect(now.lines.map((l) => [l.text, l.pay ?? null])).toEqual([
      [TEXT, INTERAC],
      ['sent too early, sorry', null],
    ]);
  });

  /** A tampered seller client: an arbitrary inner payload sealed as the seller, bypassing the chat's own checks. */
  async function sellerRaw(payload: unknown, seq: number, parts: Participants, from: Role = 'seller'): Promise<ChatEnvelopeV2> {
    return sealChat({ trade: channel, from, seq, type: 'chat.msg', payload, tk: await tkOf(parts), me: from === 'mod' ? mod : seller });
  }

  it('review M1 (pay details): an envelope that can never become valid is skipped for good: the cursor passes it, later lines show, and the next sync fetches nothing again', async () => {
    await engine().sync(chat);
    const parts = attest();
    api.view.disputeOpen = true;
    await fromSeller('before', parts);
    // A lying package (the text is not the rendering of its boxes), a malformed payload, a mod-signed package.
    api.add('seller', await sellerRaw({ text: 'Payment details\nFull name: Jane Doe\nEmail: other@example.ca', pay: INTERAC }, 1, parts));
    api.add('seller', await sellerRaw({ text: 7 }, 2, parts));
    api.add('mod', await sellerRaw({ text: TEXT, pay: INTERAC }, 0, parts, 'mod'));
    // The guard did not move for any of them, so the seller may reuse seq 1 (chatCrypto's contract).
    await fromSeller('after', parts, 'seller', 1);
    const e = engine();
    const first = await e.sync(chat);
    // Review payee-fields-2 m-4: the seller's package that could not be shown is a neutral line for the
    // buyer (no text of it); the malformed payload and the mod-signed package are still no line at all.
    expect(first.lines.map((l) => [l.id, l.text, l.missing ?? false, l.unreadablePay ?? false, l.gapBefore])).toEqual([
      ['1', 'before', false, false, false],
      ['2', '', false, true, false],
      ['5', 'after', false, false, false],
    ]);
    // The next sync asks only past the last envelope: the refused ones are not fetched again.
    api.afters = [];
    expect((await e.sync(chat)).lines.map((l) => l.text)).toEqual(['before', '', 'after']);
    expect(api.afters).toEqual(['5']);
    // Each refused envelope has a receipt marked refused and nothing else of it; the cursor is past them.
    const rec = (await store.load(chat))!;
    expect(rec.cursor).toBe('5');
    expect(rec.receipts.map((r) => [r.id, r.refused === true, r.refusedPay === true])).toEqual([['1', false, false], ['2', true, true], ['3', true, false], ['4', true, false], ['5', false, false]]);
    for (const s of ['Jane Doe', 'other@example.ca', 'INTERAC_E_TRANSFER']) expect(JSON.stringify(store.records.get(chat)), s).not.toContain(s);
    // A reopened app (a new engine) re-reads the chat: the refused ones are not placeholders; the package stays its neutral line.
    api.afters = [];
    expect((await engine().sync(chat)).lines.map((l) => [l.text, l.missing ?? false, l.unreadablePay ?? false])).toEqual([['before', false, false], ['', false, true], ['after', false, false]]);
    expect(api.afters[0]).toBe('0');
  });

  it('review payee-fields-2 m-4: a package this reader cannot open (a box its table does not know) is a neutral line for the payer, never its contents', async () => {
    await engine().sync(chat);
    const parts = attest();
    const newer = { v: 2, method: 'INTERAC_E_TRANSFER', fields: [{ key: 'name', value: 'Jane Doe' }, { key: 'email', value: 'jane@example.ca' }, { key: 'futureBox', value: 'future-box-secret' }] };
    api.add('seller', await sellerRaw({ text: `${TEXT}\nFuture box: future-box-secret`, pay: newer }, 0, parts));
    await fromSeller('did you get them?', parts, 'seller', 1);
    const s = await engine().sync(chat);
    expect(s.lines.map((l) => [l.from, l.text, l.unreadablePay ?? false, l.pay ?? null])).toEqual([
      ['seller', '', true, null],
      ['seller', 'did you get them?', false, null],
    ]);
    for (const v of ['Jane Doe', 'jane@example.ca', 'future-box-secret']) expect(JSON.stringify(store.records.get(chat)), v).not.toContain(v);
  });

  /** A package this reader's table cannot show (a box it does not know), sealed as the seller at `seq`. */
  const unknownBoxPackage = (seq: number, parts: Participants) =>
    sellerRaw({ text: `${TEXT}\nFuture box: future-box-secret`, pay: { v: 2, method: 'INTERAC_E_TRANSFER', fields: [{ key: 'name', value: 'Jane Doe' }, { key: 'email', value: 'jane@example.ca' }, { key: 'futureBox', value: 'future-box-secret' }] } }, seq, parts);

  it('review sanctions m-1: an unshowable package that came before the escrow was secured is no line until it is, then the neutral line in its place', async () => {
    api.view.tradeSecuredAt = null;
    await engine().sync(chat);
    const parts = attest();
    api.add('seller', await unknownBoxPackage(0, parts));
    await fromSeller('later', parts, 'seller', 1);
    const line = (l: { text: string; unreadablePay?: true; gapBefore: boolean }) => [l.text, l.unreadablePay ?? false, l.gapBefore];
    const early = await engine().sync(chat);
    expect(early.paySecured).toBe(false);
    expect(early.lines.map(line)).toEqual([['later', false, false]]);
    // Still not secured after a reopen: still no line.
    expect((await engine().sync(chat)).lines.map(line)).toEqual([['later', false, false]]);
    // Secured: the payer is told, in the package's place, and nothing of it is on the device.
    api.view.tradeSecuredAt = '2026-10-28T12:30:00.000Z';
    expect((await engine().sync(chat)).lines.map(line)).toEqual([['', true, false], ['later', false, false]]);
    for (const v of ['Jane Doe', 'jane@example.ca', 'future-box-secret']) expect(JSON.stringify(store.records.get(chat)), v).not.toContain(v);
  });

  it('review sanctions m-2: the line after an unshowable package has no gap marker (in this sync and a later one), but a real gap before or after it still shows', async () => {
    await engine().sync(chat);
    const parts = attest();
    const e = engine();
    const gaps = async () => (await e.sync(chat)).lines.map((l) => [l.text, l.unreadablePay ?? false, l.gapBefore]);
    // In one sync: the package at seq 0, the next line at seq 1.
    api.add('seller', await unknownBoxPackage(0, parts));
    await fromSeller('did you get them?', parts, 'seller', 1);
    expect(await gaps()).toEqual([['', true, false], ['did you get them?', false, false]]);
    // A later sync (and a reopened app) reads its seq from the stored receipt: another package at seq 2, then seq 3.
    api.add('seller', await unknownBoxPackage(2, parts));
    expect((await gaps()).at(-1)).toEqual(['', true, false]);
    await fromSeller('and again?', parts, 'seller', 3);
    expect((await gaps()).at(-1)).toEqual(['and again?', false, false]);
    // Seq 4 never came: the package at 5 shows the gap; seq 6 does not; seq 8 after it (7 missing) does.
    api.add('seller', await unknownBoxPackage(5, parts));
    await fromSeller('six', parts, 'seller', 6);
    await fromSeller('eight', parts, 'seller', 8);
    expect((await engine().sync(chat)).lines.map((l) => [l.text, l.unreadablePay ?? false, l.gapBefore])).toEqual([
      ['', true, false],
      ['did you get them?', false, false],
      ['', true, false],
      ['and again?', false, false],
      ['', true, true],
      ['six', false, false],
      ['eight', false, true],
    ]);
  });

  it('review sanctions m-2: before the escrow is secured, a gap before a held unshowable package shows on the next line, and moves back onto it once secured', async () => {
    api.view.tradeSecuredAt = null;
    await engine().sync(chat);
    const parts = attest();
    await fromSeller('hi', parts, 'seller', 0);
    // Seq 1 never came.
    api.add('seller', await unknownBoxPackage(2, parts));
    await fromSeller('later', parts, 'seller', 3);
    const line = (l: { text: string; unreadablePay?: true; gapBefore: boolean }) => [l.text, l.unreadablePay ?? false, l.gapBefore];
    expect((await engine().sync(chat)).lines.map(line)).toEqual([['hi', false, false], ['later', false, true]]);
    api.view.tradeSecuredAt = '2026-10-28T12:30:00.000Z';
    expect((await engine().sync(chat)).lines.map(line)).toEqual([['hi', false, false], ['', true, true], ['later', false, false]]);
  });

  it('review sanctions m-2: a gap before a package held until the escrow is secured (owner Q12) is never hidden', async () => {
    api.view.tradeSecuredAt = null;
    await engine().sync(chat);
    const parts = attest();
    await fromSeller('hi', parts, 'seller', 0);
    // Seq 1 never came.
    sellerState = { ...sellerState, nextSeq: 2 };
    await sellerPay(INTERAC, parts);
    await fromSeller('later', parts);
    const line = (l: { text: string; pay?: unknown; gapBefore: boolean }) => [l.text, l.pay !== undefined, l.gapBefore];
    expect((await engine().sync(chat)).lines.map(line)).toEqual([['hi', false, false], ['later', false, true]]);
    api.view.tradeSecuredAt = '2026-10-28T12:30:00.000Z';
    expect((await engine().sync(chat)).lines.map(line)).toEqual([['hi', false, false], [TEXT, true, true], ['later', false, false]]);
  });

  /** A line this buyer's own identity sealed at `seq` (as another tab or bundle of its own app would). */
  async function fromBuyer(text: string, seq: number, parts: Participants): Promise<void> {
    const r = await sealChatMessage({ role: 'buyer', me: made[0]!, participants: parts, state: { ...newChatState(channel), nextSeq: seq }, text, tk: await tkOf(parts) });
    api.add('buyer', r.envelope);
  }
  /** A package this buyer's own identity signed at `seq` whose text is not its boxes' rendering. */
  const ownLyingPackage = async (seq: number, parts: Participants) =>
    sealChat({ trade: channel, from: 'buyer', seq, type: 'chat.msg', payload: { text: 'Payment details\nFull name: Jane Doe\nEmail: other@example.ca', pay: INTERAC }, tk: await tkOf(parts), me: made[0]! });

  it("review sanctions n-3 (GR18): this device's own package refused for its contents is never the payer's neutral line", async () => {
    await engine().sync(chat);
    const parts = attest();
    // A package this buyer's own identity signed (another bundle of its own app, say) that its table cannot show.
    api.add('buyer', await ownLyingPackage(0, parts));
    await fromSeller('hello', parts);
    await fromBuyer('mine', 1, parts);
    const s = await engine().sync(chat);
    expect((await store.load(chat))!.receipts.map((r) => [r.from, r.refused === true, r.refusedPay === true])).toEqual([['buyer', true, true], ['seller', false, false], ['buyer', false, false]]);
    // Review small-fu2 M-1: an own refused seq is not taken for the gap markers, as before m-2: the
    // own line after it still shows that nothing of this device's seq 0 is shown.
    expect(s.lines.map((l) => [l.from, l.text, l.unreadablePay ?? false, l.gapBefore])).toEqual([['seller', 'hello', false, false], ['buyer', 'mine', false, true]]);
  });

  it("review small-fu2 M-1: a real gap on this device's own lines is never hidden by its own refused package", async () => {
    await engine().sync(chat);
    const parts = attest();
    await fromBuyer('zero', 0, parts);
    // Own seq 1 never came; own seq 2 is a package refused for its contents; own seq 3 follows.
    api.add('buyer', await ownLyingPackage(2, parts));
    await fromBuyer('three', 3, parts);
    expect((await engine().sync(chat)).lines.map((l) => [l.text, l.mine, l.unreadablePay ?? false, l.gapBefore])).toEqual([['zero', true, false, false], ['three', true, false, true]]);
    // A later sync reads the stored receipts the same way.
    await fromBuyer('four', 4, parts);
    expect((await engine().sync(chat)).lines.map((l) => [l.text, l.gapBefore])).toEqual([['zero', false], ['three', true], ['four', false]]);
  });

  it("review small-fu2 M-1: the same across syncs: an own refused package stored by an earlier sync does not hide the gap before the next own line", async () => {
    await engine().sync(chat);
    const parts = attest();
    const e = engine();
    await fromBuyer('zero', 0, parts);
    api.add('buyer', await ownLyingPackage(2, parts));
    expect((await e.sync(chat)).lines.map((l) => [l.text, l.gapBefore])).toEqual([['zero', false]]);
    await fromBuyer('three', 3, parts);
    expect((await e.sync(chat)).lines.map((l) => [l.text, l.gapBefore])).toEqual([['zero', false], ['three', true]]);
  });

  it("review small-fu2 n-2: a refused package the server files under another sender than its signer is refused outright, as a valid one is", async () => {
    await engine().sync(chat);
    const parts = attest();
    // Signed by the seller, filed by the server as the buyer's.
    api.add('buyer', await unknownBoxPackage(0, parts));
    await fromSeller('next', parts, 'seller', 1);
    const s = await engine().sync(chat);
    expect((await store.load(chat))!.receipts.map((r) => [r.id, r.from, r.refusedPay === true])).toEqual([['2', 'seller', false]]);
    expect(s.lines.map((l) => [l.from, l.text, l.unreadablePay ?? false])).toEqual([['seller', 'next', false]]);
  });

  it('review sanctions n-3 (GR20): a refused package is stored under its signer, never what its header says when read again', async () => {
    await engine().sync(chat);
    const parts = attest();
    const sealed = await unknownBoxPackage(0, parts);
    // The same envelope, whose header names the seller while chatCrypto opens it (so its signature
    // checks out) and this reader, the buyer, on any other read (the engine's own look at the header).
    let opening = 0;
    let other = 0;
    const lying = { ...sealed };
    Object.defineProperty(lying, 'from', {
      enumerable: true,
      get: () => (/openChatMessage/.test(new Error().stack ?? '') ? (opening++, 'seller') : (other++, 'buyer')),
    });
    api.add('seller', lying);
    const s = await engine().sync(chat);
    expect(opening).toBeGreaterThan(0);
    expect(other).toBeGreaterThan(0);
    expect((await store.load(chat))!.receipts.map((r) => [r.from, r.refusedPay === true])).toEqual([['seller', true]]);
    expect(s.lines.map((l) => [l.from, l.unreadablePay ?? false])).toEqual([['seller', true]]);
  });

  it('review M1 (pay details): only what may become valid later is tried again: a moderator line outside a dispute, a package before the escrow is secured', async () => {
    api.view.tradeSecuredAt = null;
    await engine().sync(chat);
    const parts = attest();
    api.add('mod', await sellerRaw({ text: 'Moderator here' }, 0, parts, 'mod'));
    await sellerPay(INTERAC, parts);
    await fromSeller('later', parts);
    const e = engine();
    expect((await e.sync(chat)).lines.map((l) => l.text)).toEqual(['later']);
    // The next sync fetches from before the moderator line (the cursor stopped there), and the held package is a held receipt.
    api.afters = [];
    await e.sync(chat);
    expect(api.afters[0]).toBe('0');
    expect((await store.load(chat))!.receipts.map((r) => [r.id, r.heldPay === true, r.refused === true])).toEqual([['2', true, false], ['3', false, false]]);
    // Both become valid: the dispute opens and the escrow is secured.
    api.view.disputeOpen = true;
    api.view.tradeSecuredAt = '2026-10-28T12:30:00.000Z';
    expect((await e.sync(chat)).lines.map((l) => [l.from, l.text])).toEqual([['mod', 'Moderator here'], ['seller', TEXT], ['seller', 'later']]);
  });

  it('the worker answers chat-send-pay like a send, and a non-package is bad-details', async () => {
    const { serveChat } = await import('../src/chat/serve.js');
    const out: unknown[] = [];
    let handler: (e: { data: unknown }) => void = () => undefined;
    serveChat({ postMessage: (m: unknown) => out.push(m), addEventListener: (_t: 'message', cb: (e: { data: unknown }) => void) => (handler = cb) } as never, async () => engine());
    const settle = async () => {
      for (let i = 0; i < 200 && out.length === 0; i++) await new Promise((r) => setTimeout(r, 5));
    };
    handler({ data: { t: 'chat-sync', id: 1, chat } });
    await settle();
    out.shift();
    attest();
    handler({ data: { t: 'chat-send-pay', id: 2, chat, pay: INTERAC } });
    await settle();
    expect(out.shift()).toMatchObject({ t: 'chat', id: 2, ok: true, snapshot: { lines: [{ text: TEXT, pay: INTERAC, mine: true }] } });
    handler({ data: { t: 'chat-send-pay', id: 3, chat, pay: 'x' } });
    await settle();
    expect(out.shift()).toEqual({ t: 'chat', id: 3, ok: false, error: 'bad-details' });
    expect(api.posted).toHaveLength(1);
  });
});

describe('chat engine: one key per chat, envelope v2 (design build task 5)', () => {
  it('with no key record, the first sync after attestation makes the key and posts a signed record locking it to buyer and seller', async () => {
    await engine().sync(chat);
    const parts = attest();
    expect((await engine().sync(chat)).phase).toBe('ready');
    expect(api.keyPosts).toHaveLength(1);
    const rec = await verifyChatKeyRecord(api.key, { chat: channel, participants: parts });
    expect(rec.by).toBe('buyer');
    const sellerTk = await openChatKeyRecord(rec, 'seller', seller);
    expect(sellerTk).toHaveLength(32);
    // A later sync reuses it: no second record.
    await engine().sync(chat);
    expect(api.keyPosts).toHaveLength(1);
  });

  it('nothing is made or posted before the attestation (participants come only from it)', async () => {
    await engine().sync(chat);
    expect(api.keyPosts).toEqual([]);
  });

  it('takes the seller\'s record when the seller came first, and reads the seller\'s lines under it', async () => {
    await engine().sync(chat);
    const parts = attest();
    await fromSeller('hello from the seller', parts);
    const snap = await engine().sync(chat);
    expect(snap.lines.map((l) => l.text)).toEqual(['hello from the seller']);
    expect(api.keyPosts).toEqual([]);
  });

  it('a lost race (409 key-exists) reads the record that won', async () => {
    await engine().sync(chat);
    const parts = attest();
    const e = engine();
    const getKey = api.getKey.bind(api);
    let first = true;
    api.getKey = async () => {
      if (first) {
        first = false;
        // The seller's record lands between this device's read and its post.
        await tkOf(parts);
        return null;
      }
      return getKey();
    };
    await fromSeller('after the race', parts);
    expect((await e.sync(chat)).lines.map((l) => l.text)).toEqual(['after the race']);
    expect(api.keyPosts).toHaveLength(1);
  });

  it('a record not signed by the attested trader it names, or whose copy does not match its tkh, fails with security and nothing is read or sent', async () => {
    for (const bad of ['stranger', 'tkh'] as const) {
      chat = newTradeCode();
      channel = await channelFor(chat, 'chat');
      api = new FakeApi(chat);
      await engine().sync(chat);
      const parts = attest();
      const tk = await newChatKey();
      if (bad === 'stranger') {
        const stranger = await testIdentity();
        api.key = await makeChatKeyRecord({ chat: channel, by: 'seller', tk, me: stranger, participants: { ...parts, seller: pub(stranger) } });
      } else {
        // The seller signs a record whose buyer copy is of another key than its tkh.
        const honest = await makeChatKeyRecord({ chat: channel, by: 'seller', tk, me: seller, participants: parts });
        const other = await makeChatKeyRecord({ chat: channel, by: 'seller', tk: await newChatKey(), me: seller, participants: parts });
        const body = { v: 1, chat: channel, tkh: honest.tkh, by: 'seller', wrapBuyer: other.wrapBuyer, wrapSeller: honest.wrapSeller };
        const canon = JSON.stringify(Object.fromEntries(Object.entries(body).sort(([a], [b]) => (a < b ? -1 : 1))));
        api.key = { ...body, sig: sodium.to_hex(sodium.crypto_sign_detached(new TextEncoder().encode(`x2f/chat-key-record/v1\0${canon}`), seller.signSecret)) };
      }
      const before = api.afters.length;
      const snap = await engine().sync(chat);
      expect({ bad, phase: snap.phase, problem: snap.problem }).toEqual({ bad, phase: 'failed', problem: 'security' });
      expect(api.afters.length, bad).toBe(before);
      await expect(engine().send(chat, 'hi')).rejects.toMatchObject({ code: 'not-ready' });
      expect(api.posted, bad).toEqual([]);
    }
  });

  it('R16 fixed: a v1 envelope (whose moderator copy a sender could leave out) is never a line, and the lines after it still show', async () => {
    await engine().sync(chat);
    const parts = attest();
    await fromSeller('v2 before', parts);
    const v1 = await sealChatMessage({ role: 'seller', me: seller, participants: parts, state: sellerState, text: 'pay to account B' });
    api.add('seller', v1.envelope);
    await fromSeller('v2 after', parts);
    const snap = await engine().sync(chat);
    expect(snap.lines.map((l) => l.text)).toEqual(['v2 before', 'v2 after']);
    // Decided for good: a refused receipt, so a later sync shows the same and never opens it again.
    expect((await store.load(chat))!.receipts.find((r) => r.id === '2')).toMatchObject({ refused: true });
    expect((await engine().sync(chat)).lines.map((l) => l.text)).toEqual(['v2 before', 'v2 after']);
  });

  it('every envelope the engine posts is v2, and the chat key is never stored on the device', async () => {
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    await e.send(chat, 'one');
    await e.send(chat, 'two');
    expect(api.posted.map((p) => (p as { v: unknown }).v)).toEqual([2, 2]);
    const tk = await tkOf(parts);
    const hexKey = sodium.to_hex(tk);
    const b64Key = sodium.to_base64(tk, sodium.base64_variants.ORIGINAL);
    const stored = JSON.stringify([...store.records.values()]);
    expect(stored).not.toContain(hexKey);
    expect(stored).not.toContain(b64Key);
    expect(stored).not.toContain('"wrapBuyer"');
  });
});

describe('chat engine: the dispute grant (design build task 6)', () => {
  it('grant() signs this trader\'s grant of the chat key to the attested moderator identity; only the mod identity opens its wrap', async () => {
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    await expect(e.grant(chat, '2026-11-18T12:00:00.000Z')).resolves.toBeDefined();
    const g = await verifyChatGrant(await e.grant(chat, '2026-11-18T12:00:00.000Z'), { chat: channel, participants: parts });
    expect({ by: g.by, at: g.disputeAt }).toEqual({ by: 'buyer', at: '2026-11-18T12:00:00.000Z' });
    const tk = await unwrapChatKey(mod, g.wrap, g.tkh);
    expect(sodium.memcmp(tk, await tkOf(parts))).toBe(true);
    await expect(unwrapChatKey(seller, g.wrap, g.tkh)).rejects.toBeInstanceOf(ProtocolError);
  });

  it('grant() before the chat is ready (no attestation, so no key) is not-ready', async () => {
    const e = engine();
    await e.sync(chat);
    await expect(e.grant(chat, '2026-11-18T12:00:00.000Z')).rejects.toMatchObject({ code: 'not-ready' });
  });

  it('T1 by proxy: in a dispute, the seller\'s unaccepted grant older than the wait makes this device grant once; never before the wait, after an acceptance, or outside a dispute', async () => {
    const base = Date.now();
    let clock = base;
    const e = createChatEngine({ api, store, newIdentity: async () => testIdentity(), modSigningPublic, now: () => clock });
    await e.sync(chat);
    const parts = attest();
    await e.sync(chat);
    expect((await e.sync(chat)).phase).toBe('ready');
    const theirs = await makeChatGrant({ chat: channel, by: 'seller', tk: await tkOf(parts), disputeAt: new Date(base).toISOString(), me: seller, participants: parts });
    api.view.grants = [{ grant: theirs, accepted: null }];
    // Not disputed: nothing.
    clock = base + GRANT_FALLBACK_MS + 1;
    await e.sync(chat);
    expect(api.grantPosts).toEqual([]);
    api.view.disputeOpen = true;
    // Disputed, but within the wait: nothing.
    clock = base + GRANT_FALLBACK_MS - 1;
    await e.sync(chat);
    expect(api.grantPosts).toEqual([]);
    // Accepted by the attested moderator: nothing.
    clock = base + GRANT_FALLBACK_MS + 1;
    api.view.grants = [{ grant: theirs, accepted: await makeGrantAccepted({ grant: theirs, mod }) }];
    await e.sync(chat);
    expect(api.grantPosts).toEqual([]);
    // An "acceptance" signed by someone else does not count: this device grants, once.
    api.view.grants = [{ grant: theirs, accepted: await makeGrantAccepted({ grant: theirs, mod: seller }) }];
    await e.sync(chat);
    expect(api.grantPosts).toHaveLength(1);
    const mine = await verifyChatGrant(api.grantPosts[0], { chat: channel, participants: parts });
    expect(mine.by).toBe('buyer');
    api.view.grants = [...api.view.grants, { grant: mine, accepted: null }];
    await e.sync(chat);
    expect(api.grantPosts).toHaveLength(1);
  });

  it('acts only on a grant the attested counterparty signed: one signed by a stranger, or for another chat, is ignored', async () => {
    let clock = Date.now();
    const e = createChatEngine({ api, store, newIdentity: async () => testIdentity(), modSigningPublic, now: () => clock });
    await e.sync(chat);
    const parts = attest();
    expect((await e.sync(chat)).phase).toBe('ready');
    api.view.disputeOpen = true;
    const stranger = await testIdentity();
    const forged = await makeChatGrant({ chat: channel, by: 'seller', tk: await tkOf(parts), disputeAt: new Date(clock).toISOString(), me: stranger, participants: { ...parts, seller: pub(stranger) } });
    const elsewhere = await makeChatGrant({ chat: 'another-channel', by: 'seller', tk: await tkOf(parts), disputeAt: new Date(clock).toISOString(), me: seller, participants: parts });
    api.view.grants = [{ grant: forged, accepted: null }, { grant: elsewhere, accepted: null }];
    clock += GRANT_FALLBACK_MS + 1;
    await e.sync(chat);
    expect(api.grantPosts).toEqual([]);
  });
});

describe('chat engine: the dispute notice (design build task 7, T2)', () => {
  async function ready() {
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    expect((await e.sync(chat)).phase).toBe('ready');
    return { e, parts };
  }
  const noticeBy = (by: Identity, o: { openedBy?: 'buyer' | 'seller' | 'system'; chat?: string } = {}) =>
    makeDisputeNotice({ chat: o.chat ?? channel, disputeSeq: 1, openedAt: '2026-11-18T12:00:00.000Z', openedBy: o.openedBy ?? 'system', mod: by });

  it('grants at once on a notice the attested moderator signed while the API shows the dispute open, shows the system banner, and grants only once', async () => {
    const { e, parts } = await ready();
    api.view.notice = await noticeBy(mod);
    // Both checks: the notice alone (no dispute open by the API) does nothing.
    let snap = await e.sync(chat);
    expect(api.grantPosts).toEqual([]);
    expect(snap.systemCalled).toBe(false);
    api.view.disputeOpen = true;
    snap = await e.sync(chat);
    expect(snap.systemCalled).toBe(true);
    expect(api.grantPosts).toHaveLength(1);
    const g = await verifyChatGrant(api.grantPosts[0], { chat: channel, participants: parts });
    expect(g.by).toBe('buyer');
    expect(sodium.memcmp(await unwrapChatKey(mod, g.wrap, g.tkh), await tkOf(parts))).toBe(true);
    api.view.grants = [{ grant: g, accepted: null }];
    await e.sync(chat);
    expect(api.grantPosts).toHaveLength(1);
  });

  it('a notice signed by anyone but the attested moderator identity, or for another chat, grants nothing and shows no banner', async () => {
    const { e } = await ready();
    api.view.disputeOpen = true;
    for (const n of [await noticeBy(seller), await noticeBy(await testIdentity()), await noticeBy(mod, { chat: 'another-channel' })]) {
      api.view.notice = n;
      const snap = await e.sync(chat);
      expect(snap.systemCalled).toBe(false);
    }
    expect(api.grantPosts).toEqual([]);
  });

  it('a trader-opened dispute\'s notice grants (a disputer with no key) but shows no system banner; nothing once a grant is accepted', async () => {
    const { e, parts } = await ready();
    api.view.disputeOpen = true;
    api.view.notice = await noticeBy(mod, { openedBy: 'seller' });
    const theirs = await makeChatGrant({ chat: channel, by: 'seller', tk: await tkOf(parts), disputeAt: new Date().toISOString(), me: seller, participants: parts });
    api.view.grants = [{ grant: theirs, accepted: await makeGrantAccepted({ grant: theirs, mod }) }];
    expect((await e.sync(chat)).systemCalled).toBe(false);
    expect(api.grantPosts).toEqual([]);
    api.view.grants = [];
    await e.sync(chat);
    expect(api.grantPosts).toHaveLength(1);
  });
});

describe('chat engine: review fixes of tasks 3-6 (F3, F4, F6)', () => {
  it('F3: the key\'s tkh is pinned on first use; after a restart a swapped (validly signed) record is the security failure and nothing is sent', async () => {
    await engine().sync(chat);
    const parts = attest();
    await fromSeller('under the first key', parts);
    expect((await engine().sync(chat)).phase).toBe('ready');
    expect((await store.load(chat))!.tkh).toBe((api.key as { tkh: string }).tkh);
    api.key = await makeChatKeyRecord({ chat: channel, by: 'seller', tk: await newChatKey(), me: seller, participants: parts });
    const snap = await engine().sync(chat);
    expect({ phase: snap.phase, problem: snap.problem }).toEqual({ phase: 'failed', problem: 'security' });
    await expect(engine().send(chat, 'hi')).rejects.toMatchObject({ code: 'not-ready' });
    expect(api.posted).toEqual([]);
  });

  it('F3: a 404 for the key record once a tkh is pinned is the security failure, and the device never makes a second key', async () => {
    await engine().sync(chat);
    attest();
    expect((await engine().sync(chat)).phase).toBe('ready');
    expect(api.keyPosts).toHaveLength(1);
    api.key = null;
    const snap = await engine().sync(chat);
    expect({ phase: snap.phase, problem: snap.problem }).toEqual({ phase: 'failed', problem: 'security' });
    expect(api.keyPosts).toHaveLength(1);
  });

  it('F4: an accepted grant of ANOTHER key (a cheating disputer\'s) does not count: this device grants the real key', async () => {
    let clock = Date.now();
    const e = createChatEngine({ api, store, newIdentity: async () => testIdentity(), modSigningPublic, now: () => clock });
    await e.sync(chat);
    const parts = attest();
    expect((await e.sync(chat)).phase).toBe('ready');
    api.view.disputeOpen = true;
    const theirs = await makeChatGrant({ chat: channel, by: 'seller', tk: await newChatKey(), disputeAt: new Date(clock).toISOString(), me: seller, participants: parts });
    api.view.grants = [{ grant: theirs, accepted: await makeGrantAccepted({ grant: theirs, mod }) }];
    clock += GRANT_FALLBACK_MS + 1;
    await e.sync(chat);
    expect(api.grantPosts).toHaveLength(1);
    const mine = await verifyChatGrant(api.grantPosts[0], { chat: channel, participants: parts });
    expect(sodium.memcmp(await unwrapChatKey(mod, mine.wrap, mine.tkh), await tkOf(parts))).toBe(true);
  });

  it('F6: the wait runs from when this worker first saw the grant when its disputeAt is dated later', async () => {
    const base = Date.now();
    let clock = base;
    const e = createChatEngine({ api, store, newIdentity: async () => testIdentity(), modSigningPublic, now: () => clock });
    await e.sync(chat);
    const parts = attest();
    expect((await e.sync(chat)).phase).toBe('ready');
    api.view.disputeOpen = true;
    const theirs = await makeChatGrant({ chat: channel, by: 'seller', tk: await tkOf(parts), disputeAt: new Date(base + 10 * 60_000).toISOString(), me: seller, participants: parts });
    api.view.grants = [{ grant: theirs, accepted: null }];
    await e.sync(chat);
    expect(api.grantPosts).toEqual([]);
    clock = base + GRANT_FALLBACK_MS + 1;
    await e.sync(chat);
    expect(api.grantPosts).toHaveLength(1);
  });
});

describe('chat engine: proof.attached lines (NEEDS_PROOF_RECEIVE)', () => {
  async function fromSellerProof(kind: 'proof' | 'evidence', parts: Participants) {
    const { newProofId, proofKeyToBase64 } = await import('@x2f/proof');
    const payload = {
      proofId: newProofId(), kind, key: await proofKeyToBase64(new Uint8Array(32).fill(5)), sha256: 'ef'.repeat(32),
      width: 200, height: 100, mime: 'image/png' as const, hidden: [], photoTakenAt: null,
    };
    // Decision 16 item 1: proof.attached is an envelope v2 under the chat key, as any line.
    const env = await sealChat({ trade: channel, from: 'seller', seq: sellerState.nextSeq, type: 'proof.attached', payload, tk: await tkOf(parts), me: seller });
    sellerState = { ...sellerState, nextSeq: sellerState.nextSeq + 1 };
    api.add('seller', env);
    return payload;
  }

  it('evidence from the other trader is a proof line while a dispute is open; the key is never stored', async () => {
    api.view.disputeOpen = true;
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    const p = await fromSellerProof('evidence', parts);
    const snap = await e.sync(chat);
    expect(snap.lines).toEqual([{ id: '1', from: 'seller', text: '', proof: p, at: expect.any(String), mine: false, gapBefore: false }]);
    expect(JSON.stringify([...store.records.values()])).not.toContain(p.key);
  });

  it("a 'payment proof' from the seller is refused for good; evidence outside a dispute is held, not shown; the next line still shows", async () => {
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    const ev = await fromSellerProof('evidence', parts);
    await fromSellerProof('proof', parts);
    await fromSeller('after', parts);
    const snap = await e.sync(chat);
    expect(snap.lines.map((l) => [l.text, l.proof === undefined])).toEqual([['after', true]]);
    // The seller's 'payment proof' is decided for good; the evidence is held (review M2) and shows
    // once a dispute is open.
    api.view.disputeOpen = true;
    expect((await e.sync(chat)).lines.map((l) => l.proof ?? l.text)).toEqual([ev, 'after']);
  });

  it('review M1: evidence shown during an open dispute is shown again after a reload (a new worker), not as a gap', async () => {
    api.view.disputeOpen = true;
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    const p = await fromSellerProof('evidence', parts);
    expect((await e.sync(chat)).lines.map((l) => l.proof)).toEqual([p]);
    const again = await engine().sync(chat);
    expect(again.lines).toEqual([{ id: '1', from: 'seller', text: '', proof: p, at: expect.any(String), mine: false, gapBefore: false }]);
  });

  it('review M2: evidence that arrives before the dispute record is held, not refused; it shows once a dispute is open, after a reload too', async () => {
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    const p = await fromSellerProof('evidence', parts);
    await fromSeller('after', parts);
    expect((await e.sync(chat)).lines.map((l) => l.text)).toEqual(['after']);
    const r = (await store.load(chat))!.receipts.find((x) => x.id === '1')!;
    expect(r.refused).toBeUndefined();
    expect(JSON.stringify([...store.records.values()])).not.toContain(p.key);
    api.view.disputeOpen = true;
    expect((await e.sync(chat)).lines.map((l) => [l.id, l.proof ?? l.text])).toEqual([['1', p], ['2', 'after']]);
    expect((await engine().sync(chat)).lines.map((l) => [l.id, l.proof ?? l.text])).toEqual([['1', p], ['2', 'after']]);
  });
});

describe('chat engine: the payment proof (Plan 5 Task 15)', () => {
  async function attached(over: Record<string, unknown> = {}) {
    const { newProofId, proofKeyToBase64 } = await import('@x2f/proof');
    return {
      proofId: newProofId(),
      kind: 'proof' as const,
      key: await proofKeyToBase64(new Uint8Array(32).fill(7)),
      sha256: 'ab'.repeat(32),
      width: 300,
      height: 120,
      mime: 'image/png' as const,
      hidden: ['card' as const, 'email' as const],
      photoTakenAt: null,
      ...over,
    };
  }

  it('sendProof seals proof.attached as envelope v2 under the chat key (decision 16): the seller and the mod (through its grant) read it, never in the clear', async () => {
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    const p = await attached();
    await e.sendProof(chat, p);
    expect(api.posted).toHaveLength(1);
    const wire = JSON.stringify(api.posted[0]);
    expect(() => checkChatEnvelopeV2(JSON.parse(wire), channel, 'buyer')).not.toThrow();
    for (const s of [p.key, p.proofId, p.sha256, 'proof.attached', '"hidden"']) expect(wire, s).not.toContain(s);
    // The seller with its own copy of the key, and the moderator with the key its grant wraps.
    const g = await e.grant(chat, new Date().toISOString());
    const rec = await verifyChatKeyRecord(api.key, { chat: channel, participants: parts });
    for (const tk of [await tkOf(parts), await unwrapChatKey(mod, g.wrap, rec.tkh)]) {
      const o = await openChat(api.posted[0], { tk, trade: channel, participants: parts, guard: new Guard2(channel) });
      expect(o.type).toBe('proof.attached');
      expect(o.payload).toEqual(p);
    }
    // The next line follows on the next seq: the proof used exactly one.
    await e.send(chat, 'sent it');
    expect((api.posted[1] as ChatEnvelopeV2).seq).toBe((api.posted[0] as ChatEnvelopeV2).seq + 1);
  });

  it('a malformed payload, or a seller sending a proof, is refused as bad-proof with nothing posted', async () => {
    const e = engine();
    await e.sync(chat);
    attest();
    await expect(e.sendProof(chat, await attached({ key: 'nope' }))).rejects.toMatchObject({ code: 'bad-proof' });
    await expect(e.sendProof(chat, await attached({ extra: 1 }))).rejects.toMatchObject({ code: 'bad-proof' });
    expect(api.posted).toHaveLength(0);
    // Only the buyer sends a payment proof (kind 'proof'): the sealing itself refuses another role.
    const { sealProofAttached } = await import('../src/chat/chatCrypto.js');
    const parts = attest();
    await expect(sealProofAttached({ role: 'seller', me: seller, participants: parts, state: sellerState, proof: await attached() })).rejects.toBeInstanceOf(TypeError);
  });

  it('the worker checks the payload before the engine sees it (chat-send-proof)', async () => {
    const { serveChat } = await import('../src/chat/serve.js');
    const got: unknown[] = [];
    const fake = { sync: async () => ({}) as never, send: async () => ({}) as never, sendPay: async () => ({}) as never, sendProof: async (_c: string, p: unknown) => (got.push(p), {} as never), sendUnblurred: async () => ({}) as never, sendNotice: async () => ({}) as never, grant: async () => ({}) as never, prepare: async () => ({}) as never, sweep: async () => [] };
    let handler: (e: { data: unknown }) => void = () => undefined;
    const out: unknown[] = [];
    serveChat({ postMessage: (m: unknown) => out.push(m), addEventListener: (_t: 'message', cb: (e: { data: unknown }) => void) => (handler = cb) } as never, async () => fake);
    handler({ data: { t: 'chat-send-proof', id: 1, chat, proof: { ...(await attached()), key: 'bad' } } });
    handler({ data: { t: 'chat-send-proof', id: 2, chat, proof: await attached() } });
    for (let i = 0; i < 200 && out.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
    expect(out).toContainEqual({ t: 'chat', id: 1, ok: false, error: 'bad-proof' });
    expect(out).toContainEqual(expect.objectContaining({ t: 'chat', id: 2, ok: true }));
    expect(got).toHaveLength(1);
  });

  it('review M4: no proof before the trade is secured: the engine refuses it with not-ready, nothing sealed or posted, the seq kept', async () => {
    api.view.tradeSecuredAt = null;
    const e = engine();
    await e.sync(chat);
    attest();
    await expect(e.sendProof(chat, await attached())).rejects.toMatchObject({ code: 'not-ready' });
    // Evidence waits for securing too (the lead's call, review M4's owner question: recommendation no).
    await expect(e.sendProof(chat, await attached({ kind: 'evidence' }))).rejects.toMatchObject({ code: 'not-ready' });
    expect(api.posted).toHaveLength(0);
    expect((await store.load(chat))!.state?.nextSeq ?? 0).toBe(0);
    await e.send(chat, 'still securing');
    expect((api.posted[0] as Envelope).seq).toBe(0);
    api.view.tradeSecuredAt = '2026-10-28T12:30:00.000Z';
    await e.sendProof(chat, await attached());
    expect(api.posted).toHaveLength(2);
  });

  it('review M4: the worker answers chat-send-proof with not-ready while the trade is not secured', async () => {
    api.view.tradeSecuredAt = null;
    const e = engine();
    await e.sync(chat);
    attest();
    const { serveChat } = await import('../src/chat/serve.js');
    let handler: (e: { data: unknown }) => void = () => undefined;
    const out: unknown[] = [];
    serveChat({ postMessage: (m: unknown) => out.push(m), addEventListener: (_t: 'message', cb: (e: { data: unknown }) => void) => (handler = cb) } as never, async () => e);
    handler({ data: { t: 'chat-send-proof', id: 1, chat, proof: await attached() } });
    for (let i = 0; i < 400 && out.length < 1; i++) await new Promise((r) => setTimeout(r, 5));
    expect(out).toEqual([{ t: 'chat', id: 1, ok: false, error: 'not-ready' }]);
    expect(api.posted).toHaveLength(0);
  });

  it('review M2: a proof whose post got no answer (the connection dropped, or a 5xx) is uncertain, not refused; a 4xx is still refused', async () => {
    const e = engine();
    await e.sync(chat);
    attest();
    const post = api.postEnvelope.bind(api);
    // Stored, then the connection dropped on the response.
    api.postEnvelope = async (c, env) => {
      await post(c, env);
      throw new TypeError('Failed to fetch');
    };
    await expect(e.sendProof(chat, await attached())).rejects.toMatchObject({ code: 'uncertain' });
    api.postEnvelope = async () => {
      throw Object.assign(new Error('api 502'), { status: 502, code: 'internal' });
    };
    await expect(e.sendProof(chat, await attached())).rejects.toMatchObject({ code: 'uncertain' });
    api.postEnvelope = async () => {
      throw Object.assign(new Error('api 403'), { status: 403, code: 'forbidden' });
    };
    await expect(e.sendProof(chat, await attached())).rejects.toMatchObject({ code: 'refused' });
    // A chat line is unchanged by this (its copy is ChatPanel's).
    api.postEnvelope = async () => {
      throw new TypeError('Failed to fetch');
    };
    await expect(e.send(chat, 'hello')).rejects.toMatchObject({ code: 'refused' });
    // The worker passes the code through.
    const { serveChat } = await import('../src/chat/serve.js');
    let handler: (ev: { data: unknown }) => void = () => undefined;
    const out: unknown[] = [];
    serveChat({ postMessage: (m: unknown) => out.push(m), addEventListener: (_t: 'message', cb: (ev: { data: unknown }) => void) => (handler = cb) } as never, async () => e);
    handler({ data: { t: 'chat-send-proof', id: 9, chat, proof: await attached() } });
    for (let i = 0; i < 400 && out.length < 1; i++) await new Promise((r) => setTimeout(r, 5));
    expect(out).toEqual([{ t: 'chat', id: 9, ok: false, error: 'uncertain' }]);
  });

  it('review M2: a proof the API stored is sent even when the read after it fails', async () => {
    const e = engine();
    await e.sync(chat);
    attest();
    await e.sync(chat);
    const post = api.postEnvelope.bind(api);
    let down = false;
    api.postEnvelope = async (c, env) => {
      const id = await post(c, env);
      down = true;
      return id;
    };
    const get = api.getChat.bind(api);
    api.getChat = async () => {
      if (down) throw new TypeError('Failed to fetch');
      return get();
    };
    await expect(e.sendProof(chat, await attached())).resolves.toBeDefined();
    expect(api.posted).toHaveLength(1);
  });

  // TRIPWIRE NEEDS_PROOF_RECEIVE (review I1): the API sees only `from`, so a modified seller client
  // can seal `proof.attached` kind 'proof' and the server stores it. The receiving half (ChatPanel's
  // ProofThumb, Task 15) must refuse a payment proof from anyone but the buyer and show nothing of it.
  // The receive half is in (proof stack merge): proof.attached opens as a proof line, and this keeps
  // the seller's "payment proof" refused for good.
  it('NEEDS_PROOF_RECEIVE tripwire: a payment proof (kind proof) from the seller is refused on receipt and shows nothing', async () => {
    const { parseProofPayload } = await import('@x2f/proof');
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    await e.sync(chat);
    const fake = await attached();
    // A modified seller client seals it under the chat key (v2), as any line.
    const env = await sealChat({ trade: channel, from: 'seller', seq: 0, type: 'proof.attached', payload: parseProofPayload('proof.attached', fake).payload, tk: await tkOf(parts), me: seller });
    const id = api.add('seller', env);
    await fromSeller('after it', parts, 'seller', 1);
    const snap = await e.sync(chat);
    const shown = JSON.stringify(snap);
    for (const s of [fake.proofId, fake.key, fake.sha256]) expect(shown, s).not.toContain(s);
    expect(snap.lines.map((l) => l.text)).toEqual(['after it']);
    const rec = (await store.load(chat))!;
    expect(rec.receipts.find((r) => r.id === id)?.refused).toBe(true);
  });
});

describe('chat engine: the unblurred copy for the moderator (Plan 5 Task 15, Review Focus 4)', () => {
  async function unblurred(over: Record<string, unknown> = {}) {
    const { newProofId, proofKeyToBase64 } = await import('@x2f/proof');
    return { proofId: newProofId(), key: await proofKeyToBase64(new Uint8Array(32).fill(9)), sha256: 'cd'.repeat(32), width: 300, height: 120, mime: 'image/png' as const, ...over };
  }

  it('sendUnblurred seals proof.unblurred to the moderator only: the seller and the buyer itself cannot open it', async () => {
    api.view.disputeOpen = true;
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    const p = await unblurred();
    await e.sendUnblurred(chat, p);
    expect(api.posted).toHaveLength(1);
    const env = api.posted[0] as Envelope;
    const wire = JSON.stringify(env);
    for (const s of [p.key, p.proofId, p.sha256, 'proof.unblurred']) expect(wire, s).not.toContain(s);
    const { open, ReplayGuard } = await import('@x2f/protocol');
    const o = await open(env, { me: mod, myRole: 'mod', participants: parts, trade: channel, guard: new ReplayGuard(channel) });
    expect(o.type).toBe('proof.unblurred');
    expect(o.payload).toEqual(p);
    await expect(open(env, { me: seller, myRole: 'seller', participants: parts, trade: channel, guard: new ReplayGuard(channel) })).rejects.toMatchObject({ code: 'not-for-me' });
    const buyer = made[0]!;
    await expect(open(env, { me: buyer, myRole: 'buyer', participants: parts, trade: channel, guard: new ReplayGuard(channel), allowSelf: true })).rejects.toMatchObject({ code: 'not-for-me' });
  });

  it('only while a dispute is open and the trade was secured: not-ready otherwise, nothing sealed, the seq kept', async () => {
    const e = engine();
    await e.sync(chat);
    attest();
    await expect(e.sendUnblurred(chat, await unblurred())).rejects.toMatchObject({ code: 'not-ready' });
    api.view.disputeOpen = true;
    api.view.tradeSecuredAt = null;
    await expect(e.sendUnblurred(chat, await unblurred())).rejects.toMatchObject({ code: 'not-ready' });
    expect(api.posted).toHaveLength(0);
    expect((await store.load(chat))!.state?.nextSeq ?? 0).toBe(0);
    await expect(e.sendUnblurred(chat, await unblurred({ key: 'nope' }))).rejects.toMatchObject({ code: 'not-ready' });
    api.view.tradeSecuredAt = '2026-10-28T11:00:00.000Z';
    await expect(e.sendUnblurred(chat, await unblurred({ key: 'nope' }))).rejects.toMatchObject({ code: 'bad-proof' });
    await expect(e.sendUnblurred(chat, await unblurred({ kind: 'proof' }))).rejects.toMatchObject({ code: 'bad-proof' });
    expect(api.posted).toHaveLength(0);
  });

  it('the copy is no line for anyone and leaves no gap: the sender\'s next line follows on, on both sides', async () => {
    api.view.disputeOpen = true;
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    await e.send(chat, 'before');
    await e.sendUnblurred(chat, await unblurred());
    const snap = await e.send(chat, 'after');
    expect(snap.lines.map((l) => [l.text, l.gapBefore])).toEqual([['before', false], ['after', false]]);
    // A fresh read on this device (no text kept) shows the same.
    expect((await engine().sync(chat)).lines.map((l) => [l.text, l.gapBefore])).toEqual([['before', false], ['after', false]]);
    // The seller's device: the same chat read as the seller sees the two lines, no gap and nothing else.
    const { openChatMessage } = await import('../src/chat/chatCrypto.js');
    let st = newChatState(channel);
    const seen: string[] = [];
    const tk = await tkOf(parts);
    for (const env of api.posted as Array<Envelope | ChatEnvelopeV2>) {
      try {
        // The lines are v2 under the chat key; the copy is the one v1 (decision 16), sealed to the mod alone.
        const r = await openChatMessage(env, { role: 'seller', me: seller, participants: parts, state: st, modMayPost: true, ...(env.v === 2 ? { tk } : {}) });
        st = r.state;
        seen.push(r.message.text);
      } catch (err) {
        expect(err).toMatchObject({ code: 'not-for-me' });
        seen.push('(not for me)');
      }
    }
    expect(seen).toEqual(['before', '(not for me)', 'after']);
  });

  it('a seller-side engine takes the buyer\'s copy as a receipt with no line, and the buyer\'s next line shows with no gap', async () => {
    // This device is the seller; the buyer is played here.
    api.view = { ...api.view, role: 'seller', counterparty: 'Ana', disputeOpen: true };
    const e = engine();
    await e.sync(chat);
    const me = made[0]!;
    const buyer = await testIdentity();
    api.identities.buyer = { signPublic: buyer.signPublic, boxPublic: buyer.boxPublic, proof: '' };
    const participants: Participants = { buyer: pub(buyer), seller: pub(me), mod: pub(mod) };
    const a: Attestation = { v: 1, trade: chat, channels: { chat: channel }, participants, issuedAt: new Date().toISOString() };
    api.attestation = { attestation: a, sig: sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(a), modKey.privateKey)) };
    const { parseProofPayload, sealProofEnvelope } = await import('@x2f/proof');
    // The buyer's device came first: it made the chat key (envelope v2 for its lines).
    const bk = await makeChatKey({ channel, role: 'buyer', me: buyer, participants });
    api.key = bk.record;
    let bs = newChatState(channel);
    const line = async (text: string) => {
      const r = await sealChatMessage({ role: 'buyer', me: buyer, participants, state: bs, text, tk: bk.tk });
      bs = r.state;
      api.add('buyer', r.envelope);
    };
    await line('before');
    const p = await unblurred();
    const id = api.add('buyer', await sealProofEnvelope(parseProofPayload('proof.unblurred', p), { trade: channel, from: 'buyer', seq: bs.nextSeq, me: buyer, participants }));
    bs = { ...bs, nextSeq: bs.nextSeq + 1 };
    await line('after');
    const snap = await e.sync(chat);
    expect(snap.lines.map((l) => [l.from, l.text, l.gapBefore])).toEqual([['buyer', 'before', false], ['buyer', 'after', false]]);
    const shown = JSON.stringify(snap);
    for (const s of [p.proofId, p.key, p.sha256]) expect(shown, s).not.toContain(s);
    const rec = (await store.load(chat))!;
    expect(rec.receipts.find((r) => r.id === id)).toMatchObject({ from: 'buyer', away: true });
    // Read again from the start: still no line and no gap.
    expect((await engine().sync(chat)).lines.map((l) => [l.text, l.gapBefore])).toEqual([['before', false], ['after', false]]);
  });

  /** A seller-side engine with the buyer played here (as the test above). */
  async function sellerSide(disputeOpen: boolean) {
    api.view = { ...api.view, role: 'seller', counterparty: 'Ana', disputeOpen };
    const e = engine();
    await e.sync(chat);
    const me = made[0]!;
    const buyer = await testIdentity();
    api.identities.buyer = { signPublic: buyer.signPublic, boxPublic: buyer.boxPublic, proof: '' };
    const participants: Participants = { buyer: pub(buyer), seller: pub(me), mod: pub(mod) };
    const a: Attestation = { v: 1, trade: chat, channels: { chat: channel }, participants, issuedAt: new Date().toISOString() };
    api.attestation = { attestation: a, sig: sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(a), modKey.privateKey)) };
    const { parseProofPayload, sealProofEnvelope } = await import('@x2f/proof');
    const bk = await makeChatKey({ channel, role: 'buyer', me: buyer, participants });
    api.key = bk.record;
    let bs = newChatState(channel);
    const buyerSays = {
      line: async (text: string) => {
        const r = await sealChatMessage({ role: 'buyer', me: buyer, participants, state: bs, text, tk: bk.tk });
        bs = r.state;
        return api.add('buyer', r.envelope);
      },
      /** The relay drops the buyer's next line: its seq is spent, nothing reaches the seller. */
      dropped: () => {
        bs = { ...bs, nextSeq: bs.nextSeq + 1 };
      },
      copy: async () => {
        const id = api.add('buyer', await sealProofEnvelope(parseProofPayload('proof.unblurred', await unblurred()), { trade: channel, from: 'buyer', seq: bs.nextSeq, me: buyer, participants }));
        bs = { ...bs, nextSeq: bs.nextSeq + 1 };
        return id;
      },
    };
    return { e, buyerSays };
  }

  it('review I1: a line the relay dropped before the copy still shows as a gap, on the sender\'s next shown line only', async () => {
    const { e, buyerSays } = await sellerSide(true);
    await buyerSays.line('before');
    buyerSays.dropped();
    await buyerSays.copy();
    await buyerSays.line('after');
    await buyerSays.line('then');
    const want = [['buyer', 'before', false], ['buyer', 'after', true], ['buyer', 'then', false]];
    expect((await e.sync(chat)).lines.map((l) => [l.from, l.text, l.gapBefore])).toEqual(want);
    // A fresh read from the start shows the same.
    expect((await engine().sync(chat)).lines.map((l) => [l.from, l.text, l.gapBefore])).toEqual(want);
  });

  it('review I1: the gap is carried even when the next line comes in a later sync', async () => {
    const { e, buyerSays } = await sellerSide(true);
    await buyerSays.line('before');
    buyerSays.dropped();
    await buyerSays.copy();
    expect((await e.sync(chat)).lines.map((l) => [l.text, l.gapBefore])).toEqual([['before', false]]);
    await buyerSays.line('after');
    expect((await e.sync(chat)).lines.map((l) => [l.text, l.gapBefore])).toEqual([['before', false], ['after', true]]);
  });

  it('lead call 18 Nov: outside a dispute, a moderator-only message from a trader is never taken (refused for good, R16), and shows as a gap as before', async () => {
    const { e, buyerSays } = await sellerSide(false);
    await buyerSays.line('before');
    const id = await buyerSays.copy();
    await buyerSays.line('after');
    const snap = await e.sync(chat);
    expect(snap.lines.map((l) => [l.from, l.text, l.gapBefore])).toEqual([['buyer', 'before', false], ['buyer', 'after', true]]);
    // Merge with the chat-key design (R16): a v1 envelope in a keyed chat is decided for good, its seq not taken.
    const r = (await store.load(chat))!.receipts.find((x) => x.id === id);
    expect(r).toMatchObject({ refused: true });
    expect(r?.away).toBeUndefined();
    expect((await engine().sync(chat)).lines.map((l) => [l.text, l.gapBefore])).toEqual([['before', false], ['after', true]]);
  });

  it('lead call 18 Nov: while a dispute is open the same message is away: no line and no gap', async () => {
    const { e, buyerSays } = await sellerSide(true);
    await buyerSays.line('before');
    const id = await buyerSays.copy();
    await buyerSays.line('after');
    expect((await e.sync(chat)).lines.map((l) => [l.text, l.gapBefore])).toEqual([['before', false], ['after', false]]);
    expect((await store.load(chat))!.receipts.find((r) => r.id === id)).toMatchObject({ away: true });
  });

  it('review I2: the snapshot names when this side\'s own moderator-only copy reached the chat (its receipt), and never the other side\'s', async () => {
    api.view.disputeOpen = true;
    const e = engine();
    expect((await e.sync(chat)).modOnlySentAt).toEqual([]);
    attest();
    await e.send(chat, 'before');
    const snap = await e.sendUnblurred(chat, await unblurred());
    expect(snap.modOnlySentAt).toHaveLength(1);
    expect(snap.modOnlySentAt?.[0]).toBe((api.envelopes.at(-1) as { at: string }).at);
    expect((await engine().sync(chat)).modOnlySentAt).toEqual(snap.modOnlySentAt);
    const other = await sellerSide(true);
    await other.buyerSays.copy();
    expect((await other.e.sync(chat)).modOnlySentAt).toEqual([]);
  });

  it('the worker checks the payload before the engine sees it (chat-send-unblurred)', async () => {
    const { serveChat } = await import('../src/chat/serve.js');
    const got: unknown[] = [];
    const fake = { sync: async () => ({}) as never, send: async () => ({}) as never, sendPay: async () => ({}) as never, sendProof: async () => ({}) as never, sendUnblurred: async (_c: string, p: unknown) => (got.push(p), {} as never), sendNotice: async () => ({}) as never, grant: async () => ({}) as never, prepare: async () => ({}) as never, sweep: async () => [] };
    let handler: (e: { data: unknown }) => void = () => undefined;
    const out: unknown[] = [];
    serveChat({ postMessage: (m: unknown) => out.push(m), addEventListener: (_t: 'message', cb: (e: { data: unknown }) => void) => (handler = cb) } as never, async () => fake);
    handler({ data: { t: 'chat-send-unblurred', id: 1, chat, proof: { ...(await unblurred()), key: 'bad' } } });
    handler({ data: { t: 'chat-send-unblurred', id: 2, chat, proof: await unblurred() } });
    for (let i = 0; i < 200 && out.length < 2; i++) await new Promise((r) => setTimeout(r, 5));
    expect(out).toContainEqual({ t: 'chat', id: 1, ok: false, error: 'bad-proof' });
    expect(out).toContainEqual(expect.objectContaining({ t: 'chat', id: 2, ok: true }));
    expect(got).toHaveLength(1);
  });
});

// Decision 16 (lead call 18 Nov, option i): the one v1 envelope a keyed chat takes is the moderator's
// requested unblurred copy. R16 still holds for everything else: no trader's engine ever opens a v1
// envelope here, so a sender who seals a v1 line to the counterparty alone (leaving the moderator's
// copy out) is never read, during a dispute too.
describe('chat engine: decision 16, R16 holds for v1 text in a keyed chat', () => {
  it('a v1 chat message sealed to this trader is never a line, not even while a dispute is open; the lines around it still show', async () => {
    for (const disputeOpen of [false, true]) {
      chat = newTradeCode();
      channel = await channelFor(chat, 'chat');
      api = new FakeApi(chat);
      sellerState = newChatState(channel);
      api.view.disputeOpen = disputeOpen;
      const e = engine();
      await e.sync(chat);
      const parts = attest();
      await fromSeller('v2 before', parts);
      // Sealed to buyer, seller and mod (v1, a real slot for this buyer): the engine must not open it.
      const v1 = await sealChatMessage({ role: 'seller', me: seller, participants: parts, state: sellerState, text: 'pay to account B' });
      sellerState = v1.state;
      const id = api.add('seller', v1.envelope);
      await fromSeller('v2 after', parts);
      const snap = await e.sync(chat);
      expect({ disputeOpen, lines: snap.lines.map((l) => l.text) }).toEqual({ disputeOpen, lines: ['v2 before', 'v2 after'] });
      expect(JSON.stringify(snap)).not.toContain('account B');
      const r = (await store.load(chat))!.receipts.find((x) => x.id === id)!;
      // Outside a dispute it is refused for good; inside, a validly signed trader v1 is the away receipt
      // the moderator's unblurred copy gets (no line, no gap), never opened either way.
      expect({ disputeOpen, refused: r.refused === true, away: r.away === true }).toEqual({ disputeOpen, refused: !disputeOpen, away: disputeOpen });
      expect((await engine().sync(chat)).lines.map((l) => l.text)).toEqual(['v2 before', 'v2 after']);
    }
  });

  it('a v1 envelope whose signature does not check out, or whose sender the server misnames, is refused for good, never an away receipt', async () => {
    api.view.disputeOpen = true;
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    await fromSeller('v2 before', parts);
    const v1 = await sealChatMessage({ role: 'seller', me: seller, participants: parts, state: sellerState, text: 'forged' });
    sellerState = v1.state;
    const env = v1.envelope as Envelope;
    const badSig = { ...env, sig: (env.sig[0] === 'a' ? 'b' : 'a') + env.sig.slice(1) };
    const forged = api.add('seller', badSig);
    const misnamed = api.add('buyer', env);
    await fromSeller('v2 after', parts);
    const snap = await e.sync(chat);
    expect(snap.lines.map((l) => l.text)).toEqual(['v2 before', 'v2 after']);
    const rec = (await store.load(chat))!;
    for (const id of [forged, misnamed]) {
      const r = rec.receipts.find((x) => x.id === id)!;
      expect({ id, refused: r.refused, away: r.away }).toEqual({ id, refused: true, away: undefined });
    }
    expect(snap.modOnlySentAt).toEqual([]);
  });

  it('sendUnblurred in a keyed chat posts the one v1 (to the moderator alone) and every other send stays v2', async () => {
    api.view.disputeOpen = true;
    const e = engine();
    await e.sync(chat);
    attest();
    const { newProofId, proofKeyToBase64 } = await import('@x2f/proof');
    await e.send(chat, 'one');
    await e.sendUnblurred(chat, { proofId: newProofId(), key: await proofKeyToBase64(new Uint8Array(32).fill(3)), sha256: 'aa'.repeat(32), width: 10, height: 10, mime: 'image/png' });
    const snap = await e.send(chat, 'two');
    expect(api.posted.map((x) => (x as { v: number }).v)).toEqual([2, 1, 2]);
    expect(snap.lines.map((l) => l.text)).toEqual(['one', 'two']);
    expect(snap.modOnlySentAt).toHaveLength(1);
  });
});
