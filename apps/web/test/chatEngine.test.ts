import { newTradeCode, type Role } from '@x2f/core';
import { seal, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import { attestationBytes, channelFor, chatIdentityProofValid, checkChatEnvelope, type Attestation, type PayDetailsPayload } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { newChatState, sealChatMessage, sealPayDetails, type ChatState } from '../src/chat/chatCrypto.js';
import { ChatSendFailed, createChatEngine, type ApiEnvelope, type ChatApi, type ChatApiView, type ChatEngine } from '../src/chat/engine.js';
import { memoryChatStore } from '../src/chat/store.js';

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
  view: ChatApiView = { role: 'buyer', counterparty: 'Sam', disputeOpen: false, tradeSecuredAt: '2026-10-28T11:00:00.000Z', mySignPublic: null };
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
  constructor(readonly chat: string) {}
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
  const a: Attestation = { v: 1, trade: chat, channels: { chat: channel }, participants, issuedAt: '2026-10-28T12:00:00.000Z', ...extra };
  api.attestation = { attestation: a, sig: sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(a), key)) };
  return participants;
}

let sellerState: ChatState;
async function fromSeller(text: string, parts: Participants, senderRole = 'seller', seq?: number): Promise<Envelope> {
  const state = seq === undefined ? sellerState : { ...sellerState, nextSeq: seq };
  const r = await sealChatMessage({ role: 'seller', me: seller, participants: parts, state, text });
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

  it("moderation's refusal is shown as refused", async () => {
    await engine().sync(chat);
    api.refused = true;
    expect(await engine().sync(chat)).toMatchObject({ phase: 'failed', problem: 'refused' });
  });
});

