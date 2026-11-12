// Plan 3 Task 10: the buyer-cancel refund (spec 2.3), rulings, and the lost device (spec 9).
// Hermetic (see harness.ts and the note at the top of autoRefund.test.ts).
import { generateIdentity } from '@x2f/protocol';
import { fiatCents } from '@x2f/trade';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { REFUND_UNVERIFIED_MS } from '../src/autoRefund.js';
import { buyerCancelStep } from '../src/buyerCancel.js';
import { readFileSync, readdirSync } from 'node:fs';
import { fromJson, toJson } from '../src/shadow.js';
import { NO_DESK_FACTS, sweepKindAgrees, type DeskRecord } from '../src/desk.js';
import {
  acked,
  DEAL,
  drained,
  ESCROW,
  fakeNetwork,
  FUNDS,
  hash,
  incoming,
  inFunding,
  later,
  makeCtx,
  MIN,
  moderation,
  newTrade,
  OTHER_TERMS,
  outcomeJson,
  secured,
  signal,
  TERMS,
  type Ctx,
  type Live,
  stopAll,
} from './harness.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await makeCtx();
});
afterEach(stopAll);
afterAll(async () => {
  await ctx.db.end();
});

const record = async (code: string): Promise<DeskRecord> => {
  const { rows } = await ctx.db.query<{ record: unknown }>('select record from mod_trade_desk where trade = $1', [code]);
  return fromJson(rows[0]!.record) as DeskRecord;
};
const PAID = { amountAtomic: DEAL.takeAmountAtomic, fiatCents: fiatCents(DEAL.takeAmountAtomic, { currency: 'USD', centsPerXmr: DEAL.centsPerXmr }) };
const cancelOutcome = (amount: bigint) => ({ kind: 'release', to: [{ address: TERMS.sellerRefund, amountAtomic: amount }], builder: 'buyer', cosigner: 'mod' });

describe('the buyer-cancel refund', () => {
  it('the buyer cancels after funding with the seller’s page closed: the seller-signed address gets the whole balance; no final alert, no receipt', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    later(ctx, 5 * MIN);
    await acked(l, l.buyer, 'trade.cancel', {});
    net.states.set(l.code, 'settling');
    net.settleKinds.set(l.code, 'buyer-cancel');
    await m.handle.watch();
    expect(l.party.settles).toEqual([cancelOutcome(FUNDS)]);
    expect((await record(l.code)).armed?.kind).toBe('buyer-cancel');
    expect(net.reports.some((r) => r.kind === 'refund-unverified')).toBe(false);
    await m.handle.stop();
  });

  it('with the API’s seller_refund overwritten: still only the seller-signed address', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    net.work = [{ ...(await newTrade(OTHER_TERMS)).work, trade: l.code }];
    await m.handle.tick();
    await secured(ctx, l);
    await acked(l, l.buyer, 'trade.cancel', {});
    await m.handle.watch();
    expect(l.party.settles).toEqual([cancelOutcome(FUNDS)]);
    expect(l.party.settles[0]!.to.map((p) => p.address)).not.toContain(OTHER_TERMS.sellerRefund);
    await m.handle.stop();
  });

  it('a trade.cancel sealed by the seller’s identity, or by a stranger claiming to be the buyer, is never counted', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    await signal(l, l.seller, 'trade.cancel', {});
    const stranger = { role: 'buyer' as const, id: await generateIdentity(), seq: 50 };
    await signal(l, stranger, 'trade.cancel', {});
    await drained();
    await m.handle.watch();
    expect(m.logs).toContain('signal-malformed');
    expect(m.logs).toContain('signal-bad-signature');
    expect((await record(l.code)).cancelSeen).toBe(false);
    expect(l.party.settles).toEqual([]);
    await m.handle.stop();
  });

  it('a late surplus before the moderator signed: the refund is derived again from the new balance and handed over again', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    await acked(l, l.buyer, 'trade.cancel', {});
    await m.handle.watch();
    l.party.funds = { ...l.party.funds, balance: FUNDS + 7n, unlocked: FUNDS, incoming: [incoming(hash('a'), FUNDS, 88, true), incoming(hash('b'), 7n, 99)] };
    await m.handle.watch(); // not unlocked: nothing new
    l.party.funds = { ...l.party.funds, unlocked: FUNDS + 7n, incoming: [incoming(hash('a'), FUNDS, 80, true), incoming(hash('b'), 7n, 88, true)] };
    await m.handle.watch();
    expect(l.party.settles).toEqual([cancelOutcome(FUNDS), cancelOutcome(FUNDS + 7n)]);
    await m.handle.stop();
  });

  it('without the seller’s signed terms nothing is ever signed (no recorded refund address)', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await acked(l, l.buyer, 'trade.terms', { payoutAddress: TERMS.buyerPayout, deal: DEAL });
    l.party.funds = { ...l.party.funds, balance: FUNDS, unlocked: FUNDS, incoming: [incoming(hash('a'), FUNDS, 88, true)] };
    await m.handle.watch();
    await acked(l, l.buyer, 'trade.cancel', {});
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    await m.handle.stop();
  });
});

