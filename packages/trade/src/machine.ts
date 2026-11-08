/**
 * The trade state machine. `apply` is pure: it takes the trade, one event,
 * who sent it (taken from the session or 'system', never from the request
 * body) and the server's clock, and returns the next trade or throws a
 * TradeRuleError. It does no I/O and never reads the device clock.
 */
import { amountForFunds, escrowPlan, fiatCents as fiatFor, type Price } from './money.js';
import { SETTLE_KINDS, type SettleKind } from './payouts.js';
import { SELLER_CONFIRM_CANCEL_TIMEOUT_H, TIMERS, UNLOCK_CONFIRMATIONS, addMin } from './timers.js';

export type TradeState =
  | 'setup'
  | 'funding'
  | 'securing'
  | 'secured'
  | 'paid'
  | 'refund_requested'
  | 'settling'
  | 'released'
  | 'refunded'
  | 'lapsed'
  | 'cancelled'
  | 'disputed';

export type Party = 'buyer' | 'seller';
export type By = Party | 'system';

export interface Trade {
  code: string;
  offerId: string;
  poster: 'seller' | 'buyer';
  sellerId: string;
  buyerId: string;
  methodId: string;
  amountAtomic: bigint;
  feeAtomic: bigint;
  sellerFundsAtomic: bigint;
  /** Fixed at take (OD-5). */
  lockedRate: Price;
  /** Fixed at take (OD-5). */
  fiatCents: bigint;
  confirmWindowMin: number;
  /** The offer's limits at take, as fiat totals in lockedRate's currency; a grown trade stays within them. */
  minFiatCents: bigint;
  maxFiatCents: bigint;
  /**
   * Set when extra XMR arrived before "I've paid" and the trade grew to the
   * funded amount (spec 11.1, owner 2026-10-20). `at` changes on every growth,
   * so both apps can tell their user the new totals; `from*` are the totals at take.
   */
  grown: { at: Date; fromAtomic: bigint; fromFiatCents: bigint } | null;
  state: TradeState;
  escrowAddress: string | null;
  /** The escrow's whole balance. */
  receivedAtomic: bigint;
  unlockedAtomic: bigint;
  /** The lowest confirmation count among the escrow's incoming transactions. */
  confirmations: number;
  /** Every coin in the escrow is unlocked (received > 0 && unlocked === received). */
  releasable: boolean;
  takenAt: Date;
  setupBy: Date | null;
  fundBy: Date | null;
  fundingSeenAt: Date | null;
  /**
   * When the seller tapped "Fund escrow" (the `fund-started` event, Revision 2026-10-29b): from
   * then on the seller can never walk away (`walk-away` → wrong-state).
   */
  fundStartedAt: Date | null;
  /** When the funding window lapsed (for the lapse co-sign timer). */
  lapsedAt: Date | null;
  securedAt: Date | null;
  payBy: Date | null;
  extensions: number;
  paidAt: Date | null;
  confirmBy: Date | null;
  finalAlertAt: Date | null;
  cancelProposedBy: Party | null;
  settling: SettleKind | null;
  settleFrom: TradeState | null;
  settleBy: Date | null;
  /**
   * When the moderation service reported a trade party's sealed post-release info for this
   * settling episode (`release-claimed`, Task 9 I/O, lead decision b, 2026-10-29). While set the
   * signing window no longer returns the trade to `settleFrom`: it stays `settling` until the
   * sweep is shown (`settled`) or the watcher's 6 h fallback escalates it. Null outside a claim.
   */
  releaseClaimedAt: Date | null;
  pausedAt: Date | null;
  txHash: string | null;
  dispute: { by: By; at: Date } | null;
  closedAt: Date | null;
  /**
   * The seller's "Confirm cancel" after a buyer-cancel refund (owner 2026-10-29, option B with a
   * seller confirm step): the trade is officially cancelled only from then; before it, both apps
   * say "Cancelling: returning the XMR to the seller".
   */
  cancelConfirmedAt: Date | null;
  /**
   * When the seller's Confirm cancel became available: the server first saw the buyer-cancel
   * refund with all its confirmations (system event `return-confirmed`). The trade closes as
   * cancelled by itself SELLER_CONFIRM_CANCEL_TIMEOUT_H after it (owner 2026-10-29).
   */
  cancelConfirmableAt: Date | null;
  /**
   * When the seller first nudged the buyer in this trade after the escrow was secured (owner G2,
   * 7 Nov; g66). Written by the nudge route (apps/api nudge/routes.ts), never by an event: the
   * seller's `request-refund` is refused until it is set, so the refund unlocks only after the
   * 90 minutes from full funding AND at least one nudge. Later nudges (one per 15 min, as many as
   * the seller likes) leave it as it is.
   */
  sellerNudgedAt: Date | null;
}

