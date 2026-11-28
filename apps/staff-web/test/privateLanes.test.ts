// Private moderator lanes (owner 27 Nov, docs/security/private-mod-chat-2026-11-27.md) in the staff
// reader and the chat key worker: every lane key is opened with this device's key and pinned by its
// pkh; v3 envelopes open under their lane's key with that lane's own replay guard and gap count; a
// private message is sealed as v3 under the lane key with the lane countersign.
import { generateIdentity, makePrivateLaneRecord, newPrivateKey, openPrivate, privateKeyHash, ReplayGuard, sealChat, signPrivateEnvelope, verifyModCountersign, verifyModPrivateCountersign, wrapPrivateKey } from '@x2f/protocol';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { messageTraders } from '../src/api.js';
import { ChatKeyError } from '../src/chat/types.js';
import { CaseChatError, forget, openCaseChat, sealModeMessage, sealModMessage } from '../src/keys/reader.js';
import { memory, MOD_PUB, workerPair, world } from './chatWorld.js';

let MOD = '';
const NOW = Date.parse('2026-11-27T12:00:00.000Z');
beforeAll(async () => {
  MOD = await MOD_PUB();
});

describe('openCaseChat: private lanes', () => {
  it('opens each lane under its own key and merges the lines in envelope order, each private line naming its lane', async () => {
    const w = await world();
    w.answer.envelopes = [
      { id: '1', senderRole: 'buyer', envelope: await w.seal('buyer', 0, 'I paid.'), at: 'a', to: null },
      { id: '2', senderRole: 'mod', envelope: await w.sealLane('mod', 'seller', 0, 'Seller, check your bank.'), at: 'b', to: 'seller' },
      { id: '3', senderRole: 'seller', envelope: await w.sealLane('seller', 'seller', 0, 'Nothing came in.'), at: 'c', to: 'seller' },
      { id: '4', senderRole: 'mod', envelope: await w.sealLane('mod', 'buyer', 0, 'Buyer, send the receipt.'), at: 'd', to: 'buyer' },
      // Seq 0 again in the shared chat for the moderator: the lanes' seqs are their own.
      { id: '5', senderRole: 'mod', envelope: await w.seal('mod', 0, 'Thanks both.'), at: 'e' },
    ];
    w.answer.lanes = w.answer.lanes!.map((l) => ({ ...l, nextSeq: 1 }));
    const o = await openCaseChat(w.answer, w.device, MOD);
    expect(o.lines.map((l) => [l.id, l.from, l.to ?? null, l.text, l.missingBefore])).toEqual([
      ['1', 'buyer', null, 'I paid.', 0],
      ['2', 'mod', 'seller', 'Seller, check your bank.', 0],
      ['3', 'seller', 'seller', 'Nothing came in.', 0],
      ['4', 'mod', 'buyer', 'Buyer, send the receipt.', 0],
      ['5', 'mod', null, 'Thanks both.', 0],
    ]);
    expect(o.unreadable).toBe(0);
    expect(o.missing).toBe(0);
    expect(o.lanes.buyer?.nextSeq).toBe(1);
    forget(o);
    expect(o.lanes.buyer!.pk.every((x) => x === 0) && o.lanes.seller!.pk.every((x) => x === 0)).toBe(true);
  });

  it('refuses a lane wrap whose key is not its pkh (a key the API made up, or the other lane\'s) as the security failure', async () => {
    const w = await world();
    const [b, s] = w.answer.lanes!;
    const madeUp = await wrapPrivateKey(w.device.boxPublic, await newPrivateKey());
    for (const lanes of [[{ ...b!, wrap: madeUp }, s!], [{ ...b!, wrap: s!.wrap }, s!], [b!, b!], [{ ...b!, to: 'mod' }]]) {
      await expect(openCaseChat({ ...w.answer, lanes: lanes as never }, w.device, MOD)).rejects.toEqual(new CaseChatError('security'));
    }
    // No lanes (an older API) is just no lanes.
    const { lanes: _, ...old } = w.answer;
    expect((await openCaseChat(old, w.device, MOD)).lanes).toEqual({});
  });

  it('A2: refuses a lane whose key the API made up with a pkh of its own: the signed lane record must come from the attested moderator and name that lane and pkh', async () => {
    const w = await world();
    const [b, s] = w.answer.lanes!;
    // The API's own key, wrapped to this device, with its own (matching) pkh: the hash check alone passes.
    const fake = await newPrivateKey();
    const fakeLane = { to: 'buyer' as const, pkh: await privateKeyHash(fake), wrap: await wrapPrivateKey(w.device.boxPublic, fake), nextSeq: 0 };
    const stranger = await generateIdentity();
    const strangerParts = { ...w.participants, mod: { signPublic: stranger.signPublic, boxPublic: stranger.boxPublic } };
    const cases = [
      // No record, or the real record (whose pkh is not the fake one).
      { ...fakeLane, record: undefined },
      { ...fakeLane, record: b!.record },
      // A record for the fake key signed by someone other than the attested moderator.
      { ...fakeLane, record: await makePrivateLaneRecord({ chat: w.channel, to: 'buyer', pk: fake, mod: stranger, participants: strangerParts }) },
      // A real moderator record, but for the other lane, or another chat's channel.
      { ...fakeLane, record: await makePrivateLaneRecord({ chat: w.channel, to: 'seller', pk: fake, mod: w.ids.mod, participants: w.participants }) },
      { ...fakeLane, record: await makePrivateLaneRecord({ chat: (await world()).channel, to: 'buyer', pk: fake, mod: w.ids.mod, participants: w.participants }) },
      // The real lane with the other lane's record.
      { ...b!, record: s!.record },
    ];
    for (const l of cases) {
      await expect(openCaseChat({ ...w.answer, lanes: [l, s!] as never }, w.device, MOD)).rejects.toEqual(new CaseChatError('security'));
    }
    // The real lanes, each with its own signed record, open.
    expect(Object.keys((await openCaseChat(w.answer, w.device, MOD)).lanes).sort()).toEqual(['buyer', 'seller']);
  });

  it('a lane envelope filed in the wrong lane, under another lane\'s key, as shared, or with no lane key here, is counted, never shown; gaps count per lane', async () => {
    const w = await world();
    const { lanes: _, ...noLanes } = w.answer;
    w.answer.envelopes = [
      { id: '1', senderRole: 'mod', envelope: await w.sealLane('mod', 'seller', 0, 'to seller'), at: 'a', to: 'buyer' },
      { id: '2', senderRole: 'mod', envelope: await w.sealLane('mod', 'buyer', 0, 'wrong key', w.pk.seller), at: 'b', to: 'buyer' },
      { id: '3', senderRole: 'mod', envelope: await w.sealLane('mod', 'buyer', 1, 'as shared'), at: 'c', to: null },
      // The buyer lane's moderator seq 2 follows 0 and 1, neither of which verified there: 2 missing.
      { id: '4', senderRole: 'mod', envelope: await w.sealLane('mod', 'buyer', 2, 'shown'), at: 'd', to: 'buyer' },
    ];
    const o = await openCaseChat(w.answer, w.device, MOD);
    expect(o.lines.map((l) => [l.text, l.missingBefore])).toEqual([['shown', 2]]);
    expect(o.unreadable).toBe(3);
    const without = await openCaseChat({ ...noLanes, envelopes: w.answer.envelopes }, w.device, MOD);
    expect(without.lines).toEqual([]);
    expect(without.unreadable).toBe(4);
  });
});

