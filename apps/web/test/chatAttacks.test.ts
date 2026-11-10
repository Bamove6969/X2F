/**
 * Attack tests for the browser's chat layer: every hostile envelope must end in a known refusal
 * (ChatError, ChatEnvelopeError, ProtocolError), never an unhandled error, and leave the state
 * untouched. Seeded (fast-check is not a dependency of this repo).
 */
import { newTradeCode, type Role } from '@x2f/core';
import { ProtocolError, seal, type Envelope, type Identity, type Participants } from '@x2f/protocol';
import { ChatEnvelopeError, channelFor } from '@x2f/trade';
import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import { ChatError, chatChannel, newChatState, openChatMessage, sealChatMessage, type ChatState } from '../src/chat/chatCrypto.js';

const SEED = 0x57454221; // "WEB!"
const ALL: readonly Role[] = ['buyer', 'seller', 'mod'];

function rng(seed: number): (n: number) => number {
  let a = seed;
  return (n) => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (((t ^ (t >>> 14)) >>> 0) % n) | 0;
  };
}

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

let ids: Record<Role, Identity>;
let participants: Participants;
let channel: string;

beforeAll(async () => {
  ids = { buyer: await testIdentity(), seller: await testIdentity(), mod: await testIdentity() };
  participants = { buyer: pub(ids.buyer), seller: pub(ids.seller), mod: pub(ids.mod) };
  channel = await chatChannel(newTradeCode());
});

const send = (text = 'hello', state: ChatState = newChatState(channel)) => sealChatMessage({ role: 'buyer', me: ids.buyer, participants, state, text });
const read = (body: unknown, state: ChatState = newChatState(channel), o: { modMayPost?: boolean } = {}) =>
  openChatMessage(body, { role: 'seller', me: ids.seller, participants, state, ...o });

/** The refusal code, or 'ok'; an unexpected error type fails the test. */
async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p;
    return 'ok';
  } catch (e) {
    if (e instanceof ProtocolError || e instanceof ChatError || e instanceof ChatEnvelopeError) return e.code;
    throw e;
  }
}

describe('malformed and truncated bodies', () => {
  it.each([[null], [undefined], [7], ['env'], [[]], [true]])('%s is refused', async (body) => {
    expect(await codeOf(read(body))).toBe('bad-envelope');
  });

  it('a seeded 500-case generator only ever yields known refusals and leaves the state unchanged', async () => {
    const { envelope } = await send();
    const json = JSON.stringify(envelope);
    const r = rng(SEED);
    const state = newChatState(channel);
    const allowed = new Set(['bad-envelope', 'wrong-channel', 'too-large', 'bad-signature', 'not-participant', 'not-for-me', 'bad-message', 'mod-not-allowed', 'replay', 'ok']);
    const junk: unknown[] = [null, 0, -1, 1.5, '', 'x', true, [], {}, 'A'.repeat(40), 'f'.repeat(64)];
    const fields = ['v', 'trade', 'from', 'seq', 'slots', 'nonce', 'kh', 'ct', 'ctNonce', 'sig'];
    for (let i = 0; i < 500; i++) {
      let body: unknown;
      if (r(3) === 0) {
        // One corrupted character in the wire form; often no longer JSON at all.
        const at = r(json.length);
        const alphabet = 'AZaz09+/=-"{}:,0f';
        try {
          body = JSON.parse(json.slice(0, at) + alphabet[r(alphabet.length)]! + json.slice(at + 1));
        } catch {
          continue;
        }
      } else {
        body = JSON.parse(json) as Record<string, unknown>;
        (body as Record<string, unknown>)[fields[r(fields.length)]!] = junk[r(junk.length)];
      }
      if (JSON.stringify(body) === json) continue; // An unchanged character: not a mutation.
      const code = await codeOf(read(body, state));
      expect(code !== 'ok' && allowed.has(code), JSON.stringify(body)).toBe(true);
      expect(state.guard.seen).toEqual({});
    }
  });
});

