/**
 * When the refund screens open and what their buttons allow (Task 25). Every answer is the
 * @x2f/trade state machine's own: the view is turned back into a `Trade` and the event is run
 * through `apply` (a dry run, nothing is sent). So the screen and the API can never disagree on
 * a rule, and the rules live in one place (packages/trade/src/machine.ts).
 *
 * The rebuilt trade carries every field the view has. Fields the view leaves out (the two
 * account ids, the seller funds once funded, the offer minimum, the confirm window) get neutral
 * stand-ins; `extend`, `request-refund` and `mark-paid` never read them (test/refundRules.test.ts
 * checks the answers against the machine on real trades). Only these three events are asked.
 */
import { apply, nextDeadline, TradeRuleError, type Party, type Trade, type TradeRuleCode } from '@x2f/trade';
import type { RefundView } from './refundSlot.js';

/** The events these screens post. */
export type RefundEvent = { type: 'extend' } | { type: 'request-refund' } | { type: 'mark-paid'; fiatCents: bigint };

function date(s: string | null, name: string): Date | null {
  if (s === null) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) throw new RangeError(`unreadable ${name}`);
  return d;
}

function atomic(s: string, name: string): bigint {
  if (typeof s !== 'string' || !/^(0|[1-9][0-9]*)$/.test(s)) throw new RangeError(`unreadable ${name}`);
  return BigInt(s);
}

/** The view as a `Trade` for `apply`; throws RangeError on a field it cannot read. */
export function tradeFromView(v: RefundView): Trade {
  const amountAtomic = atomic(v.amountAtomic, 'amount');
  const received = atomic(v.receivedAtomic, 'received');
  const takenAt = date(v.takenAt, 'takenAt');
  if (takenAt === null) throw new RangeError('unreadable takenAt');
  return {
    code: v.code,
    offerId: '',
    poster: v.poster,
    // Stand-ins (not in the view): distinct, so nothing reads them as the same account.
    sellerId: 'seller',
    buyerId: 'buyer',
    methodId: v.methodId,
    amountAtomic,
    feeAtomic: 0n,
    sellerFundsAtomic: amountAtomic,
    lockedRate: { currency: v.lockedRate.currency, centsPerXmr: atomic(v.lockedRate.centsPerXmr, 'rate') },
    fiatCents: atomic(v.fiatCents, 'fiat total'),
    confirmWindowMin: 1,
    minFiatCents: 1n,
    // not-a-refusal: a field name in a developer error
    maxFiatCents: atomic(v.maxFiatCents, 'offer maximum'),
    grown: null,
    state: v.state,
    escrowAddress: null,
    receivedAtomic: received,
    unlockedAtomic: v.releasable ? received : 0n,
    confirmations: v.confirmations,
    releasable: v.releasable,
    takenAt,
    setupBy: date(v.setupBy, 'setupBy'),
    fundBy: date(v.fundBy, 'fundBy'),
    fundingSeenAt: date(v.fundingSeenAt, 'fundingSeenAt'),
    fundStartedAt: date(v.fundStartedAt ?? null, 'fundStartedAt'),
    lapsedAt: null,
    securedAt: date(v.securedAt, 'securedAt'),
    payBy: date(v.payBy, 'payBy'),
    extensions: v.extensions,
    paidAt: date(v.paidAt, 'paidAt'),
    confirmBy: date(v.confirmBy, 'confirmBy'),
    finalAlertAt: date(v.finalAlertAt, 'finalAlertAt'),
    cancelProposedBy: v.cancelProposedBy,
    settling: v.settling,
    settleFrom: null,
    settleBy: date(v.settleBy, 'settleBy'),
    pausedAt: date(v.pausedAt, 'pausedAt'),
    txHash: v.txHash,
    dispute: null,
    closedAt: date(v.closedAt, 'closedAt'),
    cancelConfirmedAt: date(v.cancelConfirmedAt ?? null, 'cancelConfirmedAt'),
    cancelConfirmableAt: date(v.cancelConfirmableAt ?? null, 'cancelConfirmableAt'),
    sellerNudgedAt: date(v.sellerNudgedAt ?? null, 'sellerNudgedAt'),
  };
}