describe('owner option B: no cancel after “I’ve paid” (review I3)', () => {
  it('the moderator opened the buyer’s trade.paid, then a trade.cancel arrives: nothing is signed', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    later(ctx, 10 * MIN);
    await acked(l, l.buyer, 'trade.paid', PAID);
    await acked(l, l.buyer, 'trade.cancel', {}); // an accidental tap, an old client
    net.states.set(l.code, 'settling');
    net.settleKinds.set(l.code, 'buyer-cancel'); // even if the API took it
    await m.handle.watch();
    later(ctx, 30 * MIN);
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    // Task 39: the machine (and so the shadow) refuses a buyer cancel in `paid`; cancelSeen stays false,
    // and paidSeen would block the co-sign anyway (buyerCancelStep checks it first).
    expect(m.logs).toContain('shadow-buyer-cancel-wrong-state');
    expect((await record(l.code)).cancelSeen).toBe(false);
    expect((await record(l.code)).paidSeen).toBe(true);
    await m.handle.stop();
  });

  it('trade.cancel, then trade.paid before the coins unlock: nothing is signed (checked every pass)', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await acked(l, l.seller, 'trade.terms', { refundAddress: TERMS.sellerRefund, deal: DEAL });
    await acked(l, l.buyer, 'trade.terms', { payoutAddress: TERMS.buyerPayout, deal: DEAL });
    l.party.funds = { ...l.party.funds, balance: FUNDS, unlocked: 0n, incoming: [incoming(hash('a'), FUNDS, 99)] };
    await m.handle.watch();
    await acked(l, l.buyer, 'trade.cancel', {});
    net.states.set(l.code, 'settling');
    net.settleKinds.set(l.code, 'buyer-cancel');
    await m.handle.watch();
    expect((await record(l.code)).cancelSeen).toBe(true);
    await acked(l, l.buyer, 'trade.paid', PAID);
    l.party.funds = { ...l.party.funds, balance: FUNDS, unlocked: FUNDS, incoming: [incoming(hash('a'), FUNDS, 88, true)] };
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    await m.handle.stop();
  });

  it('a trade.cancel while the API shows paid, a release in progress, a dispute, a lapse or a closed trade: nothing is signed', async () => {
    for (const [state, kind] of [['paid', null], ['settling', 'release'], ['settling', null], ['disputed', null], ['lapsed', 'lapse-refund'], ['released', null], ['refunded', null], ['cancelled', null]] as const) {
      const { net, fetch } = fakeNetwork(ctx);
      const m = await moderation(ctx, fetch);
      const l = await inFunding(ctx, m, net);
      await secured(ctx, l);
      await acked(l, l.buyer, 'trade.cancel', {});
      net.states.set(l.code, state);
      if (kind) net.settleKinds.set(l.code, kind);
      await m.handle.watch();
      expect(l.party.settles, `${state} ${kind}`).toEqual([]);
      await m.handle.stop();
    }
  });

  it('a trade.cancel the shadow refuses is never counted', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    await m.handle.stop();
    // The shadow is disputed (the machine refuses buyer-cancel there).
    const rec = await record(l.code);
    await ctx.db.query('update mod_trade_desk set record = $2 where trade = $1', [l.code, JSON.stringify(toJson({ ...rec, shadow: { ...rec.shadow!, state: 'disputed' } }))]);
    const again = await moderation(ctx, fetch);
    await again.handle.watch();
    const p = again.parties.get(l.code)!;
    p.funds = { ...l.party.funds };
    p.resolveReady('ignored');
    await expect.poll(() => again.transports.has(l.channel)).toBe(true);
    await acked({ ...l, m: again, party: p, signals: again.transports.get(l.channel)! }, l.buyer, 'trade.cancel', {});
    await again.handle.watch();
    expect((await record(l.code)).cancelSeen).toBe(false);
    expect(again.logs).toContain('shadow-buyer-cancel-wrong-state');
    expect(p.settles).toEqual([]);
    await again.handle.stop();
  });

  it('a cancel that cannot proceed does not block the auto-refund’s escalation (review M3)', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    // only the buyer's terms: the cancel waits for a seller-signed refund address forever
    await acked(l, l.buyer, 'trade.terms', { payoutAddress: TERMS.buyerPayout, deal: DEAL });
    l.party.funds = { ...l.party.funds, balance: FUNDS, unlocked: FUNDS, incoming: [incoming(hash('a'), FUNDS, 88, true)] };
    await m.handle.watch();
    await acked(l, l.buyer, 'trade.cancel', {});
    // The API shows the seller's cancel (settling/auto-refund) the mod cannot back: it escalates after the fallback.
    net.states.set(l.code, 'settling');
    net.settleKinds.set(l.code, 'auto-refund');
    await m.handle.watch();
    later(ctx, REFUND_UNVERIFIED_MS + MIN);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.trade === l.code && r.kind === 'refund-unverified')).toHaveLength(1);
    expect(l.party.settles).toEqual([]);
    await m.handle.stop();
  });

  it('after the sweep, late coins are never signed again here (review M4)', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    await acked(l, l.buyer, 'trade.cancel', {});
    net.states.set(l.code, 'settling');
    net.settleKinds.set(l.code, 'buyer-cancel');
    await m.handle.watch();
    expect(l.party.settles).toEqual([cancelOutcome(FUNDS)]);
    net.states.set(l.code, 'refunded');
    l.party.funds = { ...l.party.funds, balance: 9n, unlocked: 9n, incoming: [incoming(hash('a'), FUNDS, 80, true), incoming(hash('late'), 9n, 85, true)] };
    await m.handle.watch();
    await m.handle.watch();
    expect(l.party.settles).toEqual([cancelOutcome(FUNDS)]);
    expect(m.logs.filter((x) => x === 'buyer-cancel-signing')).toHaveLength(1);
    await m.handle.stop();
  });

  it('review round 2 N2: an ARMED buyer cancel is rechecked every pass: after a trade.paid neither a late surplus nor a restart hands it to the party again', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    await acked(l, l.buyer, 'trade.cancel', {});
    net.states.set(l.code, 'settling');
    net.settleKinds.set(l.code, 'buyer-cancel');
    await m.handle.watch();
    expect(l.party.settles).toEqual([cancelOutcome(FUNDS)]);
    // The buyer's tx set has not come in yet; the buyer's old client sends trade.paid.
    await acked(l, l.buyer, 'trade.paid', PAID);
    // A late surplus changes the payouts: without the recheck the refund would be handed over again.
    l.party.funds = { ...l.party.funds, balance: FUNDS + 7n, unlocked: FUNDS + 7n, incoming: [incoming(hash('a'), FUNDS, 80, true), incoming(hash('b'), 7n, 88, true)] };
    await m.handle.watch();
    expect(l.party.settles).toEqual([cancelOutcome(FUNDS)]);
    expect(m.logs).toContain('buyer-cancel-buyer-paid');
    await m.handle.stop();
    // A restart: the armed refund is not handed to the new party either.
    const again = await moderation(ctx, fetch);
    await again.handle.watch();
    const p = again.parties.get(l.code)!;
    p.funds = { ...l.party.funds };
    p.resolveReady('ignored');
    await again.handle.watch();
    await again.handle.watch();
    expect(p.settles).toEqual([]);
    expect(again.logs).toContain('buyer-cancel-buyer-paid');
    expect(again.logs).not.toContain('buyer-cancel-signing');
    await again.handle.stop();
  });

  it('review round 2 N2: an ARMED buyer cancel is not handed over again while the API shows a state it may not be signed in; it is once the API allows it again', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    await acked(l, l.buyer, 'trade.cancel', {});
    net.states.set(l.code, 'settling');
    net.settleKinds.set(l.code, 'buyer-cancel');
    await m.handle.watch();
    expect(l.party.settles).toEqual([cancelOutcome(FUNDS)]);
    await m.handle.stop();
    for (const [state, kind] of [['paid', null], ['settling', 'release'], ['disputed', null]] as const) {
      net.states.set(l.code, state);
      if (kind) net.settleKinds.set(l.code, kind);
      else net.settleKinds.delete(l.code);
      const again = await moderation(ctx, fetch);
      await again.handle.watch();
      const p = again.parties.get(l.code)!;
      p.funds = { ...l.party.funds };
      p.resolveReady('ignored');
      await again.handle.watch();
      expect(p.settles, `${state} ${kind}`).toEqual([]);
      expect(again.logs).toContain('buyer-cancel-api-state');
      await again.handle.stop();
    }
    net.states.set(l.code, 'settling');
    net.settleKinds.set(l.code, 'buyer-cancel');
    const back = await moderation(ctx, fetch);
    await back.handle.watch();
    const p = back.parties.get(l.code)!;
    p.funds = { ...l.party.funds };
    p.resolveReady('ignored');
    await back.handle.watch();
    expect(p.settles).toEqual([cancelOutcome(FUNDS)]);
    await back.handle.stop();
  });
});

