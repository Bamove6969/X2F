import { newTradeCode } from '@x2f/core';
import { describe, expect, it } from 'vitest';
import { CHAT_BODY_MAX_BYTES, ChatEnvelopeError, channelFor, checkChatEnvelopeV3 } from '../src/index.js';

/** Private moderator lanes (docs/security/private-mod-chat-2026-11-27.md): the API's shape check of envelope v3. */
async function body(over: Record<string, unknown> = {}): Promise<{ channel: string; b: Record<string, unknown> }> {
  const channel = await channelFor(newTradeCode(), 'chat');
  return { channel, b: { v: 3, trade: channel, from: 'buyer', to: 'buyer', seq: 0, nonce: 'A'.repeat(32), ct: 'A'.repeat(368), sig: '0'.repeat(128), ...over } };
}

const codeOf = (f: () => unknown): string | undefined => {
  try {
    f();
  } catch (e) {
    if (e instanceof ChatEnvelopeError) return e.code;
    throw e;
  }
  return undefined;
};

describe('checkChatEnvelopeV3', () => {
  it('takes a trader\'s own-lane envelope and a moderator\'s envelope to either lane', async () => {
    const { channel, b } = await body();
    expect(checkChatEnvelopeV3(b, channel, 'buyer')).toEqual(b);
    for (const to of ['buyer', 'seller']) {
      const m = { ...b, from: 'mod', to };
      expect(checkChatEnvelopeV3(m, channel, 'mod')).toEqual(m);
    }
  });

  it('refuses another lane, another sender, another channel and a bad shape', async () => {
    const { channel, b } = await body();
    expect(codeOf(() => checkChatEnvelopeV3({ ...b, to: 'seller' }, channel, 'buyer'))).toBe('wrong-lane');
    expect(codeOf(() => checkChatEnvelopeV3({ ...b, from: 'seller', to: 'seller' }, channel, 'buyer'))).toBe('wrong-sender');
    expect(codeOf(() => checkChatEnvelopeV3(b, 'x'.repeat(channel.length), 'buyer'))).toBe('wrong-channel');
    for (const bad of [{ ...b, v: 2 }, { ...b, to: 'mod' }, { ...b, to: undefined }, { ...b, seq: -1 }, { ...b, nonce: '' }, { ...b, sig: 'x' }, { ...b, extra: 1 }]) {
      expect(codeOf(() => checkChatEnvelopeV3(bad, channel, 'buyer'))).toBe('bad-envelope');
    }
    const { to: _to, ...v2 } = b;
    expect(codeOf(() => checkChatEnvelopeV3({ ...v2, v: 2 }, channel, 'buyer'))).toBe('bad-envelope');
    expect(codeOf(() => checkChatEnvelopeV3({ ...b, ct: 'A'.repeat(CHAT_BODY_MAX_BYTES) }, channel, 'buyer'))).toBe('too-large');
  });
});
