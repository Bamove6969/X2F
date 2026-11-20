import { ROLES } from '@x2f/core';
import { EscrowError, PartyError, TransportClosedError } from '@x2f/escrow';
import { open, ReplayGuard, seal, type Participants } from '@x2f/protocol';
import { channelFor, escrowPlan, fiatCents, instructionsSha256 } from '@x2f/trade';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Attestation } from '@x2f/trade';
import { cosignPolicy } from '../src/escrow/policy.js';
import { ADDR, AMOUNT, CODE, ESCROW_ADDRESS, FEE_WALLET, Hub, INSTRUCTIONS, Parties, confirmedFor, device, testIdentity, type Funds, funded, makeApi, modKey, tradeView, until, type ApiState, type Device } from './escrow-helpers.js';

const running: Device[] = [];
const fiatOf = (a: bigint): bigint => fiatCents(a, { currency: 'USD', centsPerXmr: 33_000n });
/** The buyer taps "I've paid" on its own device with the total for `amount` (the real flow, Task 23). */
const pay = (buyer: Device, amount: bigint = AMOUNT): Promise<void> => buyer.runtime.act(CODE, { type: 'paid', fiatCents: fiatOf(amount) });
afterEach(async () => {
  await Promise.all(running.splice(0).map((d) => d.runtime.stopAll()));
});

/** A trade.paid signed with the buyer's own stored identity, delivered to the seller only. */
async function injectPaid(t: { hub: Hub; buyer: Device }, payload: { amountAtomic: bigint; fiatCents: bigint }): Promise<void> {
  const rec = (await t.buyer.store.load(CODE))!;
  const att = rec.attestation!.attestation as { participants: Participants };
  const channel = await channelFor(CODE, 'signals');
  const me = { ...rec.identity };
  t.hub.inject(channel, 'seller', await seal({ trade: channel, from: 'buyer', seq: 10_000, type: 'trade.paid', payload, to: ROLES, me, participants: att.participants }));
}

async function setup(over: Partial<ApiState> = {}) {
  const mod = await modKey();
  const state: ApiState = { identities: {}, view: tradeView(), ...over };
  const api = await makeApi(mod, state);
  const hub = new Hub();
  const parties = new Parties();
  const mk = async (role: 'buyer' | 'seller', extra: Partial<Parameters<typeof device>[1]> = {}) => {
    const d = await device(role, { api: api.forRole(role), hub, parties, modPublic: mod.publicHex, ...extra });
    running.push(d);
    return d;
  };
  return { mod, state, api, hub, parties, mk };
}

describe('attestation check before any escrow work (P3-C1)', () => {
  it('an attestation without this device’s key: phase error, participants-mismatch, runParty never called', async () => {
    const intruder = await testIdentity();
    const t = await setup({
      tamper: (a) => ({ ...a, participants: { ...a.participants, buyer: { signPublic: intruder.signPublic, boxPublic: intruder.boxPublic } } }),
    });
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(() => buyer.last()?.phase === 'error');
    expect(buyer.last()).toMatchObject({ phase: 'error', error: 'participants-mismatch', keepOpen: false, checkWords: null });
    expect(t.parties.calls.filter((c) => c.role === 'buyer')).toEqual([]);
    // Nothing was sent or even opened on the relay by the buyer: no terms, no escrow messages.
    expect(t.hub.opened.filter((o) => o.role === 'buyer')).toEqual([]);
    expect(buyer.statuses.map((s) => s.phase)).toEqual(['idle', 'registering', 'verifying', 'error']);
  });

  it.each([
    ['409 identity-conflict on registering', { identity: 'identity-conflict' as const }, ['idle', 'registering', 'error']],
    ['409 attestation-refused while waiting', { attestation: 'attestation-refused' as const }, ['idle', 'registering', 'verifying', 'error']],
  ])('%s is final: participants-mismatch, no retry, runParty never called', async (_n, refuse, phases) => {
    const t = await setup({ refuse });
    const buyer = await t.mk('buyer');
    await buyer.runtime.start(CODE);
    await until(() => buyer.last()?.phase === 'error');
    expect(buyer.last()).toMatchObject({ phase: 'error', error: 'participants-mismatch' });
    expect(buyer.statuses.map((s) => s.phase)).toEqual(phases);
    expect(t.parties.calls).toEqual([]);
    expect(t.hub.opened).toEqual([]);
  });

  it('409 trade-closed while waiting (closed before any attestation): stops polling, no error, and the record goes after 30 days (review M2)', async () => {
    const DAY = 24 * 60 * 60 * 1000;
    let clock = Date.parse('2026-10-28T12:00:00Z');
    const t = await setup();
    let fetches = 0;
    const api = t.api.forRole('buyer');
    const counted = { ...api, getAttestation: async () => (fetches++, api.getAttestation()) };
    t.state.refuse = { attestation: 'trade-closed' };
    const buyer = await device('buyer', { api: counted, hub: t.hub, parties: t.parties, modPublic: t.mod.publicHex, now: () => clock });
    running.push(buyer);
    await buyer.runtime.start(CODE);
    await until(() => fetches > 0 && buyer.last()?.phase === 'idle' && buyer.statuses.some((s) => s.phase === 'verifying'));
    const seen = fetches;
    await new Promise((r) => setTimeout(r, 50)); // pollMs is 5: a still-polling run would fetch again
    expect(fetches).toBe(seen);
    expect(buyer.last()).toMatchObject({ phase: 'idle', error: null });
    expect(t.parties.calls).toEqual([]);
    const kept = await buyer.store.load(CODE);
    expect(kept?.closedSeenAt).toBe(clock);
    expect(kept?.failed ?? null).toBeNull();

    // A resume before the 30 days keeps the record; one after forgets it.
    clock += 29 * DAY;
    const again = await device('buyer', { api: counted, hub: t.hub, parties: t.parties, modPublic: t.mod.publicHex, now: () => clock, idb: buyer.idb });
    running.push(again);
    await again.runtime.resumeAll();
    await until(async () => fetches > seen);
    await new Promise((r) => setTimeout(r, 20));
    expect((await again.store.load(CODE))?.closedSeenAt).toBe(clock - 29 * DAY);
    clock += 2 * DAY;
    const later = await device('buyer', { api: counted, hub: t.hub, parties: t.parties, modPublic: t.mod.publicHex, now: () => clock, idb: buyer.idb });
    running.push(later);
    await later.runtime.resumeAll();
    await until(async () => (await later.store.load(CODE)) === null);
  });

  it('an attestation signed by another key, for another trade or with another channel: participants-mismatch', async () => {
    const other = await modKey();
    const cases: Partial<ApiState>[] = [
      { resign: other.secret },
      { tamper: (a) => ({ ...a, trade: 'AAAA-BBBB-CCCC-DDDD' }) },
      { tamper: (a) => ({ ...a, channels: { ...a.channels, escrow: CODE } }) },
      { tamper: (a) => ({ ...a, channels: { signals: a.channels.signals! } }) },
    ];
    for (const c of cases) {
      const t = await setup(c);
      const buyer = await t.mk('buyer');
      const seller = await t.mk('seller');
      await seller.runtime.start(CODE);
      await buyer.runtime.start(CODE);
      await until(() => buyer.last()?.phase === 'error' && seller.last()?.phase === 'error');
      expect(buyer.last()?.error).toBe('participants-mismatch');
      expect(t.parties.calls).toEqual([]);
    }
  });

  // Review multisig-vs-RetoSwap F5 (12 Nov): issuedAt is checked against the device clock and the
  // view's take time. A time refusal may be this device's clock, so it is retryable and never kept.
  // Review lead-escrow-harden M1 (16 Nov): the lower bound is the time this device made its
  // identity (kept in its record), not the API's unsigned takenAt, which a lying API leaves out.
  it.each([
    ['issued after the trade was taken: accepted', { takenAt: '2026-10-23T11:00:00.000Z' }, {}, Date.parse('2026-10-24T12:00:00Z'), null],
    ['issued before the trade was taken (older than the trade)', { takenAt: '2026-10-24T12:30:00.000Z' }, {}, Date.parse('2026-10-24T12:00:00Z'), 'escrow-failed'],
    ['issued a day in this device’s future', {}, { issuedAt: '2026-10-23T12:00:00.000Z' }, Date.parse('2026-10-22T12:00:00Z'), 'escrow-failed'],
    ['a take time the view cannot read', { takenAt: 'yesterday' }, {}, Date.parse('2026-10-24T12:00:00Z'), 'escrow-failed'],
    ['issued before this device made its identity (backdated), the view without takenAt', {}, { issuedAt: '2026-10-23T12:00:00.000Z' }, Date.parse('2026-10-24T12:00:00Z'), 'escrow-failed'],
    ['issued before this device made its identity (backdated), takenAt backdated too', { takenAt: '2026-10-23T11:00:00.000Z' }, { issuedAt: '2026-10-23T12:00:00.000Z' }, Date.parse('2026-10-24T12:00:00Z'), 'escrow-failed'],
  ] as const)('issuedAt %s', async (_n, viewOver, apiOver, clock, error) => {
    const t = await setup({ view: tradeView(viewOver), ...apiOver });
    const buyer = await t.mk('buyer', { now: () => clock });
    const seller = await t.mk('seller', { now: () => clock });
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    if (error === null) {
      await until(() => t.parties.calls.some((c) => c.role === 'buyer'));
      expect(buyer.last()?.error ?? null).toBeNull();
      return;
    }
    expect(await buyer.status((s) => s.phase === 'error')).toMatchObject({ error, retryable: true });
    expect(t.parties.calls).toEqual([]);
    expect((await buyer.store.load(CODE))?.failed ?? null).toBeNull();
    expect((await buyer.store.load(CODE))?.attestation ?? null).toBeNull();
  });

  it('the record keeps the device time its identity was made, and the attestation is checked against it on every start', async () => {
    let clock = Date.parse('2026-10-24T12:00:00.000Z');
    const t = await setup();
    const buyer = await t.mk('buyer', { now: () => clock });
    const seller = await t.mk('seller', { now: () => clock });
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await until(() => t.parties.calls.some((c) => c.role === 'buyer'));
    expect((await buyer.store.load(CODE))?.identityCreatedAt).toBe(Date.parse('2026-10-24T12:00:00.000Z'));
    await buyer.runtime.stop(CODE);
    // A later start, a month on: the stored attestation still verifies against the stored time.
    clock += 30 * 24 * 60 * 60_000;
    const again = await t.mk('buyer', { idb: buyer.idb, now: () => clock });
    const before = t.parties.calls.filter((c) => c.role === 'buyer').length;
    await again.runtime.start(CODE);
    await until(() => t.parties.calls.filter((c) => c.role === 'buyer').length > before);
    expect(again.last()?.error ?? null).toBeNull();
  });

  it('a record written before the identity time was kept still verifies with today\'s unbounded key', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await until(() => t.parties.calls.some((c) => c.role === 'buyer'));
    await buyer.runtime.stop(CODE);
    const rec = (await buyer.store.load(CODE))! as unknown as Record<string, unknown>;
    delete rec.identityCreatedAt;
    await buyer.store.save(rec as never);
    expect(await buyer.store.load(CODE)).not.toHaveProperty('identityCreatedAt');
    const again = await t.mk('buyer', { idb: buyer.idb });
    const before = t.parties.calls.filter((c) => c.role === 'buyer').length;
    await again.runtime.start(CODE);
    await until(() => t.parties.calls.filter((c) => c.role === 'buyer').length > before);
    expect(again.last()?.error ?? null).toBeNull();
  });

  it.each([
    ['another deal (offer maximum)',(a: Attestation): Attestation => ({ ...a, terms: { ...a.terms!, deal: { ...a.terms!.deal, maxFiatCents: '90000' } } })],
    ['another take amount', (a: Attestation): Attestation => ({ ...a, terms: { ...a.terms!, deal: { ...a.terms!.deal, takeAmountAtomic: '1' } } })],
    ['another payout address for this buyer', (a: Attestation): Attestation => ({ ...a, terms: { ...a.terms!, buyerPayout: '4AttackerAddress' } })],
  ])('the moderator attests %s: deal-mismatch, runParty never called', async (_n, tamper) => {
    const t = await setup({ tamper });
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    expect(await buyer.status((s) => s.phase === 'error')).toMatchObject({ error: 'deal-mismatch' });
    expect(t.parties.calls.filter((c) => c.role === 'buyer')).toEqual([]);
    expect(t.hub.opened.filter((o) => o.role === 'buyer')).toEqual([]);
  });

  it('this device confirmed another own address than the moderator attested: deal-mismatch, nothing settled', async () => {
    // The mod attests the seller's real refund address; the seller confirmed another one. The view
    // carries no address, so only the attestation path (wrong-terms) can refuse this.
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE, { ...confirmedFor('seller'), ownAddress: '4SellerOther' });
    expect(await seller.status((s) => s.phase === 'error')).toMatchObject({ error: 'deal-mismatch' }); // its own address is not the attested one
    expect(t.parties.calls.filter((c) => c.role === 'seller')).toEqual([]);
    // The seller never sent terms, so the buyer has nothing it could settle.
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    await t.parties.ticks('buyer', 3);
    expect(t.parties.settles).toEqual([]);
  });

  it("an attested time to pay other than the one the trade view shows (owner p9-6): deal-mismatch on both devices, nothing set up; the same one goes ahead", async () => {
    // The view shows a 24-hour method (cash by mail); the attestation signs the 90-minute default,
    // so the moderation service would co-sign the seller's refund long before the buyer's time is up.
    const t = await setup({ view: tradeView({ payWindowMin: 1440 }) });
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    expect(await buyer.status((s) => s.phase === 'error')).toMatchObject({ error: 'deal-mismatch' });
    expect(await seller.status((s) => s.phase === 'error')).toMatchObject({ error: 'deal-mismatch' });
    expect(t.parties.calls).toEqual([]);
    expect((await buyer.store.load(CODE))?.failed ?? null).toBeNull(); // not kept: checked again on the next start
    await buyer.runtime.stopAll();
    await seller.runtime.stopAll();
    // The view and the attestation agree: the trade goes ahead.
    const ok = await setup({ view: tradeView({ payWindowMin: 90 }) });
    const b2 = await ok.mk('buyer');
    const s2 = await ok.mk('seller');
    await b2.runtime.start(CODE);
    await s2.runtime.start(CODE);
    await b2.status((s) => s.phase === 'ready');
    await s2.status((s) => s.phase === 'ready');
    expect(ok.parties.calls.map((c) => c.role).sort()).toEqual(['buyer', 'seller']);
  });

  it('a trade view without a time to pay fails closed: deal-mismatch on both devices, nothing set up (launch-rules review F2)', async () => {
    // The web and the API ship together: only a lying API leaves the field out (or sends 0).
    for (const payWindowMin of [undefined, 0, '90']) {
      const t = await setup({ view: tradeView({ payWindowMin }) });
      const buyer = await t.mk('buyer');
      const seller = await t.mk('seller');
      await buyer.runtime.start(CODE);
      await seller.runtime.start(CODE);
      expect(await buyer.status((s) => s.phase === 'error')).toMatchObject({ error: 'deal-mismatch' });
      expect(await seller.status((s) => s.phase === 'error')).toMatchObject({ error: 'deal-mismatch' });
      expect(t.parties.calls).toEqual([]);
      expect(t.hub.opened).toEqual([]);
      // Not kept as failed, and nothing pinned: checked again on the next start.
      const rec = await buyer.store.load(CODE);
      expect(rec?.failed ?? null).toBeNull();
      expect(rec?.payWindowMin ?? null).toBeNull();
      await buyer.runtime.stopAll();
      await seller.runtime.stopAll();
    }
  });

  it('the first time to pay that verified is kept on the device; a later view and attestation that agree on another are refused (launch-rules review F2)', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await buyer.status((s) => s.phase === 'ready');
    expect((await buyer.store.load(CODE))?.payWindowMin).toBe(90);
    await buyer.runtime.stopAll();
    await seller.runtime.stopAll();
    // The API now lies consistently: a 24-hour view and an attestation of 24 hours. Even with the
    // stored attestation gone (so only the pinned value can tell), the device refuses it.
    const rec = (await buyer.store.load(CODE))!;
    await buyer.store.save({ ...rec, attestation: null });
    t.state.view = tradeView({ payWindowMin: 1440 });
    t.state.tamper = (a) => ({ ...a, terms: { ...a.terms!, payWindowMin: 1440 } });
    const again = await device('buyer', { api: t.api.forRole('buyer'), hub: t.hub, parties: t.parties, modPublic: t.mod.publicHex, idb: buyer.idb });
    running.push(again);
    const calls = t.parties.calls.length;
    await again.runtime.resumeAll();
    expect(await again.status((s) => s.phase === 'error')).toMatchObject({ error: 'deal-mismatch' });
    expect(t.parties.calls.length).toBe(calls);
    expect((await again.store.load(CODE))?.payWindowMin).toBe(90);
  });

  it('a counterparty trade.terms address that differs from the attestation is ignored, never adopted; the attested one is, and the device still settles', async () => {
    const t = await setup();
    // A stand-in seller: its identity is registered, then it signs terms with an address the mod did not attest.
    const seller = await testIdentity();
    t.state.identities.seller = { signPublic: seller.signPublic, boxPublic: seller.boxPublic, proof: '' };
    const buyer = await t.mk('buyer');
    await buyer.runtime.start(CODE);
    await until(async () => (await buyer.store.load(CODE))?.attestation != null);
    const att = (await buyer.store.load(CODE))!.attestation!.attestation as Attestation;
    const channel = await channelFor(CODE, 'signals');
    const deal = confirmedFor('seller').deal;
    const terms = (seq: number, refundAddress: string) => seal({ trade: channel, from: 'seller', seq, type: 'trade.terms', payload: { refundAddress, deal }, to: ROLES, me: seller, participants: att.participants });
    t.hub.inject(channel, 'buyer', await terms(1, '4SellerOther'));
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'secured' });
    await until(async () => ((await buyer.store.load(CODE))?.signalGuard?.seen as Record<string, unknown>)?.seller !== undefined); // the frame was read (and its seq kept)
    await t.parties.ticks('buyer', 3);
    expect((await buyer.store.load(CODE))?.theirAddress).toBeNull();
    expect(buyer.statuses.some((s) => s.phase === 'error')).toBe(false);
    expect(t.parties.settles).toEqual([]);
    // The attested address arrives: adopted, and the buyer co-signs the release.
    t.hub.inject(channel, 'buyer', await terms(2, ADDR.seller));
    await until(() => t.parties.settles.some((x) => x.role === 'buyer'));
    expect((await buyer.store.load(CODE))?.theirAddress).toBe(ADDR.seller);
    expect((await buyer.store.load(CODE))?.failed ?? null).toBeNull();
  });

  it('a tampered attestation stored earlier is checked again on resume', async () => {
    const t = await setup();
    const seller = await t.mk('seller');
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await buyer.status((s) => s.phase === 'ready');
    await buyer.runtime.stopAll();
    // The stored attestation is swapped for one listing someone else as buyer (its old signature no longer fits).
    const rec = (await buyer.store.load(CODE))!;
    const intruder = await testIdentity();
    const a = rec.attestation!.attestation as { participants: Record<string, unknown> };
    await buyer.store.save({ ...rec, attestation: { ...rec.attestation!, attestation: { ...a, participants: { ...a.participants, buyer: { signPublic: intruder.signPublic, boxPublic: intruder.boxPublic } } } } });
    const calls = t.parties.calls.length;
    const again = await t.mk('buyer', { idb: buyer.idb });
    await again.runtime.resumeAll();
    expect(await again.status((s) => s.phase === 'error')).toMatchObject({ error: 'participants-mismatch' });
    expect(t.parties.calls.length).toBe(calls);
  });

  it('a stopped run never writes its record again (stop resolves only once the run has ended)', async () => {
    const t = await setup();
    const seller = await t.mk('seller');
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await buyer.status((s) => s.phase === 'ready');
    // A save is in flight (slow storage) when the page stops the runtime.
    const save = buyer.store.save.bind(buyer.store);
    let entered!: () => void;
    const inSave = new Promise<void>((r) => (entered = r));
    let stopped = false;
    let late = 0;
    buyer.store.save = async (r) => {
      entered();
      await new Promise((x) => setTimeout(x, 30));
      await save(r);
      if (stopped) late++;
    };
    const acting = buyer.runtime.act(CODE, { type: 'paid', fiatCents: fiatOf(AMOUNT) }).catch(() => undefined);
    await inSave;
    await buyer.runtime.stopAll();
    stopped = true;
    await acting;
    // Anything the old run still had queued gets its chance to (wrongly) write now.
    await new Promise((r) => setTimeout(r, 60));
    expect(late).toBe(0);
  });
});

