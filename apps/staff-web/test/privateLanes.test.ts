// Private moderator lanes (owner 27 Nov, docs/security/private-mod-chat-2026-11-27.md) in the staff
// reader and the chat key worker: every lane key is opened with this device's key and pinned by its
// pkh; v3 envelopes open under their lane's key with that lane's own replay guard and gap count; a
// private message is sealed as v3 under the lane key with the lane countersign.
import { newPrivateKey, openPrivate, ReplayGuard, signPrivateEnvelope, verifyModCountersign, verifyModPrivateCountersign, wrapPrivateKey } from '@x2f/protocol';
import { beforeAll, describe, expect, it } from 'vitest';
import { ChatKeyError } from '../src/chat/types.js';
import { CaseChatError, forget, openCaseChat, sealModMessage } from '../src/keys/reader.js';
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
