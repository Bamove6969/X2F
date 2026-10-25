import { newTradeCode, type Role } from '@x2f/core';
import { ProtocolError, seal, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import { CHAT_BODY_MAX_BYTES, CHAT_TEXT_MAX_BYTES, ChatEnvelopeError, channelFor, chatIdentityProofBytes } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ChatError,
  chatChannel,
  checkChatText,
  newChatState,
  openChatMessage,
  parseChatState,
  sealChatMessage,
  signChatIdentity,
  type ChatState,
} from '../src/chat/chatCrypto.js';

/**
 * A chat identity made here with libsodium: apps/web may name the protocol's identity maker only
 * in the escrow worker (separation check, lead answer 2026-10-24).
 */
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

const pub = (i: Identity): { signPublic: string; boxPublic: string } => ({ signPublic: i.signPublic, boxPublic: i.boxPublic });
const bytes = (o: unknown): number => new TextEncoder().encode(JSON.stringify(o)).length;

let ids: Record<Role, Identity>;
let outsider: Identity;
let participants: Participants;
let chat: string;
let channel: string;

beforeAll(async () => {
  ids = { buyer: await testIdentity(), seller: await testIdentity(), mod: await testIdentity() };
  outsider = await testIdentity();
  participants = { buyer: pub(ids.buyer), seller: pub(ids.seller), mod: pub(ids.mod) };
  chat = newTradeCode();
  channel = await chatChannel(chat);
});

async function send(role: 'buyer' | 'seller', text: string, state = newChatState(channel)): Promise<{ envelope: Envelope; state: ChatState }> {
  return sealChatMessage({ role, me: ids[role], participants, state, text });
}

async function read(body: unknown, role: Role, state = newChatState(channel), me = ids[role], parts: Participants = participants) {
  return openChatMessage(body, { role, me, participants: parts, state });
}

/** A chat message from the chat's mod identity (the moderation service seals these in a dispute). */
async function fromMod(text: string, seq = 0): Promise<Envelope> {
  return seal({ trade: channel, from: 'mod', seq, type: 'chat.msg', payload: { text }, to: ['buyer', 'seller', 'mod'], me: ids.mod, participants });
}

/** The error code of a rejected promise ('ok' when it resolves). */
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof ProtocolError || e instanceof ChatError || e instanceof ChatEnvelopeError) return e.code;
    if (e instanceof TypeError) return 'TypeError';
    throw e;
  }
}

describe('chat channel', () => {
  it('is channelFor(chat, "chat"): never the chat code, never a trade channel', async () => {
    expect(channel).toBe(await channelFor(chat, 'chat'));
    expect(channel).not.toBe(chat);
    expect(channel).not.toBe(await channelFor(chat, 'signals'));
    expect(channel).not.toBe(await channelFor(chat, 'escrow'));
  });
});

describe('sealing and opening', () => {
  it('an envelope from the buyer opens for the seller and the mod identity, and for nobody else', async () => {
    const { envelope } = await send('buyer', 'Hi, is the Zelle offer still open?');
    for (const role of ['seller', 'mod'] as const) {
      const { message } = await read(envelope, role);
      expect(message).toEqual({ from: 'buyer', seq: 0, text: 'Hi, is the Zelle offer still open?' });
    }
    // An outsider's keys, in any slot, open nothing.
    for (const role of ['buyer', 'seller', 'mod'] as const) {
      expect(await codeOf(read(envelope, role, newChatState(channel), outsider))).toBe('not-for-me');
    }
  });

  it('the sender re-reads its own message after a reload (it is sealed to itself too)', async () => {
    const { envelope } = await send('seller', 'Yes it is');
    const { message } = await read(envelope, 'seller');
    expect(message.from).toBe('seller');
    expect(message.text).toBe('Yes it is');
  });

  it('carries only the text: no names, no account fields', async () => {
    const { envelope } = await send('buyer', 'hello');
    const { message } = await read(envelope, 'mod');
    expect(Object.keys(message).sort()).toEqual(['from', 'seq', 'text']);
    expect(JSON.stringify(envelope)).not.toContain('hello');
  });

  it("the sender's seq is a counter in the state it must persist before posting", async () => {
    const s0 = newChatState(channel);
    const a = await send('buyer', 'one', s0);
    const b = await send('buyer', 'two', a.state);
    expect([a.envelope.seq, b.envelope.seq]).toEqual([0, 1]);
    expect(b.state.nextSeq).toBe(2);
    expect(s0.nextSeq).toBe(0); // inputs are never mutated
    expect(s0.guard.seen).toEqual({});
  });

  it('never reuses a seq the guard already saw from this sender (a stale counter is moved past it)', async () => {
    const a = await send('buyer', 'one', { ...newChatState(channel), nextSeq: 5 });
    const mine = await read(a.envelope, 'buyer');
    const stale = { ...mine.state, nextSeq: 0 };
    const b = await send('buyer', 'two', stale);
    expect(b.envelope.seq).toBe(6);
    expect(b.state.nextSeq).toBe(7);
  });

  it('only a buyer or a seller seals in the app', async () => {
    const p = sealChatMessage({ role: 'mod' as 'buyer', me: ids.mod, participants, state: newChatState(channel), text: 'x' });
    expect(await codeOf(p)).toBe('TypeError');
  });
});