describe('what this device signs comes from what the user confirmed, never the API', () => {
  const lies: [string, Partial<ApiState>][] = [
    ['another amount', { view: tradeView({ amountAtomic: (AMOUNT + 1n).toString() }) }],
    ['another poster', { view: tradeView({ poster: 'buyer' }) }],
    ['another rate', { view: tradeView({ lockedRate: { currency: 'USD', centsPerXmr: '33001' } }) }],
    ['another maximum', { view: tradeView({ maxFiatCents: '90000' }) }],
    ['another currency', { view: tradeView({ lockedRate: { currency: 'EUR', centsPerXmr: '33000' } }) }],
    ['another role', { roleView: { buyer: { role: 'seller' } } }],
  ];
  it.each(lies)('a TradeView with %s at start: deal-mismatch, no identity registered, nothing signed, runParty never called', async (_n, lie) => {
    const t = await setup(lie);
    const buyer = await t.mk('buyer');
    await buyer.runtime.start(CODE);
    await until(() => buyer.last()?.phase === 'error');
    expect(buyer.last()?.error).toBe('deal-mismatch');
    expect(t.state.identities.buyer).toBeUndefined();
    expect(t.parties.calls).toEqual([]);
    expect(t.hub.sent).toEqual([]);
    expect(await buyer.store.load(CODE)).toBeNull();
  });

  it('an API view that disagrees with the stored deal mid-trade is a shown refusal (nothing settled), never a kept failure; it recovers when the view is right', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(async () => buyer.last()?.phase === 'ready' && (await buyer.store.load(CODE))?.theirDeal != null);
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'secured', poster: 'buyer' });
    expect(await buyer.status((s) => s.refusal === 'view-mismatch')).toMatchObject({ phase: 'ready', error: null });
    await t.parties.ticks('buyer', 3);
    expect(t.parties.settles).toEqual([]);
    expect((await buyer.store.load(CODE))?.failed ?? null).toBeNull();
    // The view is right again: the refusal goes and the buyer co-signs the release.
    t.state.view = tradeView({ state: 'secured' });
    expect(await buyer.status((s) => s.refusal === null)).toMatchObject({ error: null });
    await until(() => t.parties.settles.some((x) => x.role === 'buyer'));
    // A record a device wrote before this fix (stopped for good on one bad view) runs again.
    await buyer.runtime.stopAll();
    const rec = (await buyer.store.load(CODE))!;
    await buyer.store.save({ ...rec, failed: 'deal-mismatch' });
    const again = await t.mk('buyer', { idb: buyer.idb });
    // The dropped failure is on disk before the next step: it was only in memory until a later save,
    // so the check after "ready" below raced that save (failed under load on 8b0830a2, 7 Nov 2026).
    const verifying = again.status((s) => s.phase === 'verifying');
    await again.runtime.resumeAll();
    await verifying;
    expect((await again.store.load(CODE))?.failed ?? null).toBeNull();
    expect(await again.status((s) => s.phase === 'ready' || s.phase === 'signing')).toMatchObject({ error: null });
    expect((await again.store.load(CODE))?.failed ?? null).toBeNull();
  });

  it('a first start without the user’s confirmation does nothing (not-confirmed)', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    await buyer.rawStart(CODE);
    await until(() => buyer.last()?.phase === 'error');
    expect(buyer.last()?.error).toBe('not-confirmed');
    expect(t.state.identities).toEqual({});
  });

  it('the terms this device signs carry the confirmed address and deal (the view has no address)', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(async () => (await buyer.store.load(CODE))?.theirAddress != null);
    expect((await buyer.store.load(CODE))?.theirAddress).toBe(ADDR.seller);
    expect((await buyer.store.load(CODE))?.theirDeal).toEqual((await seller.store.load(CODE))?.deal);
  });

  it('payment instructions are shown only when they hash to the attested ones; other text is view-mismatch and nothing is settled (Task 34 review I1, restored after J-16)', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(async () => buyer.last()?.phase === 'ready' && (await buyer.store.load(CODE))?.theirDeal != null);
    // Not funded yet: nothing could settle in any case until the instructions check passes below.
    // Before the escrow is secured the view carries none: nothing to show, nothing refused.
    t.state.view = tradeView({ state: 'securing', paymentInstructions: null });
    expect(await buyer.status((s) => s.phase === 'ready' && s.paymentInstructions === null)).toMatchObject({ refusal: null, paymentInstructions: null, instructionsMismatch: false });
    // The locked text: shown, on both sides.
    t.state.view = tradeView({ state: 'secured', paymentInstructions: INSTRUCTIONS });
    expect(await buyer.status((s) => s.paymentInstructions === INSTRUCTIONS)).toMatchObject({ refusal: null, instructionsMismatch: false });
    expect(await seller.status((s) => s.paymentInstructions === INSTRUCTIONS)).toMatchObject({ refusal: null, instructionsMismatch: false });
    // A compromised API serves other payment details (or a near copy): never shown, flagged, nothing settled.
    for (const other of ['IBAN DE00 <attacker>', `${INSTRUCTIONS} `, INSTRUCTIONS.replace('pay@', 'pay1@')]) {
      t.state.view = tradeView({ state: 'secured', paymentInstructions: other });
      await until(() => buyer.last()?.instructionsMismatch === true && seller.last()?.instructionsMismatch === true);
      for (const d of [buyer, seller]) expect(d.last()).toMatchObject({ refusal: 'view-mismatch', paymentInstructions: null, error: null });
      await expect(buyer.runtime.act(CODE, { type: 'paid', fiatCents: fiatOf(AMOUNT) })).rejects.toThrow(/instructions/);
      expect((await buyer.store.load(CODE))?.paidSeen).toBe(false);
      await Promise.all([t.parties.ticks('seller', 3), t.parties.ticks('buyer', 3)]);
      expect(t.parties.settles).toEqual([]);
      expect((await buyer.store.load(CODE))?.failed ?? null).toBeNull();
    }
    // Funded while the view still lies: still nothing settled.
    t.parties.funds = funded();
    await Promise.all([t.parties.ticks('seller', 3), t.parties.ticks('buyer', 3)]);
    expect(t.parties.settles).toEqual([]);
    // The view is right again: the text shows and the trade goes on.
    t.state.view = tradeView({ state: 'secured', paymentInstructions: INSTRUCTIONS });
    expect(await buyer.status((s) => s.paymentInstructions === INSTRUCTIONS)).toMatchObject({ refusal: null, instructionsMismatch: false });
    await until(() => t.parties.settles.some((x) => x.role === 'buyer'));
  });

  it('review M1 (the probe): past securing, missing, null or non-string instructions are a mismatch, never "none"; during securing null is fine', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(async () => buyer.last()?.phase === 'ready' && (await buyer.store.load(CODE))?.theirDeal != null);
    t.state.view = tradeView({ state: 'securing', paymentInstructions: null });
    expect(await buyer.status((s) => s.phase === 'ready')).toMatchObject({ refusal: null, instructionsMismatch: false });
    for (const lie of [{ paymentInstructions: 42 }, { paymentInstructions: false }, { paymentInstructions: { text: INSTRUCTIONS } }, { paymentInstructions: null }, {}]) {
      for (const state of ['secured', 'paid'] as const) {
        t.state.view = { ...tradeView({ state, ...(state === 'paid' ? { paidAt: '2026-10-23T12:30:00.000Z' } : {}) }), ...lie };
        if (!('paymentInstructions' in lie)) delete t.state.view.paymentInstructions;
        await until(() => buyer.last()?.instructionsMismatch === true && seller.last()?.instructionsMismatch === true);
        for (const d of [buyer, seller]) expect(d.last(), JSON.stringify(lie)).toMatchObject({ refusal: 'view-mismatch', paymentInstructions: null });
      }
      t.state.view = { ...tradeView({ state: 'secured' }), ...lie };
      if (!('paymentInstructions' in lie)) delete t.state.view.paymentInstructions;
      await expect(buyer.runtime.act(CODE, { type: 'paid', fiatCents: fiatOf(AMOUNT) })).rejects.toThrow(/instructions/);
      expect((await buyer.store.load(CODE))?.paidSeen).toBe(false);
    }
    t.parties.funds = funded();
    await Promise.all([t.parties.ticks('seller', 3), t.parties.ticks('buyer', 3)]);
    expect(t.parties.settles).toEqual([]);
  });

  it('review M2: the status carries the attested method id (null before the attestation)', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    expect(buyer.last()?.methodId ?? null).toBeNull();
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    expect(await buyer.status((s) => s.phase === 'ready')).toMatchObject({ methodId: 'ZELLE' });
    // A view showing another method mid-trade does not change it: the status keeps the signed one.
    t.state.view = tradeView({ state: 'secured', paymentInstructions: INSTRUCTIONS, methodId: 'PAYPAL' });
    await until(() => buyer.last()?.refusal === 'view-mismatch');
    expect(buyer.last()?.methodId).toBe('ZELLE');
  });

  it('Plan 4 Task 12 (A6): the seller\'s status carries the attested buyer address and take amount to pay a ruling; the buyer\'s none; none before the attestation', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    expect(seller.last()?.restitution ?? null).toBeNull();
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    expect(await seller.status((s) => s.phase === 'ready')).toMatchObject({ restitution: { address: ADDR.buyer, amountAtomic: AMOUNT } });
    expect(await buyer.status((s) => s.phase === 'ready')).toMatchObject({ restitution: null });
    // A view naming another address changes nothing: only the signed terms count.
    t.state.view = { ...tradeView({ state: 'secured' }), buyerPayout: '4AttackerAddress' } as typeof t.state.view;
    await Promise.all([t.parties.ticks('seller', 2)]);
    expect(seller.last()?.restitution).toEqual({ address: ADDR.buyer, amountAtomic: AMOUNT });
  });

  it('re-verify R1: "I\'ve paid" needs this device\'s own view to be secured; a view that says securing (no securedAt, no text) is refused', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(async () => buyer.last()?.phase === 'ready' && (await buyer.store.load(CODE))?.theirDeal != null);
    // The screen's own fetch may say secured; the runtime's says securing with nothing due yet.
    for (const state of ['setup', 'funding', 'securing'] as const) {
      t.state.view = tradeView({ state, paymentInstructions: null });
      await t.parties.ticks('buyer', 2);
      await expect(buyer.runtime.act(CODE, { type: 'paid', fiatCents: fiatOf(AMOUNT) }), state).rejects.toThrow(/secured/);
      expect((await buyer.store.load(CODE))?.paidSeen).toBe(false);
    }
    // Secured with the attested text: the tap is taken.
    t.state.view = tradeView({ state: 'secured' });
    await buyer.runtime.act(CODE, { type: 'paid', fiatCents: fiatOf(AMOUNT) });
    expect((await buyer.store.load(CODE))?.paidSeen).toBe(true);
  });

  it('re-verify R1: "secured seen" is latched in the record; a later view cannot un-secure the trade to drop the text', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(async () => buyer.last()?.phase === 'ready' && (await buyer.store.load(CODE))?.theirDeal != null);
    t.state.view = tradeView({ state: 'securing', paymentInstructions: null });
    await t.parties.ticks('buyer', 2);
    expect((await buyer.store.load(CODE))?.securedSeen ?? false).toBe(false);
    t.state.view = tradeView({ state: 'securing', securedAt: '2026-10-23T12:00:00.000Z' });
    await until(async () => (await buyer.store.load(CODE))?.securedSeen === true);
    // The API now says securing again, with no securedAt and no text, or a post-secure state not in the list.
    for (const state of ['securing', 'disputed', 'lapsed'] as const) {
      t.state.view = tradeView({ state, paymentInstructions: null });
      await until(() => buyer.last()?.instructionsMismatch === true && buyer.last()?.refusal === 'view-mismatch');
      t.state.view = tradeView({ state: 'secured', paymentInstructions: INSTRUCTIONS });
      await until(() => buyer.last()?.instructionsMismatch === false && buyer.last()?.paymentInstructions === INSTRUCTIONS);
    }
    // A fresh run on the same record keeps the latch.
    await buyer.runtime.stop(CODE);
    t.state.view = tradeView({ state: 'securing', paymentInstructions: null });
    const again = await t.mk('buyer', { idb: buyer.idb });
    await again.runtime.start(CODE);
    await until(() => again.last()?.instructionsMismatch === true);
  });

  it('re-verify R2: the hash cache keeps at most two texts, and a hit never stands in for another text', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(async () => buyer.last()?.phase === 'ready' && (await buyer.store.load(CODE))?.theirDeal != null);
    // Only the buyer's runtime hashes from here on (the spy counts every runtime in this process).
    await seller.runtime.stop(CODE);
    const hashed: string[] = [];
    const real = globalThis.crypto.subtle.digest.bind(globalThis.crypto.subtle);
    const spy = vi.spyOn(globalThis.crypto.subtle, 'digest').mockImplementation(async (alg, data) => {
      hashed.push(new TextDecoder().decode(data as Uint8Array));
      return real(alg, data);
    });
    try {
      const show = async (text: string) => {
        t.state.view = tradeView({ state: 'secured', paymentInstructions: text });
        const good = text === INSTRUCTIONS;
        await until(() => buyer.last()?.instructionsMismatch === !good && buyer.last()?.paymentInstructions === (good ? INSTRUCTIONS : null));
      };
      const junk = (i: number) => `junk ${i} ${'x'.repeat(500)}`;
      await show(INSTRUCTIONS);
      for (let i = 0; i < 40; i++) {
        await show(junk(i));
        await until(() => hashed.includes(junk(i)));
      }
      const before = hashed.filter((h) => h === INSTRUCTIONS).length;
      // Evicted after the junk: hashed once more, then cached again (two texts alternating stay cached).
      await show(INSTRUCTIONS);
      expect(hashed.filter((h) => h === INSTRUCTIONS).length).toBe(before + 1);
      await show(junk(39));
      await show(INSTRUCTIONS);
      await show(junk(39));
      expect(hashed.filter((h) => h === INSTRUCTIONS).length).toBe(before + 1);
      // A near copy is never answered by the cached attested text.
      await show(`${INSTRUCTIONS} `);
    } finally {
      spy.mockRestore();
    }
  });

  it('a lying API can tell one side other instructions: only that side refuses and shows nothing', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(async () => buyer.last()?.phase === 'ready' && (await buyer.store.load(CODE))?.theirDeal != null);
    t.state.view = tradeView({ state: 'secured', paymentInstructions: INSTRUCTIONS });
    t.state.roleView = { buyer: { paymentInstructions: 'Zelle to thief@example.test' } };
    await until(() => buyer.last()?.instructionsMismatch === true);
    expect(buyer.last()).toMatchObject({ refusal: 'view-mismatch', paymentInstructions: null });
    expect(await seller.status((s) => s.paymentInstructions === INSTRUCTIONS)).toMatchObject({ instructionsMismatch: false });
  });

  it('a view whose method differs from the attested one: deal-mismatch at start, view-mismatch mid-trade (instructions never shown)', async () => {
    const start = await setup({ view: tradeView({ methodId: 'PAYPAL' }) });
    const b0 = await start.mk('buyer');
    await b0.runtime.start(CODE);
    // The buyer registers, then the attestation (method ZELLE) disagrees with the view (PAYPAL).
    const s0 = await start.mk('seller');
    await s0.runtime.start(CODE);
    expect(await b0.status((s) => s.phase === 'error')).toMatchObject({ error: 'deal-mismatch' });
    expect(start.parties.calls.filter((c) => c.role === 'buyer')).toEqual([]);
    await b0.runtime.stopAll();
    await s0.runtime.stopAll();
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(async () => buyer.last()?.phase === 'ready' && (await buyer.store.load(CODE))?.theirDeal != null);
    t.parties.funds = funded();
    for (const methodId of ['PAYPAL', undefined]) {
      t.state.view = tradeView({ state: 'secured', paymentInstructions: INSTRUCTIONS, methodId });
      await until(() => buyer.last()?.refusal === 'view-mismatch');
      expect(buyer.last()).toMatchObject({ paymentInstructions: null, instructionsMismatch: true });
      await t.parties.ticks('buyer', 3);
      expect(t.parties.settles).toEqual([]);
    }
  });

  it('an offer that gave no instructions: the attested empty text is shown as empty, any other text is refused', async () => {
    const empty = await instructionsSha256('');
    const t = await setup({ tamper: (a) => ({ ...a, terms: { ...a.terms!, deal: { ...a.terms!.deal, instructionsSha256: empty } } }) });
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(async () => buyer.last()?.phase === 'ready' && (await buyer.store.load(CODE))?.theirDeal != null);
    t.state.view = tradeView({ state: 'secured', paymentInstructions: '' });
    expect(await buyer.status((s) => s.paymentInstructions === '')).toMatchObject({ refusal: null, instructionsMismatch: false });
    t.state.view = tradeView({ state: 'secured', paymentInstructions: INSTRUCTIONS });
    await until(() => buyer.last()?.instructionsMismatch === true);
    expect(buyer.last()).toMatchObject({ refusal: 'view-mismatch', paymentInstructions: null });
  });

  it('a view that turns into another poster mid-trade: view-mismatch shown and nothing is settled', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(async () => buyer.last()?.phase === 'ready' && (await buyer.store.load(CODE))?.theirDeal != null);
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', poster: 'buyer' });
    await until(() => buyer.last()?.refusal === 'view-mismatch' && seller.last()?.refusal === 'view-mismatch');
    await seller.runtime.act(CODE, { type: 'release' }); // the tap is recorded; nothing is signed while the view disagrees
    await Promise.all([t.parties.ticks('seller', 3), t.parties.ticks('buyer', 3)]);
    expect(t.parties.settles).toEqual([]);
    expect((await seller.store.load(CODE))?.failed ?? null).toBeNull();
  });
});

