/**
 * P-020: the fixed chat notice a proof poster's own device sends when its own blur covered the
 * trade code (`uploadPrompts(...).hidden.memo`). The chat is end-to-end encrypted, so the server
 * cannot write into it: the poster's device seals `{ text, notice }` in an ordinary `chat.msg`
 * envelope. The wording is fixed (CHAT_NOTICES); every reader checks the sealed text IS that
 * wording and shows its own copy, and refuses other words, unknown notices, extra keys and a
 * mod-signed notice. NEEDS_PLAN_5_TASK_15: nothing sends it until the BlurEditor lands.
 */
import { newTradeCode, type Role } from '@x2f/core';
import { ProtocolError, ReplayGuard, open, openChat, seal, sealChat, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import { ChatEnvelopeError, attestationBytes, channelFor, checkChatEnvelope, type Attestation } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ChatError, chatChannel, chatKeyOf, newChatState, openChatMessage, sealChatMessage, sealChatNotice, type ChatState } from '../src/chat/chatCrypto.js';
import { createChatEngine, type ApiEnvelope, type ChatApi, type ChatApiView } from '../src/chat/engine.js';
import { CHAT_NOTICES, isChatNotice } from '../src/chat/notices.js';
import { memoryChatStore } from '../src/chat/store.js';
import { proofCodeNotice } from '../src/proof/uploaderChecks.js';

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
const TEXT = CHAT_NOTICES['proof-code-hidden'];

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof ProtocolError || e instanceof ChatError || e instanceof ChatEnvelopeError) return e.code;
    throw e;
  }
}

describe('the notice wording', () => {
  it('has one notice, proof-code-hidden, saying it is the automated proof check', () => {
    expect(Object.keys(CHAT_NOTICES)).toEqual(['proof-code-hidden']);
    expect(TEXT).toMatch(/^Automated proof check: /);
    expect(isChatNotice('proof-code-hidden')).toBe(true);
    for (const x of ['toString', '__proto__', 'constructor', 'proof-code', '', 1, null, undefined, {}]) expect(isChatNotice(x), String(x)).toBe(false);
  });
});

describe('sealChatNotice / openChatMessage', () => {
  let ids: Record<Role, Identity>;
  let participants: Participants;
  let channel: string;
  beforeAll(async () => {
    ids = { buyer: await testIdentity(), seller: await testIdentity(), mod: await testIdentity() };
    participants = { buyer: pub(ids.buyer), seller: pub(ids.seller), mod: pub(ids.mod) };
    channel = await chatChannel(newTradeCode());
  });
  const read = (body: unknown, role: Role, state: ChatState = newChatState(channel)) =>
    openChatMessage(body, { role, me: ids[role], participants, state, modMayPost: true, payAllowed: true });
  const raw = (payload: unknown, from: Role = 'buyer', seq = 0): Promise<Envelope> =>
    seal({ trade: channel, from, seq, type: 'chat.msg', payload, to: ['buyer', 'seller', 'mod'], me: ids[from], participants });

  it('seals { text, notice } with the fixed wording to buyer, seller and mod; each opens it with notice set', async () => {
    const { envelope, state } = await sealChatNotice({ role: 'buyer', me: ids.buyer, participants, state: newChatState(channel), notice: 'proof-code-hidden' });
    expect(state.nextSeq).toBe(1);
    const inner = await open(envelope, { me: ids.seller, myRole: 'seller', participants, trade: channel, guard: new ReplayGuard(channel) });
    expect(inner).toEqual({ from: 'buyer', type: 'chat.msg', payload: { text: TEXT, notice: 'proof-code-hidden' } });
    for (const r of ['seller', 'buyer', 'mod'] as const) {
      expect((await read(envelope, r)).message, r).toEqual({ from: 'buyer', seq: 0, text: TEXT, notice: 'proof-code-hidden' });
    }
    // An ordinary chat envelope on the wire, nothing readable in it.
    const wire = JSON.stringify(envelope);
    expect(() => checkChatEnvelope(JSON.parse(wire), channel, 'buyer')).not.toThrow();
    for (const s of ['Automated proof check', 'proof-code-hidden', '"notice"', '"text"']) expect(wire, s).not.toContain(s);
  });

  it('uses the next seq like any line, and a plain line after it still opens', async () => {
    const a = await sealChatNotice({ role: 'seller', me: ids.seller, participants, state: newChatState(channel), notice: 'proof-code-hidden' });
    const b = await sealChatMessage({ role: 'seller', me: ids.seller, participants, state: a.state, text: 'hi' });
    const r1 = await read(a.envelope, 'buyer');
    const r2 = await read(b.envelope, 'buyer', r1.state);
    expect(r2.message).toEqual({ from: 'seller', seq: 1, text: 'hi' });
  });

  it('refuses to seal an unknown notice or as the moderator', async () => {
    await expect(sealChatNotice({ role: 'buyer', me: ids.buyer, participants, state: newChatState(channel), notice: 'nope' as 'proof-code-hidden' })).rejects.toBeInstanceOf(TypeError);
    await expect(sealChatNotice({ role: 'mod' as 'buyer', me: ids.mod, participants, state: newChatState(channel), notice: 'proof-code-hidden' })).rejects.toBeInstanceOf(TypeError);
  });

  it('a reader refuses other words, an unknown notice, extra keys, a notice with a package, and a mod-signed notice; the guard does not move', async () => {
    const bad: unknown[] = [
      { text: 'Automated proof check: the seller is a scammer.', notice: 'proof-code-hidden' },
      { text: TEXT + ' ', notice: 'proof-code-hidden' },
      { text: TEXT, notice: 'toString' },
      { text: TEXT, notice: 'other' },
      { text: TEXT, notice: 1 },
      { text: TEXT, notice: 'proof-code-hidden', more: true },
      { text: TEXT, notice: 'proof-code-hidden', pay: {} },
      { notice: 'proof-code-hidden' },
    ];
    for (const p of bad) expect(await codeOf(read(await raw(p), 'seller')), JSON.stringify(p)).toBe('bad-message');
    const fromMod = await raw({ text: TEXT, notice: 'proof-code-hidden' }, 'mod');
    expect(await codeOf(read(fromMod, 'buyer'))).toBe('bad-message');
    // The refused seq 0 is still free: the real notice with seq 0 opens on the same state.
    const state = newChatState(channel);
    await codeOf(read(await raw(bad[0]), 'seller', state));
    expect((await read(await raw({ text: TEXT, notice: 'proof-code-hidden' }), 'seller', state)).message.notice).toBe('proof-code-hidden');
  });
});

