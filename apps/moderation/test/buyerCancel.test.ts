// Plan 3 Task 10: the buyer-cancel refund (spec 2.3), rulings, and the lost device (spec 9).
// Hermetic (see harness.ts and the note at the top of autoRefund.test.ts).
import { generateIdentity } from '@x2f/protocol';
import { FINAL_ALERT_MS } from '@x2f/escrow';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buyerCancelStep } from '../src/buyerCancel.js';
import { verifyRuling } from '../src/rulings.js';
import { fromJson } from '../src/shadow.js';
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

describe('buyerCancelStep (pure)', () => {
  const base = { cancelSeen: true, recordedRefundAddress: TERMS.sellerRefund, funds: { balance: FUNDS, unlocked: FUNDS }, refundFor: (b: bigint) => [{ address: TERMS.sellerRefund, amountAtomic: b }] };
  it('signs one payout of the whole balance to the recorded address; refuses anything else', () => {
    expect(buyerCancelStep(base)).toEqual({ action: 'sign', proposed: [{ address: TERMS.sellerRefund, amountAtomic: FUNDS }] });
    expect(buyerCancelStep({ ...base, cancelSeen: false })).toEqual({ action: 'none' });
    expect(buyerCancelStep({ ...base, recordedRefundAddress: null })).toEqual({ action: 'wait', reason: 'no-seller-terms' });
    expect(buyerCancelStep({ ...base, funds: { balance: FUNDS, unlocked: 0n } })).toEqual({ action: 'wait', reason: 'not-unlocked' });
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
    ctx.clock.now = new Date(alertAt.getTime() + FINAL_ALERT_MS + 1);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.trade === l.code && r.kind === 'alert-unseen')).toHaveLength(1);
    expect(l.party.settles).toEqual([]);
    await m.handle.stop();
  });
});
