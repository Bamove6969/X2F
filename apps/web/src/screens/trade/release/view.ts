import { formatFiat, formatXmr } from '@x2f/trade';

/**
 * The fields of Task 6's TradeView (`GET /v1/trades/:code`, apps/api/src/trades/view.ts) that
 * SellerConfirm and Released read. Amounts are decimal strings, dates ISO strings. `fee` exists
 * only in the ad poster's view. `counterparty.username` is the other trader's PUBLIC display name
 * (FU-A); the private login name never reaches the browser.
 */
export interface ReleaseTrade {
  code: string;
  role: 'buyer' | 'seller';
  poster: 'buyer' | 'seller';
  state: string;
  counterparty: { username: string };
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
 * The page's handle on the escrow for a release: Task 12's `useEscrow(code).release()` (the
 * seller's app builds and signs; the buyer's app co-signs through `cosignPolicy`).
 */
export interface ReleaseEscrow {
  release(): Promise<void>;
}

/** What `GET /v1/trades/:code/confirmations` answers (apps/api/src/trades/routes.ts). */
export interface Confirmations {
  confirmations: number | null;
  target: number;
  /** The buyer's own payout address ending, on a release, for the buyer only. */
  payoutEnd?: string;
}

const xmr = (atomic: bigint) => `${formatXmr(atomic)} XMR`;

/** The amounts both screens show, formatted (XMR with 6 decimals, Global Constraints). */
export function amounts(t: ReleaseTrade) {
  const amount = BigInt(t.amountAtomic);
  const fee = t.fee ? BigInt(t.fee.atomic) : null;
  return {
    amount: xmr(amount),
    fiat: formatFiat(BigInt(t.fiatCents), t.lockedRate.currency),
    /** Poster only: the fee row (Review board "X2F fee (1%, your ad) −0.012500 XMR"). */
    fee: fee === null ? null : xmr(fee),
    /** A poster buyer receives the amount less the fee; a taker buyer the whole amount. */
    buyerReceives: xmr(fee !== null && t.role === 'buyer' ? amount - fee : amount),
    /** A poster seller funded the amount plus the fee (Task 22 "Includes X2F fee (1%, your ad)"). */
    sellerSent: fee === null ? null : xmr(amount + fee),
  };
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
