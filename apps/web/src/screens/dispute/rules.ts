// Pure rules and copy for the trader-side dispute screens (Plan 3 Task 27; spec 2.3, 6.6). Every
// "now" here is the server's clock (useServerClock), never the device's alone (Review Focus 3).
// Copy is from the DisputeOpen, DisputeRoom and DisputeRuling boards; lines marked COPY-UNSIGNED
// have no board yet (spec wording or Plan 4 A8) and wait for the owner's sign-off.
import { TIMERS, formatXmr } from '@x2f/trade';
import { formatRemaining } from '../../ui/Countdown.js';
import type { DisputeReason, DisputeTrade, DisputeView, Party, Reason, RulingView } from './api.js';

/** The buyer's reasons, from the DisputeOpen board. */
export const BUYER_REASONS: readonly (readonly [Reason, string])[] = [
  ['paid', "I paid, but the seller hasn't released"],
  ['silent', "The seller isn't replying"],
  ['terms', 'The seller asked for more money or a different payment'],
  ['other', 'Something else'],
];

/** The seller's reasons, from Plan 4 A8 (no board). COPY-UNSIGNED */
export const SELLER_REASONS: readonly (readonly [Reason, string])[] = [
  ['paid', "I haven't received the payment"],
  ['silent', "The buyer isn't replying"],
  ['terms', 'The buyer asked for something outside the terms'],
  ['other', 'Something else'],
];

export const reasonsFor = (side: Party) => (side === 'buyer' ? BUYER_REASONS : SELLER_REASONS);

/** A reason as the side that chose it wrote it. */
export function reasonLabel(by: Party, r: DisputeReason): string {
  return reasonsFor(by).find(([id]) => id === r)?.[1] ?? 'Something else';
}

export const NOTE_MAX = 1000;
/** The board's appeal form enables "Send appeal" from 10 characters (not counting spaces at the ends). */
export const APPEAL_MIN = 10;

/**
 * The appeal window's length in hours (spec Revision 2026-10-29: 48 h; Plan 4's `appealWindowH`
 * setting defaults to it). The ruling's "(48 h)" reads this, not appealUntil − ruledAt (review N3).
 */
export const APPEAL_WINDOW_H = 48;

const HOUR_MS = 60 * 60_000;
const ms = (iso: string | null): number | null => (iso === null ? null : Date.parse(iso));

/**
 * Whether this side may open a dispute now, mirroring the state machine's `open-dispute` rules
 * (the API decides; this only keeps the screen from sending what would be refused):
 * - securing or secured: either side;
 * - paid: the seller at once, the buyer only from the end of the seller's confirm window;
 * - settling: either side once the signing window has passed;
 * - refunded: the buyer, until 48 hours after the refund (owner 2026-10-29; was 90 days).
 * `wait` carries the explanation shown instead of sending anything.
 */
export type Entry = { kind: 'open' } | { kind: 'wait'; text: string; until: Date } | { kind: 'opened' } | { kind: 'none' };

export function disputeEntry(t: DisputeTrade, now: Date): Entry {
  const n = now.getTime();
  if (t.state === 'disputed') return { kind: 'opened' };
  switch (t.state) {
    case 'securing':
    case 'secured':
      return { kind: 'open' };
    case 'paid': {
      if (t.role === 'seller') return { kind: 'open' };
      const by = ms(t.confirmBy);
      const paid = ms(t.paidAt);
      if (by === null) return { kind: 'none' };
      if (n >= by) return { kind: 'open' };
      const window = paid === null ? '' : formatRemaining(by - paid, 'minutes');
      return {
        kind: 'wait',
        until: new Date(by),
        text: `You can open a dispute if the seller hasn't confirmed within ${window} of your payment.`,
      };
    }
    case 'settling': {
      const by = ms(t.settleBy);
      return by !== null && n > by ? { kind: 'open' } : { kind: 'none' };
    }
    case 'refunded': {
      // One dispute per trade: a refund that was already disputed (and ruled) offers none again.
      if (t.dispute !== null) return { kind: 'opened' };
      // A cancel itself can't be disputed (owner 2026-10-29, question 4): the buyer's own cancel or
      // one both agreed to. Disputing a refund of the wrong amount is not built yet (coordination.md).
      if (isCancelRefund(t.settling ?? null, t.dispute, t.paidAt)) return { kind: 'none' };
      const closed = ms(t.closedAt);
      if (t.role !== 'buyer' || closed === null) return { kind: 'none' };
      return n <= closed + TIMERS.disputeAfterRefundHours * HOUR_MS ? { kind: 'open' } : { kind: 'none' };
    }
    default:
      return { kind: 'none' };
  }
}