describe('replay and ordering', () => {
  it('a replay is rejected after a reload (the persisted guard)', async () => {
    const { envelope } = await send('buyer', 'once');
    const first = await read(envelope, 'seller');
    const saved = JSON.parse(JSON.stringify(first.state)) as unknown;
    const reloaded = parseChatState(saved, channel);
    expect(await codeOf(read(envelope, 'seller', reloaded))).toBe('replay');
  });

  it('an older seq after a newer one is a replay (no reordering)', async () => {
    const a = await send('buyer', 'first');
    const b = await send('buyer', 'second', a.state);
    const r = await read(b.envelope, 'seller');
    expect(await codeOf(read(a.envelope, 'seller', r.state))).toBe('replay');
  });

  it('each sender has its own order; a gap is allowed (a post that never landed)', async () => {
    const a = await send('buyer', 'b0');
    const s = await send('seller', 's0');
    const gap = await send('buyer', 'b5', { ...a.state, nextSeq: 5 });
    let st = (await read(s.envelope, 'mod')).state;
    st = (await read(a.envelope, 'mod', st)).state;
    st = (await read(gap.envelope, 'mod', st)).state;
    expect(st.guard.seen).toEqual({ buyer: 5, seller: 0 });
  });

  it('a rejected message leaves the state untouched', async () => {
    const { envelope } = await send('buyer', 'x');
    const st = newChatState(channel);
    await codeOf(read({ ...envelope, seq: 9 }, 'seller', st));
    expect(st.guard.seen).toEqual({});
  });
});

describe('binding to the chat channel', () => {
  it("another chat's state refuses the envelope (wrong-channel)", async () => {
    const { envelope } = await send('buyer', 'x');
    const other = await chatChannel(newTradeCode());
    expect(await codeOf(read(envelope, 'seller', newChatState(other)))).toBe('wrong-channel');
  });

  it('relabelling the envelope for another channel breaks the signature', async () => {
    const { envelope } = await send('buyer', 'x');
    const other = await chatChannel(newTradeCode());
    expect(await codeOf(read({ ...envelope, trade: other }, 'seller', newChatState(other)))).toBe('bad-signature');
  });

  it("a message sealed on the same code's signals channel is refused on the chat channel", async () => {
    const signals = await channelFor(chat, 'signals');
    const env = await seal({ trade: signals, from: 'buyer', seq: 0, type: 'chat.msg', payload: { text: 'x' }, to: ['buyer', 'seller', 'mod'], me: ids.buyer, participants });
    expect(await codeOf(read(env, 'seller'))).toBe('wrong-channel');
  });

  it('a non-chat type on the chat channel is refused (bad-message), as is any extra payload field', async () => {
    const mk = (type: string, payload: unknown, seq = 0) =>
      seal({ trade: channel, from: 'buyer', seq, type, payload, to: ['buyer', 'seller', 'mod'], me: ids.buyer, participants });
    expect(await codeOf(read(await mk('trade.paid', { text: 'x' }), 'seller'))).toBe('bad-message');
    expect(await codeOf(read(await mk('chat.msg', { text: 'x', username: 'alice' }), 'seller'))).toBe('bad-message');
    expect(await codeOf(read(await mk('chat.msg', { text: 7 }), 'seller'))).toBe('bad-message');
    expect(await codeOf(read(await mk('chat.msg', 'x'), 'seller'))).toBe('bad-message');
    expect(await codeOf(read(await mk('chat.msg', { text: 'a\u202Eb' }), 'seller'))).toBe('bad-message');
  });
});

