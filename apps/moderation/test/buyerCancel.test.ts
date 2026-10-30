// Plan 3 Task 10: the buyer-cancel refund (spec 2.3), rulings, and the lost device (spec 9).
// Hermetic (see harness.ts and the note at the top of autoRefund.test.ts).
import { generateIdentity } from '@x2f/protocol';
import { FINAL_ALERT_MS } from '@x2f/escrow';
import { fiatCents } from '@x2f/trade';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AUTO_REFUND_MARGIN_MS } from '../src/autoRefund.js';
import { buyerCancelStep } from '../src/buyerCancel.js';
import { verifyRuling } from '../src/rulings.js';
import { fromJson, toJson } from '../src/shadow.js';
import type { DeskRecord } from '../src/desk.js';
import {
  acked,
  DEAL,
  drained,
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
  secured,
  signal,
  TERMS,
  type Ctx,
} from './harness.js';

let ctx: Ctx;
beforeAll(async () => {
  ctx = await makeCtx();
});
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
    expect(net.reports.some((r) => r.kind === 'alert-unseen' || r.kind === 'refund-unverified')).toBe(false);
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
    expect(m.logs).toContain('buyer-cancel-buyer-paid');
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
    net.states.set(l.code, 'refund_requested');
    await m.handle.watch();
    later(ctx, 61 * MIN);
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
});

describe('buyerCancelStep (pure)', () => {
  const base = { cancelSeen: true, paidSeen: false, api: { state: 'secured', settleKind: null }, recordedRefundAddress: TERMS.sellerRefund, funds: { balance: FUNDS, unlocked: FUNDS }, refundFor: (b: bigint) => [{ address: TERMS.sellerRefund, amountAtomic: b }] };
  it('signs one payout of the whole balance to the recorded address; refuses anything else', () => {
    expect(buyerCancelStep(base)).toEqual({ action: 'sign', proposed: [{ address: TERMS.sellerRefund, amountAtomic: FUNDS }] });
    expect(buyerCancelStep({ ...base, cancelSeen: false })).toEqual({ action: 'none' });
    expect(buyerCancelStep({ ...base, recordedRefundAddress: null })).toEqual({ action: 'wait', reason: 'no-seller-terms' });
    expect(buyerCancelStep({ ...base, funds: { balance: FUNDS, unlocked: 0n } })).toEqual({ action: 'wait', reason: 'not-unlocked' });
    expect(buyerCancelStep({ ...base, paidSeen: true })).toEqual({ action: 'refuse', reason: 'buyer-paid' });
    for (const state of ['funding', 'securing', 'secured', 'refund_requested']) expect(buyerCancelStep({ ...base, api: { state, settleKind: null } }).action).toBe('sign');
    expect(buyerCancelStep({ ...base, api: { state: 'settling', settleKind: 'buyer-cancel' } }).action).toBe('sign');
    for (const [state, settleKind] of [['paid', null], ['settling', 'release'], ['settling', null], ['disputed', null], ['lapsed', 'lapse-refund'], ['released', null], ['cancelled', null], ['setup', null]] as const) {
      expect(buyerCancelStep({ ...base, api: { state, settleKind } })).toEqual({ action: 'wait', reason: 'api-state' });
    }
    // a buyer-built set paying the buyer
    expect(buyerCancelStep({ ...base, refundFor: (b) => [{ address: TERMS.buyerPayout, amountAtomic: b }] })).toEqual({ action: 'refuse', reason: 'wrong-destination' });
    expect(buyerCancelStep({ ...base, refundFor: (b) => [{ address: TERMS.sellerRefund, amountAtomic: b - 1n }] })).toEqual({ action: 'refuse', reason: 'wrong-destination' });
  });
});

describe('rulings', () => {
  it('verifyRuling refuses every input in Plan 3', () => {
    for (const r of [undefined, null, {}, { ok: true }, 'ruling', 1, [], { kind: 'release', to: [{ address: TERMS.buyerPayout, amountAtomic: FUNDS }], sig: 'aa' }]) {
      expect(verifyRuling(r)).toBe(false);
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
    // The seller's no-show refund still works; without a receipt it would escalate instead.
    later(ctx, 91 * MIN);
    await acked(l, l.seller, 'trade.refund-request', {});
    net.states.set(l.code, 'refund_requested');
    const alertAt = (await record(l.code)).shadow!.finalAlertAt!;
    net.alerts.set(l.code, alertAt);
    ctx.clock.now = new Date(alertAt.getTime() + FINAL_ALERT_MS + AUTO_REFUND_MARGIN_MS + 1);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.trade === l.code && r.kind === 'alert-unseen')).toHaveLength(1);
    expect(l.party.settles).toEqual([]);
    await m.handle.stop();
  });
});