describe("review round 3 R3-N1: an armed buyer cancel the buyer never builds does not switch off the seller's cancel refund", () => {
  const REFUND = { kind: 'release', to: [{ address: TERMS.sellerRefund, amountAtomic: FUNDS }], builder: 'seller', cosigner: 'mod' };

  /**
   * The buyer's cancel is armed and handed to the party, but the buyer never builds it; the settling
   * window reverts, payBy passes and the seller cancels (owner 8 Nov: the refund starts at once).
   * `api`: 'signal-only' leaves the API `secured` until the seller's cancel (the buyer posted nothing
   * there); 'honest' runs the API's own cancel and its settleBy revert.
   */
  async function strandedCancel(l: Live, api: 'signal-only' | 'honest'): Promise<void> {
    await secured(ctx, l);
    later(ctx, 5 * MIN);
    await acked(l, l.buyer, 'trade.cancel', {});
    if (api === 'honest') {
      l.net.states.set(l.code, 'settling');
      l.net.settleKinds.set(l.code, 'buyer-cancel');
    }
    await l.m.handle.watch();
    expect(l.party.settles).toEqual([cancelOutcome(FUNDS)]);
    expect((await record(l.code)).armed?.kind).toBe('buyer-cancel');
    // The buyer never builds the tx: the 15 min settling window runs out (shadow and API revert).
    later(ctx, 20 * MIN);
    if (api === 'honest') {
      l.net.states.set(l.code, 'secured');
      l.net.settleKinds.delete(l.code);
    }
    await l.m.handle.watch();
    expect((await record(l.code)).shadow!.state).toBe('secured');
    // payBy (secured + 90 min) passes; the seller cancels.
    later(ctx, 70 * MIN);
    await acked(l, l.seller, 'trade.refund-request', {});
    l.net.states.set(l.code, 'settling');
    l.net.settleKinds.set(l.code, 'auto-refund');
    const rec = await record(l.code);
    expect(rec.shadow!.state).toBe('settling');
    expect(rec.shadow!.settling).toBe('auto-refund');
  }

  for (const api of ['signal-only', 'honest'] as const) {
    it(`${api}: the seller-built refund is signed at once (re-armed as auto-refund, same payout)`, async () => {
      const { net, fetch } = fakeNetwork(ctx);
      const m = await moderation(ctx, fetch);
      const l = await inFunding(ctx, m, net);
      await strandedCancel(l, api);
      await m.handle.watch();
      expect(l.party.settles).toEqual([cancelOutcome(FUNDS), REFUND]);
      const rec = await record(l.code);
      expect(rec.armed?.kind).toBe('auto-refund');
      // The shadow's veto backs the re-armed kind (a landed buyer-cancel tx would be the mod's own tx).
      expect(sweepKindAgrees(rec, 'auto-refund')).toBe(true);
      expect(m.logs).toContain('auto-refund-signing');
      // asked once; the buyer-built cancel is not handed over again
      await m.handle.watch();
      expect(l.party.settles).toEqual([cancelOutcome(FUNDS), REFUND]);
      await m.handle.stop();
      // after a restart only the auto-refund is handed over
      const again = await moderation(ctx, fetch);
      await again.handle.watch();
      const p = again.parties.get(l.code)!;
      p.funds = { ...l.party.funds };
      p.resolveReady('ignored');
      await again.handle.watch();
      expect(p.settles).toEqual([REFUND]);
      await again.handle.stop();
    });

    it(`${api}: the buyer's trade.paid after the cancel → escalates (refund-unverified) once after PAID_CONFLICT_MS; nothing more signed`, async () => {
      const { net, fetch } = fakeNetwork(ctx);
      const m = await moderation(ctx, fetch);
      const l = await inFunding(ctx, m, net);
      await strandedCancel(l, api);
      await acked(l, l.buyer, 'trade.paid', PAID);
      await m.handle.watch();
      later(ctx, 3 * MIN);
      await m.handle.watch();
      later(ctx, 30 * MIN);
      await m.handle.watch();
      expect(net.reports.filter((r) => r.trade === l.code && r.kind === 'refund-unverified')).toHaveLength(1);
      expect((await record(l.code)).escalated).toBe('refund-unverified');
      expect(l.party.settles).toEqual([cancelOutcome(FUNDS)]);
      await m.handle.stop();
    });
  }

  it('the party already committed to the buyer-built cancel: the re-arm is refused, the cancel is not handed again, it lands and the desk stops (review R4-M2)', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await strandedCancel(l, 'signal-only');
    // The buyer's tx set reached the mod before the seller cancelled: the party committed to it.
    l.party.committed = true;
    await m.handle.watch();
    expect(l.party.settles).toEqual([cancelOutcome(FUNDS), REFUND]);
    await new Promise((r) => setTimeout(r, 0));
    expect(m.logs).toContain('auto-refund-settle-failed');
    // The record stays the auto-refund (never re-armed back to the cancel, never escalated) ...
    await m.handle.watch();
    const rec = await record(l.code);
    expect(rec.armed?.kind).toBe('auto-refund');
    expect(rec.escalated).toBeNull();
    // ... and the earlier (buyer-built) outcome is never handed to the party again: only refused re-asks.
    expect(l.party.settles.slice(1).every((o) => outcomeJson(o) === outcomeJson(REFUND))).toBe(true);
    // The mod signs and submits the committed cancel itself: its own tx empties the escrow. The
    // settled report names the kind the party signed (buyer-built: buyer-cancel), not the armed
    // auto-refund (re-verify R2: the API would refuse that as settle-kind-changed for good).
    const tx = '9'.repeat(64);
    // Other trades in this file share the database and the log: count from here, so the growth is this trade's.
    const overBefore = m.logs.filter((x) => x === 'desk-trade-over').length;
    l.party.funds = { ...l.party.funds, balance: 0n, unlocked: 0n, outgoing: [{ txHash: tx, height: 90, spentAtomic: FUNDS }], ownTxs: [tx] };
    later(ctx, MIN);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'settled' && r.trade === l.code)).toEqual([{ kind: 'settled', trade: l.code, txHash: tx, settleKind: 'buyer-cancel' }]);
    // The desk sees the trade over (logged once per desk, logOnce) and hands nothing more to the party.
    expect(m.logs.filter((x) => x === 'desk-trade-over').length).toBeGreaterThan(overBefore);
    const asked = l.party.settles.length;
    later(ctx, MIN);
    await m.handle.watch();
    expect(l.party.settles).toHaveLength(asked);
    expect(net.reports.filter((r) => r.trade === l.code && r.kind === 'refund-unverified')).toEqual([]);
    await m.handle.stop();
  });
});

