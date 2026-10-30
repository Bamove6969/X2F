// Plan 3 Task 10: the guarded buyer no-show auto-refund, from signed terms and signals only.
// Hermetic (see harness.ts): the real moderation service, desks and signals with real envelopes; the
// escrow party is a recorder. That the party co-signs ONLY a tx set equal to the outcome handed to
// settle() (a seller-built refund paying any other address is refused, nothing broadcast) is Plan
// 1's checkTxSet/cosign, tested on regtest in packages/escrow; here every settle() call is checked.
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { FINAL_ALERT_MS } from '@x2f/escrow';
import { fiatCents, newTrade as machineTrade, apply, type Trade } from '@x2f/trade';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ALERT_LATE_MS, AUTO_REFUND_MARGIN_MS, autoRefundStep, PAID_CONFLICT_MS, REFUND_UNVERIFIED_MS, type AutoRefundInputs } from '../src/autoRefund.js';
import { fromJson } from '../src/shadow.js';
import type { DeskRecord } from '../src/desk.js';
import {
  acked,
  acksFor,
  DEAL,
  drained,
  ESCROW,
  hash,
  incoming,
  fakeNetwork,
  FUNDS,
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
  type Live,
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
const REFUND = { kind: 'release', to: [{ address: TERMS.sellerRefund, amountAtomic: FUNDS }], builder: 'seller', cosigner: 'mod' };
const PAID = { amountAtomic: DEAL.takeAmountAtomic, fiatCents: fiatCents(DEAL.takeAmountAtomic, { currency: 'USD', centsPerXmr: DEAL.centsPerXmr }) };

/** Secured, the payment window over, the seller's refund request opened: returns the shadow's finalAlertAt. */
async function refundRequested(l: Live): Promise<Date> {
  await secured(ctx, l);
  later(ctx, 91 * MIN);
  await acked(l, l.seller, 'trade.refund-request', {});
  l.net.states.set(l.code, 'refund_requested');
  const rec = await record(l.code);
  expect(rec.shadow!.state).toBe('refund_requested');
  l.net.alerts.set(l.code, rec.shadow!.finalAlertAt!); // the API's own alert, at the same moment
  return rec.shadow!.finalAlertAt!;
}

const at = (d: Date, ms: number): Date => new Date(d.getTime() + ms);
/** The API's mark-paid window plus the margin (review I1, M1). */
const END = FINAL_ALERT_MS + AUTO_REFUND_MARGIN_MS;

describe('the auto-refund', () => {
  it('signs nothing at finalAlertAt + 15 min + margin − 1 ms; at + 15 min + margin + 1 ms co-signs the seller-built refund of the whole balance to the SELLER-SIGNED address', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    const alertAt = await refundRequested(l);
    net.seen.set(l.code, alertAt); // the buyer's device showed the alert at once
    ctx.clock.now = at(alertAt, FINAL_ALERT_MS + 1); // the API's mark-paid just closed: the margin still waits
    await m.handle.watch();
    ctx.clock.now = at(alertAt, END - 1);
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    ctx.clock.now = at(alertAt, END + 1);
    await m.handle.watch();
    expect(l.party.settles).toEqual([REFUND]);
    // asked once; the next pass with the same balance does not ask again
    await m.handle.watch();
    expect(l.party.settles).toHaveLength(1);
    expect((await record(l.code)).armed?.kind).toBe('auto-refund');
    // every signal was acked to its sender only
    expect(await acksFor(l, l.seller)).toEqual(['trade.ack:trade.terms', 'trade.ack:trade.refund-request']);
    expect(await acksFor(l, l.buyer)).toEqual(['trade.ack:trade.terms']);
    await m.handle.stop();
  });

  it('the API’s seller_refund overwritten with an attacker address: the refund still pays only the seller-signed address', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    // The API now serves the trade with an attacker's addresses (its work list and anything else):
    // the moderator never reads them again. A terms signal with the attacker's address, even signed
    // by the seller's own identity, is never adopted (it differs from what was attested).
    net.work = [{ ...(await newTrade(OTHER_TERMS)).work, trade: l.code }];
    await m.handle.tick();
    await signal(l, l.seller, 'trade.terms', { refundAddress: OTHER_TERMS.sellerRefund, deal: DEAL });
    await drained();
    expect(m.logs).toContain('signal-terms-mismatch');
    const alertAt = await refundRequested(l);
    net.seen.set(l.code, alertAt);
    ctx.clock.now = at(alertAt, END + 1);
    await m.handle.watch();
    expect(l.party.settles).toEqual([REFUND]);
    const { rows } = await ctx.db.query<{ seller_terms: { address: string } }>('select seller_terms from signed_terms where trade = $1', [l.code]);
    expect(rows[0]!.seller_terms.address).toBe(TERMS.sellerRefund);
    await m.handle.stop();
  });

  it('the API reports refund_requested while the moderator opened a valid trade.paid: nothing is signed, ever; a definite conflict escalates at once (review M7)', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    later(ctx, 30 * MIN);
    await acked(l, l.buyer, 'trade.paid', PAID);
    expect((await record(l.code)).shadow!.state).toBe('paid');
    later(ctx, 61 * MIN);
    // The (lying) API says the seller asked for a refund and the buyer saw the alert.
    net.states.set(l.code, 'refund_requested');
    net.seen.set(l.code, ctx.clock.now);
    net.alerts.set(l.code, ctx.clock.now);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.trade === l.code && r.kind === 'refund-unverified')).toHaveLength(1);
    later(ctx, REFUND_UNVERIFIED_MS);
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    expect(net.reports.filter((r) => r.trade === l.code && r.kind === 'refund-unverified')).toHaveLength(1);
    await m.handle.stop();
  });

  it('a trade.paid opened just before the API shows it paid is a race, not a conflict: no escalation within the grace (review M7)', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    const alertAt = await refundRequested(l);
    net.seen.set(l.code, alertAt);
    ctx.clock.now = at(alertAt, 5 * MIN);
    await acked(l, l.buyer, 'trade.paid', PAID);
    await m.handle.watch(); // the watch list was read before the API took the mark-paid
    ctx.clock.now = at(alertAt, 5 * MIN + PAID_CONFLICT_MS - 1);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'refund-unverified')).toEqual([]);
    net.states.set(l.code, 'paid');
    ctx.clock.now = at(alertAt, 5 * MIN + PAID_CONFLICT_MS + 1);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'refund-unverified')).toEqual([]);
    expect(l.party.settles).toEqual([]);
    await m.handle.stop();
  });

  it('P3-I3: refund requested, the buyer marks paid within the final alert: the moderator never signs the refund (the seller–buyer release is the only tx)', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    const alertAt = await refundRequested(l);
    net.seen.set(l.code, alertAt);
    ctx.clock.now = at(alertAt, 5 * MIN);
    await acked(l, l.buyer, 'trade.paid', PAID);
    expect((await record(l.code)).shadow!.state).toBe('paid');
    net.states.set(l.code, 'paid');
    ctx.clock.now = at(alertAt, END + 1);
    await m.handle.watch();
    // the seller releases (seller builds, buyer co-signs: the moderator's party is not asked)
    net.states.set(l.code, 'settling');
    later(ctx, 30 * MIN);
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    await m.handle.stop();
  });

  it('no seen-receipt 15 min after the alert → escalates (alert-unseen), nothing signed; once', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    const alertAt = await refundRequested(l);
    ctx.clock.now = at(alertAt, END - 1);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'alert-unseen')).toEqual([]);
    ctx.clock.now = at(alertAt, END + 1);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'alert-unseen')).toEqual([{ kind: 'alert-unseen', trade: l.code }]);
    // a receipt landing afterwards changes nothing: escalated is final here
    net.seen.set(l.code, ctx.clock.now);
    later(ctx, 20 * MIN);
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    expect(net.reports.filter((r) => r.kind === 'alert-unseen')).toHaveLength(1);
    await m.handle.stop();
  });

  it('a receipt at most 2 min after the alert: waits, and signs only at receipt + 15 min + margin', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    const alertAt = await refundRequested(l);
    const seenAt = at(alertAt, ALERT_LATE_MS);
    net.seen.set(l.code, seenAt);
    ctx.clock.now = at(alertAt, END + 1);
    await m.handle.watch();
    ctx.clock.now = at(seenAt, END - 1);
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    expect(net.reports.filter((r) => r.kind === 'alert-unseen' || r.kind === 'alert-late')).toEqual([]);
    ctx.clock.now = at(seenAt, END);
    await m.handle.watch();
    expect(l.party.settles).toEqual([REFUND]);
    await m.handle.stop();
  });

  it('lead decision I2 (b): a receipt more than 2 min after the alert escalates (alert-late) once the window is over; nothing signed', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    const alertAt = await refundRequested(l);
    const seenAt = at(alertAt, 14 * MIN + 50_000); // the push sat with the push service: 10 s left at the API
    net.seen.set(l.code, seenAt);
    ctx.clock.now = at(alertAt, END - 1);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'alert-late')).toEqual([]);
    ctx.clock.now = at(alertAt, END + 1);
    await m.handle.watch();
    expect(net.reports.filter((r) => r.kind === 'alert-late')).toEqual([{ kind: 'alert-late', trade: l.code }]);
    later(ctx, 30 * MIN);
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    expect(net.reports.filter((r) => r.kind === 'alert-late')).toHaveLength(1);
    await m.handle.stop();
  });

  it('review I1 (a): the moderator is down across the pause start; it waits for the API’s pause-shifted alert', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    const alertAt = await refundRequested(l);
    net.seen.set(l.code, at(alertAt, 1 * MIN));
    // The API pauses at +5 min (10 min left) for 55 min; the moderator sees the pause only at +50 min,
    // when its own window is over, so its shadow does not move.
    net.paused.add(l.code);
    ctx.clock.now = at(alertAt, 50 * MIN);
    await m.handle.watch();
    net.paused.delete(l.code);
    const apiAlert = at(alertAt, 55 * MIN);
    net.alerts.set(l.code, apiAlert); // the API's window now ends at alertAt + 70 min
    ctx.clock.now = at(alertAt, 60 * MIN + 15_000);
    await m.handle.watch();
    expect((await record(l.code)).shadow!.finalAlertAt).toEqual(alertAt);
    ctx.clock.now = at(apiAlert, FINAL_ALERT_MS);
    await m.handle.watch();
    ctx.clock.now = at(apiAlert, END - 1);
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    ctx.clock.now = at(apiAlert, END + 1);
    await m.handle.watch();
    expect(l.party.settles).toEqual([REFUND]);
    await m.handle.stop();
  });

  it('review I1 (b): an early refund-request signal, then maintenance in the API’s alert: nothing signed before the API’s shifted window ends', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    later(ctx, 90 * MIN - 1000);
    await acked(l, l.seller, 'trade.refund-request', {}); // before the shadow's payBy: kept pending
    later(ctx, 2000);
    await m.handle.watch();
    const shadowAlert = (await record(l.code)).shadow!.finalAlertAt!;
    // The API took the request 3 min later and paused for 20 min during its alert; the moderator missed the pause.
    const apiAlert = at(shadowAlert, 3 * MIN + 20 * MIN);
    net.states.set(l.code, 'refund_requested');
    net.alerts.set(l.code, apiAlert);
    net.seen.set(l.code, at(shadowAlert, 3 * MIN + 30_000));
    for (const ms of [FINAL_ALERT_MS + 1, END + 1, 25 * MIN]) {
      ctx.clock.now = at(shadowAlert, ms);
      await m.handle.watch();
    }
    ctx.clock.now = at(apiAlert, END - 1);
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    ctx.clock.now = at(apiAlert, END + 1);
    await m.handle.watch();
    expect(l.party.settles).toEqual([REFUND]);
    await m.handle.stop();
  });

  it('maintenance during the final alert: nothing is decided while paused, and the window moves by the pause', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    const alertAt = await refundRequested(l);
    net.seen.set(l.code, alertAt);
    ctx.clock.now = at(alertAt, 5 * MIN);
    net.paused.add(l.code);
    await m.handle.watch();
    ctx.clock.now = at(alertAt, 25 * MIN); // past the unpaused window, still paused
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    net.paused.delete(l.code); // resumed after a 20 min pause: the window now ends at alertAt + 35 min
    net.alerts.set(l.code, at(alertAt, 20 * MIN)); // the API shifted its alert too
    await m.handle.watch();
    ctx.clock.now = at(alertAt, 20 * MIN + END - 1);
    await m.handle.watch();
    expect(l.party.settles).toEqual([]);
    ctx.clock.now = at(alertAt, 20 * MIN + END + 1);
    await m.handle.watch();
    expect(l.party.settles).toEqual([REFUND]);
    await m.handle.stop();
  });

  it('the seller’s refund request opened before the shadow’s own payBy is retried, not lost', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    await secured(ctx, l);
    later(ctx, 90 * MIN - 1000); // the API's clock is a second ahead: it accepted the request
    await acked(l, l.seller, 'trade.refund-request', {});
    expect((await record(l.code)).pending).toEqual(['request-refund']);
    // a resent request is kept once (review M5)
    await acked(l, l.seller, 'trade.refund-request', {});
    expect((await record(l.code)).pending).toEqual(['request-refund']);
    later(ctx, 2000);
    await m.handle.watch();
    const rec = await record(l.code);
    expect(rec.pending).toEqual([]);
    expect(rec.shadow!.state).toBe('refund_requested');
    await m.handle.stop();
  });

  it('after a restart the armed refund is handed to the party again, unchanged', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const m = await moderation(ctx, fetch);
    const l = await inFunding(ctx, m, net);
    const alertAt = await refundRequested(l);
    net.seen.set(l.code, alertAt);
    ctx.clock.now = at(alertAt, END + 1);
    await m.handle.watch();
    expect(l.party.settles).toEqual([REFUND]);
    await m.handle.stop();
    const again = await moderation(ctx, fetch);
    const p = await (async () => {
      await again.handle.watch(); // starts the party again from the moderation database
      return again.parties.get(l.code)!;
    })();
    p.funds = { ...l.party.funds };
    p.resolveReady('ignored');
    await again.handle.watch();
    expect(p.settles).toEqual([REFUND]);
    await again.handle.stop();
  });
});

