// Design build task 3 (design-chat-membership-keys-2026-11-08 sections 2, 3 and 9): one key per chat,
// envelope v2, member wraps and the signed key record, grant and notice. Pure protocol.
import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  chatKeyHash,
  generateBoxKeyPair,
  generateIdentity,
  makeChatGrant,
  makeChatKeyRecord,
  makeDisputeNotice,
  newChatKey,
  open,
  openChat,
  openChatKeyRecord,
  ProtocolError,
  ReplayGuard,
  seal,
  sealChat,
  unwrapChatKey,
  verifyChatGrant,
  verifyChatKeyRecord,
  verifyDisputeNotice,
  wrapChatKey,
  type ChatEnvelopeV2,
  type Identity,
  type Participants,
} from '../src/index.js';

const CHAT = 'chat-channel-1';
let ids: Record<'buyer' | 'seller' | 'mod', Identity>;
let participants: Participants;
let tk: Uint8Array;

beforeAll(async () => {
  await sodium.ready;
  ids = { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
  participants = Object.fromEntries((['buyer', 'seller', 'mod'] as const).map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
  tk = await newChatKey();
});

const code = async (p: Promise<unknown>): Promise<string> => {
  try {
    await p;
    return 'ok';
  } catch (e) {
    return e instanceof ProtocolError ? e.code : `throw:${(e as Error).name}`;
  }
};

const send = (from: 'buyer' | 'seller' | 'mod', seq: number, text: string, k = tk) =>
  sealChat({ trade: CHAT, from, seq, type: 'chat.msg', payload: { text }, tk: k, me: ids[from] });
const read = (e: unknown, o: { guard?: ReplayGuard; k?: Uint8Array; trade?: string } = {}) =>
  openChat(e, { tk: o.k ?? tk, trade: o.trade ?? CHAT, participants, guard: o.guard ?? new ReplayGuard(o.trade ?? CHAT) });

describe('the chat key and its fingerprint', () => {
  it('is 32 fresh random bytes; tkh is generichash(32, "x2f/chat-key/v1\\0" || TK) in lower-case hex', async () => {
    const a = await newChatKey();
    const b = await newChatKey();
    expect(a).toHaveLength(32);
    expect(sodium.memcmp(a, b)).toBe(false);
    const want = sodium.to_hex(sodium.crypto_generichash(32, new Uint8Array([...new TextEncoder().encode('x2f/chat-key/v1\0'), ...a]), null));
    expect(await chatKeyHash(a)).toBe(want);
    expect(await chatKeyHash(a)).toMatch(/^[0-9a-f]{64}$/);
    await expect(chatKeyHash(new Uint8Array(31))).rejects.toThrow(TypeError);
  });

  it('a wrap opens only for its member, and only to a key matching the pinned tkh', async () => {
    const dev = await generateBoxKeyPair();
    const other = await generateBoxKeyPair();
    const tkh = await chatKeyHash(tk);
    const wrap = await wrapChatKey(dev.boxPublic, tk);
    expect(sodium.memcmp(await unwrapChatKey(dev, wrap, tkh), tk)).toBe(true);
    expect(await code(unwrapChatKey(other, wrap, tkh))).toBe('not-for-me');
    // A copy of some other key (a cheater's garbage grant) fails the tkh check.
    const wrong = await wrapChatKey(dev.boxPublic, await newChatKey());
    expect(await code(unwrapChatKey(dev, wrong, tkh))).toBe('bad-signature');
    for (const w of ['', 'AAAA', `${wrap}=`, wrap.slice(0, -4), 5]) expect(await code(unwrapChatKey(dev, w, tkh)), String(w)).toBe('bad-signature');
  });
});

describe('envelope v2', () => {
  it('one ciphertext every member opens with TK, the sender included; the verified sender is returned', async () => {
    const e = await send('buyer', 0, 'hello');
    expect(Object.keys(e).sort()).toEqual(['ct', 'from', 'nonce', 'seq', 'sig', 'trade', 'v']);
    expect(e.v).toBe(2);
    expect(await read(e)).toEqual({ type: 'chat.msg', payload: { text: 'hello' }, from: 'buyer' });
    const m = await send('mod', 0, 'moderator here');
    expect((await read(m)).from).toBe('mod');
  });

  it('a late member opens every message back to the first with the same key (design section 2.4, R16 fixed)', async () => {
    const all = [await send('buyer', 0, 'a'), await send('seller', 0, 'b'), await send('buyer', 1, 'c')];
    const guard = new ReplayGuard(CHAT);
    const got = [];
    for (const e of all) got.push((await read(e, { guard })).payload);
    expect(got).toEqual([{ text: 'a' }, { text: 'b' }, { text: 'c' }]);
  });

  it('pads to the v1 buckets', async () => {
    const lens = [];
    for (const n of [1, 300, 2000]) lens.push(sodium.from_base64((await send('buyer', n, 'x'.repeat(n))).ct, sodium.base64_variants.ORIGINAL).length);
    expect(lens).toEqual([256 + 16, 1024 + 16, 4096 + 16]);
  });

  it('refuses another key, another chat, a non-participant, a bad signature and a replay', async () => {
    const e = await send('seller', 3, 'hi');
    expect(await code(read(e, { k: await newChatKey() }))).toBe('bad-signature');
    expect(await code(read(e, { trade: 'another-chat' }))).toBe('wrong-trade');
    const stranger = await generateIdentity();
    const forged = await sealChat({ trade: CHAT, from: 'seller', seq: 4, type: 'chat.msg', payload: { text: 'x' }, tk, me: stranger });
    expect(await code(read(forged))).toBe('bad-signature');
    expect(await code(openChat(e, { tk, trade: CHAT, participants: { buyer: participants.buyer }, guard: new ReplayGuard(CHAT) }))).toBe('not-participant');
    const guard = new ReplayGuard(CHAT);
    expect(await code(read(e, { guard }))).toBe('ok');
    expect(await code(read(e, { guard }))).toBe('replay');
  });

  it('binds trade, from and seq into the AEAD as well as the signature: a re-signed envelope with any of them changed does not decrypt', async () => {
    const e = await send('buyer', 5, 'bound');
    // Re-sign as the same sender with one header field changed: the signature is fine, the AD is not.
    const resign = (u: Omit<ChatEnvelopeV2, 'sig'>, me: Identity): ChatEnvelopeV2 => {
      const msg = new TextEncoder().encode(`x2f/chat-envelope/v2\0${JSON.stringify({ ct: u.ct, from: u.from, nonce: u.nonce, seq: u.seq, trade: u.trade, v: u.v })}`);
      return { ...u, sig: sodium.to_hex(sodium.crypto_sign_detached(msg, me.signSecret)) };
    };
    const { sig: _s, ...u } = e;
    expect(await code(read(resign(u, ids.buyer)))).toBe('ok');
    expect(await code(read(resign({ ...u, seq: 6 }, ids.buyer)))).toBe('bad-signature');
    expect(await code(read(resign({ ...u, from: 'seller' }, ids.seller)))).toBe('bad-signature');
    const other = await sealChat({ trade: 'chat-x', from: 'buyer', seq: 5, type: 'chat.msg', payload: { text: 'bound' }, tk, me: ids.buyer });
    expect(await code(read(resign({ ...other, trade: CHAT }, ids.buyer)))).toBe('bad-signature');
  });

  it('decodes strictly: extra or missing keys, v1, wrong types, accessors and non-canonical base64 are refused', async () => {
    const e = await send('buyer', 7, 'strict');
    const bads: unknown[] = [
      { ...e, extra: 1 },
      (({ sig: _x, ...r }) => r)(e),
      { ...e, v: 1 },
      { ...e, seq: -1 },
      { ...e, seq: '7' },
      { ...e, nonce: `${e.nonce}=` },
      { ...e, ct: e.ct.slice(0, -4) },
      { ...e, sig: e.sig.toUpperCase() },
      Object.defineProperty({ ...e }, 'ct', { get: () => e.ct, enumerable: true }),
      null,
      [],
    ];
    for (const b of bads) expect(await code(read(b)), JSON.stringify(b)?.slice(0, 40)).toBe('bad-signature');
  });

  it('is not a v1 envelope, and v1 is untouched (the signals channel keeps it)', async () => {
    const e = await send('buyer', 8, 'v2');
    await expect(open(e, { me: ids.seller, myRole: 'seller', participants, trade: CHAT, guard: new ReplayGuard(CHAT) })).rejects.toBeInstanceOf(ProtocolError);
    const v1 = await seal({ trade: CHAT, from: 'buyer', seq: 0, type: 't', payload: 1, to: ['seller'], me: ids.buyer, participants });
    expect(await code(read(v1))).toBe('bad-signature');
    expect((await open(v1, { me: ids.seller, myRole: 'seller', participants, trade: CHAT, guard: new ReplayGuard(CHAT) })).payload).toBe(1);
  });

  it('refuses bad arguments with TypeError', async () => {
    await expect(sealChat({ trade: CHAT, from: 'buyer', seq: 0, type: 't', payload: 1, tk: new Uint8Array(16), me: ids.buyer })).rejects.toThrow(TypeError);
    await expect(sealChat({ trade: CHAT, from: 'buyer', seq: 0, type: 't', payload: 1, tk, me: { ...ids.buyer, signSecret: ids.seller.signSecret } })).rejects.toThrow(TypeError);
    await expect(sealChat({ trade: CHAT, from: 'nobody' as 'buyer', seq: 0, type: 't', payload: 1, tk, me: ids.buyer })).rejects.toThrow(TypeError);
  });
});

describe('the signed key record', () => {
  it('locks TK to the buyer and the seller; each opens its own copy; anyone verifies the creator', async () => {
    const rec = await makeChatKeyRecord({ chat: CHAT, by: 'seller', tk, me: ids.seller, participants });
    const v = await verifyChatKeyRecord(rec, { chat: CHAT, participants });
    expect(v).toEqual(rec);
    expect(v.tkh).toBe(await chatKeyHash(tk));
    expect(sodium.memcmp(await openChatKeyRecord(v, 'buyer', ids.buyer), tk)).toBe(true);
    expect(sodium.memcmp(await openChatKeyRecord(v, 'seller', ids.seller), tk)).toBe(true);
    // The moderator has no copy: "only after a dispute" is a lock (design section 3).
    expect(await code(openChatKeyRecord(v, 'buyer', ids.mod))).toBe('not-for-me');
  });

  it('refuses a record for another chat, signed by someone else, claiming the other creator, or changed', async () => {
    const rec = await makeChatKeyRecord({ chat: CHAT, by: 'buyer', tk, me: ids.buyer, participants });
    expect(await code(verifyChatKeyRecord(rec, { chat: 'other', participants }))).toBe('bad-signature');
    expect(await code(verifyChatKeyRecord({ ...rec, by: 'seller' }, { chat: CHAT, participants }))).toBe('bad-signature');
    expect(await code(verifyChatKeyRecord({ ...rec, tkh: '0'.repeat(64) }, { chat: CHAT, participants }))).toBe('bad-signature');
    expect(await code(verifyChatKeyRecord({ ...rec, wrapBuyer: rec.wrapSeller }, { chat: CHAT, participants }))).toBe('bad-signature');
    expect(await code(verifyChatKeyRecord({ ...rec, by: 'mod' }, { chat: CHAT, participants }))).toBe('bad-signature');
    expect(await code(verifyChatKeyRecord({ ...rec, x: 1 }, { chat: CHAT, participants }))).toBe('bad-signature');
    await expect(makeChatKeyRecord({ chat: CHAT, by: 'buyer', tk, me: ids.seller, participants })).rejects.toThrow(TypeError);
  });

  it('a creator who hands out a TK that does not match tkh is caught at once by the other side', async () => {
    const rec = await makeChatKeyRecord({ chat: CHAT, by: 'buyer', tk, me: ids.buyer, participants });
    const lying = { ...rec, wrapSeller: await wrapChatKey(participants.seller.boxPublic, await newChatKey()) };
    const body = { v: 1, chat: lying.chat, tkh: lying.tkh, by: lying.by, wrapBuyer: lying.wrapBuyer, wrapSeller: lying.wrapSeller };
    const canon = JSON.stringify(Object.fromEntries(Object.entries(body).sort(([a], [b]) => (a < b ? -1 : 1))));
    lying.sig = sodium.to_hex(sodium.crypto_sign_detached(new TextEncoder().encode(`x2f/chat-key-record/v1\0${canon}`), ids.buyer.signSecret));
    const v = await verifyChatKeyRecord(lying, { chat: CHAT, participants });
    expect(await code(openChatKeyRecord(v, 'seller', ids.seller))).toBe('bad-signature');
  });
});

describe('the dispute grant (T1) and the dispute notice (T2)', () => {
  it('a trader\'s grant verifies against that trader only, and its wrap opens for the moderator with the pinned tkh', async () => {
    const g = await makeChatGrant({ chat: CHAT, by: 'buyer', tk, disputeAt: '2026-11-18T12:00:00.000Z', me: ids.buyer, participants });
    const v = await verifyChatGrant(g, { chat: CHAT, participants });
    expect(sodium.memcmp(await unwrapChatKey(ids.mod, v.wrap, v.tkh), tk)).toBe(true);
    expect(await code(verifyChatGrant({ ...g, by: 'seller' }, { chat: CHAT, participants }))).toBe('bad-signature');
    expect(await code(verifyChatGrant({ ...g, disputeAt: '2026-11-18T12:00:01.000Z' }, { chat: CHAT, participants }))).toBe('bad-signature');
    expect(await code(verifyChatGrant(g, { chat: 'other', participants }))).toBe('bad-signature');
    expect(await code(verifyChatGrant({ ...g, disputeAt: 'yesterday' }, { chat: CHAT, participants }))).toBe('bad-signature');
    // Neither the moderator nor anyone else can sign a trader's grant.
    await expect(makeChatGrant({ chat: CHAT, by: 'buyer', tk, disputeAt: '2026-11-18T12:00:00.000Z', me: ids.mod, participants })).rejects.toThrow(TypeError);
  });

  it('a notice verifies against the moderator identity only', async () => {
    const n = await makeDisputeNotice({ chat: CHAT, disputeSeq: 1, openedAt: '2026-11-18T12:00:00.000Z', openedBy: 'system', mod: ids.mod });
    expect(await verifyDisputeNotice(n, { chat: CHAT, participants })).toEqual(n);
    const byBuyer = await makeDisputeNotice({ chat: CHAT, disputeSeq: 1, openedAt: '2026-11-18T12:00:00.000Z', openedBy: 'system', mod: ids.buyer });
    expect(await code(verifyDisputeNotice(byBuyer, { chat: CHAT, participants }))).toBe('bad-signature');
    expect(await code(verifyDisputeNotice({ ...n, disputeSeq: 2 }, { chat: CHAT, participants }))).toBe('bad-signature');
    expect(await code(verifyDisputeNotice({ ...n, openedBy: 'mod' }, { chat: CHAT, participants }))).toBe('bad-signature');
    await expect(makeDisputeNotice({ chat: CHAT, disputeSeq: 0, openedAt: '2026-11-18T12:00:00.000Z', openedBy: 'system', mod: ids.mod })).rejects.toThrow(TypeError);
  });

  it('the domains keep statements apart: a grant is not a key record, nor a notice', async () => {
    const g = await makeChatGrant({ chat: CHAT, by: 'buyer', tk, disputeAt: '2026-11-18T12:00:00.000Z', me: ids.buyer, participants });
    expect(await code(verifyChatKeyRecord(g, { chat: CHAT, participants }))).toBe('bad-signature');
    expect(await code(verifyDisputeNotice(g, { chat: CHAT, participants }))).toBe('bad-signature');
  });
});
