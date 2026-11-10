/**
 * What Task 23's screens show, worked out from the TradeView alone (pure, no React). Times come
 * from the server clock the room passes in, never the device clock (Review Focus 3).
 */
import type { IconName } from '../../ui/icons.js';
import type { TradeEscrow, TradeState, TradeView } from './payTypes.js';

/** Confirmations after which Monero coins unlock (@x2f/trade UNLOCK_CONFIRMATIONS). */
export const UNLOCK_CONFIRMATIONS = 10;
/**
 * The shortest payment window and one extension, in minutes (@x2f/trade TIMERS.payMin / extendMin).
 * A trade's own window is `payWindowMin` (the payment method's, owner p9-6); PAY_MIN is its fallback.
 */
export const PAY_MIN = 90;
export const EXTEND_MIN = 30;
/** Monero's block time, for an ETA the view does not give. */
const BLOCK_MIN = 2;

export interface EscrowChip {
  tone: 'caution' | 'escrow';
  icon: IconName;
  label: string;
  /** The confirmations bar ("3 of 10 · about 14 min"), shown while securing. */
  bar: { confirmations: number; of: number; etaMin: number } | null;
}

const SECURED_ON: readonly TradeState[] = ['secured', 'paid', 'settling', 'released', 'disputed'];

/**
 * The escrow chip (spec 2.2 step 6, spec 7, P3-I4): amber "Securing escrow" with the
 * confirmations bar while the funding confirms, amber "Releasable in N min" once it has 10
 * confirmations but the coins are not unlocked yet, teal "Escrow secured" from then on.
 */
export function escrowChip(v: Pick<TradeView, 'state' | 'confirmations' | 'releasable' | 'releasableEtaMin' | 'receivedAtomic'>): EscrowChip | null {
  if (SECURED_ON.includes(v.state)) return { tone: 'escrow', icon: 'shield-check', label: 'Escrow secured', bar: null };
  if (v.state !== 'securing' && !(v.state === 'funding' && v.receivedAtomic !== '0')) return null;
  const confirmations = Math.min(Math.max(0, v.confirmations), UNLOCK_CONFIRMATIONS);
  const etaMin = v.releasableEtaMin ?? Math.max(1, UNLOCK_CONFIRMATIONS - confirmations) * BLOCK_MIN;
  const bar = { confirmations, of: UNLOCK_CONFIRMATIONS, etaMin };
  if (confirmations >= UNLOCK_CONFIRMATIONS && !v.releasable) {
    return { tone: 'caution', icon: 'shield-clock', label: `Releasable in ${etaMin} min`, bar };
  }
  return { tone: 'caution', icon: 'shield-clock', label: 'Securing escrow', bar };
}

export type PayTimer =
  | { started: false; totalMin: number; startsInMin: number | null }
  | { started: true; totalMin: number; payBy: string; leftMin: number };

/**
 * "Time to pay": the payment method's time (owner p9-6; 90 minutes for instant methods), plus 30
 * per extension, that starts when the escrow settles, so waiting never costs the buyer time (spec
 * 2.2 step 6). `leftMin` is rounded up like Countdown.
 */
export function payTimer(v: Pick<TradeView, 'payBy' | 'extensions' | 'releasableEtaMin' | 'payWindowMin'>, nowMs: number): PayTimer {
  const totalMin = (v.payWindowMin ?? PAY_MIN) + EXTEND_MIN * v.extensions;
  if (v.payBy === null) return { started: false, totalMin, startsInMin: v.releasableEtaMin };
  const left = Date.parse(v.payBy) - nowMs;
  return { started: true, totalMin, payBy: v.payBy, leftMin: Number.isFinite(left) ? Math.max(0, Math.ceil(left / 60_000)) : 0 };
}

/**
 * The time to pay is over and the buyer has not tapped "I've paid" (owner 8 Nov, p6-1): not a hard
 * end. The trade stays open, "I've paid" and the details stay, and the seller may cancel at any
 * moment. Never while maintenance has the clock paused (the machine moves `payBy` on resume).
 */
export function payTimeOver(v: Pick<TradeView, 'state' | 'payBy' | 'pausedAt'>, nowMs: number): boolean {
  if (v.state !== 'secured' || v.payBy === null || v.pausedAt !== null) return false;
  const by = Date.parse(v.payBy);
  return Number.isFinite(by) && nowMs >= by;
}

/**
 * States in which a mutual cancel can be proposed or accepted (@x2f/trade CANCEL_STATES): never
 * `paid`, no cancel of any kind after "I've paid" (owner, Revision 2026-10-29b).
 */
const CANCEL_STATES: readonly TradeState[] = ['funding', 'securing', 'secured'];

/**
 * The buyer's Cancel (spec 2.3): one tap before "I've paid", and none at all after it (owner,
 * Revision 2026-10-29b; the machine refuses `buyer-cancel` in `paid`). In other states Task 23's
 * screens offer none. It stays a one-tap "Cancel trade"
 * (owner 2026-10-29: option B, with the seller's Confirm cancel once the XMR is back; Task 39).
 */
export function buyerCancelMode(v: Pick<TradeView, 'state' | 'paidAt'>): 'one-tap' | 'none' {
  if ((v.state === 'securing' || v.state === 'secured') && v.paidAt === null) return 'one-tap';
  return 'none';
}

/** The seller never cancels alone after funding (spec 2.3): only propose a mutual cancel, or withdraw one. */
export function sellerCancelMode(v: Pick<TradeView, 'state' | 'cancelProposedBy'>): 'propose' | 'proposed' | 'none' {
  if (!CANCEL_STATES.includes(v.state)) return 'none';
  if (v.cancelProposedBy === null) return 'propose';
  return v.cancelProposedBy === 'seller' ? 'proposed' : 'none';
}