describe('the desk loses no facts (review M2)', () => {
  it('a desk that failed to open is opened on a later pass, and its shadow catches up from the watcher’s latest facts', async () => {
    const { net, fetch } = fakeNetwork(ctx);
    const deskFails = { on: true };
    const m = await moderation(ctx, fetch, { deskFails });
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
    net.states.set(t.code, 'funding');
    party.funds = { ...party.funds, balance: FUNDS, unlocked: FUNDS, incoming: [incoming(hash('a'), FUNDS, 88, true)] };
    await m.handle.watch(); // the chain is reported while there is no desk
    expect(net.reports.some((r) => r.kind === 'chain' && r.trade === t.code)).toBe(true);
    expect(m.logs).toContain('desk-open-failed');
    net.states.set(t.code, 'secured');
    deskFails.on = false;
    await m.handle.watch(); // opened now; no new chain report, the shadow catches up anyway
    const rec = await record(t.code);
    expect(rec.shadow!.state).toBe('secured');
    expect(rec.shadow!.receivedAtomic).toBe(FUNDS);
    await m.handle.stop();
  });
});

describe('autoRefundStep (pure)', () => {
  const T0 = new Date('2026-10-29T12:00:00Z');
  const atMin = (m: number, ms = 0) => new Date(T0.getTime() + m * MIN + ms);
  const shadowAt = (): Trade => {
    let t = machineTrade(
      { code: 'ABCD2345EFGH6789', offerId: 'o', poster: 'seller', sellerId: 's', buyerId: 'b', methodId: 'm', amountAtomic: DEAL.takeAmountAtomic, lockedRate: { currency: 'USD', centsPerXmr: DEAL.centsPerXmr }, confirmWindowMin: 120, minFiatCents: 1n, maxFiatCents: DEAL.maxFiatCents },
      T0,
    );
    t = apply(t, { type: 'setup-done', escrowAddress: 'E' }, 'system', atMin(1));
    t = apply(t, { type: 'chain', receivedAtomic: FUNDS, unlockedAtomic: FUNDS, confirmations: 10 }, 'system', atMin(10));
    return apply(t, { type: 'request-refund' }, 'seller', atMin(101)); // payBy 100, finalAlertAt 101
  };
  const base = (over: Partial<AutoRefundInputs> = {}): AutoRefundInputs => ({
    now: atMin(117, 1),
    shadow: shadowAt(),
    api: { state: 'refund_requested', finalAlertSeenAt: atMin(101), finalAlertAt: atMin(101) },
    apiRefundSince: atMin(101),
    paidSeen: false,
    recordedRefundAddress: TERMS.sellerRefund,
    funds: { balance: FUNDS, unlocked: FUNDS },
    refundFor: (b) => [{ address: TERMS.sellerRefund, amountAtomic: b }],
    ...over,
  });

  it('signs only when every condition holds', () => {
    expect(autoRefundStep(base())).toEqual({ action: 'sign', proposed: [{ address: TERMS.sellerRefund, amountAtomic: FUNDS }] });
  });

  it('a shadow whose finalAlertAt is not after payBy: nothing signed (refused), escalated after the fallback', () => {
    const s = shadowAt();
    const bad = { ...s, finalAlertAt: s.payBy };
    expect(autoRefundStep(base({ shadow: bad }))).toEqual({ action: 'refuse', reason: 'alert-not-after-deadline' });
    expect(autoRefundStep(base({ shadow: bad, now: atMin(101 + 61) }))).toEqual({ action: 'escalate', report: 'refund-unverified' });
  });

  it('refuses or waits on every other missing fact', () => {
    expect(autoRefundStep(base({ api: { state: 'paid', finalAlertSeenAt: atMin(101), finalAlertAt: atMin(101) } })).action).toBe('wait');
    expect(autoRefundStep(base({ paidSeen: true }))).toEqual({ action: 'wait', reason: 'buyer-paid' });
    expect(autoRefundStep(base({ api: { state: 'refund_requested', finalAlertSeenAt: atMin(101), finalAlertAt: atMin(101), paused: true } }))).toEqual({ action: 'wait', reason: 'paused' });
    expect(autoRefundStep(base({ recordedRefundAddress: null }))).toEqual({ action: 'wait', reason: 'no-seller-terms' });
    expect(autoRefundStep(base({ shadow: null }))).toEqual({ action: 'wait', reason: 'shadow-not-refund-requested' });
    expect(autoRefundStep(base({ now: atMin(117, -1) }))).toEqual({ action: 'wait', reason: 'final-alert-pending' });
    expect(autoRefundStep(base({ api: { state: 'refund_requested', finalAlertSeenAt: null, finalAlertAt: atMin(101) } }))).toEqual({ action: 'escalate', report: 'alert-unseen' });
    expect(autoRefundStep(base({ api: { state: 'refund_requested', finalAlertSeenAt: atMin(102), finalAlertAt: atMin(101) } }))).toEqual({ action: 'wait', reason: 'receipt-too-recent' });
    expect(autoRefundStep(base({ api: { state: 'refund_requested', finalAlertSeenAt: atMin(103), finalAlertAt: atMin(101) }, now: atMin(119, 1) })).action).toBe('sign');
    expect(autoRefundStep(base({ api: { state: 'refund_requested', finalAlertSeenAt: atMin(103, 1), finalAlertAt: atMin(101) } }))).toEqual({ action: 'escalate', report: 'alert-late' });
    // the API's own alert, missing or later than the shadow's (review I1)
    expect(autoRefundStep(base({ api: { state: 'refund_requested', finalAlertSeenAt: atMin(101), finalAlertAt: null } }))).toEqual({ action: 'wait', reason: 'api-final-alert-missing' });
    expect(autoRefundStep(base({ api: { state: 'refund_requested', finalAlertSeenAt: atMin(101), finalAlertAt: null }, now: atMin(101 + 61) }))).toEqual({ action: 'escalate', report: 'refund-unverified' });
    expect(autoRefundStep(base({ api: { state: 'refund_requested', finalAlertSeenAt: atMin(101), finalAlertAt: atMin(130) } }))).toEqual({ action: 'wait', reason: 'final-alert-pending' });
    expect(autoRefundStep(base({ api: { state: 'refund_requested', finalAlertSeenAt: atMin(101), finalAlertAt: atMin(130) }, now: atMin(146, 1) })).action).toBe('sign');
    // a trade.paid seen while the API still shows refund_requested (review M7)
    expect(autoRefundStep(base({ paidSeen: true, paidSeenAt: atMin(115, 2) }))).toEqual({ action: 'wait', reason: 'buyer-paid' });
    expect(autoRefundStep(base({ paidSeen: true, paidSeenAt: atMin(115) }))).toEqual({ action: 'escalate', report: 'refund-unverified' });
    expect(autoRefundStep(base({ funds: { balance: FUNDS, unlocked: FUNDS - 1n } }))).toEqual({ action: 'wait', reason: 'not-unlocked' });
    expect(autoRefundStep(base({ refundFor: (b) => [{ address: OTHER_TERMS.sellerRefund, amountAtomic: b }] }))).toEqual({ action: 'refuse', reason: 'wrong-destination' });
    expect(autoRefundStep(base({ refundFor: (b) => [{ address: TERMS.sellerRefund, amountAtomic: b - 1n }, { address: TERMS.buyerPayout, amountAtomic: 1n }] }))).toEqual({ action: 'refuse', reason: 'wrong-destination' });
    expect(autoRefundStep(base({ refundFor: () => { throw new RangeError('x'); } }))).toEqual({ action: 'refuse', reason: 'no-payout' });
  });
});

describe('the only paths to settle() as the moderator', () => {
  it('apps/moderation calls settle() in desk.ts alone, and only with the guarded refunds', () => {
    const dir = fileURLToPath(new URL('../src/', import.meta.url));
    const callers = readdirSync(dir).filter((f) => f.endsWith('.ts') && /\.settle\(/.test(readFileSync(dir + f, 'utf8')));
    expect(callers).toEqual(['desk.ts']);
    const desk = readFileSync(dir + 'desk.ts', 'utf8');
    expect(desk.match(/\.settle\(/g)).toHaveLength(1);
  });
});