export type TradeEvent =
  | { type: 'setup-done'; escrowAddress: string }
  | { type: 'chain'; receivedAtomic: bigint; unlockedAtomic: bigint; confirmations: number }
  /** `fiatCents` is the total the buyer confirmed paying; refused `total-changed` unless it is the trade's total now. */
  | { type: 'mark-paid'; fiatCents: bigint }
  | { type: 'extend' }
  | { type: 'request-refund' }
  | { type: 'buyer-cancel' }
  | { type: 'propose-cancel' }
  | { type: 'accept-cancel' }
  | { type: 'withdraw-cancel' }
  /** The seller tapped "Fund escrow" (Revision 2026-10-29b): recorded once, in `funding`. */
  | { type: 'fund-started' }
  /**
   * The seller confirms a buyer's cancel once the returned XMR has all its confirmations (owner
   * 2026-10-29). `returnConfirmations` is read by the server from its own node for the trade's
   * refund tx, never taken from the request.
   */
  | { type: 'confirm-cancel'; returnConfirmations: number }
  /** The server saw the buyer-cancel refund tx with all its confirmations (its own node): Confirm cancel is now available. */
  | { type: 'return-confirmed'; confirmations: number }
  /** The seller ends the trade before funding (Revision 2026-10-29b): only before "Fund escrow" and before any coins. */
  | { type: 'walk-away' }
  | { type: 'release-started' }
  | { type: 'settled'; kind: SettleKind; txHash: string }
  | { type: 'open-dispute' }
  | { type: 'escalate' }
  | { type: 'release-claimed' }
  | { type: 'pause' }
  | { type: 'resume' }
  /**
   * The server cancels a trade whose escrow is not funded and cannot be yet (hold model v3, owner
   * 1-2 Nov 2026: a recovery-code login cancels the account's unfunded trades). Only in `setup`, or
   * in `funding` before the seller tapped "Fund escrow" and before any coins were seen: the same
   * bounds as the seller's walk-away. Accepted while paused.
   */
  | { type: 'system-cancel' }
  | { type: 'tick' };

export const SYSTEM_EVENTS = ['setup-done', 'chain', 'settled', 'escalate', 'release-claimed', 'pause', 'resume', 'tick', 'return-confirmed', 'system-cancel'] as const;
export const CLIENT_EVENTS = [
  'mark-paid',
  'extend',
  'request-refund',
  'buyer-cancel',
  'propose-cancel',
  'accept-cancel',
  'withdraw-cancel',
  'fund-started',
  'walk-away',
  'confirm-cancel',
  'release-started',
  'open-dispute',
] as const;

export type TradeRuleCode = 'wrong-state' | 'wrong-party' | 'too-early' | 'too-late' | 'no-extensions-left' | 'not-releasable' | 'total-changed';

export class TradeRuleError extends Error {
  readonly code: TradeRuleCode;
  constructor(code: TradeRuleCode) {
    super(code);
    this.name = 'TradeRuleError';
    this.code = code;
  }
}

const fail = (code: TradeRuleCode): never => {
  throw new TradeRuleError(code);
};

const SYSTEM = new Set<string>(SYSTEM_EVENTS);
const CLIENT = new Set<string>(CLIENT_EVENTS);

/**
 * States in which either side may propose, accept or withdraw a mutual cancel. Never `paid`: no
 * cancel of any kind after "I've paid" (owner, Revision 2026-10-29b).
 */
