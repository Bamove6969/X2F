/**
 * The trade state machine. `apply` is pure: it takes the trade, one event,
 * who sent it (taken from the session or 'system', never from the request
 * body) and the server's clock, and returns the next trade or throws a
 * TradeRuleError. It does no I/O and never reads the device clock.
 */
import { amountForFunds, escrowPlan, fiatCents as fiatFor, type Price } from './money.js';
import { SETTLE_KINDS, type SettleKind } from './payouts.js';
import { TIMERS, UNLOCK_CONFIRMATIONS, addMin } from './timers.js';

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
  pausedAt: Date | null;
  txHash: string | null;
  dispute: { by: By; at: Date } | null;
  closedAt: Date | null;
}

export type TradeEvent =
  | { type: 'setup-done'; escrowAddress: string }
  | { type: 'chain'; receivedAtomic: bigint; unlockedAtomic: bigint; confirmations: number }
  | { type: 'mark-paid' }
  | { type: 'extend' }
  | { type: 'request-refund' }
  | { type: 'buyer-cancel' }
  | { type: 'propose-cancel' }
  | { type: 'accept-cancel' }
  | { type: 'withdraw-cancel' }
  | { type: 'release-started' }
  | { type: 'settled'; kind: SettleKind; txHash: string }
  | { type: 'open-dispute' }
  | { type: 'escalate' }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'tick' };

export const SYSTEM_EVENTS = ['setup-done', 'chain', 'settled', 'escalate', 'pause', 'resume', 'tick'] as const;
export const CLIENT_EVENTS = [
  'mark-paid',
  'extend',
  'request-refund',
  'buyer-cancel',
  'propose-cancel',
  'accept-cancel',
  'withdraw-cancel',
  'release-started',
  'open-dispute',
] as const;

export type TradeRuleCode = 'wrong-state' | 'wrong-party' | 'too-early' | 'too-late' | 'no-extensions-left' | 'not-releasable';

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

/** States in which either side may propose, accept or withdraw a mutual cancel. */
const CANCEL_STATES: readonly TradeState[] = ['funding', 'securing', 'secured', 'paid'];
/** States from which the buyer's cancel becomes a refund settlement. */
const BUYER_CANCEL_SETTLE: readonly TradeState[] = ['securing', 'secured', 'paid', 'refund_requested'];
const CLOSED: readonly TradeState[] = ['released', 'refunded', 'cancelled'];
/** States in which a settlement seen on chain is recorded: every open state with a funded escrow. */
const SETTLED_FROM: readonly TradeState[] = ['secured', 'settling', 'disputed', 'paid', 'refund_requested', 'lapsed'];
/** States in which extra XMR grows the trade: before "I've paid" and before any refund or settlement starts. */
const GROW_STATES: readonly TradeState[] = ['funding', 'securing', 'secured'];
/** Client events still accepted during maintenance: the buyer's own payment and cancel. */
const WHILE_PAUSED: readonly string[] = ['mark-paid', 'buyer-cancel'];
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
    pausedAt: null,
    txHash: null,
    dispute: null,
    closedAt: null,
  };
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
 */