describe('a verified trade', () => {
  it('registers with a proof, runs the party with the attested participants, and both devices show the same check words', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(() => buyer.last()?.phase === 'ready' && seller.last()?.phase === 'ready');
    const words = buyer.last()!.checkWords!;
    expect(words).toHaveLength(4);
    expect(seller.last()!.checkWords).toEqual(words);

    const escrow = await channelFor(CODE, 'escrow');
    expect(t.parties.calls.map((c) => c.role).sort()).toEqual(['buyer', 'seller']);
    for (const c of t.parties.calls) {
      expect(c.args.trade).toBe(escrow);
      expect(c.args.participants.buyer.signPublic).toBe(t.state.identities.buyer!.signPublic);
      expect(c.args.participants.seller.signPublic).toBe(t.state.identities.seller!.signPublic);
      expect(c.args.password).toMatch(/^[0-9a-f]{64}$/); // R27
    }
    expect(t.parties.calls[0]!.args.password).not.toBe(t.parties.calls[1]!.args.password);
    // The identity proof verifies, and only public keys reached the API.
    for (const body of Object.values(t.state.identities)) expect(Object.keys(body!).sort()).toEqual(['boxPublic', 'proof', 'signPublic']);
    // Both sides' signed terms arrived.
    await until(async () => (await buyer.store.load(CODE))?.theirAddress === ADDR.seller && (await seller.store.load(CODE))?.theirAddress === ADDR.buyer);
    void ESCROW_ADDRESS;
  });

  it('reports the derived escrow address, the stored deal and its own funds() readings (Task 22 funding facts)', async () => {
    const t = await setup();
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(() => seller.last()?.phase === 'ready');
    expect(seller.last()).toMatchObject({ escrowAddress: ESCROW_ADDRESS, deal: confirmedFor('seller').deal });
    // receivedAtomic is the balance as read; confirmedAtomic sums only incoming with 1+ confirmations.
    t.parties.funds = {
      balance: 30n,
      unlocked: 0n,
      incoming: [
        { txHash: 'a', amountAtomic: 10n, confirmations: 0, unlocked: false },
        { txHash: 'b', amountAtomic: 20n, confirmations: 1, unlocked: false },
      ],
    };
    await seller.status((s) => s.receivedAtomic === 30n);
    expect(seller.last()).toMatchObject({ receivedAtomic: 30n, confirmedAtomic: 20n });
    // After a settlement the balance falls, while the confirmed arrivals stay counted.
    t.parties.funds = { balance: 0n, unlocked: 0n, incoming: [{ txHash: 'b', amountAtomic: 20n, confirmations: 15, unlocked: true }] };
    await seller.status((s) => s.receivedAtomic === 0n);
    expect(seller.last()).toMatchObject({ receivedAtomic: 0n, confirmedAtomic: 20n });
  });

  it('check words differ when one key differs', async () => {
    const { escrowCheckWords } = await import('@x2f/trade');
    const [a, b, c] = await Promise.all([testIdentity(), testIdentity(), testIdentity()]);
    const p = { buyer: a, seller: b, mod: c };
    const w1 = await escrowCheckWords(p, ESCROW_ADDRESS);
    expect(await escrowCheckWords(p, ESCROW_ADDRESS)).toEqual(w1);
    expect(await escrowCheckWords({ ...p, mod: a }, ESCROW_ADDRESS)).not.toEqual(w1);
    expect(await escrowCheckWords(p, `${ESCROW_ADDRESS}x`)).not.toEqual(w1);
  });
});