describe('cross-chat and cross-trade replay', () => {
  it("another chat's state refuses it (wrong-channel), and relabelling it breaks the signature", async () => {
    const { envelope } = await send();
    const other = await chatChannel(newTradeCode());
    expect(await codeOf(read(envelope, newChatState(other)))).toBe('wrong-channel');
    expect(await codeOf(read({ ...envelope, trade: other }, newChatState(other)))).toBe('bad-signature');
  });

  it("a message sealed for a trade's signals channel is refused on the chat channel, even signed by the right person", async () => {
    const code = newTradeCode();
    const chan = await channelFor(code, 'chat');
    const signals = await channelFor(code, 'signals');
    const env = await seal({ trade: signals, from: 'buyer', seq: 0, type: 'chat.msg', payload: { text: 'x' }, to: ALL, me: ids.buyer, participants });
    expect(await codeOf(read(env, newChatState(chan)))).toBe('wrong-channel');
  });

  it('an envelope replayed after a reload, or out of order, is a replay; a gap is allowed', async () => {
    const a = await send('a');
    const b = await send('b', a.state);
    const first = await read(b.envelope);
    expect(await codeOf(read(b.envelope, first.state))).toBe('replay');
    expect(await codeOf(read(a.envelope, first.state))).toBe('replay');
    const c = await send('c', { ...b.state, nextSeq: 9 });
    expect(await codeOf(read(c.envelope, first.state))).toBe('ok');
  });
});

describe('forged sender and recipient set', () => {
  it('a buyer-signed envelope claiming the mod role is refused, even while the mod may post', async () => {
    const forged = await seal({
      trade: channel,
      from: 'mod',
      seq: 0,
      type: 'chat.msg',
      payload: { text: 'release now' },
      to: ALL,
      me: ids.buyer,
      participants: { buyer: pub(ids.mod), seller: pub(ids.seller), mod: pub(ids.buyer) },
    });
    expect(await codeOf(read(forged, newChatState(channel), { modMayPost: true }))).toBe('bad-signature');
  });

  it('a chat message sealed without the reader is not-for-me and does not move the guard', async () => {
    const env = await seal({ trade: channel, from: 'buyer', seq: 0, type: 'chat.msg', payload: { text: 'x' }, to: ['buyer', 'mod'], me: ids.buyer, participants });
    const state = newChatState(channel);
    expect(await codeOf(read(env, state))).toBe('not-for-me');
    expect(state.guard.seen).toEqual({});
  });

  it('a message sealed without the mod opens for the counterparty: the mod cannot tell (R16, called out for the lead)', async () => {
    const env = await seal({ trade: channel, from: 'buyer', seq: 0, type: 'chat.msg', payload: { text: 'x' }, to: ['buyer', 'seller'], me: ids.buyer, participants });
    expect(await codeOf(read(env))).toBe('ok');
    expect(await codeOf(openChatMessage(env, { role: 'mod', me: ids.mod, participants, state: newChatState(channel) }))).toBe('not-for-me');
  });
});

describe('a moderator line outside a dispute (modMayPost)', () => {
  const fromMod = (seq = 0) => seal({ trade: channel, from: 'mod', seq, type: 'chat.msg', payload: { text: 'from the moderator' }, to: ALL, me: ids.mod, participants });

  it('is refused while modMayPost is false or absent, leaving the guard so it opens later', async () => {
    const env = await fromMod();
    const state = newChatState(channel);
    expect(await codeOf(read(env, state))).toBe('mod-not-allowed');
    expect(await codeOf(read(env, state, { modMayPost: false }))).toBe('mod-not-allowed');
    expect(state.guard.seen).toEqual({});
    expect(await codeOf(read(env, state, { modMayPost: true }))).toBe('ok');
  });

  it('a truthy but not-true modMayPost does not count', async () => {
    const env = await fromMod();
    const loose = { modMayPost: 1 } as unknown as { modMayPost: boolean };
    expect(await codeOf(read(env, newChatState(channel), loose))).toBe('mod-not-allowed');
  });
});

describe('oversized bodies', () => {
  it('a message over the text cap is refused before sealing; a body over 16 KiB before any crypto', async () => {
    expect(await codeOf(send('x'.repeat(2001)))).toBe('too-large');
    const { envelope } = await send();
    expect(await codeOf(read({ ...envelope, ct: 'A'.repeat(20_000) }))).toBe('too-large');
  });
});
