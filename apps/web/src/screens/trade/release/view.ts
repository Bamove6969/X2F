import { escrowPlan, formatFiat, formatXmr } from '@x2f/trade';
import { methodOf, publicName, type TradeView } from '../../../api/trade.js';
import type { UseEscrow } from '../../../escrow/useEscrow.js';

/**
 * The fields of Task 22's `TradeView` (`GET /v1/trades/:code`, apps/web/src/api/trade.ts) that
 * SellerConfirm and Released read. `fee` exists only in the ad poster's view; the other trader is
 * shown only through `publicName(counterparty)`, the PUBLIC display name (FU-A).
 */
export type ReleaseTrade = Pick<
  TradeView,
  | 'code'
  | 'role'
  | 'poster'
  | 'state'
  | 'counterparty'
  | 'methodId'
  | 'profile'
  | 'amountAtomic'
  | 'fiatCents'
  | 'lockedRate'
  | 'releasable'
  | 'releasableEtaMin'
  | 'fee'
  | 'settling'
  | 'txHash'
  | 'confirmBy'
  | 'serverNow'
  | 'securedAt'
>;

/** The payment method as the trade header shows it: Task 22's `methodOf`. */
export type MethodInfo = ReturnType<typeof methodOf>;

export { methodOf, publicName };

/**
 * The page's handle on the escrow for a release: Task 12's `UseEscrow` (escrow/useEscrow.ts, the
 * room's one handle; Task 22's `TradeEscrow` is that type), narrowed to what these screens read.
 * `release()` has the seller's app build and sign (the buyer's app co-signs through
 * `cosignPolicy`); `phase` says whether THIS device has signed; `amountAtomic`/`fiatCents` are
 * the amount this device accepts, the only sum the screens show (review 2026-10-27, I3).
 */
export type ReleaseEscrow = Pick<UseEscrow, 'release' | 'phase' | 'error' | 'refusal' | 'keepOpen' | 'amountAtomic' | 'fiatCents'> & Partial<Pick<UseEscrow, 'handedOff'>>;

/** What `GET /v1/trades/:code/confirmations` answers (apps/api/src/trades/routes.ts). */
export interface Confirmations {
  confirmations: number | null;
  target: number;
  /** The buyer's own payout address ending, on a release, for the buyer only. */
  payoutEnd?: string;
}

const xmr = (atomic: bigint) => `${formatXmr(atomic)} XMR`;

/**
 * The amounts both screens show, formatted (XMR with 6 decimals, Global Constraints), from the
 * amount THIS device accepts (`escrow.amountAtomic`/`fiatCents`), never the API's (review
 * 2026-10-27, I3). The fee is worked out from that amount (`escrowPlan`, 1%); `t.fee` only says
 * the viewer is the ad poster, the one who sees it. Null while the device has no amount.
 */
export function amounts(t: Pick<ReleaseTrade, 'role' | 'lockedRate' | 'fee'>, device: Pick<ReleaseEscrow, 'amountAtomic' | 'fiatCents'>) {
  if (device.amountAtomic === null || device.fiatCents === null || device.amountAtomic <= 0n) return null;
  const amount = device.amountAtomic;
  const fee = t.fee ? escrowPlan({ amountAtomic: amount, poster: t.role }).feeAtomic : null;
  return {
    amount: xmr(amount),
    fiat: formatFiat(device.fiatCents, t.lockedRate.currency),
    /** Poster only: the fee row (Review board "X2F fee (1%, your ad) −0.012500 XMR"). */
    fee: fee === null ? null : xmr(fee),
    /** A poster buyer receives the amount less the fee; a taker buyer the whole amount (both before the network fee). */
    buyerReceives: xmr(fee !== null && t.role === 'buyer' ? amount - fee : amount),
    /** The same, unformatted, for the kit's Xmr (the paid room, lead review 2026-11-08 R-I1). */
    buyerReceivesAtomic: fee !== null && t.role === 'buyer' ? amount - fee : amount,
    /** A poster seller funded the amount plus the fee (Task 22 "Includes X2F fee (1%, your ad)"). */
    sellerSent: fee === null ? null : xmr(amount + fee),
  };
}

/** What a trade screen says when the device's escrow has stopped (Task 12 `phase: 'error'`). */
// not-a-refusal: a device fault (the escrow stopped)
export const ESCROW_STOPPED = 'The escrow stopped on this device, so it can’t sign a release. Reload the page; if it stays, open a dispute.';

/** What a trade screen says for each Task 12 refusal (never silent, runtime.ts EscrowRefusal). */
export function refusalCopy(r: NonNullable<ReleaseEscrow['refusal']>, other: string): string {
  switch (r) {
    case 'amount-out-of-range':
      return 'The trade amount X2F shows is not one this device accepted. Nothing is signed while it differs.';
    case 'amount-changed':
      return 'The trade amount X2F shows changed after it was fixed on this device. Nothing is signed while it differs.';
    case 'paid-amount-refused':
      return `The amount ${other} marked as paid doesn’t fit this trade. This device won’t sign a release. Open a dispute.`;
    case 'paid-amount-waiting':
      return 'This device is still checking the escrow for the amount marked as paid. Keep this page open.';
    case 'amount-unknown':
      return 'This device doesn’t know the trade amount, so it won’t sign a release. Open a dispute.';
    case 'attempts-exhausted':
      return 'This device tried to sign several times and stopped. Open a dispute.';
    case 'view-mismatch':
      return 'The trade details from X2F don’t match what you confirmed on this device. Nothing is signed while they differ.';
  }
}

/** A Monero tx hash as the explorer link may carry it: exactly 64 lowercase hex characters. */
export function isTxHash(h: string | null): h is string {
  return h !== null && /^[0-9a-f]{64}$/.test(h);
}

const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null);

/**
 * The profile copy SellerConfirm uses (spec 2.6): where the money lands, from `landsIn` ("your
 * bank account, checked in your bank's app" → "your bank account"), and the `checkPrompt`. With no
 * profile (Task 3 not wired yet) the place is "your account" and there is no prompt.
 */
export function profileCopy(profile: unknown): { place: string; checkPrompt: string | null } {
  const p = profile !== null && typeof profile === 'object' ? (profile as Record<string, unknown>) : {};
  const landsIn = text(p.landsIn);
  const place = landsIn === null ? 'your account' : (landsIn.split(',')[0] ?? landsIn).trim();
  return { place, checkPrompt: text(p.checkPrompt) };
}

/** "your bank account" → "my bank account", for the seller's own checkbox sentence. */
export function firstPerson(place: string): string {
  return place.replace(/^your\b/, 'my');
}