describe('settling', () => {
  async function ready(over: Partial<ApiState> = {}) {
    const t = await setup(over);
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    await until(() => buyer.last()?.phase === 'ready' && seller.last()?.phase === 'ready');
    await until(async () => (await buyer.store.load(CODE))?.theirDeal != null && (await seller.store.load(CODE))?.theirDeal != null);
    return { ...t, buyer, seller };
  }

  it('release: the seller builds, the buyer co-signs, each through cosignPolicy', async () => {
    const t = await ready();
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    await pay(t.buyer);
    await t.seller.runtime.act(CODE, { type: 'release' });
    await until(() => t.parties.settles.length === 2);
    const [s, b] = [t.parties.settles.find((x) => x.role === 'seller')!, t.parties.settles.find((x) => x.role === 'buyer')!];
    expect(s.o).toEqual(b.o);
    expect(s.o).toMatchObject({ builder: 'seller', cosigner: 'buyer' });
    expect(s.o.to).toEqual([
      { address: ADDR.buyer, amountAtomic: AMOUNT },
      { address: FEE_WALLET, amountAtomic: 12_500_000_000n },
    ]);
    expect(t.seller.last()?.phase).toBe('signing');
    expect(t.seller.last()?.keepOpen).toBe(true);
    for (const p of t.parties.pending) p.resolve(p.role === 'buyer' ? 'txhash' : null);
    await until(() => t.seller.last()?.phase === 'done' && t.buyer.last()?.phase === 'done');
    void cosignPolicy;
  });

  it('a TradeView whose amount is one atomic unit bigger, or whose poster is swapped, settles nothing', async () => {
    for (const lie of [{ amountAtomic: (AMOUNT + 1n).toString() }, { poster: 'buyer' }]) {
      const t = await ready();
      t.parties.funds = funded();
      t.state.view = tradeView({ state: 'paid', ...lie });
      await t.seller.runtime.act(CODE, { type: 'release' });
      await Promise.all([t.parties.ticks('seller'), t.parties.ticks('buyer')]);
      expect(t.parties.settles).toEqual([]);
      // No signed paid amount: the seller has nothing it may release (amount-unknown).
      if ('amountAtomic' in lie) expect(t.seller.last()?.refusal).toBe('amount-unknown');
      await t.buyer.runtime.stopAll();
      await t.seller.runtime.stopAll();
    }
  });

  it('a late surplus before signing: both sides re-derive and settle again, the surplus to the seller', async () => {
    const t = await ready();
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    await pay(t.buyer);
    await t.seller.runtime.act(CODE, { type: 'release' });
    await until(() => t.parties.settles.length === 2);
    t.parties.funds = funded('seller', 100_000_000n);
    await until(() => t.parties.settles.length === 4);
    for (const s of t.parties.settles.slice(2)) expect(s.o.to.at(-1)).toEqual({ address: ADDR.seller, amountAtomic: 100_000_000n });
  });

  describe('security: the amount is fixed at "I’ve paid" (the buyer’s own tap; the seller from the signed trade.paid)', () => {
    const grown = 1_300_000_000_000n;
    const middle = 1_280_000_000_000n;
    const fundsFor = (a: bigint) => a + a / 100n;
    const paidAt = '2026-10-23T12:30:00.000Z';
    async function paidAtMiddle() {
      const t = await ready();
      t.state.view = tradeView({ state: 'securing' });
      t.parties.funds = { balance: fundsFor(grown), unlocked: fundsFor(grown), incoming: [] };
      await until(async () => (await t.seller.store.load(CODE))?.sizeAtomic === grown && (await t.buyer.store.load(CODE))?.sizeAtomic === grown);
      // Growth stopped at a starter cap: the API shows `middle`; the buyer confirms and pays that total.
      t.state.view = tradeView({ state: 'secured', amountAtomic: middle.toString() });
      await t.buyer.runtime.act(CODE, { type: 'paid', fiatCents: fiatOf(middle) });
      expect((await t.buyer.store.load(CODE))?.acceptedAtomic).toBe(middle);
      await until(async () => (await t.seller.store.load(CODE))?.acceptedAtomic === middle);
      return t;
    }

    it.each([
      ['lowers the amount (still above the take amount)', AMOUNT],
      ['raises the amount (still within the device-grown amount)', grown],
    ])('the API %s after paid: no signature on either side, refusal amount-changed', async (_n, lie) => {
      const t = await paidAtMiddle();
      t.state.view = tradeView({ state: 'paid', paidAt, amountAtomic: lie.toString() });
      expect(await t.buyer.status((x) => x.refusal === 'amount-changed')).toMatchObject({ error: null });
      expect(await t.seller.status((x) => x.refusal === 'amount-changed')).toMatchObject({ error: null });
      await t.seller.runtime.act(CODE, { type: 'release' }).catch(() => undefined);
      await Promise.all([t.parties.ticks('seller', 3), t.parties.ticks('buyer', 3)]);
      // Only the amount the buyer paid for was ever handed to a party (the buyer's standing co-sign).
      const paysOnly = (amount: bigint) => t.parties.settles.every((x) => x.o.to[0]!.amountAtomic === amount);
      expect(paysOnly(middle)).toBe(true);
      expect(t.parties.settles.some((x) => x.role === 'seller')).toBe(false);
      // The amount the buyer paid for comes back: both settle exactly that.
      t.state.view = tradeView({ state: 'paid', paidAt, amountAtomic: middle.toString() });
      await until(() => t.parties.settles.some((x) => x.role === 'seller'));
      expect(paysOnly(middle)).toBe(true);
    });

    it('the fixed amount survives a reload', async () => {
      const t = await paidAtMiddle();
      await t.buyer.runtime.stopAll();
      const again = await t.mk('buyer', { idb: t.buyer.idb });
      t.state.view = tradeView({ state: 'paid', paidAt, amountAtomic: AMOUNT.toString() });
      await again.runtime.resumeAll();
      expect(await again.status((x) => x.refusal === 'amount-changed')).toMatchObject({ error: null });
      await t.parties.ticks('buyer', 3);
      expect(t.parties.settles.every((x) => x.o.to[0]!.amountAtomic === middle)).toBe(true);
    });

    it('"I’ve paid" with a fiat total other than the amount the device accepts is refused and fixes nothing', async () => {
      const t = await ready();
      t.parties.funds = funded();
      t.state.view = tradeView({ state: 'secured' });
      await expect(t.buyer.runtime.act(CODE, { type: 'paid', fiatCents: fiatOf(AMOUNT) + 1n })).rejects.toThrow();
      const rec = (await t.buyer.store.load(CODE))!;
      expect(rec.acceptedAtomic ?? null).toBeNull();
      expect(rec.paidSeen).toBe(false);
      await t.parties.ticks('seller', 3);
      expect((await t.seller.store.load(CODE))?.paidSeen).toBe(false); // no trade.paid reached the seller
      // The old way of saying paid, without a total, is refused too.
      await expect(t.buyer.runtime.act(CODE, { type: 'signal', signal: 'trade.paid' } as never)).rejects.toThrow();
      expect((await t.buyer.store.load(CODE))?.paidSeen).toBe(false);
    });

    it.each([
      ['another maximum', { maxFiatCents: '90000' }],
      ['another poster', { poster: 'buyer' }],
    ])('"I’ve paid" while the API view disagrees with the deal (%s; the total still agrees) is refused and fixes nothing (Task 23 round 2, I1)', async (_n, drift) => {
      const t = await ready();
      t.parties.funds = funded();
      t.state.view = tradeView({ state: 'secured', ...drift });
      expect(await t.buyer.status((s) => s.refusal === 'view-mismatch')).toMatchObject({ error: null });
      await expect(t.buyer.runtime.act(CODE, { type: 'paid', fiatCents: fiatOf(AMOUNT) })).rejects.toThrow(/view/);
      const rec = (await t.buyer.store.load(CODE))!;
      expect(rec.acceptedAtomic ?? null).toBeNull();
      expect(rec.paidSeen).toBe(false);
      await t.parties.ticks('seller', 3);
      expect((await t.seller.store.load(CODE))?.paidSeen).toBe(false); // no trade.paid reached the seller
      // The view is right again: the same tap goes through.
      t.state.view = tradeView({ state: 'secured' });
      await t.buyer.runtime.act(CODE, { type: 'paid', fiatCents: fiatOf(AMOUNT) });
      expect((await t.buyer.store.load(CODE))?.acceptedAtomic).toBe(AMOUNT);
    });

    it('the amount the buyer confirmed is fixed by the tap itself, even if the API moves it right after', async () => {
      const t = await ready();
      t.state.view = tradeView({ state: 'securing' });
      t.parties.funds = { balance: fundsFor(grown), unlocked: fundsFor(grown), incoming: [] };
      await until(async () => (await t.buyer.store.load(CODE))?.sizeAtomic === grown);
      // The tap's own read shows `middle`; every later read shows the grown amount.
      let reads = 0;
      const atTap = tradeView({ state: 'secured', amountAtomic: middle.toString() });
      const later = tradeView({ state: 'secured', amountAtomic: grown.toString() });
      Object.defineProperty(t.state, 'view', { configurable: true, get: () => (reads++ === 0 ? atTap : later) });
      await t.buyer.runtime.act(CODE, { type: 'paid', fiatCents: fiatOf(middle) });
      expect((await t.buyer.store.load(CODE))?.acceptedAtomic).toBe(middle);
      expect(await t.buyer.status((x) => x.refusal === 'amount-changed')).toBeTruthy();
    });

    it('a hand-over before paid fixes nothing: growth still works and a buyer cancel still settles', async () => {
      const t = await ready();
      t.parties.funds = funded();
      t.state.view = tradeView({ state: 'secured' });
      await until(() => t.parties.settles.some((x) => x.role === 'buyer')); // the standing co-sign
      expect((await t.buyer.store.load(CODE))?.acceptedAtomic ?? null).toBeNull();
      t.parties.funds = { balance: fundsFor(grown), unlocked: fundsFor(grown), incoming: [] };
      await until(async () => (await t.buyer.store.load(CODE))?.sizeAtomic === grown);
      await t.buyer.runtime.act(CODE, { type: 'buyer-cancel' });
      await until(() => t.parties.settles.some((x) => x.role === 'buyer' && x.o.cosigner === 'mod'));
      expect(t.parties.settles.find((x) => x.o.cosigner === 'mod')!.o.to).toEqual([{ address: ADDR.seller, amountAtomic: fundsFor(grown) }]);
    });

    it("after paid, no buyer cancel at all, whatever the API's amount (no cancel after I've paid, Task 39 review I2)", async () => {
      const t = await paidAtMiddle();
      t.state.view = tradeView({ state: 'paid', paidAt, amountAtomic: AMOUNT.toString() });
      expect(await t.buyer.status((x) => x.refusal === 'amount-changed')).toBeTruthy();
      await expect(t.buyer.runtime.act(CODE, { type: 'buyer-cancel' })).rejects.toThrow();
      await t.parties.ticks('buyer', 3);
      expect(t.parties.settles.filter((x) => x.o.cosigner === 'mod')).toEqual([]);
    });

    it('a buyer cancel tapped before paying is dropped by I\'ve paid and never signed in paid (Task 39 review I2)', async () => {
      const t = await ready();
      t.state.view = tradeView({ state: 'securing' });
      t.parties.funds = { balance: fundsFor(AMOUNT), unlocked: 0n, incoming: [] };
      // Tapped while securing (the coins are not unlocked: nothing can be signed yet).
      await t.buyer.runtime.act(CODE, { type: 'buyer-cancel' });
      expect((await t.buyer.store.load(CODE))?.intent).toMatchObject({ kind: 'buyer-cancel', auto: false });
      // The signing window lapsed back to secured, and the buyer paid.
      t.state.view = tradeView({ state: 'secured', amountAtomic: AMOUNT.toString() });
      await t.buyer.runtime.act(CODE, { type: 'paid', fiatCents: fiatOf(AMOUNT) });
      expect((await t.buyer.store.load(CODE))?.intent?.kind).not.toBe('buyer-cancel');
      t.state.view = tradeView({ state: 'paid', paidAt, amountAtomic: AMOUNT.toString() });
      t.parties.funds = { balance: fundsFor(AMOUNT), unlocked: fundsFor(AMOUNT), incoming: [] };
      await t.parties.ticks('buyer', 3);
      expect(t.parties.settles.filter((x) => x.o.builder === 'buyer' && x.o.cosigner === 'mod')).toEqual([]);
    });

    it('the seller fixes the amount from the buyer’s signed trade.paid, never from its own API view', async () => {
      const t = await paidAtMiddle();
      // The API shows only the seller another amount (in range for the seller).
      t.state.roleView = { seller: { amountAtomic: grown.toString() } };
      t.state.view = tradeView({ state: 'paid', paidAt, amountAtomic: middle.toString() });
      expect(await t.seller.status((x) => x.refusal === 'amount-changed')).toMatchObject({ error: null });
      await t.seller.runtime.act(CODE, { type: 'release' }).catch(() => undefined);
      await t.parties.ticks('seller', 3);
      expect(t.parties.settles.filter((x) => x.role === 'seller')).toEqual([]);
      expect((await t.seller.store.load(CODE))?.acceptedAtomic).toBe(middle);
    });

    it('a seller that sees paid in its API view first fixes nothing until the buyer’s signed amount arrives', async () => {
      const t = await ready();
      t.state.view = tradeView({ state: 'securing' });
      t.parties.funds = { balance: fundsFor(grown), unlocked: fundsFor(grown), incoming: [] };
      await until(async () => (await t.seller.store.load(CODE))?.sizeAtomic === grown && (await t.buyer.store.load(CODE))?.sizeAtomic === grown);
      // The API tells the seller "paid" at the grown amount before the buyer has tapped.
      t.state.view = tradeView({ state: 'secured', amountAtomic: middle.toString() });
      t.state.roleView = { seller: { state: 'paid', paidAt, amountAtomic: grown.toString() } };
      await until(async () => (await t.seller.store.load(CODE))?.paidSeen === true);
      await t.parties.ticks('seller', 2);
      expect((await t.seller.store.load(CODE))?.acceptedAtomic ?? null).toBeNull();
      // The buyer confirms `middle`: that signed amount is what the seller fixes.
      await t.buyer.runtime.act(CODE, { type: 'paid', fiatCents: fiatOf(middle) });
      await until(async () => (await t.seller.store.load(CODE))?.acceptedAtomic === middle);
      expect((await t.seller.store.load(CODE))?.paidRefused ?? false).toBe(false);
    });

    it('a buyer that knows of paid only from the API (no tap of its own) co-signs no release: amount-unknown', async () => {
      const t = await ready();
      t.parties.funds = funded();
      t.state.view = tradeView({ state: 'paid', paidAt });
      await t.seller.runtime.act(CODE, { type: 'release' });
      expect(await t.buyer.status((x) => x.refusal === 'amount-unknown')).toMatchObject({ error: null });
      await Promise.all([t.parties.ticks('buyer', 3), t.parties.ticks('seller', 2)]);
      expect(t.parties.settles.filter((x) => x.role === 'buyer')).toEqual([]);
      // Its own tap fixes the amount and the co-sign follows.
      await pay(t.buyer);
      await until(() => t.parties.settles.some((x) => x.role === 'buyer'));
    });

    it('paidRecorded: false while the buyer knows of paid only from the API, true once its own tap fixed the amount (Task 23 review I2, I3)', async () => {
      const t = await ready();
      t.parties.funds = funded();
      t.state.view = tradeView({ state: 'secured' });
      expect(await t.buyer.status((x) => x.phase === 'ready')).toMatchObject({ paidRecorded: false });
      t.state.view = tradeView({ state: 'paid', paidAt });
      expect(await t.buyer.status((x) => x.refusal === 'amount-unknown')).toMatchObject({ paidRecorded: false });
      await pay(t.buyer);
      expect(await t.buyer.status((x) => x.paidRecorded)).toMatchObject({ refusal: null, error: null });
      // The seller never reports it.
      expect(await t.seller.status(() => true)).toMatchObject({ paidRecorded: false });
    });

    it('a release handed over before paid binds its amount: another amount is refused at the tap and for any release', async () => {
      const t = await ready();
      t.parties.funds = funded();
      t.state.view = tradeView({ state: 'secured' });
      await until(() => t.parties.settles.some((x) => x.role === 'buyer')); // the standing co-sign, at AMOUNT
      await until(async () => (await t.buyer.store.load(CODE))?.releaseBoundAtomic === AMOUNT);
      // Extra coins grow the trade and the API follows; the bound release does not move.
      t.parties.funds = { balance: fundsFor(grown), unlocked: fundsFor(grown), incoming: [] };
      t.state.view = tradeView({ state: 'secured', amountAtomic: grown.toString() });
      expect(await t.buyer.status((x) => x.refusal === 'amount-changed')).toMatchObject({ error: null });
      await t.parties.ticks('buyer', 3);
      expect(t.parties.settles.filter((x) => x.role === 'buyer').every((x) => x.o.to[0]!.amountAtomic === AMOUNT)).toBe(true);
      await expect(pay(t.buyer, grown)).rejects.toThrow();
      expect((await t.buyer.store.load(CODE))?.paidSeen).toBe(false);
      // The binding survives a reload.
      await t.buyer.runtime.stopAll();
      const again = await t.mk('buyer', { idb: t.buyer.idb });
      await again.runtime.resumeAll();
      expect(await again.status((x) => x.refusal === 'amount-changed')).toMatchObject({ error: null });
      await expect(again.runtime.act(CODE, { type: 'paid', fiatCents: fiatOf(grown) })).rejects.toThrow();
      t.buyer = again;
      // A refund is not bound: the buyer can still cancel, paying the whole balance to the seller.
      await t.buyer.runtime.act(CODE, { type: 'buyer-cancel' });
      await until(() => t.parties.settles.some((x) => x.role === 'buyer' && x.o.cosigner === 'mod'));
      expect(t.parties.settles.find((x) => x.o.cosigner === 'mod')!.o.to).toEqual([{ address: ADDR.seller, amountAtomic: fundsFor(grown) }]);
    });

    it('Plan 4 Task 12 (B1): a grown trade\'s ruling payment is the amount this seller fixed at paid, never the take amount; a view naming another amount changes nothing', async () => {
      const t = await paidAtMiddle();
      expect(await t.seller.status((x) => x.restitution?.amountAtomic === middle)).toMatchObject({ restitution: { address: ADDR.buyer, amountAtomic: middle } });
      for (const lie of [AMOUNT, grown, grown * 2n]) {
        t.state.view = tradeView({ state: 'paid', paidAt, amountAtomic: lie.toString() });
        await t.parties.ticks('seller', 2);
        expect(t.seller.last()?.restitution).toEqual({ address: ADDR.buyer, amountAtomic: middle });
      }
    });

    it('Plan 4 Task 12 (B1): a seller funded above the take amount, nothing fixed yet: the ruling payment is the grown amount (the API amount within [take, own size]); above its own size, no amount (no form)', async () => {
      const t = await ready();
      t.state.view = tradeView({ state: 'securing' });
      t.parties.funds = { balance: fundsFor(grown), unlocked: fundsFor(grown), incoming: [] };
      await until(async () => (await t.seller.store.load(CODE))?.sizeAtomic === grown);
      t.state.view = tradeView({ state: 'secured', amountAtomic: grown.toString() });
      expect(await t.seller.status((x) => x.restitution?.amountAtomic === grown)).toMatchObject({ restitution: { address: ADDR.buyer, amountAtomic: grown } });
      expect(t.seller.last()?.restitution?.amountAtomic).not.toBe(AMOUNT);
      // An API amount above what this device's own escrow funds grew to: no amount, so no form.
      t.state.view = tradeView({ state: 'secured', amountAtomic: (grown + 1n).toString() });
      expect(await t.seller.status((x) => x.restitution === null)).toMatchObject({ restitution: null });
    });

    it('I3 status: amountAtomic and fiatCents are the sum this device will accept: the API amount in range, the bound one once a release was handed over (even when the API grows it), the fixed one after paid', async () => {
      const t = await ready();
      expect(await t.buyer.status((x) => x.phase === 'ready')).toMatchObject({ amountAtomic: AMOUNT, fiatCents: fiatOf(AMOUNT) }); // the API amount, in range
      // The API shows an amount above this device's own size: nothing this device accepts (and nothing to show as the sum).
      t.state.view = tradeView({ state: 'securing', amountAtomic: grown.toString() });
      expect(await t.buyer.status((x) => x.amountAtomic === null)).toMatchObject({ fiatCents: null });
      // Secured at the take amount: the standing co-sign binds the release to it.
      t.parties.funds = funded();
      t.state.view = tradeView({ state: 'secured' });
      await until(async () => (await t.buyer.store.load(CODE))?.releaseBoundAtomic === AMOUNT);
      // Extra coins grow the trade and the API follows: the status keeps the bound amount, the only one the device will release for.
      t.parties.funds = { balance: fundsFor(grown), unlocked: fundsFor(grown), incoming: [] };
      t.state.view = tradeView({ state: 'secured', amountAtomic: grown.toString() });
      expect(await t.buyer.status((x) => x.refusal === 'amount-changed')).toMatchObject({ amountAtomic: AMOUNT, fiatCents: fiatOf(AMOUNT) });
      await expect(pay(t.buyer, grown)).rejects.toThrow(); // the page never offered the grown sum
      // The seller has fixed nothing yet: its status follows the API amount within its own range.
      await until(async () => (await t.seller.store.load(CODE))?.sizeAtomic === grown);
      expect(await t.seller.status((x) => x.amountAtomic === grown)).toMatchObject({ fiatCents: fiatOf(grown) });
      // The API shows the take amount again and the buyer pays it: both sides now carry the fixed amount.
      t.state.view = tradeView({ state: 'secured' });
      await pay(t.buyer);
      expect(await t.buyer.status((x) => x.refusal === null)).toMatchObject({ amountAtomic: AMOUNT, fiatCents: fiatOf(AMOUNT) });
      await until(async () => (await t.seller.store.load(CODE))?.acceptedAtomic === AMOUNT);
      expect(await t.seller.status((x) => x.amountAtomic === AMOUNT)).toMatchObject({ fiatCents: fiatOf(AMOUNT) });
    });

    it('I1: a release bound at its first hand-over stays bound when the API flips secured, lapsed, secured with a lower amount', async () => {
      const t = await ready();
      t.state.view = tradeView({ state: 'securing' });
      t.parties.funds = { balance: fundsFor(grown), unlocked: fundsFor(grown), incoming: [] };
      await until(async () => (await t.buyer.store.load(CODE))?.sizeAtomic === grown);
      t.state.view = tradeView({ state: 'secured', amountAtomic: grown.toString() });
      await until(() => t.parties.settles.some((x) => x.role === 'buyer')); // the standing co-sign at `grown`
      await until(async () => (await t.buyer.store.load(CODE))?.releaseBoundAtomic === grown);
      // The API flips the trade away from a release and back, now with a lower amount in range.
      t.state.view = tradeView({ state: 'lapsed', amountAtomic: grown.toString() });
      await until(async () => (await t.buyer.store.load(CODE))?.intent?.kind === 'lapse-refund');
      t.state.view = tradeView({ state: 'secured', amountAtomic: AMOUNT.toString() });
      expect(await t.buyer.status((x) => x.refusal === 'amount-changed')).toMatchObject({ error: null });
      await t.parties.ticks('buyer', 3);
      expect(t.parties.settles.filter((x) => x.role === 'buyer' && x.o.builder === 'seller').every((x) => x.o.to[0]!.amountAtomic === grown)).toBe(true);
      await expect(pay(t.buyer, AMOUNT)).rejects.toThrow();
      expect((await t.buyer.store.load(CODE))?.releaseBoundAtomic).toBe(grown);
    });

    it('I2: a seller whose wallet saw the extra coins only after the signed paid amount fixes it once its own size catches up', async () => {
      const t = await ready();
      const lockedForSeller: Funds = { balance: fundsFor(grown), unlocked: escrowPlan({ amountAtomic: AMOUNT, poster: 'seller' }).sellerFundsAtomic, incoming: [] };
      t.parties.fundsFor = { seller: lockedForSeller }; // the seller's wallet has not seen 10 confirmations yet
      t.parties.funds = { balance: fundsFor(grown), unlocked: fundsFor(grown), incoming: [] };
      t.state.view = tradeView({ state: 'securing' });
      await until(async () => (await t.buyer.store.load(CODE))?.sizeAtomic === grown);
      t.state.view = tradeView({ state: 'secured', amountAtomic: grown.toString() });
      await pay(t.buyer, grown);
      t.state.view = tradeView({ state: 'paid', paidAt, amountAtomic: grown.toString() });
      expect(await t.seller.status((x) => x.refusal === 'paid-amount-waiting')).toMatchObject({ error: null });
      expect((await t.seller.store.load(CODE))?.paidRefused ?? false).toBe(false);
      // The seller's wallet catches up: it grows, fixes the signed amount, and can release.
      t.parties.fundsFor = {};
      await until(async () => (await t.seller.store.load(CODE))?.acceptedAtomic === grown);
      await t.seller.runtime.act(CODE, { type: 'release' });
      await until(() => t.parties.settles.some((x) => x.role === 'seller'));
      expect(t.parties.settles.find((x) => x.role === 'seller')!.o.to[0]).toEqual({ address: ADDR.buyer, amountAtomic: grown });
    });

    it('I2: a second, different signed trade.paid is refused for good (first one wins)', async () => {
      const t = await paidAtMiddle();
      await injectPaid(t, { amountAtomic: grown, fiatCents: fiatOf(grown) });
      expect(await t.seller.status((x) => x.refusal === 'paid-amount-refused')).toMatchObject({ error: null });
      await t.seller.runtime.act(CODE, { type: 'release' }).catch(() => undefined);
      await t.parties.ticks('seller', 3);
      expect(t.parties.settles.filter((x) => x.role === 'seller')).toEqual([]);
    });

    it('a seller with no paid at all releases nothing, even in secured with an amount in range: amount-unknown', async () => {
      const t = await ready();
      t.parties.funds = funded();
      t.state.view = tradeView({ state: 'secured' });
      await t.seller.runtime.act(CODE, { type: 'release' });
      expect(await t.seller.status((x) => x.refusal === 'amount-unknown')).toMatchObject({ error: null });
      await t.parties.ticks('seller', 3);
      expect(t.parties.settles.filter((x) => x.role === 'seller')).toEqual([]);
    });

    it('a buyer before paid co-signs nothing above its own size: amount-out-of-range', async () => {
      const t = await ready();
      t.parties.funds = funded();
      t.state.view = tradeView({ state: 'secured', amountAtomic: (AMOUNT + 1n).toString() });
      expect(await t.buyer.status((x) => x.refusal === 'amount-out-of-range')).toMatchObject({ error: null });
      await t.parties.ticks('buyer', 3);
      expect(t.parties.settles.filter((x) => x.role === 'buyer')).toEqual([]);
    });

    it('the seller signs no release without the buyer’s signed amount, even when its API view says paid: amount-unknown', async () => {
      const t = await ready();
      t.parties.funds = funded();
      t.state.view = tradeView({ state: 'secured' });
      t.state.roleView = { seller: { state: 'paid', paidAt } };
      await t.seller.runtime.act(CODE, { type: 'release' });
      expect(await t.seller.status((x) => x.refusal === 'amount-unknown')).toMatchObject({ error: null });
      await t.parties.ticks('seller', 3);
      expect(t.parties.settles.filter((x) => x.role === 'seller')).toEqual([]);
      // The buyer's signed trade.paid fixes it, and the release follows.
      t.state.roleView = {};
      t.state.view = tradeView({ state: 'paid', paidAt });
      await pay(t.buyer);
      await until(() => t.parties.settles.some((x) => x.role === 'seller'));
    });

    it.each([
      ['a total that does not fit the amount', () => ({ amountAtomic: middle, fiatCents: fiatOf(middle) + 1n })],
      ['an amount below the take amount', () => ({ amountAtomic: AMOUNT - 1n, fiatCents: fiatOf(AMOUNT - 1n) })],
    ])('a signed trade.paid with %s is refused for good and fixes nothing', async (_n, bad) => {
      const t = await ready();
      t.state.view = tradeView({ state: 'securing' });
      t.parties.funds = { balance: fundsFor(grown), unlocked: fundsFor(grown), incoming: [] };
      await until(async () => (await t.seller.store.load(CODE))?.sizeAtomic === grown);
      t.state.view = tradeView({ state: 'secured', amountAtomic: middle.toString() });
      await injectPaid(t, bad());
      expect(await t.seller.status((x) => x.refusal === 'paid-amount-refused')).toMatchObject({ error: null });
      await until(async () => (await t.seller.store.load(CODE))?.paidRefused === true); // that save has landed
      const rec = (await t.seller.store.load(CODE))!;
      expect(rec.acceptedAtomic ?? null).toBeNull();
      expect(rec.paidSeen).toBe(true);
      await t.seller.runtime.act(CODE, { type: 'release' }).catch(() => undefined);
      await t.parties.ticks('seller', 3);
      expect(t.parties.settles.filter((x) => x.role === 'seller')).toEqual([]);
    });

    it('a signed trade.paid above the seller’s own size waits (not refused for good) and fixes nothing yet', async () => {
      const t = await ready();
      t.state.view = tradeView({ state: 'securing' });
      t.parties.funds = { balance: fundsFor(grown), unlocked: fundsFor(grown), incoming: [] };
      await until(async () => (await t.seller.store.load(CODE))?.sizeAtomic === grown);
      t.state.view = tradeView({ state: 'secured', amountAtomic: middle.toString() });
      await injectPaid(t, { amountAtomic: grown + 1n, fiatCents: fiatOf(grown + 1n) });
      expect(await t.seller.status((x) => x.refusal === 'paid-amount-waiting')).toMatchObject({ error: null });
      await until(async () => (await t.seller.store.load(CODE))?.paidPending != null);
      const rec = (await t.seller.store.load(CODE))!;
      expect(rec.acceptedAtomic ?? null).toBeNull();
      expect(rec.paidRefused ?? false).toBe(false);
    });
  });

  describe('growth and starter caps: the API amount is accepted only between the take amount and the device-grown amount', () => {
    const grown = 1_300_000_000_000n;
    const fundsFor = (a: bigint) => a + a / 100n;
    async function grownTrade() {
      const t = await ready();
      // Grown while securing: no standing co-sign yet, so nothing settles before the view below.
      t.state.view = tradeView({ state: 'securing' });
      t.parties.funds = { balance: fundsFor(grown), unlocked: fundsFor(grown), incoming: [] };
      await until(async () => (await t.seller.store.load(CODE))?.sizeAtomic === grown && (await t.buyer.store.load(CODE))?.sizeAtomic === grown);
      return t;
    }
    const paidAt = '2026-10-23T12:30:00.000Z';

    it.each([
      ['the take amount (growth capped at the start)', AMOUNT],
      ['an amount in between (a starter cap)', 1_280_000_000_000n],
      ['the device-grown amount', grown],
    ])('%s: accepted, release pays the buyer that amount and the rest to the seller', async (_n, apiAmount) => {
      const t = await grownTrade();
      t.state.view = tradeView({ state: 'paid', paidAt, amountAtomic: apiAmount.toString() });
      await pay(t.buyer, apiAmount);
      await t.seller.runtime.act(CODE, { type: 'release' });
      await until(() => t.parties.settles.length === 2);
      const [s, b] = [t.parties.settles.find((x) => x.role === 'seller')!, t.parties.settles.find((x) => x.role === 'buyer')!];
      expect(b.o).toEqual(s.o);
      expect(s.o.to[0]).toEqual({ address: ADDR.buyer, amountAtomic: apiAmount });
      expect(s.o.to.reduce((x, p) => x + p.amountAtomic, 0n)).toBe(fundsFor(grown));
      expect(t.seller.last()?.refusal).toBeNull();
    });

    it.each([
      ['one atomic unit above the device-grown amount', grown + 1n],
      ['one atomic unit below the take amount', AMOUNT - 1n],
    ])('%s: refused visibly (status refusal), nothing settled', async (_n, apiAmount) => {
      const t = await grownTrade();
      t.state.view = tradeView({ state: 'paid', paidAt, amountAtomic: apiAmount.toString() });
      await expect(t.seller.runtime.act(CODE, { type: 'release' })).resolves.toBeUndefined();
      // The seller has no signed paid amount (the buyer could not confirm one): amount-unknown.
      expect(await t.seller.status((x) => x.refusal === 'amount-unknown')).toMatchObject({ phase: 'ready', error: null });
      // The buyer cannot confirm paying an amount out of range, and without its own tap it signs no release.
      await expect(pay(t.buyer, apiAmount)).rejects.toThrow();
      expect(await t.buyer.status((x) => x.refusal === 'amount-unknown')).toMatchObject({ error: null });
      await Promise.all([t.parties.ticks('seller'), t.parties.ticks('buyer')]);
      expect(t.parties.settles).toEqual([]);
      // Back in range: the refusal clears, the buyer confirms, and the trade settles.
      t.state.view = tradeView({ state: 'paid', paidAt, amountAtomic: grown.toString() });
      await pay(t.buyer, grown);
      expect(await t.seller.status((x) => x.refusal === null && x.phase === 'signing')).toBeTruthy();
      await until(() => t.parties.settles.length === 2);
    });
  });

  it('buyerCancel sends trade.cancel and settles payoutsFor(buyer-cancel) with builder buyer, cosigner mod', async () => {
    const t = await ready();
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'secured' });
    await until(() => t.parties.settles.some((s) => s.role === 'buyer')); // the standing release co-sign
    const before = t.hub.sent.length;
    await t.buyer.runtime.act(CODE, { type: 'buyer-cancel' });
    await until(() => t.parties.settles.some((s) => s.role === 'buyer' && s.o.cosigner === 'mod'));
    const signals = await channelFor(CODE, 'signals');
    expect(t.hub.sent.slice(before).some((x) => x.channel === signals && x.from === 'buyer')).toBe(true);
    const cancel = t.parties.settles.find((s) => s.o.cosigner === 'mod')!;
    expect(cancel.o).toEqual({ kind: 'release', to: [{ address: ADDR.seller, amountAtomic: funded().balance }], builder: 'buyer', cosigner: 'mod' });
    await expect(t.seller.runtime.act(CODE, { type: 'buyer-cancel' })).rejects.toThrow();
  });

  it('intentKind: null for the automatic choice, the tapped kind once saved, also while the coins are still locked (Task 23 round 2, Minor 1)', async () => {
    const t = await ready();
    t.parties.funds = { ...funded(), unlocked: 0n };
    t.state.view = tradeView({ state: 'secured' });
    await until(async () => (await t.buyer.store.load(CODE))?.intent?.kind === 'release'); // the automatic standing release
    expect(t.buyer.last()?.intentKind).toBeNull();
    await t.buyer.runtime.act(CODE, { type: 'buyer-cancel' });
    t.state.view = tradeView({ state: 'settling', settling: 'buyer-cancel' });
    await t.parties.ticks('buyer', 2);
    expect(await t.buyer.status((s) => s.intentKind === 'buyer-cancel')).toMatchObject({ phase: 'ready', error: null });
    expect(t.parties.settles.some((s) => s.o.cosigner === 'mod')).toBe(false); // nothing built yet: the coins are locked
  });

  it('a buyer who tapped propose-cancel and then paid co-signs the release once the seller releases', async () => {
    const t = await ready();
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'secured', cancelProposedBy: 'buyer' });
    await t.buyer.runtime.act(CODE, { type: 'propose-cancel-sign' });
    expect((await t.buyer.store.load(CODE))?.intent).toMatchObject({ kind: 'mutual-cancel', auto: false });
    // The buyer pays anyway (its proposal stands, Task 2), then the seller releases.
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z', cancelProposedBy: 'buyer' });
    await pay(t.buyer);
    await t.seller.runtime.act(CODE, { type: 'release' });
    t.state.view = tradeView({ state: 'settling', settling: 'release', paidAt: '2026-10-23T12:30:00.000Z', cancelProposedBy: 'buyer' });
    await until(() => t.parties.settles.some((s) => s.role === 'buyer' && s.o.builder === 'seller'));
    const release = t.parties.settles.filter((s) => s.role === 'buyer').at(-1)!;
    expect(release.o).toEqual(t.parties.settles.find((s) => s.role === 'seller')!.o);
    expect(release.o.to[0]).toEqual({ address: ADDR.buyer, amountAtomic: AMOUNT });
    expect((await t.buyer.store.load(CODE))?.intent).toMatchObject({ kind: 'release', auto: true });
  });

  it('a tapped mutual cancel stays while the proposal stands, and falls back once it is withdrawn', async () => {
    const t = await ready();
    t.parties.funds = funded();
    // Before "I've paid" (no cancel after it, Task 39): the buyer has not paid here.
    t.state.view = tradeView({ state: 'secured', cancelProposedBy: 'seller' });
    await t.buyer.runtime.act(CODE, { type: 'propose-cancel-sign' });
    await until(() => t.parties.settles.some((s) => s.role === 'buyer' && s.o.cosigner === 'seller'));
    expect((await t.buyer.store.load(CODE))?.intent).toMatchObject({ kind: 'mutual-cancel', auto: false });
    // The proposal is gone (withdrawn) and the buyer pays: the standing release co-sign comes back.
    t.state.view = tradeView({ state: 'secured', cancelProposedBy: null });
    await pay(t.buyer);
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z', cancelProposedBy: null });
    await until(async () => (await t.buyer.store.load(CODE))?.intent?.kind === 'release');
    await until(() => t.parties.settles.at(-1)?.role === 'buyer' && t.parties.settles.at(-1)?.o.builder === 'seller');
  });

  it('a tap the trade view does not support is refused and changes nothing', async () => {
    const t = await ready();
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    await until(async () => (await t.buyer.store.load(CODE))?.intent?.kind === 'release');
    // No cancel proposed and not settling a mutual cancel: the tap has nothing to sign.
    await expect(t.buyer.runtime.act(CODE, { type: 'propose-cancel-sign' })).rejects.toThrow();
    expect((await t.buyer.store.load(CODE))?.intent).toMatchObject({ kind: 'release', auto: true });
    // The seller's release tap outside secured/paid (here: the seller's own cancel settling) is refused too.
    t.state.view = tradeView({ state: 'settling', settling: 'auto-refund' });
    await expect(t.seller.runtime.act(CODE, { type: 'release' })).rejects.toThrow();
  });

  it('buyerCancel saves its intent before trade.cancel leaves: if the save fails, nothing is sent', async () => {
    const t = await ready();
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'secured' });
    const signals = await channelFor(CODE, 'signals');
    // The buyer's signals frames, read as the seller reads them. A bare frame count is not enough:
    // the buyer's answering trade.terms (sent once it has the seller's) can still be on its way
    // when ready() returns, and the terms are sent again every 5 s until the mod acks them.
    const buyerSignals = async (): Promise<string[]> => {
      const rec = (await t.seller.store.load(CODE))!;
      const { participants } = rec.attestation!.attestation as { participants: Participants };
      const guard = new ReplayGuard(signals);
      const types: string[] = [];
      for (const x of t.hub.sent.filter((y) => y.channel === signals && y.from === 'buyer')) {
        types.push((await open(x.e, { me: rec.identity, myRole: 'seller', participants, trade: signals, guard })).type);
      }
      return types;
    };
    await until(async () => (await buyerSignals()).length >= 2); // its own terms and its answer have left
    expect(await buyerSignals()).not.toContain('trade.cancel');
    // Only a record holding the buyer-cancel intent fails to save; a save with a new signals seq works.
    // That save (made before any signals frame leaves) carries the intent too: if it failed as well, a
    // trade.cancel sent before the intent is saved could never leave and this test would not see it.
    let seq = (await t.buyer.store.load(CODE))!.signalSeq;
    const save = t.buyer.store.save.bind(t.buyer.store);
    t.buyer.store.save = async (r) => {
      if (r.intent?.kind === 'buyer-cancel' && r.signalSeq <= seq) throw new Error('disk full');
      await save(r);
      seq = Math.max(seq, r.signalSeq);
    };
    await expect(t.buyer.runtime.act(CODE, { type: 'buyer-cancel' })).rejects.toThrow();
    await t.parties.ticks('buyer', 2);
    expect(await buyerSignals()).not.toContain('trade.cancel');
  });

  it('a buyer-cancel whose save fails leaves no intent behind: a later save never stores it, and nothing settles on it', async () => {
    const t = await ready();
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'secured' });
    await until(async () => (await t.buyer.store.load(CODE))?.intent?.kind === 'release'); // the automatic standing release
    // Only the first save of the buyer-cancel intent fails; every later save works.
    let failed = false;
    const save = t.buyer.store.save.bind(t.buyer.store);
    t.buyer.store.save = async (r) => {
      if (!failed && r.intent?.kind === 'buyer-cancel') {
        failed = true;
        throw new Error('disk full');
      }
      return save(r);
    };
    const sent = t.hub.sent.length;
    await expect(t.buyer.runtime.act(CODE, { type: 'buyer-cancel' })).rejects.toThrow();
    expect(failed).toBe(true);
    await t.parties.ticks('buyer', 3);
    expect((await t.buyer.store.load(CODE))?.intent).toMatchObject({ kind: 'release', auto: true });
    expect(t.buyer.last()?.intentKind ?? null).toBeNull();
    expect(t.parties.settles.some((s) => s.o.cosigner === 'mod')).toBe(false);
    const signals = await channelFor(CODE, 'signals');
    const rec = (await t.seller.store.load(CODE))!;
    const { participants } = rec.attestation!.attestation as { participants: Participants };
    const guard = new ReplayGuard(signals);
    for (const x of t.hub.sent.slice(sent).filter((y) => y.channel === signals && y.from === 'buyer')) {
      expect((await open(x.e, { me: rec.identity, myRole: 'seller', participants, trade: signals, guard })).type).not.toBe('trade.cancel');
    }
  });

  it('a seller release tap whose save fails leaves no tapped intent behind', async () => {
    const t = await ready();
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    let failed = false;
    const save = t.seller.store.save.bind(t.seller.store);
    t.seller.store.save = async (r) => {
      if (!failed && r.intent?.kind === 'release' && !r.intent.auto) {
        failed = true;
        throw new Error('disk full');
      }
      return save(r);
    };
    await expect(t.seller.runtime.act(CODE, { type: 'release' })).rejects.toThrow();
    expect(failed).toBe(true);
    await t.parties.ticks('seller', 3);
    expect((await t.seller.store.load(CODE))?.intent ?? null).toBeNull();
    expect(t.seller.last()?.intentKind ?? null).toBeNull();
  });

  it('"paid" whose save fails leaves the record as it was: not paid, no fixed amount, the cancel tap kept, no trade.paid', async () => {
    const t = await ready();
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'secured', cancelProposedBy: 'seller' });
    await t.buyer.runtime.act(CODE, { type: 'propose-cancel-sign' });
    let failed = false;
    const save = t.buyer.store.save.bind(t.buyer.store);
    t.buyer.store.save = async (r) => {
      if (!failed && r.paidSeen === true) {
        failed = true;
        throw new Error('disk full');
      }
      return save(r);
    };
    await expect(pay(t.buyer)).rejects.toThrow();
    expect(failed).toBe(true);
    await t.parties.ticks('buyer', 3);
    const rec = (await t.buyer.store.load(CODE))!;
    expect(rec.paidSeen ?? false).toBe(false);
    expect(rec.acceptedAtomic ?? null).toBeNull();
    expect(rec.intent).toMatchObject({ kind: 'mutual-cancel', auto: false });
  });

  it('a save that fails in a tick stops the trade (escrow-failed, retryable) instead of settling with an unsaved bound; retry() runs it again', async () => {
    const t = await ready();
    // Only the save that would store the release binding fails.
    const save = t.buyer.store.save.bind(t.buyer.store);
    t.buyer.store.save = async (r) => {
      if ((r.releaseBoundAtomic ?? null) !== null) throw new Error('disk full');
      return save(r);
    };
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'secured' }); // the buyer's standing co-sign would bind the release
    expect(await t.buyer.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed', retryable: true });
    await t.parties.ticks('buyer', 2);
    expect(t.parties.settles.filter((x) => x.role === 'buyer')).toEqual([]); // nothing handed over on an unsaved bound
    expect((await t.buyer.store.load(CODE))?.releaseBoundAtomic ?? null).toBeNull();
    expect((await t.buyer.store.load(CODE))?.failed ?? null).toBeNull();
    t.buyer.store.save = save;
    await t.buyer.runtime.retry(CODE);
    await until(() => t.parties.settles.some((x) => x.role === 'buyer'));
    expect((await t.buyer.store.load(CODE))?.releaseBoundAtomic).toBe(AMOUNT);
  });

  // Gap 4 (20 Nov): the seller's refund view says when the page may close by `handedOff`.
  it("the seller's refund: handedOff only once the party says its part is finished (the moderator submitted it), while the phase is still signing; never before", async () => {
    const t = await ready();
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'settling', settling: 'auto-refund' });
    await t.seller.runtime.act(CODE, { type: 'build-refund' });
    await until(() => t.parties.settles.some((x) => x.role === 'seller'));
    expect(t.parties.settles.find((x) => x.role === 'seller')!.o).toMatchObject({ builder: 'seller', cosigner: 'mod' });
    await until(() => t.seller.last()?.phase === 'signing');
    expect(t.seller.last()?.handedOff).toBe(false);
    expect(t.seller.last()?.keepOpen).toBe(true);
    await t.parties.ticks('seller', 2);
    expect(t.seller.last()?.handedOff).toBe(false); // the party has not said so: still needed
    t.parties.sent.seller = true;
    await until(() => t.seller.last()?.handedOff === true);
    expect(t.seller.last()?.phase).toBe('signing'); // in no block yet: the settle itself is not done
    for (const p of t.parties.pending.filter((x) => x.role === 'seller')) p.resolve(null);
    await until(() => t.seller.last()?.phase === 'done');
    expect(t.seller.last()?.handedOff).toBe(true);
  });

  it('handedOff is false with no settle under way, whatever the party says, and false on an error', async () => {
    const t = await ready();
    t.parties.sent.seller = true;
    t.parties.sent.buyer = true;
    await t.parties.ticks('seller', 2);
    expect(t.seller.last()?.phase).toBe('ready');
    expect(t.seller.last()?.handedOff).toBe(false);
    expect(t.buyer.last()?.handedOff).toBe(false);
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'settling', settling: 'auto-refund' });
    await until(() => t.seller.last()?.handedOff === true); // the runtime's own auto-refund intent, settled by the party
    t.parties.fundsError.seller = new Error('wallet gone');
    await until(() => t.seller.last()?.phase === 'error');
    expect(t.seller.last()?.handedOff).toBe(false);
  });

  it('lapsed with funds: the seller builds the lapse refund automatically and the buyer co-signs it', async () => {
    const t = await ready();
    const part = 400_000_000_000n;
    t.parties.funds = { balance: part, unlocked: part, incoming: [] };
    t.state.view = tradeView({ state: 'lapsed' });
    await until(() => t.parties.settles.length === 2);
    for (const s of t.parties.settles) expect(s.o).toEqual({ kind: 'release', to: [{ address: ADDR.seller, amountAtomic: part }], builder: 'seller', cosigner: 'buyer' });
  });
});

