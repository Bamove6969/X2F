import { ROLES } from '@x2f/core';
import type { Transport } from '@x2f/escrow';
import { seal, type Identity, type Participants } from '@x2f/protocol';
import { describe, expect, it, vi } from 'vitest';
import { runSignals, type SignalsState } from '../src/escrow/signals.js';
import { ADDR, Hub, confirmedFor, testIdentity, until } from './escrow-helpers.js';

const CHANNEL = 'S1GN-ALSC-HANN-EL00';

async function trio() {
  const ids = { buyer: await testIdentity(), seller: await testIdentity(), mod: await testIdentity() };
  const participants = Object.fromEntries(ROLES.map((r) => [r, { signPublic: ids[r].signPublic, boxPublic: ids[r].boxPublic }])) as Participants;
  return { ids, participants };
}

const fresh = (): SignalsState => ({ guard: { trade: CHANNEL, seen: {} }, seq: 0, theirAddress: null, theirDeal: null, termsAcked: false });

function side(role: 'buyer' | 'seller', hub: Hub, me: Identity, participants: Participants, over: Partial<Parameters<typeof runSignals>[0]> = {}) {
  const saves: SignalsState[] = [];
  const got: { type: string; from: string; savedFirst: boolean; payload: Record<string, unknown> }[] = [];
  const absorbed: { type: string; savesBefore: number }[] = [];
  const h = runSignals({
    channel: CHANNEL,
    role,
    me,
    participants,
    transport: hub.transport({ url: 'ws://t', code: CHANNEL, role }),
    state: fresh(),
    ownAddress: ADDR[role],
    deal: confirmedFor(role).deal,
    attestedTheirAddress: ADDR[role === 'buyer' ? 'seller' : 'buyer'],
    save: async (s) => void saves.push(s),
    absorb: (type) => absorbed.push({ type, savesBefore: saves.length }),
    onSignal: (type, from, payload) => got.push({ type, from, savedFirst: saves.length > 0, payload }),
    resendMs: 10,
    ...over,
  });
  return { h, saves, got, absorbed, last: () => saves.at(-1) };
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

  it('only the attested terms are adopted; another address or deal (before or after), a signal from the wrong role, malformed payloads and replays are ignored', async () => {
    const hub = new Hub();
    const { ids, participants } = await trio();
    const ignored = vi.fn();
    const b = side('buyer', hub, ids.buyer, participants, { onIgnored: ignored });
    const deal = confirmedFor('seller').deal;
    const send = async (seq: number, type: string, payload: unknown, from: 'seller' | 'mod' = 'seller') =>
      hub.inject(CHANNEL, 'buyer', await seal({ trade: CHANNEL, from, seq, type, payload, to: ROLES, me: ids[from], participants }));
    await send(0, 'trade.terms', { refundAddress: '4Attacker', deal }); // before the attested ones: ignored, not adopted
    await until(() => ignored.mock.calls.length >= 1);
    expect(b.last()?.theirAddress).toBeNull();
    await send(1, 'trade.terms', { refundAddress: ADDR.seller, deal });
    await until(() => b.last()?.theirAddress === ADDR.seller);
    await send(2, 'trade.terms', { refundAddress: '4Attacker', deal });
    await send(3, 'trade.paid', {}); // only the buyer sends trade.paid
    await send(4, 'trade.terms', { refundAddress: ADDR.seller, deal, extra: 1 });
    await send(5, 'trade.terms', { payoutAddress: ADDR.seller, deal });
    await send(3, 'trade.extend', {}); // replayed seq
    await send(6, 'trade.terms', { refundAddress: ADDR.seller, deal: { ...deal, takeAmountAtomic: 1n } });
    await until(() => ignored.mock.calls.length >= 7);
    expect(ignored.mock.calls.map((c) => c[0])).toEqual(['terms-mismatch', 'terms-mismatch', 'malformed', 'malformed', 'malformed', 'replay', 'terms-mismatch']);
    expect(b.last()?.theirAddress).toBe(ADDR.seller);
    expect(b.last()?.theirDeal).toEqual(deal);
    // Every accepted signal was saved before it was acted on.
    expect(b.got.every((g) => g.savedFirst)).toBe(true);
    expect(b.got.map((g) => g.type)).toEqual(['trade.terms']); // the ignored copies never count as signals
    b.h.stop();
  });

  it('trade.paid carries the signed amount and fiat total; the receiver absorbs it before the save', async () => {
    const hub = new Hub();
    const { ids, participants } = await trio();
    const b = side('buyer', hub, ids.buyer, participants);
    const s = side('seller', hub, ids.seller, participants);
    await expect(b.h.send('trade.paid')).rejects.toThrow(); // no amount: refused
    await expect(b.h.send('trade.paid', { amountAtomic: 0n, fiatCents: 1n })).rejects.toThrow();
    await b.h.send('trade.paid', { amountAtomic: 1_280_000_000_000n, fiatCents: 42_240n });
    await until(() => s.got.some((g) => g.type === 'trade.paid'));
    expect(s.got.find((g) => g.type === 'trade.paid')!.payload).toEqual({ amountAtomic: 1_280_000_000_000n, fiatCents: 42_240n });
    const ab = s.absorbed.find((x) => x.type === 'trade.paid')!;
    const savedAfter = s.saves.length;
    expect(savedAfter).toBeGreaterThan(ab.savesBefore); // absorbed first, then saved
    b.h.stop();
    s.h.stop();
    // A trade.paid without the amount (the old shape) is malformed and never absorbed.
    const hub2 = new Hub();
    const ignored = vi.fn();
    const s2 = side('seller', hub2, ids.seller, participants, { onIgnored: ignored });
    hub2.inject(CHANNEL, 'seller', await seal({ trade: CHANNEL, from: 'buyer', seq: 50, type: 'trade.paid', payload: {}, to: ROLES, me: ids.buyer, participants }));
    await until(() => ignored.mock.calls.some((c) => c[0] === 'malformed'));
    expect(s2.absorbed.some((x) => x.type === 'trade.paid')).toBe(false);
    s2.h.stop();
  });

  // Found while chasing the 23 Nov dispute-payout flake (it was not that flake's cause):
  // a side answered the peer's trade.terms only the first time it adopted them, and stopped
  // resending its own once it held the peer's terms and the mod's ack. A peer that lost ours (its
  // run read them but a reload came before the save landed) then resent forever and never got
  // them: its device has no counterparty terms, its policy context is null, and it settles nothing.
  // A done side now answers a peer still resending, at most once per quiet interval, so two done
  // sides never ping-pong.
  it('a buyer that lost the seller\'s terms with a reload gets them again from a seller that is already done; two done sides then stay quiet', async () => {
    const hub = new Hub();
    const { ids, participants } = await trio();
    const ack = async (role: 'buyer' | 'seller', seq: number) =>
      hub.inject(CHANNEL, role, await seal({ trade: CHANNEL, from: 'mod', seq, type: 'trade.ack', payload: { of: 'trade.terms' }, to: ROLES, me: ids.mod, participants }));
    // The buyer's first run: its own terms leave (their seq is stored), but the save that adopts the
    // seller's terms never lands (the page is going away).
    const stored: SignalsState[] = [];
    let adoptTried = false;
    const b1 = side('buyer', hub, ids.buyer, participants, {
      save: (st) => {
        if (st.theirAddress !== null) {
          adoptTried = true;
          return new Promise<void>(() => {});
        }
        stored.push(structuredClone(st));
        return Promise.resolve();
      },
      answerMs: 50,
    });
    const s = side('seller', hub, ids.seller, participants, { answerMs: 50 });
    await until(() => adoptTried && s.last()?.theirAddress === ADDR.buyer);
    await ack('seller', 1);
    await until(() => s.last()?.termsAcked === true);
    b1.h.stop();
    // Whatever else reached the dying page is lost with it.
    const drain = hub.transport({ url: 'ws://t', code: CHANNEL, role: 'buyer' });
    while (await Promise.race([drain.next().then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), 30))]));
    drain.close();
    expect(stored.at(-1)?.theirAddress).toBeNull();
    // The seller is done and quiet; the buyer comes back from what was stored and resends its terms.
    await new Promise((r) => setTimeout(r, 80));
    const b2 = side('buyer', hub, ids.buyer, participants, { state: stored.at(-1)!, answerMs: 50 });
    await until(() => b2.last()?.theirAddress === ADDR.seller, 2000);
    expect(b2.last()?.theirDeal).toEqual(confirmedFor('seller').deal);
    await ack('buyer', 2);
    await until(() => b2.last()?.termsAcked === true);
    // Both done: no more terms in either direction.
    await new Promise((r) => setTimeout(r, 150));
    const n = hub.sent.length;
    await new Promise((r) => setTimeout(r, 300));
    expect(hub.sent.length).toBe(n);
    b2.h.stop();
    s.h.stop();
  });

  // Review of d9ed0d60 (M1): a quiet interval alone did not stop two done sides answering each
  // other once twice the one-way delay reached it. A copy of the peer's terms is answered again only
  // after the peer sent two of them since our last send: a done peer sends one per send of ours.
  const LATENCIES = [0, 10, 30, 60, 120];
  const delayed = (t: Transport, ms: number): Transport => ({ ...t, send: (e) => (ms === 0 ? t.send(e) : void setTimeout(() => t.send(e), ms)) });
  const doneState = (role: 'buyer' | 'seller'): SignalsState => ({ ...fresh(), seq: 100, theirAddress: ADDR[role === 'buyer' ? 'seller' : 'buyer'], theirDeal: confirmedFor(role === 'buyer' ? 'seller' : 'buyer').deal, termsAcked: true });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it.each(LATENCIES)('two done sides starting together, one-way delay %i ms: each sends its terms once and then both stay quiet', async (ms) => {
    const hub = new Hub();
    const { ids, participants } = await trio();
    const mk = (role: 'buyer' | 'seller') =>
      side(role, hub, ids[role], participants, { transport: delayed(hub.transport({ url: 'ws://t', code: CHANNEL, role }), ms), state: doneState(role), answerMs: 20 });
    const b = mk('buyer');
    const s = mk('seller');
    await sleep(300 + 4 * ms);
    const n = hub.sent.length;
    await sleep(600);
    expect(hub.sent.length).toBe(n);
    expect(n).toBeLessThanOrEqual(2);
    b.h.stop();
    s.h.stop();
  });

  it.each(LATENCIES)('two fresh sides starting together, one-way delay %i ms: both adopt, and once the mod acks both, no more terms', async (ms) => {
    const hub = new Hub();
    const { ids, participants } = await trio();
    const mk = (role: 'buyer' | 'seller') => side(role, hub, ids[role], participants, { transport: delayed(hub.transport({ url: 'ws://t', code: CHANNEL, role }), ms), answerMs: 20 });
    const b = mk('buyer');
    const s = mk('seller');
    await until(() => b.last()?.theirAddress === ADDR.seller && s.last()?.theirAddress === ADDR.buyer, 3000);
    for (const [role, seq] of [['buyer', 1], ['seller', 2]] as const) {
      hub.inject(CHANNEL, role, await seal({ trade: CHANNEL, from: 'mod', seq, type: 'trade.ack', payload: { of: 'trade.terms' }, to: ROLES, me: ids.mod, participants }));
    }
    await until(() => b.last()?.termsAcked === true && s.last()?.termsAcked === true);
    await sleep(300 + 4 * ms);
    const n = hub.sent.length;
    await sleep(600);
    expect(hub.sent.length).toBe(n);
    b.h.stop();
    s.h.stop();
  });

  it.each(LATENCIES)('one-way delay %i ms: a done seller answers a buyer that came back without its terms, then both stay quiet', async (ms) => {
    const hub = new Hub();
    const { ids, participants } = await trio();
    const s = side('seller', hub, ids.seller, participants, { transport: delayed(hub.transport({ url: 'ws://t', code: CHANNEL, role: 'seller' }), ms), state: doneState('seller'), answerMs: 20 });
    await sleep(100 + 2 * ms);
    // The seller's start send is lost with the buyer's old page.
    const drain = hub.transport({ url: 'ws://t', code: CHANNEL, role: 'buyer' });
    while (await Promise.race([drain.next().then(() => true), sleep(30).then(() => false)]));
    drain.close();
    const b = side('buyer', hub, ids.buyer, participants, { transport: delayed(hub.transport({ url: 'ws://t', code: CHANNEL, role: 'buyer' }), ms), state: { ...fresh(), seq: 100 }, answerMs: 20 });
    await until(() => b.last()?.theirAddress === ADDR.seller, 3000);
    hub.inject(CHANNEL, 'buyer', await seal({ trade: CHANNEL, from: 'mod', seq: 1, type: 'trade.ack', payload: { of: 'trade.terms' }, to: ROLES, me: ids.mod, participants }));
    await until(() => b.last()?.termsAcked === true);
    await sleep(300 + 4 * ms);
    const n = hub.sent.length;
    await sleep(600);
    expect(hub.sent.length).toBe(n);
    b.h.stop();
    s.h.stop();
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