const CANCEL_STATES: readonly TradeState[] = ['funding', 'securing', 'secured'];
/** States from which the buyer's cancel becomes a refund settlement (never `paid`, Revision 2026-10-29b). */
const BUYER_CANCEL_SETTLE: readonly TradeState[] = ['securing', 'secured', 'refund_requested'];
const CLOSED: readonly TradeState[] = ['released', 'refunded', 'cancelled'];
/** States in which a settlement seen on chain is recorded: every open state an escrow can hold coins in. */
const SETTLED_FROM: readonly TradeState[] = ['funding', 'securing', 'secured', 'settling', 'disputed', 'paid', 'refund_requested', 'lapsed'];
/** States in which extra XMR grows the trade: before "I've paid" and before any refund or settlement starts. */
const GROW_STATES: readonly TradeState[] = ['funding', 'securing', 'secured'];
/**
 * Client events still accepted while a trade is paused (maintenance, or a party's account hold):
 * the buyer's own payment and cancel, the seller's "Fund escrow" record (it only takes the seller's
 * walk-away away; their wallet opens anyway), the seller's walk-away before funding (nothing has
 * moved), and opening a dispute (owner G7, 7 Nov: a paused trade's parties still reach a moderator;
 * no money moves until the moderator decides; lead hold v3 review item 5).
 */
const WHILE_PAUSED: readonly string[] = ['mark-paid', 'buyer-cancel', 'fund-started', 'walk-away', 'open-dispute'];
/** The longest seller confirm window (wires, 24 h). */
const MAX_CONFIRM_WINDOW_MIN = 1440;

/** A new trade at take: amounts, fee and the fiat total are fixed here (OD-5). */
export function newTrade(
  a: {
    code: string;
    offerId: string;
    poster: 'seller' | 'buyer';
    sellerId: string;
    buyerId: string;
    methodId: string;
    amountAtomic: bigint;
    lockedRate: Price;
    confirmWindowMin: number;
    minFiatCents: bigint;
    maxFiatCents: bigint;
  },
  now: Date,
): Trade {
  checkNow(now);
  if (!Number.isSafeInteger(a.confirmWindowMin) || a.confirmWindowMin <= 0 || a.confirmWindowMin > MAX_CONFIRM_WINDOW_MIN) {
    throw new RangeError('bad confirm window');
  }
  if (a.sellerId === a.buyerId) throw new RangeError('seller and buyer must differ');
  const plan = escrowPlan({ amountAtomic: a.amountAtomic, poster: a.poster });
  const fiat = fiatFor(a.amountAtomic, a.lockedRate);
  if (fiat <= 0n) throw new RangeError('fiat total must be positive');
  if (a.minFiatCents <= 0n || a.minFiatCents > a.maxFiatCents) throw new RangeError('bad offer limits');
  if (fiat < a.minFiatCents || fiat > a.maxFiatCents) throw new RangeError('outside the offer limits');
  return {
    code: a.code,
    offerId: a.offerId,
    poster: a.poster,
    sellerId: a.sellerId,
    buyerId: a.buyerId,
    methodId: a.methodId,
    amountAtomic: a.amountAtomic,
    feeAtomic: plan.feeAtomic,
    sellerFundsAtomic: plan.sellerFundsAtomic,
    lockedRate: { currency: a.lockedRate.currency, centsPerXmr: a.lockedRate.centsPerXmr },
    fiatCents: fiat,
    confirmWindowMin: a.confirmWindowMin,
    minFiatCents: a.minFiatCents,
    maxFiatCents: a.maxFiatCents,
    grown: null,
    state: 'setup',
    escrowAddress: null,
    receivedAtomic: 0n,
    unlockedAtomic: 0n,
    confirmations: 0,
    releasable: false,
    takenAt: now,
    setupBy: addMin(now, TIMERS.setupMin),
    fundBy: null,
    fundingSeenAt: null,
    fundStartedAt: null,
    lapsedAt: null,
    securedAt: null,
    payBy: null,
    extensions: 0,
    paidAt: null,
    confirmBy: null,
    finalAlertAt: null,
    cancelProposedBy: null,
    settling: null,
    settleFrom: null,
    settleBy: null,
    releaseClaimedAt: null,
    pausedAt: null,
    txHash: null,
    dispute: null,
    closedAt: null,
    cancelConfirmedAt: null,
    cancelConfirmableAt: null,
    sellerNudgedAt: null,
  };
}