describe('the shadow vetoes a refund sweep kind its own facts do not back (review round 2, R2-M1 defence in depth)', () => {
  const KEY = '7'.repeat(64);
  /** A sweep the mod did not sign, shown through an import, named by both parties' spend.info (Task 9 R3-I1), with a tx key that proves it. */
  const forged = (l: Live, tx: string, spentAtomic: bigint): void => {
    l.party.funds = { ...l.party.funds, balance: 0n, unlocked: 0n, outgoing: [{ txHash: tx, height: 90, spentAtomic }], ownTxs: [], spendProofs: [{ from: 'seller', txHash: tx, txKey: KEY }, { from: 'buyer', txHash: tx, txKey: '' }] };
    l.party.prove = () => true;
  };
  const settled = (net: Live['net'], code: string) => net.reports.filter((r) => r.kind === 'settled' && r.trade === code);

  it('the API names lapse-refund while the shadow is secured (never lapsed): the sweep is never proven, and the 6 h fallback escalates', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    net.states.set(l.code, 'lapsed');
    net.settleKinds.set(l.code, 'lapse-refund');
    forged(l, hash('c'), FUNDS);
    await m.handle.watch();
    await m.handle.watch();
    expect(settled(net, l.code)).toEqual([]);
    expect(l.party.proveCalls).toEqual([]);
    expect(m.logs).toContain('sweep-kind-vetoed');
    expect(m.logs).toContain('sweep-unproven');
    await m.handle.stop();
  });

  it('a real lapse: the sweep is proven once the shadow itself lapsed (delayed by at most a pass, not lost)', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await acked(l, l.seller, 'trade.terms', { refundAddress: TERMS.sellerRefund, deal: DEAL });
    await acked(l, l.buyer, 'trade.terms', { payoutAddress: TERMS.buyerPayout, deal: DEAL });
    const half = FUNDS / 2n;
    l.party.funds = { ...l.party.funds, balance: half, unlocked: half, incoming: [incoming(hash('a'), half, 88, true)] };
    await m.handle.watch();
    later(ctx, 31 * MIN); // past the shadow's own fundBy
    net.states.set(l.code, 'lapsed');
    net.settleKinds.set(l.code, 'lapse-refund');
    forged(l, hash('d'), half);
    await m.handle.watch(); // the shadow lapses in this pass's desk step, after the sweep was checked
    expect(settled(net, l.code)).toEqual([]);
    expect((await record(l.code)).shadow!.lapsedAt).not.toBeNull();
    await m.handle.watch();
    expect(settled(net, l.code)).toEqual([{ kind: 'settled', trade: l.code, txHash: hash('d'), settleKind: 'lapse-refund' }]);
    expect(l.party.proveCalls.at(-1)!.minimums).toEqual([{ address: TERMS.sellerRefund, amountAtomic: half }]);
    await m.handle.stop();
  });

  it('the API names release (or mutual-cancel) while this desk armed a buyer cancel: never proven', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    await acked(l, l.buyer, 'trade.cancel', {});
    net.states.set(l.code, 'settling');
    net.settleKinds.set(l.code, 'buyer-cancel');
    await m.handle.watch();
    expect((await record(l.code)).armed?.kind).toBe('buyer-cancel');
    forged(l, hash('e'), FUNDS);
    for (const kind of ['release', 'mutual-cancel']) {
      net.settleKinds.set(l.code, kind);
      await m.handle.watch();
    }
    expect(settled(net, l.code)).toEqual([]);
    expect(l.party.proveCalls).toEqual([]);
    expect(m.logs).toContain('sweep-kind-vetoed');
    await m.handle.stop();
  });

  it('a desk that could not be opened backs no refund kind (fail safe); release and mutual-cancel are not checked by the shadow (owed under Task 9 R2-M1)', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch, { deskFails: { on: true } });
    const t = await newTrade();
    net.work = [t.work];
    await m.handle.tick();
    net.work = [];
    const party = m.parties.get(t.code)!;
    party.resolveReady(ESCROW);
    net.states.set(t.code, 'setup');
    await expect.poll(async () => {
      await m.handle.watch();
      return net.reports.some((r) => r.kind === 'setup-done' && r.trade === t.code);
    }).toBe(true);
    party.funds = { ...party.funds, balance: FUNDS, unlocked: FUNDS, incoming: [incoming(hash('a'), FUNDS, 88, true)] };
    await m.handle.watch();
    net.states.set(t.code, 'lapsed');
    net.settleKinds.set(t.code, 'lapse-refund');
    party.funds = { ...party.funds, balance: 0n, unlocked: 0n, outgoing: [{ txHash: hash('f'), height: 90, spentAtomic: FUNDS }], ownTxs: [], spendProofs: [{ from: 'seller', txHash: hash('f'), txKey: KEY }, { from: 'buyer', txHash: hash('f'), txKey: '' }] };
    party.prove = () => true;
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'settled' && r.trade === t.code)).toEqual([]);
    expect(party.proveCalls).toEqual([]);
    expect(m.logs).toContain('sweep-kind-vetoed');
    net.states.set(t.code, 'settling');
    net.settleKinds.set(t.code, 'mutual-cancel');
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'settled' && r.trade === t.code)).toEqual([{ kind: 'settled', trade: t.code, txHash: hash('f'), settleKind: 'mutual-cancel' }]);
    await m.handle.stop();
  });
});

