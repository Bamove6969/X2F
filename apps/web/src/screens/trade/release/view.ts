import { escrowPlan, formatFiat, formatXmr } from '@x2f/trade';
import type { UseEscrow } from '../../../escrow/useEscrow.js';

/**
 * The fields of Task 6's TradeView (`GET /v1/trades/:code`, apps/api/src/trades/view.ts) that
 * SellerConfirm and Released read. Amounts are decimal strings, dates ISO strings. `fee` exists
 * only in the ad poster's view. The other trader is shown only by `publicName(counterparty)`, the
 * PUBLIC display name (FU-A); a login name never reaches the browser. Structurally a subset of
 * Task 22's `TradeView` (wip/lead-p3-task22 apps/web/src/api/trade.ts), so the trade room's view
 * can be passed straight in.
 */
export interface ReleaseTrade {
  code: string;
  role: 'buyer' | 'seller';
  poster: 'buyer' | 'seller';
  /** Task 22's `TradeState` (packages/trade); a string here so either view type passes in. */
  state: string;
  counterparty: { displayName?: string; username?: string };
  methodId: string;
  /** Task 3's method profile, or null until Task 3 wires `getProfile` into the view. */
  profile: unknown;
  amountAtomic: string;
  fiatCents: string;
  lockedRate: { currency: string; centsPerXmr: string };
  releasable: boolean;
  releasableEtaMin: number | null;
  fee?: { atomic: string } | undefined;
  settling: string | null;
  txHash: string | null;
  confirmBy: string | null;
  serverNow: string;
}

/** The payment method as the trade header shows it (name and the "What is this?" sentence). */
export interface MethodInfo {
  name: string;
  whatItIs: string;
}

/**
 * The page's handle on the escrow for a release: Task 12's `UseEscrow` (escrow/useEscrow.ts, the
 * room's one handle; Task 22's `TradeEscrow` is that type), narrowed to what these screens read.
 * `release()` has the seller's app build and sign (the buyer's app co-signs through
 * `cosignPolicy`); `phase` says whether THIS device has signed; `amountAtomic`/`fiatCents` are
 * the amount this device accepts, the only sum the screens show (review 2026-10-27, I3).
 */
export type ReleaseEscrow = Pick<UseEscrow, 'release' | 'phase' | 'error' | 'refusal' | 'keepOpen' | 'amountAtomic' | 'fiatCents'>;

/** What `GET /v1/trades/:code/confirmations` answers (apps/api/src/trades/routes.ts). */
export interface Confirmations {
  confirmations: number | null;
  target: number;
  /** The buyer's own payout address ending, on a release, for the buyer only. */
  payoutEnd?: string;
}

/**
 * The counterparty's public display name: `displayName` once wip/lead-p2-fua renames the column,
 * `username` (the public column) before. The same rule as Task 22's `publicName` in
 * apps/web/src/api/trade.ts; use that one once it is on the line (release-tripwires.test.ts).
 */
export function publicName(t: { displayName?: string; username?: string }): string {
  return t.displayName ?? t.username ?? '';
}

/**
 * The method for the trade header: the profile's `name` if the view carries one, else the method
 * id. The same rule as Task 22's `methodOf` (apps/web/src/api/trade.ts).
 */
export function methodInfo(t: Pick<ReleaseTrade, 'methodId' | 'profile'>): MethodInfo {
  const p = (t.profile !== null && typeof t.profile === 'object' ? t.profile : {}) as Record<string, unknown>;
  return {
    name: typeof p.name === 'string' && p.name !== '' ? p.name : t.methodId,
    whatItIs: typeof p.whatItIs === 'string' ? p.whatItIs : '',
  };
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
    /** A poster seller funded the amount plus the fee (Task 22 "Includes X2F fee (1%, your ad)"). */
    sellerSent: fee === null ? null : xmr(amount + fee),
  };
}

/** What a trade screen says when the device's escrow has stopped (Task 12 `phase: 'error'`). */
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