/**
 * A buyer's cancel whose refund has settled and that the seller has not confirmed yet (owner
 * 2026-10-29): it stays among the seller's active trades ("Your input is needed to cancel this
 * trade."), and timers and maintenance still apply to it although it is closed.
 */
export function awaitingCancelConfirm(t: Pick<Trade, 'state' | 'settling' | 'cancelConfirmedAt' | 'dispute' | 'paidAt'>): boolean {
  // Never once the buyer marked paid: that refund keeps the buyer's dispute instead (review I1).
  return t.state === 'refunded' && t.settling === 'buyer-cancel' && t.cancelConfirmedAt === null && t.dispute === null && t.paidAt === null;
}

/** When an unconfirmed buyer's cancel closes by itself, or null before Confirm cancel became available. */
function cancelAutoCloseAt(t: Trade): Date | null {
  if (!awaitingCancelConfirm(t) || t.cancelConfirmableAt === null) return null;
  return addMin(t.cancelConfirmableAt, SELLER_CONFIRM_CANCEL_TIMEOUT_H * 60);
}

function checkNow(now: Date): void {
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw new RangeError('bad clock');
}

const past = (now: Date, d: Date | null): boolean => d !== null && now.getTime() > d.getTime();

/**
 * The time a new deadline counts from. During maintenance it is the pause, so
 * `resume` (which shifts every deadline at or after the pause by its length)
 * lands it at resume + duration: a deadline set while paused starts at the resume.
 */
const base = (t: Trade, now: Date): Date => t.pausedAt ?? now;

/** Enter `settling` for `kind`; the signing window runs only while every coin is unlocked. */
function startSettling(t: Trade, kind: SettleKind, now: Date): Trade {
  return {
    ...t,
    state: 'settling',
    settling: kind,
    settleFrom: t.state,
    settleBy: t.releasable ? addMin(base(t, now), TIMERS.settleMin) : null,
    releaseClaimedAt: null,
  };
}

function close(t: Trade, state: 'cancelled' | 'released' | 'refunded', now: Date): Trade {
  return { ...t, state, closedAt: now };
}

function onChain(t: Trade, e: Extract<TradeEvent, { type: 'chain' }>, now: Date): Trade {
  const { receivedAtomic: received, unlockedAtomic: unlocked, confirmations } = e;
  if (typeof received !== 'bigint' || typeof unlocked !== 'bigint') throw new RangeError('bad chain facts');
  if (received < 0n || unlocked < 0n || unlocked > received) throw new RangeError('bad chain facts');
  if (!Number.isSafeInteger(confirmations) || confirmations < 0) throw new RangeError('bad chain facts');
  const releasable = received > 0n && unlocked === received;
  let next: Trade = { ...t, receivedAtomic: received, unlockedAtomic: unlocked, confirmations, releasable };
  next = grow(next, now);
  const funded = received >= next.sellerFundsAtomic;

  if (next.state === 'funding' && funded) {
    next = { ...next, state: 'securing', fundingSeenAt: next.fundingSeenAt ?? now };
  }
  if (next.state === 'securing' && funded && releasable) {
    next = { ...next, state: 'secured', securedAt: now, payBy: addMin(base(t, now), TIMERS.payMin) };
  }
  if (next.state === 'settling') {
    if (!releasable) next = { ...next, settleBy: null };
    else if (!t.releasable || t.settleBy === null) next = { ...next, settleBy: addMin(base(t, now), TIMERS.settleMin) };
  }
  return next;
}

/**
 * Extra XMR before "I've paid" (spec 11.1, owner 2026-10-20): when the escrow
 * holds more than the trade needs and the grown trade's fiat total, at the same
 * locked rate, stays within the offer's maximum, the amount, fee and fiat total
 * grow to what was funded. Otherwise nothing changes and the surplus goes to
 * the seller at settlement (payoutsFor).
 *
 * Only releasable coins (every coin unlocked, 10 confirmations) grow the trade,
 * and the size is worked out again from the amount at take on every chain
 * event, so an extra that is dropped or double-spent shrinks the trade back and
 * it never needs more than the escrow holds. While some coins are still locked
 * the trade keeps at most its current size.
 */