/** The machine's rule code for this event now, or null when it would accept it. Throws RangeError on an unreadable view. */
export function refusalFor(v: RefundView, e: RefundEvent, by: Party, now: Date): TradeRuleCode | null {
  const t = tradeFromView(v);
  try {
    apply(t, e, by, now);
    return null;
  } catch (err) {
    if (err instanceof TradeRuleError) return err.code;
    throw err;
  }
}

/** Accepted now by the machine; an unreadable view allows nothing. */
function allowed(v: RefundView, e: RefundEvent, by: Party, now: Date): boolean {
  try {
    return refusalFor(v, e, by, now) === null;
  } catch (err) {
    if (err instanceof RangeError) return false;
    throw err;
  }
}

/** The seller may tap "Cancel and get refund" now (server clock): the 90 minutes are over and they have nudged (owner G2). */
export function canRequestRefund(v: RefundView, now: Date): boolean {
  return v.role === 'seller' && allowed(v, { type: 'request-refund' }, 'seller', now);
}

/**
 * The view as if the seller nudged right now: what the machine would say once they nudge. `now`
 * is the server clock, never before `securedAt` in `secured`, so the nudge counts.
 */
const asNudged = (v: RefundView, now: Date): RefundView => ({ ...v, sellerNudgedAt: now.toISOString() });

/**
 * Owner G2 / g66: the window is over but Cancel is still locked only because the seller has not
 * nudged the buyer since the escrow was secured. The screen then makes Nudge the primary.
 */
export function refundNeedsNudge(v: RefundView, now: Date): boolean {
  return v.role === 'seller' && !canRequestRefund(v, now) && allowed(asNudged(v, now), { type: 'request-refund' }, 'seller', now);
}

/** The seller may tap "Give 30 more min" now: the window has ended and fewer than two extensions were used. */
export function canExtend(v: RefundView, now: Date): boolean {
  return v.role === 'seller' && allowed(v, { type: 'extend' }, 'seller', now);
}

/**
 * The trade-room slot guard for SellerRefund (`when`): the seller, in `secured`, once the buyer's
 * payment window has passed by the server clock. That is exactly when the machine accepts
 * `request-refund` from a seller who has nudged, so the final alert can only start after the
 * window (Global Constraints). It opens before the first nudge too: Cancel shows locked there and
 * Nudge is the primary (owner G2, `refundNeedsNudge`).
 */
export function sellerRefundOpen(v: RefundView, nowMs: number): boolean {
  const now = new Date(nowMs);
  return v.state === 'secured' && (canRequestRefund(v, now) || refundNeedsNudge(v, now));
}

/** FinalAlert is the buyer's screen while the seller's refund request is open. */
export function showFinalAlert(v: Pick<RefundView, 'role' | 'state'>): boolean {
  return v.role === 'buyer' && v.state === 'refund_requested';
}

/** When the final alert ends (the machine's `nextDeadline`: finalAlertAt + 15 min), or null while paused or unreadable. */
export function finalAlertEnds(v: RefundView): Date | null {
  try {
    return v.state === 'refund_requested' ? nextDeadline(tradeFromView(v)) : null;
  } catch (err) {
    if (err instanceof RangeError) return null;
    throw err;
  }
}

/** The buyer may still tap I've paid (the machine refuses `too-late` once the alert has ended). */
export function canMarkPaid(v: RefundView, now: Date): boolean {
  let fiatCents: bigint;
  try {
    fiatCents = atomic(v.fiatCents, 'fiat total');
  } catch {
    return false;
  }
  return v.role === 'buyer' && allowed(v, { type: 'mark-paid', fiatCents }, 'buyer', now);
}