function grow(t: Trade, now: Date): Trade {
  if (!GROW_STATES.includes(t.state) || t.paidAt !== null) return t;
  if (t.receivedAtomic <= t.sellerFundsAtomic) return t;
  const amountAtomic = amountForFunds(t.receivedAtomic, t.poster);
  if (amountAtomic <= t.amountAtomic) return t;
  const fiatCents = fiatFor(amountAtomic, t.lockedRate);
  if (fiatCents > t.maxFiatCents) return t;
  const plan = escrowPlan({ amountAtomic, poster: t.poster });
  return {
    ...t,
    amountAtomic,
    feeAtomic: plan.feeAtomic,
    sellerFundsAtomic: plan.sellerFundsAtomic,
    fiatCents,
    grown: { at: now, fromAtomic: t.grown?.fromAtomic ?? t.amountAtomic, fromFiatCents: t.grown?.fromFiatCents ?? t.fiatCents },
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
      if (!past(now, t.settleBy)) return t;
      return { ...t, state: t.settleFrom ?? fail('wrong-state'), settling: null, settleFrom: null, settleBy: null };
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
  // The final alert is a timestamp, but the auto-refund window it opens is a deadline:
  // shift it when that window was still open at the pause, so finalAlertAt > payBy still holds.
  const alertOpen = t.finalAlertAt !== null && addMin(t.finalAlertAt, TIMERS.finalAlertMin).getTime() >= pausedAt;
  return {
    ...t,
    pausedAt: null,
    setupBy: move(t.setupBy),
    fundBy: move(t.fundBy),
    payBy: move(t.payBy),
    confirmBy: move(t.confirmBy),
    settleBy: move(t.settleBy),
    finalAlertAt: alertOpen && t.finalAlertAt !== null ? new Date(t.finalAlertAt.getTime() + shift) : t.finalAlertAt,
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
      const closed = t.closedAt ?? fail('wrong-state');
      const limit = closed.getTime() + TIMERS.disputeAfterRefundDays * 24 * 60 * 60_000;
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
    // Maintenance: only the buyer's own payment and cancel go through.
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

    case 'settled': {
      if (typeof e.txHash !== 'string' || e.txHash === '') throw new RangeError('bad tx hash');
      if (!SETTLED_FROM.includes(s)) return fail('wrong-state');
      if (!SETTLE_KINDS.includes(e.kind)) throw new RangeError('unknown settle kind');
      const state = e.kind === 'release' ? 'released' : 'refunded';
      return { ...t, state, settling: e.kind, settleBy: null, txHash: e.txHash, closedAt: now };
    }

    case 'escalate': {
      // Only when the escrow holds coins: a lapse nobody refunded, or late funds after the end.
      if (s !== 'lapsed' && !CLOSED.includes(s)) return fail('wrong-state');
      if (t.receivedAtomic <= 0n) return fail('wrong-state');
      return { ...t, state: 'disputed', dispute: { by: 'system', at: now }, closedAt: null };
    }

    case 'mark-paid':
      if (by !== 'buyer') return fail('wrong-party');
      if (s !== 'securing' && s !== 'secured' && s !== 'refund_requested') return fail('wrong-state');
      // Once the auto-refund may run (autoRefundDecision: now >= finalAlertAt + 15 min) it is too late.
      if (s === 'refund_requested' && t.finalAlertAt !== null && now.getTime() >= addMin(t.finalAlertAt, TIMERS.finalAlertMin).getTime()) {
        return fail('too-late');
      }
      return {
        ...t,
        state: 'paid',
        paidAt: now,
        confirmBy: addMin(base(t, now), t.confirmWindowMin),
        finalAlertAt: null,
        // The buyer has paid: a seller's standing offer to cancel no longer applies.
        cancelProposedBy: t.cancelProposedBy === 'seller' ? null : t.cancelProposedBy,
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
      if (!past(now, t.payBy)) return fail('too-early');
      return { ...t, state: 'refund_requested', finalAlertAt: now };

    case 'buyer-cancel':
      if (by !== 'buyer') return fail('wrong-party');
      if (s === 'setup' || (s === 'funding' && t.receivedAtomic === 0n)) return close(t, 'cancelled', now);
      if (s === 'funding' || BUYER_CANCEL_SETTLE.includes(s)) return startSettling(t, 'buyer-cancel', now);
      return fail('wrong-state');

    case 'propose-cancel':
      if (!CANCEL_STATES.includes(s)) return fail('wrong-state');
      if (t.cancelProposedBy !== null) return fail('wrong-state');
      return { ...t, cancelProposedBy: by as Party };

    case 'accept-cancel':
      if (!CANCEL_STATES.includes(s) || t.cancelProposedBy === null) return fail('wrong-state');
      if (t.cancelProposedBy === by) return fail('wrong-party');
      if (t.receivedAtomic === 0n && t.fundingSeenAt === null) return close({ ...t, cancelProposedBy: null }, 'cancelled', now);
      if (!t.releasable) return fail('not-releasable');
      return startSettling({ ...t, cancelProposedBy: null }, 'mutual-cancel', now);

    case 'withdraw-cancel':
      if (!CANCEL_STATES.includes(s) || t.cancelProposedBy === null) return fail('wrong-state');
      if (t.cancelProposedBy !== by) return fail('wrong-party');
      return { ...t, cancelProposedBy: null };

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
      return t.settleBy;
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