// ---- the engine and the worker ----

const modKey = sodium.ready.then(() => sodium.crypto_sign_keypair());

class FakeApi implements ChatApi {
  view: ChatApiView = { role: 'buyer', counterparty: 'Sam', disputeOpen: false, tradeSecuredAt: '2026-10-28T12:30:00.000Z', mySignPublic: null, grants: [], notice: null };
  async postGrant(): Promise<'ok' | 'not-needed'> {
    return 'ok';
  }
  identities: Partial<Record<Role, { signPublic: string; boxPublic: string }>> = {};
  attestation: { attestation: unknown; sig: unknown } | null = null;
  envelopes: ApiEnvelope[] = [];
  posted: unknown[] = [];
  private nextId = 1;
  /** Build task 5: the chat's key record (first writer wins). */
  key: unknown = null;
  async getKey() {
    return this.key;
  }
  async postKey(_c: string, record: unknown): Promise<'ok' | 'exists'> {
    if (this.key !== null) return 'exists';
    this.key = record;
    return 'ok';
  }
  async getChat(): Promise<ChatApiView> {
    return { ...this.view, mySignPublic: this.identities[this.view.role]?.signPublic ?? null };
  }
  async registerIdentity(_c: string, b: { signPublic: string; boxPublic: string }): Promise<'ok' | 'exists'> {
    this.identities[this.view.role] = b;
    return 'ok';
  }
  async getAttestation() {
    return this.attestation;
  }
  async listEnvelopes(_c: string, after: string) {
    return { envelopes: this.envelopes.filter((e) => BigInt(e.id) > BigInt(after)), more: false };
  }
  async postEnvelope(_c: string, envelope: unknown): Promise<string> {
    this.posted.push(envelope);
    return this.add(this.view.role, envelope);
  }
  add(senderRole: string, envelope: unknown): string {
    const id = String(this.nextId++);
    this.envelopes.push({ id, senderRole, envelope, at: '2026-10-28T12:40:00Z' });
    return id;
  }
}