describe('tampering and truncation', () => {
  it('changing any signed field breaks the signature', async () => {
    const { envelope } = await send('buyer', 'pay to the usual account');
    const flip = (s: string): string => (s[5] === 'A' ? `${s.slice(0, 5)}B${s.slice(6)}` : `${s.slice(0, 5)}A${s.slice(6)}`);
    const tampered: unknown[] = [
      { ...envelope, seq: envelope.seq + 1 },
      { ...envelope, ct: flip(envelope.ct) },
      { ...envelope, nonce: flip(envelope.nonce) },
      { ...envelope, ctNonce: flip(envelope.ctNonce) },
      { ...envelope, kh: `${envelope.kh.slice(0, -1)}${envelope.kh.endsWith('0') ? '1' : '0'}` },
      { ...envelope, slots: { ...envelope.slots, seller: flip(envelope.slots.seller) } },
      { ...envelope, slots: { ...envelope.slots, seller: envelope.slots.mod, mod: envelope.slots.seller } },
    ];
    for (const t of tampered) expect(await codeOf(read(t, 'seller'))).toBe('bad-signature');
  });

  it('a truncated ciphertext or signature is refused', async () => {
    const { envelope } = await send('buyer', 'x');
    expect(await codeOf(read({ ...envelope, ct: envelope.ct.slice(0, -4) }, 'seller'))).toBe('bad-signature');
    expect(await codeOf(read({ ...envelope, sig: envelope.sig.slice(0, -2) }, 'seller'))).toBe('bad-envelope');
    const missing = Object.fromEntries(Object.entries(envelope).filter(([k]) => k !== 'ctNonce'));
    expect(await codeOf(read(missing, 'seller'))).toBe('bad-envelope');
  });

  it('a body over 16 KiB is refused before any crypto (too-large)', async () => {
    const { envelope } = await send('buyer', 'x');
    const big = { ...envelope, ct: 'A'.repeat(CHAT_BODY_MAX_BYTES) };
    expect(bytes(big)).toBeGreaterThan(CHAT_BODY_MAX_BYTES);
    expect(await codeOf(read(big, 'seller'))).toBe('too-large');
  });

  it('a deterministic 200-mutation fuzz only ever throws chat or protocol errors', async () => {
    const { envelope } = await send('buyer', 'fuzz me');
    const json = JSON.stringify(envelope);
    let x = 12345;
    const rnd = (n: number): number => {
      x = (x * 1103515245 + 12345) % 2 ** 31;
      return x % n;
    };
    const alphabet = 'AZaz09+/=-"{}:,0f';
    for (let i = 0; i < 200; i++) {
      const at = rnd(json.length);
      const mutated = json.slice(0, at) + alphabet[rnd(alphabet.length)] + json.slice(at + 1);
      let body: unknown;
      try {
        body = JSON.parse(mutated);
      } catch {
        continue;
      }
      const code = await codeOf(read(body, 'seller'));
      if (mutated === json) expect(code).toBe('ok');
      else expect(['bad-envelope', 'wrong-channel', 'too-large', 'bad-signature', 'not-participant', 'not-for-me', 'bad-message']).toContain(code);
    }
  });
});