describe('sweepKindAgrees (pure)', () => {
  const lapsed = { lapsedAt: new Date(0) } as unknown as NonNullable<DeskRecord['shadow']>;
  const live = { lapsedAt: null } as unknown as NonNullable<DeskRecord['shadow']>;
  const base = { armed: null, cancelSeen: false, paidSeen: false, shadow: live };
  const armed = (kind: 'auto-refund' | 'buyer-cancel') => ({ kind, at: new Date(0) });
  it('backs a refund kind only with its own cause; once a refund is armed, only that kind', () => {
    expect(sweepKindAgrees(base, null)).toBe(true);
    expect(sweepKindAgrees(base, 'release')).toBe(true);
    expect(sweepKindAgrees(base, 'mutual-cancel')).toBe(true);
    expect(sweepKindAgrees(base, 'auto-refund')).toBe(false);
    expect(sweepKindAgrees({ ...base, armed: armed('auto-refund') }, 'auto-refund')).toBe(true);
    expect(sweepKindAgrees(base, 'buyer-cancel')).toBe(false);
    expect(sweepKindAgrees({ ...base, cancelSeen: true }, 'buyer-cancel')).toBe(true);
    expect(sweepKindAgrees({ ...base, cancelSeen: true, paidSeen: true }, 'buyer-cancel')).toBe(false);
    expect(sweepKindAgrees(base, 'lapse-refund')).toBe(false);
    expect(sweepKindAgrees({ ...base, shadow: lapsed }, 'lapse-refund')).toBe(true);
    expect(sweepKindAgrees({ ...base, shadow: null }, 'lapse-refund')).toBe(false);
    for (const k of ['release', 'mutual-cancel', 'buyer-cancel', 'lapse-refund'] as const) {
      expect(sweepKindAgrees({ ...base, cancelSeen: true, shadow: lapsed, armed: armed('auto-refund') }, k), k).toBe(false);
    }
    for (const k of ['release', 'mutual-cancel', 'auto-refund', 'lapse-refund'] as const) {
      expect(sweepKindAgrees({ ...base, cancelSeen: true, shadow: lapsed, armed: armed('buyer-cancel') }, k), k).toBe(false);
    }
    for (const k of ['auto-refund', 'buyer-cancel', 'lapse-refund'] as const) expect(sweepKindAgrees(NO_DESK_FACTS, k), k).toBe(false);
  });
});