describe('sealModMessage and the worker: a private message', () => {
  it('seals v3 under the lane key with the lane countersign verifyModPrivateCountersign accepts; only that lane opens it', async () => {
    const w = await world();
    const o = await openCaseChat(w.answer, w.device, MOD);
    const now = new Date(NOW);
    const m = await sealModMessage(o, 'Only you see this.', w.device, now, 0, 'seller');
    expect(m.to).toBe('seller');
    const body = { v: 3 as const, trade: w.channel, from: 'mod' as const, to: 'seller' as const, seq: 0, nonce: m.nonce, ct: m.ct };
    const cs = { chat: w.channel, to: 'seller', seq: 0, nonce: m.nonce, ctSha256: m.ctSha256, requestId: m.requestId, issuedAt: m.issuedAt, sig: m.sig };
    await expect(verifyModPrivateCountersign(cs, { body, signPublic: w.device.signPublic })).resolves.toBeDefined();
    // Not movable to the other lane, and not a shared countersign.
    await expect(verifyModPrivateCountersign({ ...cs, to: 'buyer' }, { body: { ...body, to: 'buyer' }, signPublic: w.device.signPublic })).rejects.toThrow();
    await expect(verifyModCountersign({ chat: w.channel, seq: 0, nonce: m.nonce, ctSha256: m.ctSha256, requestId: m.requestId, issuedAt: m.issuedAt, sig: m.sig }, { body: { v: 2, trade: w.channel, from: 'mod', seq: 0, nonce: m.nonce, ct: m.ct }, signPublic: w.device.signPublic })).rejects.toThrow();
    const env = await signPrivateEnvelope(body, w.ids.mod);
    const opened = await openPrivate(env, { pk: w.pk.seller, trade: w.channel, to: 'seller', participants: w.participants, guard: new ReplayGuard(w.channel) });
    expect(opened.payload).toEqual({ text: 'Only you see this.' });
    await expect(openPrivate({ ...env, to: 'buyer' }, { pk: w.pk.buyer, trade: w.channel, to: 'buyer', participants: w.participants, guard: new ReplayGuard(w.channel) })).rejects.toThrow();
    // A lane the chat does not have, or a wiped lane key, is never sealed under.
    const { lanes: _, ...noLanes } = w.answer;
    const bare = await openCaseChat(noLanes, w.device, MOD);
    await expect(sealModMessage(bare, 'Hi', w.device, now, 0, 'buyer')).rejects.toEqual(new CaseChatError('security'));
    forget(o);
    await expect(sealModMessage(o, 'Hi', w.device, now, 0, 'seller')).rejects.toEqual(new CaseChatError('security'));
  });

  it('through the worker: nextSeqByLane in the view, `to` crosses and comes back, the lane seq advances alone, a bad lane is refused', async () => {
    const backend = memory();
    const w = await world({ backend });
    w.answer.lanes = w.answer.lanes!.map((l) => (l.to === 'buyer' ? { ...l, nextSeq: 4 } : l));
    const { keys, keeper } = await workerPair({ backend, now: () => NOW });
    const v = await keys.open(w.answer);
    expect(v.nextSeqByLane).toEqual({ buyer: 4, seller: 0 });
    const p = await keys.seal(v.handle, 'Private.', new Date(NOW), 4, 'buyer');
    expect({ to: p.to, seq: p.seq }).toEqual({ to: 'buyer', seq: 4 });
    const shared = await keys.seal(v.handle, 'Both.', new Date(NOW), 0);
    expect('to' in shared).toBe(false);
    await expect(keys.seal(v.handle, 'Hi', new Date(NOW), 0, 'mod' as never)).rejects.toEqual(new ChatKeyError('unreadable'));
    expect(JSON.stringify([v, p])).not.toContain(Buffer.from(w.pk.buyer).toString('hex'));
    keeper.forgetAll();
    expect(keeper.size).toBe(0);
  });
});