function grow(t: Trade, now: Date): Trade {
  if (!GROW_STATES.includes(t.state) || t.paidAt !== null) return t;
  const fromAtomic = t.grown?.fromAtomic ?? t.amountAtomic;
  const fromFiatCents = t.grown?.fromFiatCents ?? t.fiatCents;
  const basis = t.releasable ? t.receivedAtomic : t.receivedAtomic < t.sellerFundsAtomic ? t.receivedAtomic : t.sellerFundsAtomic;
  let amountAtomic = fromAtomic;
  if (basis > escrowPlan({ amountAtomic: fromAtomic, poster: t.poster }).sellerFundsAtomic) {
    const candidate = amountForFunds(basis, t.poster);
    // Above the offer maximum the trade keeps the size it already has; that size is covered by basis.
    if (candidate > fromAtomic) amountAtomic = fiatFor(candidate, t.lockedRate) <= t.maxFiatCents ? candidate : t.amountAtomic;
  }
  if (amountAtomic === t.amountAtomic) return t;
  const plan = escrowPlan({ amountAtomic, poster: t.poster });
  const back = amountAtomic === fromAtomic;
  return {
    ...t,
    amountAtomic,
    feeAtomic: plan.feeAtomic,
    sellerFundsAtomic: plan.sellerFundsAtomic,
    fiatCents: back ? fromFiatCents : fiatFor(amountAtomic, t.lockedRate),
    grown: back ? null : { at: now, fromAtomic, fromFiatCents },
  };
}

function onTick(t: Trade, now: Date): Trade {
  if (t.pausedAt !== null) return t;
  switch (t.state) {
    case 'setup':
      return past(now, t.setupBy) ? close(t, 'cancelled', now) : t;
    case 'funding':
      if (!past(now, t.fundBy) || t.receivedAtomic >= t.sellerFundsAtomic) return t;
      // With nothing in the escrow the trade is over; otherwise the lapse refund still has to settle.
      return { ...t, state: 'lapsed', lapsedAt: now, closedAt: t.receivedAtomic === 0n ? now : null };
    case 'settling':
      // A claimed release is not reverted (lead decision b): only the sweep or the fallback ends it.
      if (t.releaseClaimedAt !== null || !past(now, t.settleBy)) return t;
      return { ...t, state: t.settleFrom ?? fail('wrong-state'), settling: null, settleFrom: null, settleBy: null };
    case 'refunded':
      // The seller never tapped Confirm cancel: it closes as cancelled by itself (owner 2026-10-29).
      return past(now, cancelAutoCloseAt(t)) ? { ...t, cancelConfirmedAt: now } : t;
    default:
      return t;
  }
}

function onResume(t: Trade, now: Date): Trade {
  if (t.pausedAt === null) return fail('wrong-state');
  const pausedAt = t.pausedAt.getTime();
  const shift = Math.max(0, now.getTime() - pausedAt);
  // Every deadline still running at the pause moves by the pause's length. One set during
  // the pause was counted from pausedAt (see `base`), so it now runs from the resume.
  const move = (d: Date | null): Date | null => (d !== null && d.getTime() >= pausedAt ? new Date(d.getTime() + shift) : d);
  // The final alert and the lapse are timestamps, but each opens a window that is a deadline
  // (the auto-refund window, the lapse co-sign window): shift the timestamp when its window
  // was still open at the pause, so finalAlertAt > payBy still holds and the co-sign timer is frozen too.
  const opens = (d: Date | null, windowMin: number): Date | null =>
    d !== null && addMin(d, windowMin).getTime() >= pausedAt ? new Date(d.getTime() + shift) : d;
  return {
    ...t,
    pausedAt: null,
    setupBy: move(t.setupBy),
    fundBy: move(t.fundBy),
    payBy: move(t.payBy),
    confirmBy: move(t.confirmBy),
    settleBy: move(t.settleBy),
    finalAlertAt: opens(t.finalAlertAt, TIMERS.finalAlertMin),
    lapsedAt: opens(t.lapsedAt, TIMERS.lapseCosignMin),
    cancelConfirmableAt: opens(t.cancelConfirmableAt, SELLER_CONFIRM_CANCEL_TIMEOUT_H * 60),
  };
}

