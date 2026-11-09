/**
 * Attack tests for the API-side chat checks: checkChatEnvelope must throw only ChatEnvelopeError
 * on anything a client can send, and chatIdentityProofValid must return false and never throw on
 * a bad chat-identity proof. Seeded (fast-check is not a dependency of this repo).
 */
import { newTradeCode } from '@x2f/core';
import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import { CHAT_BODY_MAX_BYTES, ChatEnvelopeError, chatIdentityProofBytes, chatIdentityProofValid, checkChatEnvelope, identityProofBytes } from '../src/index.js';

const SEED = 0x43484154; // "CHAT"
const channel = 'chat-channel-id';

function rng(seed: number): (n: number) => number {
  let a = seed;
  return (n) => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) % n) | 0;
  };
}

const b64 = (bytes: number): string => 'A'.repeat(Math.ceil(bytes / 3) * 4 - (bytes % 3 === 0 ? 0 : bytes % 3 === 1 ? 2 : 1)) + (bytes % 3 === 0 ? '' : bytes % 3 === 1 ? '==' : '=');
const valid = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  v: 1,
  trade: channel,
  from: 'buyer',
  seq: 3,
  slots: { buyer: b64(48), seller: b64(48), mod: b64(48) },
  nonce: b64(24),
  kh: 'a'.repeat(64),
  ct: b64(272),
  ctNonce: b64(24),
  sig: 'b'.repeat(128),
  ...over,
});

function codeOf(fn: () => unknown): string {
  try {
    fn();
    return 'ok';
  } catch (e) {
    if (e instanceof ChatEnvelopeError) return e.code;
    throw e;
  }
}

describe('checkChatEnvelope, a client-controlled body', () => {
  it('a valid body passes (control)', () => {
    expect(codeOf(() => checkChatEnvelope(valid(), channel, 'buyer'))).toBe('ok');
  });

  it.each([[null], [undefined], [7], ['x'], [[]], [true], [new Date(0)]])('%s is bad-envelope', (b) => {
    expect(codeOf(() => checkChatEnvelope(b, channel))).toBe('bad-envelope');
  });

  it('a JSON __proto__ key, a missing key and an extra key are bad-envelope', () => {
    expect(codeOf(() => checkChatEnvelope(JSON.parse(`{"__proto__":{},${JSON.stringify(valid()).slice(1)}`), channel))).toBe('bad-envelope');
    const missing = valid();
    delete missing['ct'];
    expect(codeOf(() => checkChatEnvelope(missing, channel))).toBe('bad-envelope');
    expect(codeOf(() => checkChatEnvelope(valid({ extra: 1 }), channel))).toBe('bad-envelope');
  });

  it('a seq out of range or of the wrong type is bad-envelope', () => {
    for (const seq of [-1, 1.5, 2 ** 53, '3', null, NaN]) expect(codeOf(() => checkChatEnvelope(valid({ seq }), channel)), String(seq)).toBe('bad-envelope');
  });

  it('a wrong channel, and a forged sender role against the session, are their own refusals', () => {
    expect(codeOf(() => checkChatEnvelope(valid({ trade: 'another-channel' }), channel))).toBe('wrong-channel');
    expect(codeOf(() => checkChatEnvelope(valid(), channel, 'seller'))).toBe('wrong-sender');
    expect(codeOf(() => checkChatEnvelope(valid({ from: 'mod' }), channel, 'buyer'))).toBe('wrong-sender');
    expect(codeOf(() => checkChatEnvelope(valid({ from: 'admin' }), channel))).toBe('bad-envelope');
  });

  it('an oversized body is too-large, one byte over the cap, before anything else', () => {
    const fits = valid({ ct: b64(9000) });
    const size = (o: unknown): number => new TextEncoder().encode(JSON.stringify(o)).length;
    expect(size(fits)).toBeLessThan(CHAT_BODY_MAX_BYTES);
    const over = valid({ trade: 'x'.repeat(CHAT_BODY_MAX_BYTES - size(valid()) + channel.length + 1) });
    expect(size(over)).toBe(CHAT_BODY_MAX_BYTES + 1);
    expect(codeOf(() => checkChatEnvelope(over, channel))).toBe('too-large');
  });

  it('a seeded 500-case generator only ever yields ChatEnvelopeError', () => {
    const r = rng(SEED);
    const keys = ['v', 'trade', 'from', 'seq', 'slots', 'nonce', 'kh', 'ct', 'ctNonce', 'sig'] as const;
    const junk: unknown[] = [null, 0, -1, 1.5, NaN, '', 'x', true, [], {}, 2 ** 53, '0', 'A'.repeat(100), 'g'.repeat(64), 'A'.repeat(47), '====', { buyer: 1 }];
    const allowed = ['ok', 'bad-envelope', 'wrong-channel', 'wrong-sender', 'too-large'];
    for (let i = 0; i < 500; i++) {
      const body = valid();
      const n = 1 + r(3);
      for (let j = 0; j < n; j++) {
        const k = keys[r(keys.length)]!;
        if (k === 'slots' && r(2) === 0) body.slots = { buyer: junk[r(junk.length)], seller: b64(48), mod: b64(48) };
        else body[k] = junk[r(junk.length)];
      }
      const code = codeOf(() => checkChatEnvelope(body, channel, r(2) === 0 ? 'buyer' : undefined));
      expect(allowed, JSON.stringify(body)).toContain(code);
    }
  });
});