describe('key confusion between the parties', () => {
  it('the buyer cannot seal as the seller (identity does not match participants[from])', async () => {
    const p = sealChatMessage({ role: 'seller', me: ids.buyer, participants, state: newChatState(channel), text: 'x' });
    expect(await codeOf(p)).toBe('TypeError');
  });

  it("a buyer-signed envelope claiming to be from the seller fails the seller's key", async () => {
    const forged = await seal({
      trade: channel,
      from: 'seller',
      seq: 0,
      type: 'chat.msg',
      payload: { text: 'release now' },
      to: ['buyer', 'seller', 'mod'],
      me: ids.buyer,
      participants: { buyer: pub(ids.seller), seller: pub(ids.buyer), mod: pub(ids.mod) },
    });
    expect(await codeOf(read(forged, 'mod'))).toBe('bad-signature');
  });

  it('participants with the two traders swapped refuse the message', async () => {
    const { envelope } = await send('buyer', 'x');
    const swapped = { buyer: pub(ids.seller), seller: pub(ids.buyer), mod: pub(ids.mod) };
    expect(await codeOf(read(envelope, 'mod', newChatState(channel), ids.mod, swapped))).toBe('bad-signature');
  });

  it("the seller's keys under the buyer's role open nothing", async () => {
    const { envelope } = await send('seller', 'x');
    expect(await codeOf(read(envelope, 'buyer', newChatState(channel), ids.seller))).toBe('not-for-me');
  });

  it('a participant list where two roles share a key is refused', async () => {
    const { envelope } = await send('buyer', 'x');
    const shared = { buyer: pub(ids.buyer), seller: pub(ids.seller), mod: pub(ids.seller) };
    expect(await codeOf(read(envelope, 'seller', newChatState(channel), ids.seller, shared))).toBe('TypeError');
  });
});

describe('message text', () => {
  it('the largest text, even all JSON-escaped, seals within 16 KiB', async () => {
    for (const unit of ['"', '\\', '\n', 'a', 'é', '中', '\u{1F600}']) {
      const n = Math.floor(CHAT_TEXT_MAX_BYTES / new TextEncoder().encode(unit).length);
      const text = unit === '\n' ? `x${unit.repeat(n - 1)}` : unit.repeat(n);
      const { envelope } = await send('buyer', text);
      expect(bytes(envelope)).toBeLessThanOrEqual(CHAT_BODY_MAX_BYTES);
      expect((await read(envelope, 'seller')).message.text).toBe(text);
    }
  });

  it('one byte over the limit is too-large', () => {
    expect(() => checkChatText('a'.repeat(CHAT_TEXT_MAX_BYTES + 1))).toThrow(expect.objectContaining({ code: 'too-large' }));
    expect(checkChatText('a'.repeat(CHAT_TEXT_MAX_BYTES))).toHaveLength(CHAT_TEXT_MAX_BYTES);
  });

  it('refuses the deprecated format controls, interlinear annotation marks and zero-width characters', () => {
    const invisible = ['\u206A', '\u206B', '\u206C', '\u206D', '\u206E', '\u206F', '\uFFF9', '\uFFFA', '\uFFFB', '\u200B', '\u2060', '\uFEFF', '\u180E'];
    for (const c of invisible) {
      expect(() => checkChatText(`pay${c}here`), c.codePointAt(0)?.toString(16)).toThrow(expect.objectContaining({ code: 'bad-text' }));
    }
  });

  it('keeps ZWJ, ZWNJ and the LRM/RLM/ALM marks (emoji sequences, Persian and Indic text, RTL)', () => {
    const family = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}';
    const persian = '\u0645\u06CC\u200C\u062E\u0648\u0627\u0647\u0645';
    for (const t of [family, persian, 'a\u200Eb', 'a\u200Fb', 'a\u061Cb']) expect(checkChatText(t)).toBe(t);
  });

  it('refuses a message that is empty once invisible characters are removed', () => {
    for (const t of ['\u200D', '\u200C\u200E', ' \u200F\n\u061C ', '\u200D\t\u200C']) {
      expect(() => checkChatText(t), JSON.stringify(t)).toThrow(expect.objectContaining({ code: 'bad-text' }));
    }
  });

  it('refuses empty, blank, control characters, lone surrogates and direction overrides', () => {
    for (const t of ['', '   ', '\n\t', 'a\u0000b', 'a\u0007', 'a\u007fb', 'a\u0085b', '\ud800', 'x\udc00', 'a\u202Eb', 'a\u2066b', 7, null]) {
      expect(() => checkChatText(t), JSON.stringify(t)).toThrow(expect.objectContaining({ code: 'bad-text' }));
    }
  });

  it('keeps newlines, tabs and any language as typed', () => {
    for (const t of ['line one\nline two', 'a\tb', 'Привет', 'مرحبا', '\u{1F600} ok']) expect(checkChatText(t)).toBe(t);
  });

  it('seal refuses bad text before any crypto', async () => {
    expect(await codeOf(send('buyer', 'a\u0000'))).toBe('bad-text');
  });
});