describe('chat engine: messages', () => {
  it('sends a sealed message the seller and the mod identity open; the stored line is mine', async () => {
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    const snap = await e.send(chat, 'Sending via Zelle now');
    expect(snap.phase).toBe('ready');
    expect(snap.lines).toEqual([{ id: '1', from: 'buyer', text: 'Sending via Zelle now', at: expect.any(String), mine: true, gapBefore: false }]);
    expect(JSON.stringify(api.posted)).not.toContain('Zelle');
    const { open, ReplayGuard } = await import('@x2f/protocol');
    for (const [role, me] of [['seller', seller], ['mod', mod]] as const) {
      const o = await open(api.posted[0] as Envelope, { me, myRole: role, participants: parts, trade: channel, guard: new ReplayGuard(channel) });
      expect(o.payload).toEqual({ text: 'Sending via Zelle now' });
    }
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
    const m = await seal({ trade: channel, from: 'mod', seq: 0, type: 'chat.msg', payload: { text: 'Moderator here' }, to: ['buyer', 'seller', 'mod'], me: mod, participants: parts });
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
    const m = await seal({ trade: channel, from: 'mod', seq: 0, type: 'chat.msg', payload: { text: 'x' }, to: ['buyer', 'seller', 'mod'], me: mod, participants: parts });
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
    const other = await sealChatMessage({ role: 'seller', me: seller, participants: parts, state: newChatState(channel), text: 'pay to account B' });
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
    const injected = await sealChatMessage({ role: 'seller', me: seller, participants: parts, state: sellerState, text: 'send to account B' });
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
    const fake = { sync: async () => ({}) as never, send: async () => ({}) as never, sendPay: async () => ({}) as never, sendProof: async () => ({}) as never, sweep: async () => (sweeps++, []) };
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
    const fake = { sync: async () => ({}) as never, send: async () => ({}) as never, sendPay: async () => ({}) as never, sendProof: async () => ({}) as never, sweep: () => results[Math.min(sweeps++, 1)]!() };
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
  async function sellerPay(pay: PayDetailsPayload, parts: Participants): Promise<Envelope> {
    const r = await sealPayDetails({ role: 'seller', me: seller, participants: parts, state: sellerState, pay });
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
    expect(() => checkChatEnvelope(JSON.parse(wire), channel, 'buyer')).not.toThrow();
    for (const s of ['Jane Doe', 'jane@example.ca', 'Full name', 'Payment details', 'INTERAC_E_TRANSFER', '"pay"', '"text"', '"name"', '"email"']) expect(wire, s).not.toContain(s);
    // The other side and the mod identity open the same package.
    const { open, ReplayGuard } = await import('@x2f/protocol');
    const o = await open(api.posted[0] as Envelope, { me: seller, myRole: 'seller', participants: parts, trade: channel, guard: new ReplayGuard(channel) });
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
  async function sellerRaw(payload: unknown, seq: number, parts: Participants, from: Role = 'seller'): Promise<Envelope> {
    return seal({ trade: channel, from, seq, type: 'chat.msg', payload, to: ['buyer', 'seller', 'mod'], me: from === 'mod' ? mod : seller, participants: parts });
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
    expect(first.lines.map((l) => [l.text, l.missing ?? false, l.gapBefore])).toEqual([
      ['before', false, false],
      ['after', false, false],
    ]);
    // The next sync asks only past the last envelope: the refused ones are not fetched again.
    api.afters = [];
    expect((await e.sync(chat)).lines.map((l) => l.text)).toEqual(['before', 'after']);
    expect(api.afters).toEqual(['5']);
    // Each refused envelope has a receipt marked refused and nothing else of it; the cursor is past them.
    const rec = (await store.load(chat))!;
    expect(rec.cursor).toBe('5');
    expect(rec.receipts.map((r) => [r.id, r.refused === true])).toEqual([['1', false], ['2', true], ['3', true], ['4', true], ['5', false]]);
    for (const s of ['Jane Doe', 'other@example.ca', 'INTERAC_E_TRANSFER']) expect(JSON.stringify(store.records.get(chat)), s).not.toContain(s);
    // A reopened app (a new engine) re-reads the chat: the refused ones are neither lines nor placeholders.
    api.afters = [];
    expect((await engine().sync(chat)).lines.map((l) => [l.text, l.missing ?? false])).toEqual([['before', false], ['after', false]]);
    expect(api.afters[0]).toBe('0');
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

  it('sendProof seals proof.attached to buyer, seller and mod: the key is readable by the seller and the mod, never in the clear', async () => {
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    const p = await attached();
    await e.sendProof(chat, p);
    expect(api.posted).toHaveLength(1);
    const wire = JSON.stringify(api.posted[0]);
    expect(() => checkChatEnvelope(JSON.parse(wire), channel, 'buyer')).not.toThrow();
    for (const s of [p.key, p.proofId, p.sha256, 'proof.attached', '"hidden"']) expect(wire, s).not.toContain(s);
    const { open, ReplayGuard } = await import('@x2f/protocol');
    for (const [me, myRole] of [[seller, 'seller'], [mod, 'mod']] as const) {
      const o = await open(api.posted[0] as Envelope, { me, myRole, participants: parts, trade: channel, guard: new ReplayGuard(channel) });
      expect(o.type).toBe('proof.attached');
      expect(o.payload).toEqual(p);
    }
    // The next line follows on the next seq: the proof used exactly one.
    await e.send(chat, 'sent it');
    expect((api.posted[1] as Envelope).seq).toBe((api.posted[0] as Envelope).seq + 1);
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
    const fake = { sync: async () => ({}) as never, send: async () => ({}) as never, sendPay: async () => ({}) as never, sendProof: async (_c: string, p: unknown) => (got.push(p), {} as never), sweep: async () => [] };
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
  // Today every proof.attached is a refused receipt; when the receive half opens them, this keeps
  // the seller's "payment proof" refused.
  it('NEEDS_PROOF_RECEIVE tripwire: a payment proof (kind proof) from the seller is refused on receipt and shows nothing', async () => {
    const { parseProofPayload, sealProofEnvelope } = await import('@x2f/proof');
    const e = engine();
    await e.sync(chat);
    const parts = attest();
    await e.sync(chat);
    const fake = await attached();
    const env = await sealProofEnvelope(parseProofPayload('proof.attached', fake), { trade: channel, from: 'seller', seq: 0, me: seller, participants: parts });
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