describe('bad chat-identity proofs (POST /v1/chats/:chat/identity and moderation attestation)', () => {
  beforeAll(async () => {
    await sodium.ready;
  });

  function good(chat: string, role: 'buyer' | 'seller') {
    const kp = sodium.crypto_sign_keypair();
    const signPublic = sodium.to_hex(kp.publicKey);
    const boxPublic = sodium.to_hex(sodium.crypto_sign_ed25519_pk_to_curve25519(kp.publicKey));
    const proof = sodium.to_hex(sodium.crypto_sign_detached(chatIdentityProofBytes(chat, role, signPublic, boxPublic), kp.privateKey));
    return { signPublic, boxPublic, proof, kp };
  }

  it('a proof over this chat and role is accepted (control)', async () => {
    const chat = newTradeCode();
    expect(await chatIdentityProofValid(chat, 'seller', good(chat, 'seller'))).toBe(true);
  });

  it('every tampered field or swapped binding is refused', async () => {
    const chat = newTradeCode();
    const k = good(chat, 'buyer');
    const other = good(chat, 'buyer');
    const flip = (hex: string, at = 10): string => hex.slice(0, at) + (hex[at] === 'a' ? 'b' : 'a') + hex.slice(at + 1);
    const cases: Array<[string, unknown]> = [
      ['truncated proof', { ...k, proof: k.proof.slice(0, -2) }],
      ['long proof', { ...k, proof: `${k.proof}00` }],
      ['upper-case proof', { ...k, proof: k.proof.toUpperCase() }],
      ['bit-flipped proof', { ...k, proof: flip(k.proof) }],
      ['proof by another key', { ...k, proof: other.proof }],
      ['flipped sign key', { ...k, signPublic: flip(k.signPublic) }],
      ['upper-case sign key', { ...k, signPublic: k.signPublic.toUpperCase() }],
      ['box key of another identity', { ...k, boxPublic: other.boxPublic }],
      ['all-zero key (small order)', { ...k, signPublic: '0'.repeat(64) }],
      ['all-zero signature', { ...k, proof: '0'.repeat(128) }],
      ['non-strings', { signPublic: 1, boxPublic: null, proof: {} }],
      ['null keys', null],
      ['empty object', {}],
    ];
    for (const [name, keys] of cases) expect(await chatIdentityProofValid(chat, 'buyer', keys as never), name).toBe(false);
  });

  it('a proof replayed from another chat, from a trade identity or for the other role is refused', async () => {
    const chat = newTradeCode();
    const k = good(chat, 'buyer');
    expect(await chatIdentityProofValid(newTradeCode(), 'buyer', k)).toBe(false);
    expect(await chatIdentityProofValid(chat, 'seller', k)).toBe(false);
    const tradeProof = sodium.to_hex(sodium.crypto_sign_detached(identityProofBytes(chat, 'buyer', k.signPublic, k.boxPublic), k.kp.privateKey));
    expect(await chatIdentityProofValid(chat, 'buyer', { ...k, proof: tradeProof })).toBe(false);
  });

  it('a junk chat code or role is refused, never thrown', async () => {
    const chat = newTradeCode();
    const k = good(chat, 'buyer');
    for (const c of ['', 'nope', 'A'.repeat(500), 5 as unknown as string, null as unknown as string]) {
      expect(await chatIdentityProofValid(c, 'buyer', k), String(c)).toBe(false);
    }
    expect(await chatIdentityProofValid(chat, 'mod' as 'buyer', k)).toBe(false);
  });
});
