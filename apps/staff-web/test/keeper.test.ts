// Design build task 10 (review lead-mod-chat N10): the chat key worker's keeper, through the same
// message protocol the page uses (a copying message pair). What crosses to the page: the device's
// public halves, the lines to show under a handle, and the sealed message to post. Never a chat
// key or a device secret.
import { openChat, ReplayGuard, signChatEnvelope, verifyModCountersign } from '@x2f/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { ChatKeyError } from '../src/chat/types.js';
import { SEAL_CLOCK_SKEW_MS } from '../src/keys/keeper.js';
import { memory, MOD_PUB, workerPair, world } from './chatWorld.js';

const NOW = Date.parse('2026-11-18T12:00:00.000Z');
beforeAll(async () => {
  await MOD_PUB();
});

async function setup() {
  const backend = memory();
  const w = await world({ backend });
  return { w, ...(await workerPair({ backend, now: () => NOW })) };
}

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');

describe('the chat key worker', () => {
  it('answers the device\'s public halves only, the same key the stored record holds', async () => {
    const { w, keys } = await setup();
    const d = await keys.device();
    expect(d).toEqual({ deviceKeyId: w.device.deviceKeyId, signPublic: w.device.signPublic, boxPublic: w.device.boxPublic });
  });

  it('opens a chat to the lines to show under a handle: no key, no wrap opened, no secret in anything it answers', async () => {
    const { w, keys, keeper } = await setup();
    const v = await keys.open(w.answer);
    expect(Object.keys(v).sort()).toEqual(['handle', 'lines', 'missing', 'nextSeq', 'olderNotShown', 'unreadable']);
    expect(v.handle).toMatch(/^[0-9a-f]{32}$/);
    expect(v.lines.map((l) => [l.from, l.text])).toEqual([['buyer', 'I paid.'], ['seller', 'Not received.']]);
    expect(keeper.size).toBe(1);
    const sealed = await keys.seal(v.handle, 'Please send the statement.', new Date(NOW), v.nextSeq);
    const id = await w.device.identity();
    const answers = JSON.stringify([await keys.device(), v, sealed]);
    for (const secret of [w.tk, id.signSecret.subarray(0, 32), id.boxSecret]) expect(answers).not.toContain(hex(secret));
    // The sealed message is the moderator's, countersigned by the device, and both traders read it once signed.
    const body = { v: 2 as const, trade: w.channel, from: 'mod' as const, seq: sealed.seq, nonce: sealed.nonce, ct: sealed.ct };
    await expect(verifyModCountersign({ chat: w.channel, seq: sealed.seq, nonce: sealed.nonce, ctSha256: sealed.ctSha256, requestId: sealed.requestId, issuedAt: sealed.issuedAt, sig: sealed.sig }, { body, signPublic: w.device.signPublic })).resolves.toBeDefined();
    const env = await signChatEnvelope(body, w.ids.mod);
    expect((await openChat(env, { tk: w.tk, trade: w.channel, participants: w.participants, guard: new ReplayGuard(w.channel) })).payload).toEqual({ text: 'Please send the statement.' });
  });

  it('refuses what does not check out with a code only: a chat that is not the pinned key\'s, an unknown handle, a bad text, a time far from its own clock', async () => {
    const { w, keys } = await setup();
    const forged = await world({ signer: new Uint8Array(64).fill(1) });
    await expect(keys.open({ ...w.answer, attestation: forged.answer.attestation })).rejects.toEqual(new ChatKeyError('security'));
    await expect(keys.open({ nonsense: true } as never)).rejects.toBeInstanceOf(ChatKeyError);
    const v = await keys.open(w.answer);
    await expect(keys.seal('0'.repeat(32), 'Hi', new Date(NOW), 0)).rejects.toEqual(new ChatKeyError('gone'));
    await expect(keys.seal(v.handle, '   ', new Date(NOW), 0)).rejects.toEqual(new ChatKeyError('unreadable'));
    await expect(keys.seal(v.handle, 'Hi', new Date(NOW + SEAL_CLOCK_SKEW_MS + 1), 0)).rejects.toEqual(new ChatKeyError('unreadable'));
    await expect(keys.seal(v.handle, 'Hi', new Date(NOW - SEAL_CLOCK_SKEW_MS - 1), 0)).rejects.toEqual(new ChatKeyError('unreadable'));
    await expect(keys.seal(v.handle, 'Hi', new Date(NOW), -1)).rejects.toEqual(new ChatKeyError('unreadable'));
    await expect(keys.seal(v.handle, 'Hi', new Date(NOW + SEAL_CLOCK_SKEW_MS), 0)).resolves.toBeDefined();
  });

  it('forget wipes the opened chat\'s key: the handle is gone', async () => {
    const { w, keys, keeper } = await setup();
    const v = await keys.open(w.answer);
    keys.forget(v.handle);
    await new Promise((r) => setTimeout(r, 20));
    expect(keeper.size).toBe(0);
    await expect(keys.seal(v.handle, 'Hi', new Date(NOW), 0)).rejects.toEqual(new ChatKeyError('gone'));
    await keys.open(w.answer);
    await keys.open(w.answer);
    keeper.forgetAll();
    expect(keeper.size).toBe(0);
  });
});
