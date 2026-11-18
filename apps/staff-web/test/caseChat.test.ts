// Design build task 9: the moderator's read and message in staff-web. The chat's attestation must be
// the pinned moderation key's, its key record the attested trader's with the re-wrapped tkh, and the
// wrap open only with this device's key; a message is sealed under the chat key and countersigned.
import {
  generateIdentity,
  makeChatKeyRecord,
  newChatKey,
  openChat,
  ReplayGuard,
  signChatEnvelope,
  verifyModCountersign,
  wrapChatKey,
} from '@x2f/protocol';
import sodium from 'libsodium-wrappers';
import { beforeAll, describe, expect, it } from 'vitest';
import { CaseChatError, forget, modTextOk, openCaseChat, sealModMessage, type CaseChatAnswer } from '../src/chat/reader.js';
import { modKey, MOD_PUB as modPub, world } from './chatWorld.js';

let MOD = '';
beforeAll(async () => {
  MOD = await modPub();
});
const MOD_PUB = () => MOD;

describe('openCaseChat', () => {
  it('opens the chat on this device: every line by its attested sender; a line under another key is counted, never shown', async () => {
    const w = await world();
    const o = await openCaseChat(w.answer, w.device, MOD_PUB());
    expect(o.lines.map((l) => [l.from, l.text])).toEqual([['buyer', 'I paid.'], ['seller', 'Not received.']]);
    expect(o.unreadable).toBe(1);
    expect(sodium.memcmp(o.tk, w.tk)).toBe(true);
    forget(o);
    expect(o.tk.every((x) => x === 0)).toBe(true);
  });

  it('is the security failure for an attestation not by the pinned key, a record of another tkh or signed by a stranger, a wrap for another device, or another chat', async () => {
    const w = await world();
    const other = await world();
    const stranger = await generateIdentity();
    const fakeTk = await newChatKey();
    const fakeRecord = await makeChatKeyRecord({ chat: w.channel, by: 'buyer', tk: fakeTk, me: stranger, participants: { ...w.participants, buyer: { signPublic: stranger.signPublic, boxPublic: stranger.boxPublic } } });
    await modKey();
    const notMod = sodium.crypto_sign_keypair();
    const cases: Array<[string, CaseChatAnswer]> = [
      ['attestation by another key', (await world({ signer: notMod.privateKey })).answer],
      ['a key the API made up', { ...w.answer, wrap: await wrapChatKey(w.device.boxPublic, fakeTk), tkh: fakeRecord.tkh, record: fakeRecord }],
      ['tkh not the record\'s', { ...w.answer, tkh: other.record.tkh }],
      ['a wrap for another device', { ...w.answer, wrap: other.answer.wrap }],
      ['another chat\'s attestation', { ...w.answer, attestation: other.answer.attestation }],
      ['no attestation', { ...w.answer, attestation: null }],
    ];
    for (const [why, a] of cases) await expect(openCaseChat(a, w.device, MOD_PUB()), why).rejects.toEqual(new CaseChatError('security'));
  });
});

describe('sealModMessage', () => {
  it('seals under the chat key as the moderator at the next seq and countersigns with the device key; both traders read it once moderation signs it', async () => {
    const w = await world();
    const o = await openCaseChat(w.answer, w.device, MOD_PUB());
    const now = new Date('2026-11-18T12:00:00.000Z');
    const m = await sealModMessage(o, 'Please send your bank statement.', w.device, now);
    expect({ seq: m.seq, issuedAt: m.issuedAt, deviceKeyId: m.deviceKeyId }).toEqual({ seq: 0, issuedAt: now.toISOString(), deviceKeyId: w.device.deviceKeyId });
    const body = { v: 2 as const, trade: w.channel, from: 'mod' as const, seq: m.seq, nonce: m.nonce, ct: m.ct };
    await expect(verifyModCountersign({ chat: w.channel, seq: m.seq, ctSha256: m.ctSha256, requestId: m.requestId, issuedAt: m.issuedAt, sig: m.sig }, { body, signPublic: w.device.signPublic })).resolves.toBeDefined();
    const env = await signChatEnvelope(body, w.ids.mod);
    expect(await openChat(env, { tk: w.tk, trade: w.channel, participants: w.participants, guard: new ReplayGuard(w.channel) })).toEqual({ from: 'mod', type: 'chat.msg', payload: { text: 'Please send your bank statement.' } });
    // A different request id each time.
    expect((await sealModMessage(o, 'Again.', w.device, now)).requestId).not.toBe(m.requestId);
  });

  it('refuses a blank, too long or control-character text, and a key already wiped', async () => {
    const w = await world();
    const o = await openCaseChat(w.answer, w.device, MOD_PUB());
    for (const t of ['', '   ', 'x'.repeat(2001), 'bell\u0007']) {
      expect(modTextOk(t), t).toBe(false);
      await expect(sealModMessage(o, t, w.device, new Date())).rejects.toBeInstanceOf(CaseChatError);
    }
    forget(o);
    await expect(sealModMessage(o, 'Hi', w.device, new Date())).rejects.toEqual(new CaseChatError('security'));
  });
});