describe('guards in front of settle', () => {
  async function ready(over: Partial<ApiState> = {}, sellerDeal: Partial<Parameters<typeof confirmedFor>[1]> = {}) {
    const t = await setup(over);
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE, confirmedFor('seller', sellerDeal));
    return { ...t, buyer, seller };
  }

  it('the counterparty signed another deal than the attested one: ignored, never adopted, nothing settled; the attested deal is adopted', async () => {
    // A real seller device would already stop at the attestation (its deal is not the attested
    // one); a stand-in seller signs terms with another offer maximum to test the buyer's own check.
    const t = await setup();
    const seller = await testIdentity();
    t.state.identities.seller = { signPublic: seller.signPublic, boxPublic: seller.boxPublic, proof: '' };
    const buyer = await t.mk('buyer');
    await buyer.runtime.start(CODE);
    await until(async () => (await buyer.store.load(CODE))?.attestation != null);
    const att = (await buyer.store.load(CODE))!.attestation!.attestation as Attestation;
    const channel = await channelFor(CODE, 'signals');
    const terms = (seq: number, deal: ReturnType<typeof confirmedFor>['deal']) => seal({ trade: channel, from: 'seller', seq, type: 'trade.terms', payload: { refundAddress: ADDR.seller, deal }, to: ROLES, me: seller, participants: att.participants });
    t.hub.inject(channel, 'buyer', await terms(1, { ...confirmedFor('seller').deal, maxFiatCents: 60_000n }));
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'secured' });
    await until(async () => ((await buyer.store.load(CODE))?.signalGuard?.seen as Record<string, unknown>)?.seller !== undefined);
    await t.parties.ticks('buyer', 3);
    expect((await buyer.store.load(CODE))?.theirDeal).toBeNull();
    expect(buyer.statuses.some((s) => s.phase === 'error')).toBe(false);
    expect(t.parties.settles).toEqual([]);
    t.hub.inject(channel, 'buyer', await terms(2, confirmedFor('seller').deal));
    await until(() => t.parties.settles.some((x) => x.role === 'buyer'));
    expect((await buyer.store.load(CODE))?.theirDeal?.maxFiatCents).toBe(50_000n);
  });

  it('a seller that confirmed another deal than the moderator attested stops before signing terms (checked again on every start, not kept)', async () => {
    const t = await setup({ roleView: { seller: { maxFiatCents: '60000' } } });
    const seller = await t.mk('seller');
    await seller.runtime.start(CODE, confirmedFor('seller', { maxFiatCents: 60_000n }));
    const buyer = await t.mk('buyer');
    await buyer.runtime.start(CODE);
    expect(await seller.status((s) => s.phase === 'error')).toMatchObject({ error: 'deal-mismatch', retryable: false });
    expect(t.hub.opened.filter((o) => o.role === 'seller')).toEqual([]);
    await seller.runtime.stopAll();
    expect((await seller.store.load(CODE))?.failed ?? null).toBeNull();
  });

  it('a failure is kept in the record only for participants-mismatch and the party’s integrity errors', async () => {
    // participants-mismatch: kept.
    const t = await setup({ tamper: (a) => ({ ...a, participants: { ...a.participants, buyer: a.participants.mod } }) });
    const buyer = await t.mk('buyer');
    const seller = await t.mk('seller');
    await buyer.runtime.start(CODE);
    await seller.runtime.start(CODE);
    expect(await buyer.status((s) => s.phase === 'error')).toMatchObject({ error: 'participants-mismatch', retryable: false });
    await until(async () => (await buyer.store.load(CODE))?.failed === 'participants-mismatch');
    // The party's address-mismatch: kept.
    const u = await setup();
    u.parties.readyError = { seller: new PartyError('address-mismatch', 'buyer reports another escrow address') };
    const s2 = await u.mk('seller');
    const b2 = await u.mk('buyer');
    await s2.runtime.start(CODE);
    await b2.runtime.start(CODE);
    expect(await s2.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed', retryable: false });
    await until(async () => (await s2.store.load(CODE))?.failed === 'escrow-failed');
  });

  async function settlingSeller() {
    const t = await ready();
    await until(async () => (await t.seller.store.load(CODE))?.theirDeal != null && (await t.buyer.store.load(CODE))?.theirDeal != null);
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    await pay(t.buyer);
    await until(async () => (await t.seller.store.load(CODE))?.acceptedAtomic === AMOUNT);
    await t.seller.runtime.act(CODE, { type: 'release' });
    await until(() => t.parties.settles.some((s) => s.role === 'seller'));
    await t.seller.runtime.stopAll();
    return t;
  }

  it('on resume, a stored counterparty deal that is not the attested one is dropped: the stored outcome is not settled and nothing is kept as failed', async () => {
    const t = await settlingSeller();
    await t.buyer.runtime.stopAll(); // no resend of the right terms during this test
    const rec = (await t.seller.store.load(CODE))!;
    expect(rec.intent?.outcome).not.toBeNull();
    await t.seller.store.save({ ...rec, theirDeal: { ...rec.theirDeal!, maxFiatCents: 60_000n } });
    const sellers = () => t.parties.settles.filter((s) => s.role === 'seller').length;
    const count = sellers();
    const again = await t.mk('seller', { idb: t.seller.idb });
    await again.runtime.resumeAll();
    await again.status((s) => s.phase === 'ready' || s.phase === 'signing');
    await t.parties.ticks('seller', 3);
    expect(sellers()).toBe(count);
    expect(again.statuses.some((s) => s.phase === 'error')).toBe(false);
    const after = (await again.store.load(CODE))!;
    expect([after.theirDeal, after.theirAddress, after.failed ?? null]).toEqual([null, null, null]);
  });

  it('on resume, a stored outcome is gated by cosignPolicy again: a tampered one is never settled', async () => {
    const t = await settlingSeller();
    const rec = (await t.seller.store.load(CODE))!;
    const o = rec.intent!.outcome!;
    const evil = { ...o, to: [{ address: '4AttackerAddress', amountAtomic: o.to[0]!.amountAtomic }, ...o.to.slice(1)] };
    await t.seller.store.save({ ...rec, intent: { ...rec.intent!, outcome: evil } });
    const count = t.parties.settles.length;
    const again = await t.mk('seller', { idb: t.seller.idb });
    await again.runtime.resumeAll();
    // The tick re-derives the true outcome and settles that; the stored one never reaches the party.
    await until(() => t.parties.settles.length > count);
    await t.parties.ticks('seller');
    expect(t.parties.settles.slice(count).every((s) => s.o.to.every((p) => p.address !== '4AttackerAddress'))).toBe(true);
    expect(t.parties.settles.slice(count).at(-1)!.o).toEqual({ kind: 'release', ...o });
  });

  it('no growth once this device knows of "I’ve paid", even while the API still says secured', async () => {
    const t = await ready();
    await until(async () => (await t.seller.store.load(CODE))?.theirDeal != null && (await t.buyer.store.load(CODE))?.theirDeal != null);
    t.state.view = tradeView({ state: 'secured' });
    t.parties.funds = funded();
    await t.buyer.runtime.act(CODE, { type: 'paid', fiatCents: fiatOf(AMOUNT) });
    await until(async () => (await t.seller.store.load(CODE))?.paidSeen === true);
    expect((await t.buyer.store.load(CODE))?.paidSeen).toBe(true);
    // Extra XMR that would grow the trade (within the offer maximum) arrives after the tap.
    const grown = 1_300_000_000_000n;
    const b = grown + grown / 100n;
    t.parties.funds = { balance: b, unlocked: b, incoming: [] };
    await Promise.all([t.parties.ticks('seller', 3), t.parties.ticks('buyer', 3)]);
    expect((await t.seller.store.load(CODE))?.sizeAtomic).toBe(AMOUNT);
    expect((await t.buyer.store.load(CODE))?.sizeAtomic).toBe(AMOUNT);
  });
});