describe('moderator messages (spec 6.6: traders see the moderator only in a disputed trade)', () => {
  it('by default an authentic message from the mod is refused (mod-not-allowed) and the guard does not move', async () => {
    const env = await fromMod('I am reviewing this trade', 3);
    const st = newChatState(channel);
    for (const role of ['buyer', 'seller'] as const) {
      expect(await codeOf(read(env, role, st))).toBe('mod-not-allowed');
    }
    expect(st.guard.seen).toEqual({});
    // Once a dispute is open the same envelope still opens: the refusal left no trace.
    const r = await openChatMessage(env, { role: 'buyer', me: ids.buyer, participants, state: st, modMayPost: true });
    expect(r.message).toEqual({ from: 'mod', seq: 3, text: 'I am reviewing this trade' });
    expect(r.state.guard.seen).toEqual({ mod: 3 });
  });

  it('a forged "mod" message still fails the signature, whatever the setting', async () => {
    const forged = await seal({
      trade: channel, from: 'mod', seq: 0, type: 'chat.msg', payload: { text: 'release now' }, to: ['buyer', 'seller', 'mod'],
      me: ids.buyer, participants: { buyer: pub(ids.mod), seller: pub(ids.seller), mod: pub(ids.buyer) },
    });
    expect(await codeOf(read(forged, 'seller'))).toBe('bad-signature');
    expect(await codeOf(openChatMessage(forged, { role: 'seller', me: ids.seller, participants, state: newChatState(channel), modMayPost: true }))).toBe('bad-signature');
  });

  it('modMayPost does not change what the traders may send', async () => {
    const { envelope } = await send('buyer', 'hi');
    const r = await openChatMessage(envelope, { role: 'seller', me: ids.seller, participants, state: newChatState(channel), modMayPost: true });
    expect(r.message.from).toBe('buyer');
    expect((await read(envelope, 'seller')).message.from).toBe('buyer');
  });
});

describe('source hygiene (M3)', () => {
  it('chat source and tests hold no literal invisible or bidi characters (they are written as \\u escapes)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const files = ['../src/chat/chatCrypto.ts', './chatCrypto.test.ts', './chat-tripwire.test.ts', '../../../packages/trade/src/chat.ts', '../../../packages/trade/test/chat.test.ts'];
    const hidden = /[\u00AD\u061C\u180E\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\uFFF9-\uFFFB]/u;
    for (const f of files) expect(hidden.test(readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8')), f).toBe(false);
  });
});

describe('saved chat state', () => {
  it('round-trips through JSON', async () => {
    const a = await send('buyer', 'x');
    const r = await read(a.envelope, 'buyer', a.state);
    expect(parseChatState(JSON.parse(JSON.stringify(r.state)), channel)).toEqual(r.state);
  });

  it("refuses another chat's state or a bad shape (bad-state)", async () => {
    const good = newChatState(channel);
    const other = newChatState(await chatChannel(newTradeCode()));
    const bad: unknown[] = [
      other,
      null,
      { ...good, extra: 1 },
      { ...good, nextSeq: -1 },
      { ...good, nextSeq: 1.5 },
      { ...good, guard: { trade: other.channel, seen: {} } },
      { ...good, guard: { trade: channel, seen: { buyer: -1 } } },
      { ...good, guard: { trade: channel, seen: { admin: 1 } } },
    ];
    for (const b of bad) expect(() => parseChatState(b, channel), JSON.stringify(b)).toThrow(expect.objectContaining({ code: 'bad-state' }));
  });
});

describe('chat identity proof', () => {
  it('signs chatIdentityProofBytes with the identity (the API verifies it against signPublic)', async () => {
    const proof = await signChatIdentity(ids.buyer, chat, 'buyer');
    await sodium.ready;
    const msg = chatIdentityProofBytes(chat, 'buyer', ids.buyer.signPublic, ids.buyer.boxPublic);
    expect(sodium.crypto_sign_verify_detached(sodium.from_hex(proof), msg, sodium.from_hex(ids.buyer.signPublic))).toBe(true);
    const asSeller = chatIdentityProofBytes(chat, 'seller', ids.buyer.signPublic, ids.buyer.boxPublic);
    expect(sodium.crypto_sign_verify_detached(sodium.from_hex(proof), asSeller, sodium.from_hex(ids.buyer.signPublic))).toBe(false);
  });
});