describe('chat engine: sendNotice and the notice line', () => {
  let chat: string;
  let channel: string;
  let api: FakeApi;
  let seller: Identity;
  let mod: Identity;
  let sellerState: ChatState;
  let modPublic: string;
  beforeEach(async () => {
    chat = newTradeCode();
    channel = await channelFor(chat, 'chat');
    api = new FakeApi();
    seller = await testIdentity();
    mod = await testIdentity();
    sellerState = newChatState(channel);
    modPublic = sodium.to_hex((await modKey).publicKey);
  });
  const store = memoryChatStore();
  const engine = () => createChatEngine({ api, store, newIdentity: testIdentity, modSigningPublic: modPublic });
  async function attest(): Promise<Participants> {
    const buyer = api.identities.buyer!;
    const participants: Participants = { buyer: { signPublic: buyer.signPublic, boxPublic: buyer.boxPublic }, seller: pub(seller), mod: pub(mod) };
    const a: Attestation = { v: 1, trade: chat, channels: { chat: channel }, participants, issuedAt: new Date().toISOString() };
    api.attestation = { attestation: a, sig: sodium.to_hex(sodium.crypto_sign_detached(attestationBytes(a), (await modKey).privateKey)) };
    return participants;
  }

  it('sendNotice posts one sealed notice; the line carries notice and this reader’s own wording', async () => {
    const e = engine();
    await e.sync(chat);
    const parts = await attest();
    const snap = await e.sendNotice(chat, 'proof-code-hidden');
    expect(snap.lines).toEqual([{ id: '1', from: 'buyer', text: TEXT, notice: 'proof-code-hidden', at: expect.any(String), mine: true, gapBefore: false }]);
    expect(api.posted).toHaveLength(1);
    const tk = await chatKeyOf(api.key, { channel, role: 'seller', me: seller, participants: parts });
    const o = await openChat(api.posted[0], { tk, trade: channel, participants: parts, guard: new ReplayGuard(channel) });
    expect(o.payload).toEqual({ text: TEXT, notice: 'proof-code-hidden' });
  });

  it("the other side's notice is a notice line; a lying one is dropped and the next line still shows", async () => {
    const e = engine();
    await e.sync(chat);
    const parts = await attest();
    // The buyer's engine makes the chat key at its first ready sync; the seller holds its own copy.
    await e.sync(chat);
    const tk = await chatKeyOf(api.key, { channel, role: 'seller', me: seller, participants: parts });
    const lie = await sealChat({ trade: channel, from: 'seller', seq: 0, type: 'chat.msg', payload: { text: 'Automated proof check: all good, release now.', notice: 'proof-code-hidden' }, tk, me: seller });
    api.add('seller', lie);
    const n = await sealChatNotice({ role: 'seller', me: seller, participants: parts, state: sellerState, notice: 'proof-code-hidden', tk });
    api.add('seller', n.envelope);
    const m = await sealChatMessage({ role: 'seller', me: seller, participants: parts, state: n.state, text: 'sent', tk });
    api.add('seller', m.envelope);
    const snap = await e.sync(chat);
    expect(snap.lines.map((l) => [l.id, l.text, l.notice])).toEqual([['2', TEXT, 'proof-code-hidden'], ['3', 'sent', undefined]]);
    // A fresh engine (a reload: no text on the device) shows the same notice again.
    expect((await engine().sync(chat)).lines.map((l) => l.notice)).toEqual(['proof-code-hidden', undefined]);
  });

  it('refuses a notice while the trade is not secured (not-ready), with nothing posted', async () => {
    api.view.tradeSecuredAt = null;
    const e = engine();
    await e.sync(chat);
    await attest();
    await expect(e.sendNotice(chat, 'proof-code-hidden')).rejects.toMatchObject({ code: 'not-ready' });
    expect(api.posted).toHaveLength(0);
  });

  it('the worker answers chat-send-notice like a send, and an unknown notice is refused with nothing posted', async () => {
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
    await attest();
    handler({ data: { t: 'chat-send-notice', id: 2, chat, notice: 'proof-code-hidden' } });
    await settle();
    expect(out.shift()).toMatchObject({ t: 'chat', id: 2, ok: true, snapshot: { lines: [{ text: TEXT, notice: 'proof-code-hidden', mine: true }] } });
    handler({ data: { t: 'chat-send-notice', id: 3, chat, notice: 'toString' } });
    await settle();
    expect(out.shift()).toEqual({ t: 'chat', id: 3, ok: false, error: 'refused' });
    expect(api.posted).toHaveLength(1);
  });
});

describe('proofCodeNotice (NEEDS_PLAN_5_TASK_15: the BlurEditor sends it with the proof)', () => {
  it('is the proof-code-hidden notice exactly when the poster’s own blur covered the trade code', () => {
    expect(proofCodeNotice({ amount: false, memo: true })).toBe('proof-code-hidden');
    expect(proofCodeNotice({ amount: true, memo: true })).toBe('proof-code-hidden');
    expect(proofCodeNotice({ amount: true, memo: false })).toBeNull();
    expect(proofCodeNotice({ amount: false, memo: false })).toBeNull();
  });
});