describe('resume on load (Review Focus 1)', () => {
  it('a reload mid-signing hands the party the same outcome again, and nothing else', async () => {
    const t = await setup();
    const seller = await t.mk('seller');
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await until(async () => (await seller.store.load(CODE))?.theirDeal != null && (await buyer.store.load(CODE))?.theirDeal != null);
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    await pay(buyer);
    await seller.runtime.act(CODE, { type: 'release' });
    await until(() => t.parties.settles.filter((s) => s.role === 'seller').length === 1);
    const first = t.parties.settles.find((s) => s.role === 'seller')!.o;

    // Reload: the page goes away mid-signing and comes back.
    await seller.runtime.stopAll();
    const again = await t.mk('seller', { idb: seller.idb });
    await again.runtime.resumeAll();
    await until(() => t.parties.settles.filter((s) => s.role === 'seller').length === 2);
    await new Promise((r) => setTimeout(r, 60));
    const sellerSettles = t.parties.settles.filter((s) => s.role === 'seller');
    expect(sellerSettles).toHaveLength(2);
    expect(sellerSettles[1]!.o).toEqual(first);
    // The resumed party got its saved state back, and the same wallet password.
    const calls = t.parties.calls.filter((c) => c.role === 'seller');
    expect(calls).toHaveLength(2);
    expect(await calls[1]!.args.store.load()).not.toBeNull();
    expect(calls[1]!.args.password).toBe(calls[0]!.args.password);
    expect(calls[1]!.args.me.signPublic).toBe(calls[0]!.args.me.signPublic);
  });

  it('once settle resolved, a reload never calls settle again', async () => {
    const t = await setup();
    const seller = await t.mk('seller');
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await until(async () => (await seller.store.load(CODE))?.theirDeal != null && (await buyer.store.load(CODE))?.theirDeal != null);
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    await pay(buyer);
    await seller.runtime.act(CODE, { type: 'release' });
    await until(() => t.parties.pending.some((p) => p.role === 'seller'));
    t.parties.pending.find((p) => p.role === 'seller')!.resolve(null);
    await until(() => seller.last()?.phase === 'done');
    expect((await seller.store.load(CODE))?.intent?.done).toBe(true);
    await seller.runtime.stopAll();
    // The seller's settles only: the buyer's runtime keeps running and makes its standing release
    // co-sign on its own tick, which under load can land after this count (a flake seen 2026-10-29).
    const sellerSettles = () => t.parties.settles.filter((s) => s.role === 'seller').length;
    const count = sellerSettles();
    expect(count).toBe(1);
    const again = await t.mk('seller', { idb: seller.idb });
    await again.runtime.resumeAll();
    await until(() => again.last()?.phase === 'done');
    await new Promise((r) => setTimeout(r, 60));
    expect(sellerSettles()).toBe(count);
  });

  it('a second tab waits for the first one’s lock and runs nothing meanwhile', async () => {
    const t = await setup();
    const held = new Map<string, Promise<void>>();
    const lock = async (name: string, fn: () => Promise<void>) => {
      while (held.has(name)) await held.get(name);
      const p = fn().finally(() => held.delete(name));
      held.set(name, p);
      await p;
    };
    const tab1 = await t.mk('seller', { lock });
    const tab2 = await t.mk('seller', { idb: tab1.idb, lock });
    const buyer = await t.mk('buyer');
    await tab1.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await until(() => tab1.last()?.phase === 'ready');
    await tab2.runtime.start(CODE);
    await new Promise((r) => setTimeout(r, 60));
    expect(tab2.statuses.map((s) => s.phase)).toEqual(['idle']);
    expect(t.parties.calls.filter((c) => c.role === 'seller')).toHaveLength(1);
    await tab1.runtime.stopAll();
    await until(() => tab2.last()?.phase === 'ready');
  });
});

