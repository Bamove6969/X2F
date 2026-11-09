import { newTradeCode } from '@x2f/core';
import { describe, expect, it } from 'vitest';
import {
  CHAT_AFTER_CLOSE_DAYS,
  CHAT_AFTER_DISPUTE_DAYS,
  CHAT_BODY_MAX_BYTES,
  CHAT_PRETRADE_IDLE_DAYS,
  ChatEnvelopeError,
  channelFor,
  chatIdentityProofBytes,
  chatPurgeDue,
  checkChatEnvelope,
} from '../src/index.js';

const DAY = 86_400_000;
const B64_48 = 'A'.repeat(64);
const B64_24 = 'A'.repeat(32);

async function body(over: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  return {
    v: 1,
    trade: await channelFor(newTradeCode(), 'chat'),
    from: 'buyer',
    seq: 0,
    slots: { buyer: B64_48, seller: B64_48, mod: B64_48 },
    nonce: B64_24,
    kh: '0'.repeat(64),
    ct: 'A'.repeat(368),
    ctNonce: B64_24,
    sig: '0'.repeat(128),
    ...over,
  };
}

const codeOf = (f: () => unknown): string => {
  try {
    f();
  } catch (e) {
    if (e instanceof ChatEnvelopeError) return e.code;
    throw e;
  }
  return 'ok';
};

describe('checkChatEnvelope (the API-side shape check; no keys, no decryption)', () => {
  it('accepts a well-formed envelope on the chat channel from the session role', async () => {
    const b = await body();
    const env = checkChatEnvelope(b, b.trade as string, 'buyer');
    expect(env.trade).toBe(b.trade);
    expect(env.seq).toBe(0);
  });

  it('refuses another channel, including the same chat code on its trade channels', async () => {
    const code = newTradeCode();
    const b = await body({ trade: await channelFor(code, 'signals') });
    expect(codeOf(() => checkChatEnvelope(b, '0000-0000-0000-0000', 'buyer'))).toBe('wrong-channel');
    const chat = await channelFor(code, 'chat');
    expect(codeOf(() => checkChatEnvelope(b, chat, 'buyer'))).toBe('wrong-channel');
    const raw = await body({ trade: code });
    expect(codeOf(() => checkChatEnvelope(raw, chat, 'buyer'))).toBe('wrong-channel');
  });

  it('refuses a `from` that is not the session role (no posting as the other side or as the mod)', async () => {
    const b = await body({ from: 'seller' });
    expect(codeOf(() => checkChatEnvelope(b, b.trade as string, 'buyer'))).toBe('wrong-sender');
    const m = await body({ from: 'mod' });
    expect(codeOf(() => checkChatEnvelope(m, m.trade as string, 'buyer'))).toBe('wrong-sender');
  });

  it('without a session role, still requires a known role', async () => {
    const b = await body({ from: 'mod' });
    expect(checkChatEnvelope(b, b.trade as string).from).toBe('mod');
    const x = await body({ from: 'admin' });
    expect(codeOf(() => checkChatEnvelope(x, x.trade as string))).toBe('bad-envelope');
  });

  it('refuses extra, missing or wrongly typed fields', async () => {
    const b = await body();
    const ch = b.trade as string;
    const cases: Array<Record<string, unknown> | unknown> = [
      null,
      [],
      'x',
      { ...b, extra: 1 },
      { ...b, username: 'alice' },
      Object.fromEntries(Object.entries(b).filter(([k]) => k !== 'sig')),
      { ...b, v: 2 },
      { ...b, seq: -1 },
      { ...b, seq: 1.5 },
      { ...b, seq: '1' },
      { ...b, seq: Number.MAX_SAFE_INTEGER + 1 },
      { ...b, slots: { buyer: B64_48, seller: B64_48 } },
      { ...b, slots: { buyer: B64_48, seller: B64_48, mod: B64_48, x: B64_48 } },
      { ...b, slots: { buyer: 1, seller: B64_48, mod: B64_48 } },
      { ...b, kh: 'Z'.repeat(64) },
      { ...b, sig: 'A'.repeat(128) },
      { ...b, ct: 'not base64!' },
      { ...b, nonce: 7 },
    ];
    for (const c of cases) expect(codeOf(() => checkChatEnvelope(c, ch, 'buyer'))).toBe('bad-envelope');
  });

  it('refuses a body over 16 KiB with too-large, and accepts one that fits', async () => {
    const b = await body();
    const ch = b.trade as string;
    const size = (o: unknown): number => new TextEncoder().encode(JSON.stringify(o)).length;
    const base = size({ ...b, ct: '' });
    // ct must be whole base64 quads: the largest that fits is within 3 bytes of the cap.
    const fit = { ...b, ct: 'A'.repeat(Math.floor((CHAT_BODY_MAX_BYTES - base) / 4) * 4) };
    expect(size(fit)).toBeLessThanOrEqual(CHAT_BODY_MAX_BYTES);
    expect(size(fit)).toBeGreaterThan(CHAT_BODY_MAX_BYTES - 4);
    expect(codeOf(() => checkChatEnvelope(fit, ch, 'buyer'))).toBe('ok');
    const over = { ...b, ct: 'A'.repeat(CHAT_BODY_MAX_BYTES - base + 1) };
    expect(size(over)).toBe(CHAT_BODY_MAX_BYTES + 1);
    expect(codeOf(() => checkChatEnvelope(over, ch, 'buyer'))).toBe('too-large');
  });

  it('never puts field values in its error messages', async () => {
    const b = await body({ from: 'seller' });
    try {
      checkChatEnvelope(b, b.trade as string, 'buyer');
    } catch (e) {
      expect((e as Error).message).not.toContain(b.trade as string);
    }
  });
});

