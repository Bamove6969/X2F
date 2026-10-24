import { ROLES } from '@x2f/core';
import { generateIdentity, seal, type Identity, type Participants } from '@x2f/protocol';
import { describe, expect, it, vi } from 'vitest';
import { runSignals, type SignalsState } from '../src/escrow/signals.js';
import { ADDR, Hub, confirmedFor, until } from './escrow-helpers.js';

const CHANNEL = 'S1GN-ALSC-HANN-EL00';

async function trio() {
  const ids = { buyer: await generateIdentity(), seller: await generateIdentity(), mod: await generateIdentity() };
  const participants = Object.fromEntries(ROLES.map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
  return { ids, participants };
}

const fresh = (): SignalsState => ({ guard: { trade: CHANNEL, seen: {} }, seq: 0, theirAddress: null, theirDeal: null, termsAcked: false });

function side(role: 'buyer' | 'seller', hub: Hub, me: Identity, participants: Participants, over: Partial<Parameters<typeof runSignals>[0]> = {}) {
  const saves: SignalsState[] = [];
  const got: { type: string; from: string; savedFirst: boolean }[] = [];
  const h = runSignals({
    channel: CHANNEL,
    role,
    me,
    participants,
    transport: hub.transport({ url: 'ws://t', code: CHANNEL, role }),
    state: fresh(),
    ownAddress: ADDR[role],
    deal: confirmedFor(role).deal,
    save: async (s) => void saves.push(s),
    onSignal: (type, from) => got.push({ type, from, savedFirst: saves.length > 0 }),
    resendMs: 10,
    ...over,
  });
  return { h, saves, got, last: () => saves.at(-1) };
}

describe('signals channel', () => {
  it('both sides exchange signed terms (address and deal) and stop resending once the mod acks', async () => {
    const hub = new Hub();
    const { ids, participants } = await trio();
    const b = side('buyer', hub, ids.buyer, participants);
    const s = side('seller', hub, ids.seller, participants);
    await until(() => b.last()?.theirAddress === ADDR.seller && s.last()?.theirAddress === ADDR.buyer);
    expect(b.last()?.theirDeal).toEqual(confirmedFor('seller').deal);
    // The mod acks both; resends stop.
    for (const role of ['buyer', 'seller'] as const) {
      hub.inject(CHANNEL, role, await seal({ trade: CHANNEL, from: 'mod', seq: role === 'buyer' ? 1 : 2, type: 'trade.ack', payload: { of: 'trade.terms' }, to: ROLES, me: ids.mod, participants }));
    }
    await until(() => b.last()?.termsAcked === true && s.last()?.termsAcked === true);
    await new Promise((r) => setTimeout(r, 30));
    const n = hub.sent.length;
    await new Promise((r) => setTimeout(r, 60));
    expect(hub.sent.length).toBe(n);
    b.h.stop();
    s.h.stop();
  });

  it('the first terms win; a later different copy, a signal from the wrong role, malformed payloads and replays are ignored', async () => {
    const hub = new Hub();
    const { ids, participants } = await trio();
    const ignored = vi.fn();
    const b = side('buyer', hub, ids.buyer, participants, { onIgnored: ignored });
    const deal = confirmedFor('seller').deal;
    const send = async (seq: number, type: string, payload: unknown, from: 'seller' | 'mod' = 'seller') =>
      hub.inject(CHANNEL, 'buyer', await seal({ trade: CHANNEL, from, seq, type, payload, to: ROLES, me: ids[from], participants }));
    await send(1, 'trade.terms', { refundAddress: ADDR.seller, deal });
    await until(() => b.last()?.theirAddress === ADDR.seller);
    await send(2, 'trade.terms', { refundAddress: '4Attacker', deal });
    await send(3, 'trade.paid', {}); // only the buyer sends trade.paid
    await send(4, 'trade.terms', { refundAddress: ADDR.seller, deal, extra: 1 });
    await send(5, 'trade.terms', { payoutAddress: ADDR.seller, deal });
    await send(3, 'trade.extend', {}); // replayed seq
    await send(6, 'trade.terms', { refundAddress: ADDR.seller, deal: { ...deal, takeAmountAtomic: 1n } });
    await until(() => ignored.mock.calls.length >= 6);
    expect(ignored.mock.calls.map((c) => c[0])).toEqual(['terms-changed', 'malformed', 'malformed', 'malformed', 'replay', 'terms-changed']);
    expect(b.last()?.theirAddress).toBe(ADDR.seller);
    expect(b.last()?.theirDeal).toEqual(deal);
    // Every accepted signal was saved before it was acted on.
    expect(b.got.every((g) => g.savedFirst)).toBe(true);
    expect(b.got.map((g) => g.type)).toEqual(['trade.terms', 'trade.terms', 'trade.terms']);
    b.h.stop();
  });

  it('a side may send only its own signals; the seq is saved before the envelope leaves', async () => {
    const hub = new Hub();
    const { ids, participants } = await trio();
    const b = side('buyer', hub, ids.buyer, participants);
    const s = side('seller', hub, ids.seller, participants);
    await expect(b.h.send('trade.extend')).rejects.toThrow();
    await expect(s.h.send('trade.cancel')).rejects.toThrow();
    await expect(s.h.send('trade.paid')).rejects.toThrow();
    await b.h.send('trade.cancel');
    const env = hub.sent.filter((x) => x.from === 'buyer').at(-1)!;
    expect(b.saves.some((x) => x.seq === env.e.seq)).toBe(true);
    await until(() => s.got.some((g) => g.type === 'trade.cancel' && g.from === 'buyer'));
    b.h.stop();
    s.h.stop();
  });
});