function onDispute(t: Trade, by: Party, now: Date): Trade {
  const open = (): Trade => ({ ...t, state: 'disputed', dispute: { by, at: now }, closedAt: null });
  switch (t.state) {
    case 'securing':
    case 'secured':
      return open();
    case 'paid':
      if (by === 'buyer' && (t.confirmBy === null || now.getTime() < t.confirmBy.getTime())) return fail('too-early');
      return open();
    case 'settling':
      if (t.settleBy === null || !past(now, t.settleBy)) return fail('too-early');
      return open();
    case 'refunded': {
      if (by !== 'buyer') return fail('wrong-party');
      // A cancel itself can't be disputed (owner 2026-10-29, question 4): the buyer's own cancel,
      // or one both agreed to, with the buyer never having marked paid. A cancel refund that lands
      // after "I've paid" (a held-back refund broadcast once the buyer paid) keeps the dispute
      // (review I1). A moderator's refund to the seller is built as mutual-cancel, but only after
      // a dispute, which this leaves as it was.
      if (t.dispute === null && t.paidAt === null && (t.settling === 'buyer-cancel' || t.settling === 'mutual-cancel')) return fail('wrong-state');
      const closed = t.closedAt ?? fail('wrong-state');
      const limit = closed.getTime() + TIMERS.disputeAfterRefundHours * 60 * 60_000;
      if (now.getTime() > limit) return fail('too-late');
      return open();
    }
    default:
      return fail('wrong-state');
  }
}