describe('buyerCancelStep (pure)', () => {
  const base = { cancelSeen: true, paidSeen: false, api: { state: 'secured', settleKind: null }, recordedRefundAddress: TERMS.sellerRefund, funds: { balance: FUNDS, unlocked: FUNDS }, refundFor: (b: bigint) => [{ address: TERMS.sellerRefund, amountAtomic: b }] };
  it('signs one payout of the whole balance to the recorded address; refuses anything else', () => {
    expect(buyerCancelStep(base)).toEqual({ action: 'sign', proposed: [{ address: TERMS.sellerRefund, amountAtomic: FUNDS }] });
    expect(buyerCancelStep({ ...base, cancelSeen: false })).toEqual({ action: 'none' });
    expect(buyerCancelStep({ ...base, recordedRefundAddress: null })).toEqual({ action: 'wait', reason: 'no-seller-terms' });
    expect(buyerCancelStep({ ...base, funds: { balance: FUNDS, unlocked: 0n } })).toEqual({ action: 'wait', reason: 'not-unlocked' });
    expect(buyerCancelStep({ ...base, paidSeen: true })).toEqual({ action: 'refuse', reason: 'buyer-paid' });
    for (const state of ['funding', 'securing', 'secured']) expect(buyerCancelStep({ ...base, api: { state, settleKind: null } }).action).toBe('sign');
    expect(buyerCancelStep({ ...base, api: { state: 'settling', settleKind: 'buyer-cancel' } }).action).toBe('sign');
    // The retired refund_requested, and the seller's cancel already settling (owner 8 Nov), never.
    for (const [state, settleKind] of [['refund_requested', null], ['settling', 'auto-refund'], ['paid', null], ['settling', 'release'], ['settling', null], ['disputed', null], ['lapsed', 'lapse-refund'], ['released', null], ['cancelled', null], ['setup', null]] as const) {
      expect(buyerCancelStep({ ...base, api: { state, settleKind } })).toEqual({ action: 'wait', reason: 'api-state' });
    }
    // a buyer-built set paying the buyer
    expect(buyerCancelStep({ ...base, refundFor: (b) => [{ address: TERMS.buyerPayout, amountAtomic: b }] })).toEqual({ action: 'refuse', reason: 'wrong-destination' });
    expect(buyerCancelStep({ ...base, refundFor: (b) => [{ address: TERMS.sellerRefund, amountAtomic: b - 1n }] })).toEqual({ action: 'refuse', reason: 'wrong-destination' });
  });
});