/** The buyer's accept/decline card for the seller's standing mutual-cancel proposal. */
export function showProposal(v: Pick<TradeView, 'role' | 'state' | 'cancelProposedBy'>): boolean {
  return v.role === 'buyer' && v.cancelProposedBy === 'seller' && CANCEL_STATES.includes(v.state);
}

export type StepKey = 'funded' | 'pay' | 'confirm' | 'released';
export interface Step {
  key: StepKey;
  status: 'done' | 'current' | 'todo';
}

/** How far each state has come along the Desktop board's four steps (0 = funding, 4 = all done). */
function progress(v: Pick<TradeView, 'state' | 'settling'>): number {
  switch (v.state) {
    case 'setup':
    case 'funding':
      return 0;
    case 'securing':
    case 'secured':
      return 1;
    case 'paid':
      return 2;
    case 'settling':
      return v.settling === 'release' ? 3 : 1;
    case 'released':
      return 4;
    default:
      return 1;
  }
}

/** The Desktop board's progress steps: Escrow funded, You pay, Seller confirms, XMR released. */
export function timelineSteps(v: Pick<TradeView, 'state' | 'settling'>): Step[] {
  const p = progress(v);
  const keys: StepKey[] = ['funded', 'pay', 'confirm', 'released'];
  return keys.map((key, i) => ({ key, status: i < p ? 'done' : i === p ? 'current' : 'todo' }));
}

/** The counterparty card's line ("412 trades · 99% positive · releases in ~6 min"); unknown parts are left out. */
export function counterpartyLine(v: Pick<TradeView, 'role' | 'counterparty'>): string {
  const c = v.counterparty;
  const parts = [`${c.completedTrades} ${c.completedTrades === 1 ? 'trade' : 'trades'}`];
  if (c.positivePct !== null) parts.push(`${c.positivePct}% positive`);
  // How fast someone releases is a seller fact: shown only when the counterparty is the seller.
  if (v.role === 'buyer' && c.typicalMinutes !== null) parts.push(`releases in ~${c.typicalMinutes} min`);
  return parts.join(' · ');
}

/**
 * Why "I've paid" is not offered right now, or null when it is (review 2026-10-27, I1). Never
 * before the escrow is secured (`not-secured`, owner Q12). The sum to
 * pay is only ever this device's own figure (`escrow.fiatCents`, Task 12): none while the escrow
 * is stopped or not ready, none while the escrow refuses the trade as the API shows it (any
 * refusal but `amount-out-of-range`, which is `no-amount`: a `view-mismatch` can leave the totals
 * agreeing, and then the device would settle nothing for a payment; round 2, I1), none while the
 * device accepts no amount (the API's is outside [take, this device's size]), and none while the
 * API's total differs from the device's (the API would refuse a `mark-paid` the device confirms,
 * or the device would refuse the one the API takes). A differing total on the SAME amount is
 * `total-wrong`: both work it out at the locked rate, so it will not clear by waiting (round 2,
 * Minor 2); on another amount it is `amount-differs` (the device may still catch up).
 */
export type PayBlock = 'escrow-stopped' | 'escrow-refused' | 'not-secured' | 'escrow-not-ready' | 'no-amount' | 'amount-differs' | 'total-wrong';

type PayView = Pick<TradeView, 'fiatCents' | 'amountAtomic'>;

/**
 * Owner Q12 (2026-11-06): the seller's payment details and "I've paid" only once the escrow is
 * secured, 10 of 10 confirmations with the coins unlocked, as the server says (the machine refuses
 * `mark-paid` with `too-early` before `secured`). In
 * `paid` the details the buyer paid to stay on screen (review 2026-11-07, 1; the fold glance shows
 * them too), and the button there is "Marked as paid", never this gate.
 *
 * Lead default (2026-11-07): "secured" means the trade's own funds are 10 of 10 and unlocked (the
 * machine's `secured` state). Later top-ups, dust included, never re-lock paying: a trade stays
 * `secured` while new coins confirm, so a seller can't hold the buyer off while `payBy` runs.
 */
export function paySecured(v: Pick<TradeView, 'state'>): boolean {
  return v.state === 'secured' || v.state === 'paid';
}
type PayEscrow = Pick<TradeEscrow, 'phase' | 'error' | 'refusal' | 'fiatCents' | 'amountAtomic'>;

function totalBlock(view: PayView, e: PayEscrow): PayBlock | null {
  if (e.fiatCents === null) return 'no-amount';
  if (e.fiatCents === BigInt(view.fiatCents)) return null;
  return e.amountAtomic !== null && e.amountAtomic === BigInt(view.amountAtomic) ? 'total-wrong' : 'amount-differs';
}

export function payBlock(view: PayView & Pick<TradeView, 'state'>, e: PayEscrow): PayBlock | null {
  if (e.error !== null) return 'escrow-stopped';
  if (e.refusal !== null && e.refusal !== 'amount-out-of-range') return 'escrow-refused';
  if (!paySecured(view)) return 'not-secured';
  if (e.phase !== 'ready') return 'escrow-not-ready';
  return totalBlock(view, e);
}

/**
 * Why "Finish marking as paid" (paid on the server, the tap not recorded on this device) cannot
 * run, or null when it can: the same gate as `payBlock`, except that `amount-unknown` is the
 * refusal Finish exists for (and the phase is not asked: the escrow may be busy co-signing).
 */
export function finishBlock(view: PayView, e: PayEscrow): PayBlock | null {
  if (e.error !== null) return 'escrow-stopped';
  if (e.refusal !== null && e.refusal !== 'amount-unknown') return 'escrow-refused';
  return totalBlock(view, e);
}