export function apply(t: Trade, e: TradeEvent, by: By, now: Date): Trade {
  checkNow(now);
  if (by !== 'buyer' && by !== 'seller' && by !== 'system') return fail('wrong-party');
  // P3-C2: system events only from the server itself, client events only from a trader.
  if (SYSTEM.has(e.type)) {
    if (by !== 'system') return fail('wrong-party');
  } else if (CLIENT.has(e.type)) {
    if (by === 'system') return fail('wrong-party');
    // Paused (maintenance or a hold): only WHILE_PAUSED goes through.
    if (t.pausedAt !== null && !WHILE_PAUSED.includes(e.type)) return fail('wrong-state');
  } else {
    throw new RangeError('unknown event');
  }
  const s = t.state;

  switch (e.type) {
    case 'setup-done':
      if (s !== 'setup') return fail('wrong-state');
      if (typeof e.escrowAddress !== 'string' || e.escrowAddress === '') throw new RangeError('bad escrow address');
      return { ...t, state: 'funding', escrowAddress: e.escrowAddress, fundBy: addMin(base(t, now), TIMERS.fundMin) };

    case 'chain':
      return onChain(t, e, now);

    case 'tick':
      return onTick(t, now);

    case 'pause':
      if (t.pausedAt !== null) return fail('wrong-state');
      return { ...t, pausedAt: now };

    case 'resume':
      return onResume(t, now);

    case 'system-cancel':
      if (s === 'setup') return close(t, 'cancelled', now);
      if (s === 'funding' && t.fundStartedAt === null && t.receivedAtomic === 0n && t.fundingSeenAt === null) return close(t, 'cancelled', now);
      return fail('wrong-state');

    case 'settled': {
      if (typeof e.txHash !== 'string' || e.txHash === '') throw new RangeError('bad tx hash');
      if (!SETTLED_FROM.includes(s)) return fail('wrong-state');
      if (!SETTLE_KINDS.includes(e.kind)) throw new RangeError('unknown settle kind');
      const state = e.kind === 'release' ? 'released' : 'refunded';
      return { ...t, state, settling: e.kind, settleBy: null, txHash: e.txHash, closedAt: now };
    }

    case 'escalate': {
      // Only when the escrow holds coins: a lapse nobody refunded, late funds after the end, or a
      // settlement the moderator was not shown spending the escrow 6 h after it started (Task 9 I/O),
      // or a requested refund the moderator may not sign alone (Task 10: no seen-receipt for the
      // buyer's final alert, or its own records disagree with the API's).
      if (s !== 'lapsed' && s !== 'settling' && s !== 'refund_requested' && !CLOSED.includes(s)) return fail('wrong-state');
      // A buyer's cancel whose refund never showed all its confirmations (Task 39 review M3) goes to a
      // moderator whatever the escrow reads: nobody knows where the coins are.
      if (t.receivedAtomic <= 0n && !awaitingCancelConfirm(t)) return fail('wrong-state');
      return { ...t, state: 'disputed', dispute: { by: 'system', at: now }, closedAt: null };
    }

    case 'release-claimed':
      // The moderation service got a trade party's sealed post-release info (Task 9 I/O, lead
      // decision b): once per settling episode, only while settling.
      if (s !== 'settling' || t.releaseClaimedAt !== null) return fail('wrong-state');
      return { ...t, releaseClaimedAt: now };

    case 'mark-paid':
      if (by !== 'buyer') return fail('wrong-party');
      // "I've paid" only once the escrow is secured, 10 of 10 confirmations and the coins unlocked
      // (owner Q12, 2026-11-06): while it is still securing the buyer is told to wait, not refused as moved on.
      if (s === 'securing') return fail('too-early');
      if (s !== 'secured' && s !== 'refund_requested') return fail('wrong-state');
      // Once the auto-refund may run (autoRefundDecision: now >= finalAlertAt + 15 min) it is too late.
      // The window is frozen during maintenance, so a paused trade counts from the pause.
      if (s === 'refund_requested' && t.finalAlertAt !== null && base(t, now).getTime() >= addMin(t.finalAlertAt, TIMERS.finalAlertMin).getTime()) {
        return fail('too-late');
      }
      if (typeof e.fiatCents !== 'bigint') throw new RangeError('bad fiat total');
      // The buyer confirms the total they sent; a trade that grew since their screen showed it is refused.
      if (e.fiatCents !== t.fiatCents) return fail('total-changed');
      return {
        ...t,
        state: 'paid',
        paidAt: now,
        confirmBy: addMin(base(t, now), t.confirmWindowMin),
        finalAlertAt: null,
        // No cancel after "I've paid" (Revision 2026-10-29b): any open proposal is withdrawn here.
        cancelProposedBy: null,
      };

    case 'extend':
      if (by !== 'seller') return fail('wrong-party');
      if (s !== 'secured') return fail('wrong-state');
      if (t.extensions >= TIMERS.maxExtensions) return fail('no-extensions-left');
      if (t.payBy === null || now.getTime() < t.payBy.getTime()) return fail('too-early');
      return { ...t, payBy: addMin(now, TIMERS.extendMin), extensions: t.extensions + 1 };

    case 'request-refund':
      if (by !== 'seller') return fail('wrong-party');
      if (s !== 'secured' || t.paidAt !== null) return fail('wrong-state');
      // Owner G2 / g66: locked until the buyer's 90 minutes (from full funding, plus any extension)
      // have passed AND the seller has nudged at least once since the escrow was secured.
      if (!past(now, t.payBy)) return fail('too-early');
      // The 15-minute final alert below stays (lead, 7 Nov) until the owner rules on it (page 6).
      // The 90 minutes count from secured (payBy = securedAt + 90 min): the buyer cannot pay before (Q12); lead default.
      if (t.sellerNudgedAt === null || t.securedAt === null || t.sellerNudgedAt.getTime() < t.securedAt.getTime()) return fail('too-early');
      return { ...t, state: 'refund_requested', finalAlertAt: now };

    case 'buyer-cancel':
      if (by !== 'buyer') return fail('wrong-party');
      if (t.paidAt !== null) return fail('wrong-state');
      if (s === 'setup' || (s === 'funding' && t.receivedAtomic === 0n)) return close(t, 'cancelled', now);
      if (s === 'funding' || BUYER_CANCEL_SETTLE.includes(s)) return startSettling(t, 'buyer-cancel', now);
      return fail('wrong-state');

    case 'propose-cancel':
      if (!CANCEL_STATES.includes(s) || t.paidAt !== null) return fail('wrong-state');
      if (t.cancelProposedBy !== null) return fail('wrong-state');
      return { ...t, cancelProposedBy: by as Party };

    case 'accept-cancel':
      if (!CANCEL_STATES.includes(s) || t.paidAt !== null || t.cancelProposedBy === null) return fail('wrong-state');
      if (t.cancelProposedBy === by) return fail('wrong-party');
      if (t.receivedAtomic === 0n && t.fundingSeenAt === null) return close({ ...t, cancelProposedBy: null }, 'cancelled', now);
      if (!t.releasable) return fail('not-releasable');
      return startSettling({ ...t, cancelProposedBy: null }, 'mutual-cancel', now);

    case 'withdraw-cancel':
      if (!CANCEL_STATES.includes(s) || t.cancelProposedBy === null) return fail('wrong-state');
      if (t.cancelProposedBy !== by) return fail('wrong-party');
      return { ...t, cancelProposedBy: null };

    case 'fund-started':
      if (by !== 'seller') return fail('wrong-party');
      if (s !== 'funding' || t.fundStartedAt !== null) return fail('wrong-state');
      return { ...t, fundStartedAt: now };

    case 'walk-away':
      // Before funding either side can walk away; the seller never after tapping "Fund escrow" or
      // once any coins are seen (Revision 2026-10-29b). The buyer's walk-away is `buyer-cancel`.
      if (by !== 'seller') return fail('wrong-party');
      if (s === 'setup') return close(t, 'cancelled', now);
      if (s === 'funding' && t.fundStartedAt === null && t.receivedAtomic === 0n && t.fundingSeenAt === null) return close(t, 'cancelled', now);
      return fail('wrong-state');

    case 'return-confirmed':
      if (!awaitingCancelConfirm(t) || t.cancelConfirmableAt !== null) return fail('wrong-state');
      if (!Number.isSafeInteger(e.confirmations) || e.confirmations < 0) throw new RangeError('bad confirmations');
      if (e.confirmations < UNLOCK_CONFIRMATIONS) return fail('too-early');
      // During maintenance the 48 hours count from the resume (as every deadline set while paused).
      return { ...t, cancelConfirmableAt: base(t, now) };

    case 'confirm-cancel':
      if (by !== 'seller') return fail('wrong-party');
      if (!awaitingCancelConfirm(t)) return fail('wrong-state');
      if (!Number.isSafeInteger(e.returnConfirmations) || e.returnConfirmations < 0) throw new RangeError('bad confirmations');
      // Greyed out until the return has the same confirmations the trade uses everywhere (10). Once
      // the server recorded that count (cancelConfirmableAt) it is trusted: a node that is briefly
      // down when the seller taps does not take the button away again (review M1).
      if (t.cancelConfirmableAt === null && e.returnConfirmations < UNLOCK_CONFIRMATIONS) return fail('too-early');
      return { ...t, cancelConfirmedAt: now };

    case 'release-started':
      if (by !== 'seller') return fail('wrong-party');
      if (s !== 'secured' && s !== 'paid') return fail('wrong-state');
      if (!t.releasable || t.receivedAtomic < t.sellerFundsAtomic) return fail('not-releasable');
      return startSettling(t, 'release', now);

    case 'open-dispute':
      return onDispute(t, by as Party, now);
  }
}

/** The deadline the server is counting down to now, or null (none, or paused). */
export function nextDeadline(t: Trade): Date | null {
  if (t.pausedAt !== null) return null;
  switch (t.state) {
    case 'setup':
      return t.setupBy;
    case 'funding':
      return t.fundBy;
    case 'secured':
      return t.payBy;
    case 'paid':
      return t.confirmBy;
    case 'refund_requested':
      return t.finalAlertAt === null ? null : addMin(t.finalAlertAt, TIMERS.finalAlertMin);
    case 'settling':
      return t.releaseClaimedAt !== null ? null : t.settleBy;
    case 'refunded':
      return cancelAutoCloseAt(t);
    default:
      return null;
  }
}

/** Minutes until every coin in the escrow is unlocked: 0 when releasable, null with nothing received. */
export function releasableEta(t: Trade, blockSeconds = 120): number | null {
  if (!(blockSeconds > 0)) throw new RangeError('bad block time');
  if (t.receivedAtomic === 0n) return null;
  if (t.releasable) return 0;
  const blocks = Math.max(1, UNLOCK_CONFIRMATIONS - t.confirmations);
  return Math.ceil((blocks * blockSeconds) / 60);
}