describe('chatIdentityProofBytes', () => {
  const SP = '0123456789abcdef'.repeat(4);
  const BP = 'fedcba9876543210'.repeat(4);

  it('binds the chat, the role and both public keys under its own domain', () => {
    const text = new TextDecoder().decode(chatIdentityProofBytes('K7M2-9QXA-4FTR-8WPN', 'buyer', SP, BP));
    expect(text).toBe(`x2f/chat-identity/v1\0K7M2-9QXA-4FTR-8WPN\0buyer\0${SP}${BP}`);
  });

  it('is the same for any spelling of the chat code and differs per role and per key', () => {
    const a = chatIdentityProofBytes('k7m2 9qxa 4ftr 8wpn', 'buyer', SP, BP);
    expect(a).toEqual(chatIdentityProofBytes('K7M2-9QXA-4FTR-8WPN', 'buyer', SP, BP));
    expect(a).not.toEqual(chatIdentityProofBytes('K7M2-9QXA-4FTR-8WPN', 'seller', SP, BP));
    expect(a).not.toEqual(chatIdentityProofBytes('K7M2-9QXA-4FTR-8WPN', 'buyer', BP, SP));
  });

  it('refuses a bad chat code or a role other than buyer or seller', () => {
    expect(() => chatIdentityProofBytes('nope', 'buyer', SP, BP)).toThrow(TypeError);
    expect(() => chatIdentityProofBytes('K7M2-9QXA-4FTR-8WPN', 'mod' as 'buyer', SP, BP)).toThrow(TypeError);
  });

  it('requires both keys as exactly 64 lower-case hex characters (they are joined with no separator)', () => {
    const code = 'K7M2-9QXA-4FTR-8WPN';
    // Without the length rule, ("ab"+x, y) and ("a", "b"+x+y) would sign the same bytes.
    for (const bad of ['', 'aa', SP.slice(1), `${SP}0`, SP.toUpperCase(), `${SP.slice(0, 63)}g`, `${SP.slice(0, 63)} `]) {
      expect(() => chatIdentityProofBytes(code, 'buyer', bad, BP), bad).toThrow(TypeError);
      expect(() => chatIdentityProofBytes(code, 'buyer', SP, bad), bad).toThrow(TypeError);
    }
  });
});

