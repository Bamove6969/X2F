// Private lanes (owner 27 Nov): the moderator talks to one trader; the other cannot read it; staff can.
import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  encryptPrivate,
  generateBoxKeyPair,
  generateIdentity,
  makeModPrivateCountersign,
  makePrivateLaneRecord,
  newChatKey,
  newPrivateKey,
  openChat,
  openPrivate,
  openPrivateLaneRecord,
  privateKeyHash,
  ProtocolError,
  ReplayGuard,
  sealChat,
  sealPrivate,
  signPrivateEnvelope,
  unwrapPrivateKey,
  verifyModPrivateCountersign,
  verifyPrivateLaneRecord,
  wrapPrivateKey,
  type Identity,
  type Participants,
} from '../src/index.js';

const CHAT = 'chat-channel-1';
let ids: Record<'buyer' | 'seller' | 'mod', Identity>;
let participants: Participants;
let pkB: Uint8Array;
let pkS: Uint8Array;
let tk: Uint8Array;

beforeAll(async () => {
  await sodium.ready;
  ids = { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
  participants = Object.fromEntries((['buyer', 'seller', 'mod'] as const).map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
  pkB = await newPrivateKey();
  pkS = await newPrivateKey();
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
const g = () => new ReplayGuard(CHAT);

describe('private lanes', () => {
  it('the lane record opens only for its trader, verifies only as the moderator', async () => {
    const rec = await makePrivateLaneRecord({ chat: CHAT, to: 'buyer', pk: pkB, mod: ids.mod, participants });
    const v = await verifyPrivateLaneRecord(rec, { chat: CHAT, participants });
    expect(v.pkh).toBe(await privateKeyHash(pkB));
    expect(sodium.memcmp(await openPrivateLaneRecord(v, ids.buyer), pkB)).toBe(true);
    expect(await code(openPrivateLaneRecord(v, ids.seller))).toBe('not-for-me');
    expect(await code(verifyPrivateLaneRecord({ ...rec, to: 'seller' }, { chat: CHAT, participants }))).toBe('bad-signature');
    expect(await code(verifyPrivateLaneRecord(rec, { chat: 'other', participants }))).toBe('bad-signature');
    expect(await code(makePrivateLaneRecord({ chat: CHAT, to: 'buyer', pk: pkB, mod: ids.buyer, participants }))).toBe('throw:TypeError');
  });

  it('a staff wrap opens to PK and is pinned to pkh', async () => {
    const dev = await generateBoxKeyPair();
    const w = await wrapPrivateKey(dev.boxPublic, pkS);
    expect(sodium.memcmp(await unwrapPrivateKey(dev, w, await privateKeyHash(pkS)), pkS)).toBe(true);
    expect(await code(unwrapPrivateKey(dev, w, await privateKeyHash(pkB)))).toBe('bad-signature');
  });

  it('moderator and lane trader talk; the other lane, TK and the other trader cannot open it', async () => {
    const m = await sealPrivate({ trade: CHAT, from: 'mod', to: 'buyer', seq: 0, type: 'chat.msg', payload: { text: 'hi' }, pk: pkB, me: ids.mod });
    const r = await sealPrivate({ trade: CHAT, from: 'buyer', to: 'buyer', seq: 0, type: 'chat.msg', payload: { text: 'yo' }, pk: pkB, me: ids.buyer });
    const guard = g();
    expect((await openPrivate(m, { pk: pkB, trade: CHAT, to: 'buyer', participants, guard })).payload).toEqual({ text: 'hi' });
    expect((await openPrivate(r, { pk: pkB, trade: CHAT, to: 'buyer', participants, guard })).from).toBe('buyer');
    expect(await code(openPrivate(m, { pk: pkS, trade: CHAT, to: 'buyer', participants, guard: g() }))).toBe('bad-signature');
    expect(await code(openPrivate(m, { pk: pkB, trade: CHAT, to: 'seller', participants, guard: g() }))).toBe('not-participant');
    expect(await code(openPrivate({ ...m, to: 'seller' }, { pk: pkB, trade: CHAT, to: 'seller', participants, guard: g() }))).toBe('bad-signature');
    expect(await code(openChat({ ...m, v: 2 }, { tk, trade: CHAT, participants, guard: g() }))).toBe('bad-signature');
    expect(await code(sealPrivate({ trade: CHAT, from: 'seller', to: 'buyer', seq: 0, type: 'chat.msg', payload: {}, pk: pkB, me: ids.seller }))).toBe('throw:TypeError');
    // A forged seller-in-buyer-lane envelope is refused before any key is tried.
    const forged = await signPrivateEnvelope({ ...(await encryptPrivate({ trade: CHAT, from: 'buyer', to: 'buyer', seq: 1, type: 'x', payload: {}, pk: pkB })), from: 'seller' }, ids.seller).catch((e) => e);
    expect(forged).toBeInstanceOf(ProtocolError);
    // A TK message never opens as a lane message.
    const shared = await sealChat({ trade: CHAT, from: 'mod', seq: 0, type: 'chat.msg', payload: {}, tk, me: ids.mod });
    expect(await code(openPrivate({ ...shared, v: 3, to: 'buyer' }, { pk: pkB, trade: CHAT, to: 'buyer', participants, guard: g() }))).toBe('bad-signature');
  });

  it('replay is per lane guard', async () => {
    const m = await sealPrivate({ trade: CHAT, from: 'mod', to: 'seller', seq: 4, type: 'chat.msg', payload: {}, pk: pkS, me: ids.mod });
    const guard = g();
    await openPrivate(m, { pk: pkS, trade: CHAT, to: 'seller', participants, guard });
    expect(await code(openPrivate(m, { pk: pkS, trade: CHAT, to: 'seller', participants, guard }))).toBe('replay');
  });

  it('the lane countersign binds the lane', async () => {
    const dev = await generateIdentity();
    const body = await encryptPrivate({ trade: CHAT, from: 'mod', to: 'buyer', seq: 2, type: 'chat.msg', payload: { text: 'x' }, pk: pkB });
    const c = await makeModPrivateCountersign({ body, requestId: 'a'.repeat(32), issuedAt: new Date().toISOString(), me: dev });
    expect((await verifyModPrivateCountersign(c, { body, signPublic: dev.signPublic })).to).toBe('buyer');
    expect(await code(verifyModPrivateCountersign({ ...c, to: 'seller' }, { body: { ...body, to: 'seller' }, signPublic: dev.signPublic }))).toBe('bad-signature');
    expect(await code(verifyModPrivateCountersign(c, { body: { ...body, to: 'seller' }, signPublic: dev.signPublic }))).toBe('bad-signature');
  });
});