/** How a refunded trade ended: `TradeView.settling` keeps the settle kind after the refund. */
export type SettleKind = 'release' | 'mutual-cancel' | 'buyer-cancel' | 'auto-refund' | 'lapse-refund';

/**
 * The buyer's refunded view says why the XMR went back to the seller, for every kind of refund
 * (owner 2026-10-29; the seller is "the seller", never named): the buyer cancelled; the payment
 * time ran out and the seller cancelled; a dispute decision; both agreed to cancel; the funding
 * time ran out. Until trades record `refund_reason` (NEEDS_REFUND_REASON) the reason is inferred. A trade that had a dispute was
 * refunded by its decision (a moderator's refund to the seller is built as `mutual-cancel` today,
 * escrow/policy.ts, so the dispute decides the reason, not the kind). COPY-UNSIGNED (no board).
 */
export function refundReason(settling: SettleKind | null, dispute: DisputeTrade['dispute']): { title: string; text: string } {
  if (dispute !== null) {
    return {
      title: 'Refunded by the dispute decision',
      text: 'A moderator decided this trade\'s dispute and the XMR went back to the seller. The ruling and its reasons are on the dispute page.',
    };
  }
  switch (settling) {
    case 'buyer-cancel':
      return { title: 'You cancelled this trade', text: `You cancelled, so all the XMR went back to the seller.` };
    case 'auto-refund':
      return {
        title: 'The payment time ran out',
        // The owner's wording (Plan 3 Revision 2026-10-29, Decision 7). COPY-UNSIGNED
        text: 'Payment time ran out, the seller cancelled; everything in escrow went back to the original owner.',
      };
    case 'mutual-cancel':
      return { title: 'You both cancelled this trade', text: `You and the seller agreed to cancel, so all the XMR went back to the seller.` };
    case 'lapse-refund':
      return { title: 'The funding time ran out', text: `The escrow wasn't fully funded in time, so all the XMR went back to the seller.` }; // COPY-UNSIGNED
    default:
      return { title: 'Refunded', text: `The XMR went back to the seller.` };
  }
}

/**
 * The refund came from a cancel (the buyer's, or both sides'), with no dispute. A cancel itself
 * can't be disputed (owner 2026-10-29, question 4; this replaces Revision 2026-10-29b's "Did you
 * pay before you cancelled? Open a dispute."). Not a no-show (auto) refund, a lapse or a dispute
 * decision, and not a cancel's refund that landed after the buyer marked paid (it keeps the
 * dispute: review I1, the seller holding the refund back until the buyer paid).
 */
export function isCancelRefund(settling: SettleKind | null, dispute: DisputeTrade['dispute'], paidAt: string | null): boolean {
  return dispute === null && paidAt === null && (settling === 'buyer-cancel' || settling === 'mutual-cancel');
}

/**
 * An XMR amount inside a sentence, as the boards write it ("1.25 XMR"): six decimals with the
 * trailing zeros dropped, keeping at least two. Amounts shown on their own use `Amount` (six).
 */
export function xmrInText(atomic: string | bigint): string {
  const six = formatXmr(typeof atomic === 'bigint' ? atomic : BigInt(atomic));
  const [whole, frac = ''] = six.split('.');
  const kept = frac.replace(/0+$/, '').padEnd(2, '0');
  return `${whole}.${kept}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** "10:14", in the viewer's own time zone. */
export function clockTime(d: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('hour')}:${get('minute')}`;
}

/** "Fri 16 Oct, 10:14" (the boards' date), in the viewer's own time zone. */
export function dayTime(d: Date, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', ...(timeZone ? { timeZone } : {}) }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('weekday')} ${get('day')} ${get('month')}, ${clockTime(d, timeZone)}`;
}

/** "in 23 h" or "in 40 min" (whole hours down, minutes up, as the DisputeRoom board's "(in 23 h)"). */
export function inTime(msLeft: number): string {
  const left = Math.max(0, msLeft);
  if (left >= 60 * 60_000) return `in ${Math.floor(left / (60 * 60_000))} h`;
  return `in ${Math.max(1, Math.ceil(left / 60_000))} min`;
}

/** "38 min" from the dispute opening to the moderator joining (the board's "Replied in 38 min"). */
export function repliedIn(d: DisputeView): string | null {
  if (d.moderator === null) return null;
  return formatRemaining(Date.parse(d.moderator.joinedAt) - Date.parse(d.openedAt), 'minutes');
}