describe('chatPurgeDue (purgeChats retention rule)', () => {
  const t0 = new Date('2026-10-01T00:00:00Z');
  const at = (days: number): Date => new Date(t0.getTime() + days * DAY);
  const pre = { tradeClosedAt: null, tradeLinked: false, disputeOpen: false, disputed: false, disputeClosedAt: null, createdAt: t0, lastMessageAt: null };
  const justAfter = (d: Date): Date => new Date(d.getTime() + 1);

  it('uses the owner\'s numbers (8 Nov: 30 days, 90 after a dispute) and leaves the 7 idle days alone', () => {
    expect(CHAT_PRETRADE_IDLE_DAYS).toBe(7);
    expect(CHAT_AFTER_CLOSE_DAYS).toBe(30);
    expect(CHAT_AFTER_DISPUTE_DAYS).toBe(90);
  });

  it('a pre-trade chat goes after 7 days without a message (counted from the last one)', () => {
    expect(chatPurgeDue(pre, at(7))).toBe(false);
    expect(chatPurgeDue(pre, justAfter(at(7)))).toBe(true);
    const talked = { ...pre, lastMessageAt: at(5) };
    expect(chatPurgeDue(talked, at(12))).toBe(false);
    expect(chatPurgeDue(talked, justAfter(at(12)))).toBe(true);
  });

  it('a chat linked to an open trade is never purged, however quiet', () => {
    expect(chatPurgeDue({ ...pre, tradeLinked: true }, at(400))).toBe(false);
  });

  describe('a trade that was never disputed', () => {
    const closed = { ...pre, tradeLinked: true, tradeClosedAt: at(10) };

    it('keeps its chat for exactly 30 days after it closes, not the 90 of a disputed one', () => {
      expect(chatPurgeDue(closed, at(39))).toBe(false);
      expect(chatPurgeDue(closed, at(40))).toBe(false);
      expect(chatPurgeDue(closed, justAfter(at(40)))).toBe(true);
      expect(chatPurgeDue(closed, at(41))).toBe(true);
    });
  });

  describe('a trade that had a dispute', () => {
    const closed = { ...pre, tradeLinked: true, tradeClosedAt: at(10), disputed: true, disputeClosedAt: at(10) };

    it('keeps its chat for exactly 90 days after the dispute closes, and past the 30 of an undisputed one', () => {
      expect(chatPurgeDue(closed, at(40))).toBe(false);
      expect(chatPurgeDue(closed, justAfter(at(40)))).toBe(false);
      expect(chatPurgeDue(closed, at(100))).toBe(false);
      expect(chatPurgeDue(closed, justAfter(at(100)))).toBe(true);
    });

    it('counts from the dispute closing, not from when the trade closed', () => {
      // The trade settled at day 10, the appeal ran, the dispute closed at day 50.
      const appealed = { ...closed, disputeClosedAt: at(50) };
      expect(chatPurgeDue(appealed, at(100))).toBe(false);
      expect(chatPurgeDue(appealed, at(140))).toBe(false);
      expect(chatPurgeDue(appealed, justAfter(at(140)))).toBe(true);
    });

    it('a dispute opened inside the 30 days stops the 30-day erasure (the owner\'s rule)', () => {
      // Refunded at day 10, disputed at day 20, closed at day 25.
      const late = { ...closed, tradeClosedAt: at(10), disputeClosedAt: at(25) };
      expect(chatPurgeDue(late, justAfter(at(40)))).toBe(false);
      expect(chatPurgeDue(late, at(115))).toBe(false);
      expect(chatPurgeDue(late, justAfter(at(115)))).toBe(true);
    });

    it('never counts from before the trade closed: the later of the two is the start', () => {
      const earlier = { ...closed, tradeClosedAt: at(20), disputeClosedAt: at(5) };
      expect(chatPurgeDue(earlier, at(110))).toBe(false);
      expect(chatPurgeDue(earlier, justAfter(at(110)))).toBe(true);
    });

    it('never goes while a dispute is open, however long ago the trade closed', () => {
      // Round 1 published: coins moved, the trade closed, the 48-hour appeal window is running.
      expect(chatPurgeDue({ ...closed, disputeOpen: true, disputeClosedAt: null }, at(1000))).toBe(false);
      // Appealed, or a later escalation (seq 2) with an earlier dispute already closed.
      expect(chatPurgeDue({ ...closed, disputeOpen: true }, at(1000))).toBe(false);
      expect(chatPurgeDue({ ...pre, disputeOpen: true }, at(1000))).toBe(false);
      expect(chatPurgeDue({ ...pre, tradeLinked: true, tradeClosedAt: null, disputeOpen: true, disputed: true }, at(1000))).toBe(false);
    });

    it('fails closed: disputed but with no close time (final, complying, or a row out of step) is kept', () => {
      expect(chatPurgeDue({ ...closed, disputeClosedAt: null }, at(1000))).toBe(false);
    });

    it('a corrupt dispute close time keeps the chat', () => {
      expect(chatPurgeDue({ ...closed, disputeClosedAt: new Date('x') }, at(1000))).toBe(false);
    });

    it('a chat on an open trade stays even if an earlier dispute closed long ago', () => {
      expect(chatPurgeDue({ ...closed, tradeClosedAt: null }, at(1000))).toBe(false);
    });
  });

  it('fails closed (keeps the chat) on any invalid date, in both branches', () => {
    const corrupt = new Date('x');
    expect(chatPurgeDue(pre, corrupt)).toBe(false);
    // Pre-trade: a corrupt createdAt or lastMessageAt, with the other date valid and long past.
    expect(chatPurgeDue({ ...pre, createdAt: corrupt }, at(1000))).toBe(false);
    expect(chatPurgeDue({ ...pre, createdAt: corrupt, lastMessageAt: at(1) }, at(1000))).toBe(false);
    expect(chatPurgeDue({ ...pre, lastMessageAt: corrupt }, at(1000))).toBe(false);
    expect(chatPurgeDue({ ...pre, tradeClosedAt: corrupt }, at(1000))).toBe(false);
    // Trade-linked: a corrupt tradeClosedAt, createdAt or lastMessageAt, the trade long closed.
    const closed = { ...pre, tradeLinked: true, tradeClosedAt: at(10) };
    expect(chatPurgeDue(closed, at(1000))).toBe(true);
    expect(chatPurgeDue({ ...closed, tradeClosedAt: corrupt }, at(1000))).toBe(false);
    expect(chatPurgeDue({ ...closed, createdAt: corrupt }, at(1000))).toBe(false);
    expect(chatPurgeDue({ ...closed, lastMessageAt: corrupt }, at(1000))).toBe(false);
    // A corrupt dispute time on a trade never disputed is still a corrupt row.
    expect(chatPurgeDue({ ...closed, disputeClosedAt: corrupt }, at(1000))).toBe(false);
  });
});