describe('the lane mode (owner 27 Nov follow-up): `chat.mode` in a lane', () => {
  it('opens a moderator `chat.mode` in a lane as a line of kind mode; anywhere else, or not exactly {on}, is counted, never shown', async () => {
    const w = await world();
    w.answer.envelopes = [
      { id: '1', senderRole: 'mod', envelope: await w.sealMode('seller', 0, true), at: 'a', to: 'seller' },
      { id: '2', senderRole: 'mod', envelope: await w.sealLane('mod', 'seller', 1, 'Only you.'), at: 'b', to: 'seller' },
      { id: '3', senderRole: 'mod', envelope: await w.sealMode('seller', 2, false), at: 'c', to: 'seller' },
      // A trader cannot switch the mode, nor is a payload other than exactly {on: boolean} a mode.
      { id: '4', senderRole: 'seller', envelope: await w.sealMode('seller', 0, true, { from: 'seller' }), at: 'd', to: 'seller' },
      { id: '5', senderRole: 'mod', envelope: await w.sealMode('buyer', 0, true, { payload: { on: 'yes' } }), at: 'e', to: 'buyer' },
      { id: '6', senderRole: 'mod', envelope: await w.sealMode('buyer', 1, true, { payload: { on: true, text: 'x' } }), at: 'f', to: 'buyer' },
      // In the shared chat (under TK) it is no mode.
      { id: '7', senderRole: 'mod', envelope: await sealChat({ trade: w.channel, from: 'mod', seq: 0, type: 'chat.mode', payload: { on: true }, tk: w.tk, me: w.ids.mod }), at: 'g', to: null },
    ];
    const o = await openCaseChat(w.answer, w.device, MOD);
    expect(o.lines).toEqual([
      { kind: 'mode', id: '1', from: 'mod', to: 'seller', on: true, at: 'a', missingBefore: 0 },
      { id: '2', from: 'mod', text: 'Only you.', at: 'b', missingBefore: 0, to: 'seller' },
      { kind: 'mode', id: '3', from: 'mod', to: 'seller', on: false, at: 'c', missingBefore: 0 },
    ]);
    expect(o.unreadable).toBe(4);
  });

  it('sealModeMessage seals v3 {type: chat.mode, payload: {on}} in that lane only, with a lane countersign that verifies', async () => {
    const w = await world();
    const o = await openCaseChat(w.answer, w.device, MOD);
    for (const on of [true, false]) {
      const m = await sealModeMessage(o, 'buyer', on, w.device, new Date(NOW), 3);
      expect({ to: m.to, seq: m.seq, mode: m.mode }).toEqual({ to: 'buyer', seq: 3, mode: true });
      const body = { v: 3 as const, trade: w.channel, from: 'mod' as const, to: 'buyer' as const, seq: 3, nonce: m.nonce, ct: m.ct };
      const cs = { chat: w.channel, to: 'buyer', seq: 3, nonce: m.nonce, ctSha256: m.ctSha256, requestId: m.requestId, issuedAt: m.issuedAt, sig: m.sig };
      await expect(verifyModPrivateCountersign(cs, { body, signPublic: w.device.signPublic })).resolves.toBeDefined();
      await expect(verifyModPrivateCountersign({ ...cs, to: 'seller' }, { body: { ...body, to: 'seller' }, signPublic: w.device.signPublic })).rejects.toThrow();
      const env = await signPrivateEnvelope(body, w.ids.mod);
      const opened = await openPrivate(env, { pk: w.pk.buyer, trade: w.channel, to: 'buyer', participants: w.participants, guard: new ReplayGuard(w.channel) });
      expect({ type: opened.type, payload: opened.payload, from: opened.from }).toEqual({ type: 'chat.mode', payload: { on }, from: 'mod' });
      await expect(openPrivate({ ...env, to: 'seller' }, { pk: w.pk.seller, trade: w.channel, to: 'seller', participants: w.participants, guard: new ReplayGuard(w.channel) })).rejects.toThrow();
    }
    await expect(sealModeMessage(o, 'buyer', 'yes' as never, w.device, new Date(NOW), 0)).rejects.toEqual(new CaseChatError('unreadable'));
    forget(o);
    await expect(sealModeMessage(o, 'buyer', true, w.device, new Date(NOW), 0)).rejects.toEqual(new CaseChatError('security'));
  });

  it('through the worker: sealMode crosses the boundary and refuses a bad lane, on, clock or handle', async () => {
    const backend = memory();
    const w = await world({ backend });
    const { keys, keeper } = await workerPair({ backend, now: () => NOW });
    const v = await keys.open(w.answer);
    const m = await keys.sealMode(v.handle, 'seller', true, new Date(NOW), 0);
    expect({ to: m.to, seq: m.seq, mode: m.mode }).toEqual({ to: 'seller', seq: 0, mode: true });
    expect((await keys.sealMode(v.handle, 'seller', false, new Date(NOW), 1)).seq).toBe(1);
    await expect(keys.sealMode(v.handle, 'mod' as never, true, new Date(NOW), 0)).rejects.toEqual(new ChatKeyError('unreadable'));
    await expect(keys.sealMode(v.handle, 'buyer', 1 as never, new Date(NOW), 0)).rejects.toEqual(new ChatKeyError('unreadable'));
    await expect(keys.sealMode(v.handle, 'buyer', true, new Date(NOW + 3_600_000), 0)).rejects.toEqual(new ChatKeyError('unreadable'));
    await expect(keys.sealMode('0'.repeat(32), 'buyer', true, new Date(NOW), 0)).rejects.toEqual(new ChatKeyError('gone'));
    expect(JSON.stringify(m)).not.toContain(Buffer.from(w.pk.seller).toString('hex'));
    keeper.forgetAll();
  });

  it('messageTraders sends mode: true for a mode message and omits mode otherwise (fix-mode-firstreply)', async () => {
    const w = await world();
    const o = await openCaseChat(w.answer, w.device, MOD);
    const modeMsg = await sealModeMessage(o, 'buyer', true, w.device, new Date(NOW), 0);
    const laneMsg = await sealModMessage(o, 'Only buyer.', w.device, new Date(NOW), 1, 'buyer');
    const sharedMsg = await sealModMessage(o, 'To both.', w.device, new Date(NOW), 0);
    const bodies: Record<string, unknown>[] = [];
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(JSON.stringify({ id: '1' }), { status: 201, headers: { 'content-type': 'application/json' } });
    });
    try {
      await messageTraders('ABCD-EFGH-JKLM-NPQR', modeMsg);
      await messageTraders('ABCD-EFGH-JKLM-NPQR', laneMsg);
      await messageTraders('ABCD-EFGH-JKLM-NPQR', { ...laneMsg, mode: false });
      await messageTraders('ABCD-EFGH-JKLM-NPQR', sharedMsg);
    } finally {
      fetchSpy.mockRestore();
      forget(o);
    }
    expect(bodies).toHaveLength(4);
    expect(bodies[0]).toMatchObject({ to: 'buyer', mode: true });
    expect(bodies[1]).toMatchObject({ to: 'buyer' });
    expect('mode' in bodies[1]!).toBe(false);
    expect('mode' in bodies[2]!).toBe(false);
    expect('to' in bodies[3]!).toBe(false);
    expect('mode' in bodies[3]!).toBe(false);
  });
});