describe('rulings', () => {
  it('the ruling gate only decides: nothing in it calls settle (the executor, execute.ts, does)', () => {
    // Plan 4 Task 13 replaced Plan 3's refuse-everything `verifyRuling` with the gate (gate.test.ts).
    // Task 14's executor (execute.ts) is the one place a ruling reaches `settle`: the gate only answers.
    // Review M3: every file under gate/ and cli/, recursively. With the comments stripped, none calls
    // or names `.settle`, none imports anything from @x2f/escrow but types, and none imports the party,
    // the desk, the watcher or the service (where a PartyHandle comes from).
    const files = (rel: string): string[] =>
      readdirSync(new URL(rel, import.meta.url), { recursive: true, withFileTypes: true })
        .filter((e) => e.isFile() && /\.ts$/.test(e.name))
        .map((e) => `${e.parentPath}/${e.name}`);
    const all = [...files('../src/gate/'), ...files('../src/cli/')];
    expect(all.length).toBeGreaterThan(5);
    for (const f of all) {
      const code = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
      expect(code, f).not.toMatch(/\bsettle\s*\(|\.settle\b|PartyHandle/);
      for (const m of code.matchAll(/^\s*import\s+(type\s+)?[^;]*?from\s+'([^']+)'/gm)) {
        if (m[2] === '@x2f/escrow') expect(m[1], `${f}: ${m[0]}`).toBeDefined();
        expect(m[2], f).not.toMatch(/(^|\/)(party|desk|watcher|main|autoRefund|buyerCancel)\.js$/);
      }
      expect(code, f).not.toMatch(/import\(\s*'[^']*(party|desk|watcher|main)\.js'/);
    }
  });
});

describe('a lost device (spec 9)', () => {
  it('the buyer’s store is gone after funding: a new identity cannot cancel; the trade ends only by the auto-refund or an escalation', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    // The buyer's device lost its trade identity: a reinstalled app makes a new one. Its cancel
    // (and any mutual cancel it would co-sign) cannot be from the attested buyer.
    const reborn = { role: 'buyer' as const, id: await generateIdentity(), seq: 0 };
    await signal(l, reborn, 'trade.cancel', {});
    await drained();
    await m.handle.watch();
    expect((await record(l.code)).cancelSeen).toBe(false);
    expect(l.party.settles).toEqual([]);
    // The seller's cancel after the time to pay still works: the refund is signed at once (owner 8 Nov).
    later(ctx, 91 * MIN);
    await acked(l, l.seller, 'trade.refund-request', {});
    net.states.set(l.code, 'settling');
    net.settleKinds.set(l.code, 'auto-refund');
    await m.handle.watch();
    expect(l.party.settles).toEqual([{ kind: 'release', to: [{ address: TERMS.sellerRefund, amountAtomic: FUNDS }], builder: 'seller', cosigner: 'mod' }]);
    await m.handle.stop();
  });
});
