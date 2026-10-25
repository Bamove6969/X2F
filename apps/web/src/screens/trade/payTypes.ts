/**
 * Task 23's copy of the trade-room slot interface that Task 22 owns (wip/lead-p3-task22 @e8e1f44:
 * `screens/trade/TradeRoom.tsx` `TradeScreenProps`, `screens/trade/seams.ts` `TradeEscrow`,
 * `api/trade.ts` `TradeView`, `TraderSummary`, `publicName`). Task 23 builds its screens against
 * these copies so it never creates or edits Task 22's files.
 *
 * TRIPWIRE (test/pay-tripwires.test.ts): the day `TradeRoom.tsx` is on this branch, that test fails
 * and says what to do: replace this file's body with re-exports from Task 22's modules, register
 * `TASK23_SLOTS` (BuyerPay.tsx) with `registerTradeScreen`, and add `import './BuyerPay.js';` on
 * Task 23's reserved line in `screens/trade/screens.ts`.
 */

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

/** The other trader (apps/api/src/trades/view.ts `TraderSummary`); the name is the PUBLIC display name (FU-A). */
export interface TraderSummary {
  displayName?: string;
  /** The public name before FU-A renamed the column to `display_name`; never a login name. */
  username?: string;
  completedTrades: number;
  online: boolean;
  lastSeenAt: string | null;
  typicalMinutes: number | null;
  positivePct: number | null;
  badges: string[];
}

/** The counterparty's public display name: the only way Task 23's screens read a name. */
export function publicName(t: Pick<TraderSummary, 'displayName' | 'username'>): string {
  return t.displayName ?? t.username ?? '';
}

/** `GET /v1/trades/:code` as JSON (Task 6 `TradeView`): amounts are decimal strings, dates ISO strings. */
export interface TradeView {
  code: string;
  role: Party;
  poster: Party;
  state: TradeState;
  counterparty: TraderSummary;
  methodId: string;
  profile: unknown;
  amountAtomic: string;
  fiatCents: string;
  lockedRate: { currency: string; centsPerXmr: string };
  maxFiatCents: string;
  grown: { at: string; fromAtomic: string; fromFiatCents: string } | null;
  receivedAtomic: string;
  confirmations: number;
  releasable: boolean;
  releasableEtaMin: number | null;
  funding: { sellerFundsAtomic: string; escrowAddress: string | null; uri: string | null; walletApp: string | null } | null;
  fee?: { atomic: string };
  extensions: number;
  cancelProposedBy: Party | null;
  settling: 'release' | 'mutual-cancel' | 'buyer-cancel' | 'auto-refund' | 'lapse-refund' | null;
  dispute: { by: 'buyer' | 'seller' | 'system'; at: string } | null;
  txHash: string | null;
  takenAt: string;
  setupBy: string | null;
  fundBy: string | null;
  fundingSeenAt: string | null;
  securedAt: string | null;
  payBy: string | null;
  paidAt: string | null;
  confirmBy: string | null;
  finalAlertAt: string | null;
  settleBy: string | null;
  pausedAt: string | null;
  closedAt: string | null;
  nextDeadline: string | null;
  serverNow: string;
}

export type EscrowPhase = 'idle' | 'registering' | 'verifying' | 'setting-up' | 'ready' | 'signing' | 'done' | 'settled-without-device' | 'error';
export type EscrowErrorCode = 'participants-mismatch' | 'deal-mismatch' | 'not-confirmed' | 'escrow-failed' | 'unsupported-browser';
export type EscrowRefusal = 'amount-out-of-range' | 'amount-changed' | 'paid-amount-refused' | 'paid-amount-waiting' | 'amount-unknown' | 'attempts-exhausted';
export type UserSignal = 'trade.paid' | 'trade.cancel' | 'trade.extend' | 'trade.refund-request';

/** Task 22's `TradeEscrow` (= Task 12's `UseEscrow`), field for field. */
export interface TradeEscrow {
  phase: EscrowPhase;
  error: EscrowErrorCode | null;
  retryable: boolean;
  refusal: EscrowRefusal | null;
  checkWords: string[] | null;
  keepOpen: boolean;
  release(): Promise<void>;
  buildRefund(): Promise<void>;
  /** Sends `trade.cancel` and settles the buyer-cancel refund (Task 12). */
  buyerCancel(): Promise<void>;
  proposeCancelSign(): Promise<void>;
  /** Sends `trade.paid` with the total the buyer confirmed (Task 12). */
  markPaid(fiatCents: bigint): Promise<void>;
  retry(): void;
  signal(type: Exclude<UserSignal, 'trade.paid'>): Promise<void>;
}

/** Task 22's `TradeScreenProps`: what the room hands every screen. */
export interface TradeScreenProps {
  view: TradeView;
  escrow: TradeEscrow;
  refresh(): Promise<void>;
  serverClock(): Date;
  wide: boolean;
}