// Security review 20 Nov, M1: a builder that was closed before it saw its own settle in a block (for
// the seller, after "the moderator has sent the refund") and comes back once the trade has closed.
// The closed trade's relay no longer brings the DONE and cosignPolicy hands a closed trade's
// outcome to no party, so only the party's chain proof (landed) can tell "my tx landed" from
// "settled elsewhere". Every builder-returns-after-close flow: no-show refund, seller-built
// release, lapse refund, buyer cancel.
describe('review M1: a builder that comes back after the trade closed', () => {
  const emptied = () => ({ balance: 0n, unlocked: 0n, incoming: [{ txHash: 'aa', amountAtomic: 1n, confirmations: 12, unlocked: true }] });
  type Flow = { name: string; builder: 'seller' | 'buyer'; closed: Record<string, unknown>; tap: (t: Awaited<ReturnType<typeof setup>> & { buyer: Device; seller: Device }) => Promise<void> };
  const FLOWS: Flow[] = [
    {
      name: 'no-show refund (seller-built, the moderator co-signs)',
      builder: 'seller',
      closed: { state: 'refunded', settling: 'auto-refund' },
      tap: async (t) => {
        t.state.view = tradeView({ state: 'settling', settling: 'auto-refund' });
        await t.seller.runtime.act(CODE, { type: 'build-refund' });
      },
    },
    {
      name: 'release (seller-built, the buyer co-signs)',
      builder: 'seller',
      closed: { state: 'released', paidAt: '2026-10-23T12:30:00.000Z' },
      tap: async (t) => {
        t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
        await pay(t.buyer);
        await t.seller.runtime.act(CODE, { type: 'release' });
      },
    },
    {
      name: 'lapse refund (seller-built, the buyer co-signs)',
      builder: 'seller',
      closed: { state: 'refunded', settling: 'lapse-refund' },
      tap: async (t) => {
        t.state.view = tradeView({ state: 'lapsed' });
      },
    },
    {
      name: 'buyer cancel (buyer-built, the moderator co-signs)',
      builder: 'buyer',
      closed: { state: 'refunded', settling: 'buyer-cancel' },
      tap: async (t) => {
        t.state.view = tradeView({ state: 'secured' });
        await until(() => t.parties.settles.some((s) => s.role === 'buyer')); // the standing release co-sign
        await t.buyer.runtime.act(CODE, { type: 'buyer-cancel' });
      },
    },
  ];

  /** The builder settles (its settle never resolves here), its device closes, the trade closes and empties, and the device comes back. */
  async function returnsAfterClose(f: Flow, landed: string | null) {
    let clock = Date.parse('2026-10-24T12:00:00.000Z');
    const t = await setup();
    const opts = { now: () => clock, settledElsewhereMs: 60_000 };
    const seller = await t.mk('seller', opts);
    const buyer = await t.mk('buyer', opts);
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await until(async () => (await seller.store.load(CODE))?.theirDeal != null && (await buyer.store.load(CODE))?.theirDeal != null);
    t.parties.funds = funded();
    const all = { ...t, seller, buyer };
    await f.tap(all);
    await until(() => t.parties.pending.some((p) => p.role === f.builder && p.o.builder === f.builder));
    const built = t.parties.pending.filter((p) => p.role === f.builder && p.o.builder === f.builder).at(-1)!.o;
    const dev = f.builder === 'seller' ? seller : buyer;
    await dev.status((s) => s.phase === 'signing');
    await dev.runtime.stopAll(); // closed before it saw its tx in a block
    t.state.view = tradeView(f.closed);
    t.parties.funds = emptied();
    t.parties.landedFor[f.builder] = landed;
    const again = await t.mk(f.builder, { ...opts, idb: dev.idb });
    await again.runtime.resumeAll();
    return { ...all, again, built, advance: (ms: number) => (clock += ms) };
  }

  for (const f of FLOWS) {
    it(`${f.name}: the party proves its outcome landed, so the device ends done (settleSeenAt set), never escrow-failed`, async () => {
      const t = await returnsAfterClose(f, 'a'.repeat(64));
      await until(async () => (await t.again.store.load(CODE))?.settleSeenAt != null);
      expect((await t.again.store.load(CODE))?.intent?.done).toBe(true);
      expect(t.again.last()?.phase).toBe('done');
      // The proof was asked for exactly the outcome this device built, and nothing new was handed to the party.
      const asked = t.parties.landedAsked.filter((x) => x.role === f.builder);
      expect(asked.length).toBeGreaterThan(0);
      for (const x of asked) expect(x.o).toEqual(t.built);
      const settlesBefore = t.parties.settles.length;
      t.advance(10 * 60_000);
      await t.parties.ticks(f.builder, 3);
      expect(t.again.statuses.some((s) => s.phase === 'error')).toBe(false);
      expect((await t.again.store.load(CODE))?.failed ?? null).toBeNull();
      expect(t.parties.settles.length).toBe(settlesBefore);
    });

    it(`${f.name}: with no proof the emptying still counts as settled elsewhere (escrow-failed after the grace)`, async () => {
      const t = await returnsAfterClose(f, null);
      await t.parties.ticks(f.builder, 3);
      expect(t.again.last()?.phase).not.toBe('error'); // not yet: the grace runs
      t.advance(60_000);
      expect(await t.again.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed', retryable: false });
      expect((await t.again.store.load(CODE))?.intent?.done).toBe(false);
    });
  }
});

describe('after the trade closes: the escrow store is kept for 30 days or until this device saw its settle confirmed, whichever is later', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const empty = (confirmations = 12) => ({ balance: 0n, unlocked: 0n, incoming: [{ txHash: 'aa', amountAtomic: 1n, confirmations, unlocked: confirmations >= 10 }] });

  async function released(o: { settle?: boolean; settledElsewhereMs?: number } = {}) {
    let clock = Date.parse('2026-10-24T12:00:00.000Z');
    const t = await setup();
    const opts = { now: () => clock, ...(o.settledElsewhereMs !== undefined ? { settledElsewhereMs: o.settledElsewhereMs } : {}) };
    const seller = await t.mk('seller', opts);
    const buyer = await t.mk('buyer', opts);
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await until(async () => (await seller.store.load(CODE))?.theirDeal != null && (await buyer.store.load(CODE))?.theirDeal != null);
    t.parties.funds = funded();
    t.state.view = tradeView({ state: 'paid', paidAt: '2026-10-23T12:30:00.000Z' });
    await pay(buyer);
    await seller.runtime.act(CODE, { type: 'release' });
    await until(() => t.parties.pending.some((p) => p.role === 'seller') && t.parties.pending.some((p) => p.role === 'buyer'));
    if (o.settle !== false) {
      for (const p of t.parties.pending.splice(0)) p.resolve(p.role === 'buyer' ? 'txhash' : null);
      await seller.status((s) => s.phase === 'done');
    }
    return { ...t, seller, buyer, advance: (ms: number) => (clock += ms) };
  }

  it('settled and confirmed: kept until 30 days after this device saw the trade closed, then both records go', async () => {
    const t = await released();
    t.state.view = tradeView({ state: 'released' });
    t.parties.funds = empty();
    await t.parties.ticks('seller', 3);
    expect(await t.seller.store.load(CODE)).not.toBeNull();
    t.advance(30 * DAY - 1);
    await t.parties.ticks('seller', 3);
    expect(await t.seller.store.load(CODE)).not.toBeNull();
    t.advance(1);
    await until(async () => (await t.seller.store.load(CODE)) === null);
    expect(await t.seller.store.password(CODE)).toBeNull();
    expect(t.seller.last()?.phase).toBe('done');
  });

  it('30 days passed but the settle tx is still in the pool: kept until it is in a block', async () => {
    const t = await released();
    t.state.view = tradeView({ state: 'released' });
    t.parties.funds = empty(0);
    await t.parties.ticks('seller');
    t.advance(31 * DAY);
    await t.parties.ticks('seller', 3);
    expect(await t.seller.store.load(CODE)).not.toBeNull();
    t.parties.funds = empty(1);
    await until(async () => (await t.seller.store.load(CODE)) === null);
  });

  it('the API says cancelled while the escrow still holds coins: never deleted, whatever the clock says', async () => {
    const t = await released({ settle: false });
    t.state.view = tradeView({ state: 'cancelled' });
    await t.parties.ticks('seller');
    t.advance(60 * DAY);
    await t.parties.ticks('seller', 3);
    expect(await t.seller.store.load(CODE)).not.toBeNull();
    expect(await t.seller.store.password(CODE)).not.toBeNull();
  });

  it('cancelled before any funding: nothing to settle, deleted only after 30 days', async () => {
    let clock = Date.parse('2026-10-24T12:00:00.000Z');
    const t = await setup();
    const seller = await t.mk('seller', { now: () => clock });
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await seller.status((s) => s.phase === 'ready');
    t.state.view = tradeView({ state: 'cancelled' });
    await t.parties.ticks('seller', 3);
    expect(await seller.store.load(CODE)).not.toBeNull();
    const before = seller.last()?.phase;
    clock += 30 * DAY;
    await until(async () => (await seller.store.load(CODE)) === null);
    // Nothing was settled by this device: forgetting the record never reports 'done' (minor 6); the last phase stays.
    expect(seller.last()?.phase).toBe(before);
    expect(seller.last()?.phase).not.toBe('done');
  });

  it('closed and emptied while this device was still settling: settled elsewhere, escrow-failed, the store is kept', async () => {
    const t = await released({ settle: false, settledElsewhereMs: 60_000 });
    t.state.view = tradeView({ state: 'released' });
    await t.parties.ticks('seller');
    // Long after the close, the emptied escrow is seen while this device's own settle is still open.
    t.advance(31 * 24 * 60 * 60 * 1000);
    t.parties.funds = empty();
    await t.parties.ticks('seller', 3);
    expect(t.seller.last()?.phase).toBe('signing'); // not yet: the party may still catch up
    expect(await t.seller.store.load(CODE)).not.toBeNull(); // its own settle was never seen: kept
    t.advance(60_000);
    expect(await t.seller.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed', retryable: false });
    t.advance(60 * DAY);
    await t.parties.ticks('seller', 3);
    expect(await t.seller.store.load(CODE)).not.toBeNull();
    // Confirmed settled elsewhere is kept: a reload stays stopped.
    await until(async () => (await t.seller.store.load(CODE))?.failed === 'escrow-failed');
    await t.seller.runtime.stopAll();
    const again = await t.mk('seller', { idb: t.seller.idb });
    await again.runtime.resumeAll();
    expect(await again.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed', retryable: false });
  });

  it('a funded escrow swept while this device has no settle of its own: escrow-failed, never done, the store is kept', async () => {
    let clock = Date.parse('2026-10-24T12:00:00.000Z');
    const t = await setup();
    const seller = await t.mk('seller', { now: () => clock });
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await until(async () => (await seller.store.load(CODE))?.theirDeal != null);
    // Funded and secured: the seller has nothing to settle on its own here.
    t.state.view = tradeView({ state: 'secured' });
    t.parties.funds = funded();
    await t.parties.ticks('seller', 2);
    expect((await seller.store.load(CODE))?.intent).toBeNull();
    // Someone else's tx empties it and the API says refunded.
    t.state.view = tradeView({ state: 'refunded' });
    t.parties.funds = empty();
    expect(await seller.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed' });
    await t.parties.ticks('seller', 2); // that tick's save has landed
    expect(seller.statuses.some((s) => s.phase === 'done')).toBe(false);
    expect((await seller.store.load(CODE))?.settleSeenAt ?? null).toBeNull();
    clock += 60 * DAY;
    await t.parties.ticks('seller', 3);
    expect(await seller.store.load(CODE)).not.toBeNull();
  });

  it('done only from this device’s own settle: settleSeenAt is set once its settle resolved and the escrow is empty in a block', async () => {
    const t = await released();
    t.state.view = tradeView({ state: 'released' });
    t.parties.funds = empty();
    await until(async () => (await t.seller.store.load(CODE))?.settleSeenAt != null);
    expect((await t.seller.store.load(CODE))?.intent?.done).toBe(true);
    expect(t.seller.last()?.phase).toBe('done');
  });

  it('fail closed: a record without fundedSeen (written before the field) and an empty escrow is kept, whatever the clock says', async () => {
    let clock = Date.parse('2026-10-24T12:00:00.000Z');
    const t = await setup();
    const seller = await t.mk('seller', { now: () => clock });
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await seller.status((s) => s.phase === 'ready');
    await seller.runtime.stopAll();
    const rec = (await seller.store.load(CODE))! as unknown as Record<string, unknown>;
    delete rec.fundedSeen;
    await seller.store.save(rec as never);
    t.state.view = tradeView({ state: 'cancelled' });
    const again = await t.mk('seller', { idb: seller.idb, now: () => clock });
    await again.runtime.resumeAll();
    await t.parties.ticks('seller', 2);
    clock += 60 * DAY;
    await t.parties.ticks('seller', 3);
    expect(await again.store.load(CODE)).not.toBeNull();
  });

  it('fundedSeen is saved at once, even when the same tick refuses a view that disagrees with the deal, and survives a reload', async () => {
    const t = await setup();
    const seller = await t.mk('seller');
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await seller.status((s) => s.phase === 'ready');
    // Coins arrive in the same reading as a view that disagrees with the deal.
    t.state.view = tradeView({ state: 'secured', poster: 'buyer' });
    t.parties.funds = funded();
    expect(await seller.status((s) => s.refusal === 'view-mismatch')).toBeTruthy();
    await seller.runtime.stopAll();
    expect((await seller.store.load(CODE))?.fundedSeen).toBe(true);
  });

  it('this device’s own open settle emptied by another tx is escrow-failed even with fundedSeen false', async () => {
    const t = await released({ settle: false, settledElsewhereMs: 60_000 });
    await t.seller.runtime.stopAll();
    const rec = (await t.seller.store.load(CODE))!;
    expect(rec.intent?.outcome).not.toBeNull();
    await t.seller.store.save({ ...rec, fundedSeen: false });
    t.state.view = tradeView({ state: 'released' });
    t.parties.funds = { balance: 0n, unlocked: 0n, incoming: [] };
    let clock = Date.parse('2026-10-24T12:00:00.000Z');
    const again = await t.mk('seller', { idb: t.seller.idb, now: () => clock, settledElsewhereMs: 60_000 });
    await again.runtime.resumeAll();
    await t.parties.ticks('seller', 2);
    clock += 60_000;
    expect(await again.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed' });
    clock += 60 * DAY;
    await t.parties.ticks('seller', 3);
    expect(await again.store.load(CODE)).not.toBeNull();
  });

  it('I3: the seller in a buyer cancel it did not sign: settled-without-device, not an error, gone after 30 days', async () => {
    let clock = Date.parse('2026-10-24T12:00:00.000Z');
    const t = await setup();
    const seller = await t.mk('seller', { now: () => clock });
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await until(async () => (await seller.store.load(CODE))?.theirDeal != null);
    t.state.view = tradeView({ state: 'secured' });
    t.parties.funds = funded();
    await t.parties.ticks('seller', 2);
    t.state.view = tradeView({ state: 'refunded', settling: 'buyer-cancel' });
    t.parties.funds = empty();
    expect(await seller.status((s) => s.phase === 'settled-without-device')).toMatchObject({ error: null, retryable: false });
    await t.parties.ticks('seller', 2);
    expect(seller.statuses.some((s) => s.phase === 'error')).toBe(false);
    expect((await seller.store.load(CODE))?.failed ?? null).toBeNull();
    clock += 30 * DAY;
    await until(async () => (await seller.store.load(CODE)) === null);
    expect(seller.last()?.phase).toBe('settled-without-device'); // never 'done': this device signed nothing
  });

  it.each([
    ['never having tapped paid: settled-without-device', false],
    ['having tapped paid: escrow-failed', true],
  ])('I3: the buyer in an auto-refund, %s', async (_n, tapped) => {
    const t = await setup();
    const seller = await t.mk('seller');
    const buyer = await t.mk('buyer', { settledElsewhereMs: 0 }); // no grace for its own open co-sign
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await until(async () => (await buyer.store.load(CODE))?.theirDeal != null);
    t.state.view = tradeView({ state: 'secured' });
    t.parties.funds = funded();
    await t.parties.ticks('buyer', 2);
    if (tapped) await pay(buyer);
    t.state.view = tradeView({ state: 'refunded', settling: 'auto-refund' });
    t.parties.funds = empty();
    if (tapped) expect(await buyer.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed' });
    else expect(await buyer.status((s) => s.phase === 'settled-without-device')).toMatchObject({ error: null });
  });

  it('a late coin after close is saved as funded at once, though that tick saves nothing else', async () => {
    let clock = Date.parse('2026-10-24T12:00:00.000Z');
    const t = await setup();
    const seller = await t.mk('seller', { now: () => clock });
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await seller.status((s) => s.phase === 'ready');
    // Quiet every other writer: the buyer's terms arrived and it stops; the mod acks the seller's
    // terms, so no terms resend saves the record. Only the tick's own save can store the flag.
    await until(async () => (await seller.store.load(CODE))?.theirAddress === ADDR.buyer);
    await buyer.runtime.stopAll();
    const channel = await channelFor(CODE, 'signals');
    const att = (await seller.store.load(CODE))!.attestation!.attestation as Attestation;
    t.hub.inject(channel, 'seller', await seal({ trade: channel, from: 'mod', seq: 1, type: 'trade.ack', payload: { of: 'trade.terms' }, to: ROLES, me: t.api.modId, participants: att.participants }));
    await until(async () => (await seller.store.load(CODE))?.termsAcked === true);
    t.state.view = tradeView({ state: 'cancelled' });
    await until(async () => (await seller.store.load(CODE))?.closedSeenAt != null);
    t.parties.funds = { balance: 5n, unlocked: 0n, incoming: [{ txHash: 'late', amountAtomic: 5n, confirmations: 0, unlocked: false }] };
    await until(async () => (await seller.store.load(CODE))?.fundedSeen === true);
    expect((await seller.store.load(CODE))?.fundedSeen).toBe(true);
    void clock;
  });

  it('the party used up its attempts for an outcome: refused visibly (attempts-exhausted), not retried in a silent loop', async () => {
    const t = await released({ settle: false });
    const p = t.parties.pending.find((x) => x.role === 'seller')!;
    const before = t.parties.settles.filter((x) => x.role === 'seller').length;
    p.reject(new PartyError('bad-outcome', 'settlement attempts for this outcome are used up'));
    expect(await t.seller.status((s) => s.refusal === 'attempts-exhausted')).toMatchObject({ error: null });
    await t.parties.ticks('seller', 3);
    expect(t.parties.settles.filter((x) => x.role === 'seller').length).toBe(before);
  });

  it('a transient failure is not kept: status says retryable, retry() runs it again, and a reload recovers', async () => {
    const t = await setup();
    t.parties.readyError = { seller: new Error('daemon unreachable') };
    const seller = await t.mk('seller');
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    expect(await seller.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed', retryable: true });
    expect((await seller.store.load(CODE))?.failed ?? null).toBeNull();
    await seller.runtime.retry(CODE);
    expect(await seller.status((s) => s.phase === 'ready')).toMatchObject({ error: null });
    // And the same after a reload instead of a retry.
    t.parties.readyError = { seller: new Error('relay closed') };
    await seller.runtime.stopAll();
    const again = await t.mk('seller', { idb: seller.idb });
    await again.runtime.resumeAll();
    expect(await again.status((s) => s.phase === 'error')).toMatchObject({ retryable: true });
    await again.runtime.stopAll();
    const third = await t.mk('seller', { idb: seller.idb });
    await third.runtime.resumeAll();
    expect(await third.status((s) => s.phase === 'ready')).toMatchObject({ error: null });
  });

  it('an integrity failure from the party (equivocation) is kept and not retryable', async () => {
    const t = await setup();
    t.parties.readyError = { seller: new PartyError('equivocation', 'two different copies') };
    const seller = await t.mk('seller');
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    expect(await seller.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed', retryable: false });
    await until(async () => (await seller.store.load(CODE))?.failed === 'escrow-failed');
    await seller.runtime.retry(CODE);
    expect(await seller.status((s) => s.phase === 'error')).toMatchObject({ retryable: false });
  });

  it('the party reports settled-elsewhere: escrow-failed, never a quiet close', async () => {
    const t = await released({ settle: false });
    const p = t.parties.pending.find((x) => x.role === 'seller')!;
    p.reject(new PartyError('settled-elsewhere', 'another transaction emptied the escrow'));
    expect(await t.seller.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed', retryable: false });
    expect(await t.seller.store.load(CODE)).not.toBeNull();
    // A confirmed settled-elsewhere is kept: a reload stays stopped.
    await until(async () => (await t.seller.store.load(CODE))?.failed === 'escrow-failed');
    await t.seller.runtime.stopAll();
    const again = await t.mk('seller', { idb: t.seller.idb });
    await again.runtime.resumeAll();
    expect(await again.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed', retryable: false });
  });

  // ── A dead party and the relay's close of the trade (review 2026-10-26, Important 1) ──

  it('a party whose funds() fails: shown as escrow-failed and retryable; an integrity failure is kept; a daemon hiccup is neither', async () => {
    const t = await released();
    t.state.view = tradeView({ state: 'released' });
    // A daemon that is briefly unreachable: read again next tick, nothing shown.
    t.parties.fundsError.seller = new EscrowError('daemon-unavailable');
    await t.parties.ticks('seller', 3);
    expect(t.seller.last()).toMatchObject({ phase: 'done', error: null });
    // The party died for a reason that is not an integrity failure: visible and retryable.
    t.parties.fundsError.seller = new PartyError('bad-state', 'unknown saved state version');
    expect(await t.seller.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed', retryable: true });
    expect((await t.seller.store.load(CODE))?.failed ?? null).toBeNull();
    delete t.parties.fundsError.seller;
    await t.seller.runtime.retry(CODE);
    expect(await t.seller.status((s) => s.phase !== 'error' && s.phase !== 'idle')).toMatchObject({ error: null });
    // An integrity failure from the party is kept and not retryable.
    t.parties.fundsError.seller = new PartyError('equivocation', 'two different copies');
    expect(await t.seller.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed', retryable: false });
    await until(async () => (await t.seller.store.load(CODE))?.failed === 'escrow-failed');
  });

  it('relay closed (4404) at trade end while this device’s own settle is still open: no error at once, settled elsewhere after the grace, the store is kept', async () => {
    const t = await released({ settle: false, settledElsewhereMs: 60_000 });
    t.parties.closeRelay('seller'); // the seller's open settle rejects with the transport's close
    t.state.view = tradeView({ state: 'released' });
    t.parties.funds = empty();
    await t.parties.ticks('seller', 3);
    // Not an error yet: the trade is closed, so a closed relay is expected; the after-close rules decide.
    expect(t.seller.last()).toMatchObject({ phase: 'signing', error: null });
    expect(await t.seller.store.load(CODE)).toMatchObject({ closedSeenAt: expect.any(Number) });
    t.advance(60_000);
    expect(await t.seller.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed', retryable: false });
    await until(async () => (await t.seller.store.load(CODE))?.failed === 'escrow-failed');
    t.advance(60 * DAY);
    await t.parties.ticks('seller', 3);
    expect(await t.seller.store.load(CODE)).not.toBeNull();
  });

  it('relay closed (4404) at trade end, own settle done: settleSeenAt is recorded and the records go after 30 days', async () => {
    const t = await released();
    t.parties.closeRelay('seller');
    t.parties.closeRelay('buyer');
    t.state.view = tradeView({ state: 'released' });
    t.parties.funds = empty();
    await until(async () => (await t.seller.store.load(CODE))?.settleSeenAt != null);
    expect(t.seller.last()).toMatchObject({ phase: 'done', error: null });
    t.advance(30 * DAY);
    await until(async () => (await t.seller.store.load(CODE)) === null);
    expect(await t.seller.store.password(CODE)).toBeNull();
  });

  it('a device that comes back after the relay closed the trade (ready() rejects with the close): the after-close rules still run', async () => {
    let clock = Date.parse('2026-10-24T12:00:00.000Z');
    const t = await setup();
    const seller = await t.mk('seller', { now: () => clock });
    const buyer = await t.mk('buyer');
    await seller.runtime.start(CODE);
    await buyer.runtime.start(CODE);
    await until(async () => (await seller.store.load(CODE))?.theirDeal != null);
    t.state.view = tradeView({ state: 'secured' });
    t.parties.funds = funded();
    await t.parties.ticks('seller', 2);
    await seller.runtime.stopAll();
    // Meanwhile the buyer cancelled, the escrow was refunded without the seller, and the relay closed the trade.
    t.parties.closeRelay('seller');
    t.state.view = tradeView({ state: 'refunded', settling: 'buyer-cancel' });
    t.parties.funds = empty();
    const again = await t.mk('seller', { idb: seller.idb, now: () => clock });
    await again.runtime.resumeAll();
    expect(await again.status((s) => s.phase === 'settled-without-device')).toMatchObject({ error: null, retryable: false });
    expect(again.statuses.some((s) => s.phase === 'error')).toBe(false);
    clock += 30 * DAY;
    await until(async () => (await again.store.load(CODE)) === null);
  });

  it('relay closed while the trade is still open: escrow-failed and retryable; retry() runs the party again', async () => {
    const t = await released({ settle: false }); // view: paid, the seller's settle is open
    t.parties.closeRelay('seller');
    expect(await t.seller.status((s) => s.phase === 'error')).toMatchObject({ error: 'escrow-failed', retryable: true });
    expect((await t.seller.store.load(CODE))?.failed ?? null).toBeNull();
    delete t.parties.relayClosed.seller;
    await t.seller.runtime.retry(CODE);
    expect(await t.seller.status((s) => s.phase === 'signing')).toMatchObject({ error: null });
  });
});