const WALLET_APPS: Record<string, string> = {
  cake: 'Cake Wallet',
  edge: 'Edge',
  feather: 'Feather',
  monerujo: 'Monerujo',
  stack: 'Stack Wallet',
  'monero-gui-cli': 'Monero GUI or CLI',
  'ledger-trezor': 'Ledger or Trezor',
};

/** Which side an outcome pays XMR to from the escrow (none for the after-refund outcomes). */
export function paidSide(outcome: RulingView['outcome']): Party | null {
  if (outcome === 'release-to-buyer') return 'buyer';
  if (outcome === 'refund-to-seller') return 'seller';
  return null;
}

/** Who lost (the ruling shows on their profile as a lost dispute); none for no-action. */
export function loserOf(outcome: RulingView['outcome']): Party | null {
  if (outcome === 'release-to-buyer' || outcome === 'seller-sends-xmr' || outcome === 'seller-returns-fiat') return 'seller';
  if (outcome === 'refund-to-seller') return 'buyer';
  return null;
}

/** Whether the ruling is final for this side: the appeal round, or round 1 past its window with no appeal. */
export function rulingFinal(d: DisputeView, now: Date): boolean {
  const r = d.ruling;
  if (r === null) return false;
  if (r.round === 2 || r.appealUntil === null) return true;
  return d.appeal === null && now.getTime() >= Date.parse(r.appealUntil);
}

export interface RulingCopy {
  label: string;
  title: string;
  /** Only for the side the ruling pays, when the API sent the destination. */
  destination: { app: string | null; end: string } | null;
  footer: string;
}

/**
 * The ruling card's words for this side. `me` is this side, `other` the other trader's display name.
 * Board lines (DisputeRuling, wip/design-brief): "Ruling: release to the buyer", "1.25 XMR goes to
 * you" and the footer. The board's "Sent to Cake Wallet, address ending …k3Fz." is not true yet: the
 * page says "Goes to …" (DisputeRuling.tsx) until the API reports the payout executed.
 *
 * NEEDS_PLAN_4_RULING_PAYOUT (C11 review I1): the spec and Plan 4 ("A1 dropped", Revision
 * 2026-10-29c) move the coins at the ruling, but nothing executes a ruling's payout yet, and
 * rulingAllowsCosign below still holds the co-sign until the ruling is final (round 1 past its window
 * with no appeal, or round 2). Changing that gate (coins move at the ruling, with or without an
 * appeal, still through cosignPolicy) is a money rule and belongs to the Plan 4 execution task, not
 * to copy. When the API reports the payout executed (DisputeView has no such flag today), the
 * destination line flips to the board's "Sent to …" and the appeal line may say the XMR has moved.
 * Tripwire NEEDS_PLAN_4_RULING_PAYOUT in test/dispute-tripwires.test.ts.
 */
export function rulingCopy(d: DisputeView, me: Party, other: string, amountAtomic: string, _now: Date): RulingCopy {
  const r = d.ruling;
  if (r === null) throw new Error('no ruling');
  const amount = `${xmrInText(amountAtomic)} XMR`;
  const otherSide: Party = me === 'buyer' ? 'seller' : 'buyer';
  const nameOf = (p: Party) => (p === me ? 'you' : other);
  let label: string;
  let title: string;
  switch (r.outcome) {
    case 'release-to-buyer':
      label = 'Ruling: release to the buyer';
      title = me === 'buyer' ? `${amount} goes to you` : `${amount} goes to ${other}`;
      break;
    case 'refund-to-seller':
      label = 'Ruling: refund to the seller'; // COPY-UNSIGNED
      title = me === 'seller' ? `${amount} goes to you` : `${amount} goes to ${other}`; // COPY-UNSIGNED
      break;
    case 'seller-sends-xmr':
      label = 'Ruling: the seller sends the XMR'; // COPY-UNSIGNED
      title = me === 'seller' ? `You must send ${other} ${amount}` : `${other} must send you ${amount}`; // COPY-UNSIGNED; not-a-refusal: what a ruling asks of a side
      break;
    case 'seller-returns-fiat':
      label = 'Ruling: the seller returns the payment'; // COPY-UNSIGNED
      title = me === 'seller' ? `You must return ${other}'s payment` : `${other} must return your payment`; // COPY-UNSIGNED; not-a-refusal: what a ruling asks of a side
      break;
    case 'no-action':
      label = 'Ruling: no action'; // COPY-UNSIGNED
      title = 'Nothing more happens in this trade'; // COPY-UNSIGNED
      break;
  }
  let destination: RulingCopy['destination'] = null;
  if (r.destination !== null && paidSide(r.outcome) === me) {
    const app = r.destination.walletApp === null ? null : (WALLET_APPS[r.destination.walletApp] ?? null);
    destination = { app, end: r.destination.addressEnd.slice(-4) };
  }
  const loser = loserOf(r.outcome);
  // The board's line, true today and neutral on how long: nothing deletes dispute records yet, and
  // the keep time after the dispute closes is pending the owner's Plan 7 Q1 (Plan 4 Task 23 builds
  // the purge); change this line with it. The lost-dispute clause is the board's; a lost dispute
  // still counts as a completed trade and drops no stage (owner 2026-10-29). COPY-UNSIGNED (pending Q1)
  let footer = 'This ruling and its evidence are kept with the trade.';
  if (loser !== null) footer += loser === me ? ' It appears on your profile as a lost dispute.' : ` It appears on ${nameOf(otherSide)}'s profile as a lost dispute.`;
  return { label, title, destination, footer };
}

/**
 * The appeal window's lien sentence (spec Revision 2026-10-29c "Liens": an overturned ruling puts the
 * lien on whoever received the coins), for a ruling that moves the XMR; '' for the others. The
 * receiver reads the board's words; the other side reads who it would fall on (COPY-UNSIGNED).
 */
export function overturnLien(outcome: RulingView['outcome'], me: Party, other: string): string {
  const receiver = paidSide(outcome);
  if (receiver === null) return '';
  // not-a-refusal: what an overturned ruling would mean, explained before any appeal (board DisputeRuling)
  if (receiver === me) return " If an appeal overturns the ruling, you get a lien. You can't trade until you pay the XMR back.";
  return ` If an appeal overturns the ruling, ${other} gets a lien until they pay the XMR back.`; // COPY-UNSIGNED
}

/**
 * The line once an appeal is in. Board DisputeRuling: "Appeal sent. A second moderator will look at
 * it. The XMR has already moved; if they overturn the ruling, the other trader gets a lien until they
 * pay it back." Review I1 (NEEDS_PLAN_4_RULING_PAYOUT, above rulingCopy): nothing has moved the XMR
 * yet, so the page keeps the lien and drops "The XMR has already moved" (COPY-UNSIGNED). The other
 * side's appeal and the receiver's lien are worded to match (COPY-UNSIGNED).
 */
export function appealSentText(d: DisputeView, me: Party, other: string): string {
  const a = d.appeal;
  const r = d.ruling;
  if (a === null || r === null) return '';
  const who = a.by === me ? 'Appeal sent.' : `${other} appealed.`;
  if (d.afterRefund) return `${who} A second moderator will decide.`; // COPY-UNSIGNED
  const receiver = paidSide(r.outcome);
  const lien =
    receiver === null
      ? ''
      : receiver === me
        ? ' If they overturn the ruling, you get a lien until you pay the XMR back.' // COPY-UNSIGNED (review I1)
        : ' If they overturn the ruling, the other trader gets a lien until they pay the XMR back.'; // COPY-UNSIGNED (review I1)
  return `${who} A second moderator will look at it.${lien}`;
}

/** A Plan 1 `Outcome` as the escrow runtime hands it over (structural, so this file needs no escrow import). */
export interface SettleOutcome {
  kind: 'release';
  to: { address: string; amountAtomic: bigint }[];
  builder: 'buyer' | 'seller' | 'mod';
  cosigner: 'buyer' | 'seller' | 'mod';
}

/**
 * The ruling gate in front of co-signing a moderator-built transaction (Plan 3 Task 27): only a
 * set the moderator built for this side to co-sign, only when the ruling pays this side, only once
 * the ruling is final (the appeal round, or round 1 past its window with no appeal; see
 * NEEDS_PLAN_4_RULING_PAYOUT above rulingCopy: Plan 4's execution task changes this), and only when
 * `cosignPolicy` (Task 12, which checks the exact payouts against this device's own facts) agrees.
 * Anything else is refused. Never throws.
 */
export function rulingAllowsCosign(a: {
  role: Party;
  dispute: DisputeView | null;
  now: Date;
  outcome: SettleOutcome;
  cosignPolicy: (o: SettleOutcome) => boolean;
}): boolean {
  try {
    const d = a.dispute;
    if (d === null || d.ruling === null || d.afterRefund) return false;
    if (paidSide(d.ruling.outcome) !== a.role) return false;
    if (!rulingFinal(d, a.now)) return false;
    if (a.outcome.kind !== 'release' || a.outcome.builder !== 'mod' || a.outcome.cosigner !== a.role) return false;
    return a.cosignPolicy(a.outcome) === true;
  } catch {
    return false;
  }
}
