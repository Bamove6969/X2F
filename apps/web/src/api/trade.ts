import { api } from './client.js';

/** The trade's state (packages/trade `TradeState`; listed here so the web build needs no server code). */
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

export const TRADE_STATES: readonly TradeState[] = [
  'setup',
  'funding',
  'securing',
  'secured',
  'paid',
  'refund_requested',
  'settling',
  'released',
  'refunded',
  'lapsed',
  'cancelled',
  'disputed',
];

export type Party = 'buyer' | 'seller';

/**
 * The other trader as the API shows them (apps/api/src/traders/summary.ts `TraderSummary`, Task 4). The name
 * is the PUBLIC display name (FU-A); the private login name is never sent. Read it only through
 * `publicName`.
 */
export interface TraderSummary {
  displayName: string;
  completedTrades: number;
  online: boolean;
  lastSeenAt: string | null;
  typicalMinutes: number | null;
  positivePct: number | null;
  badges: string[];
  /** The starter-limits stage (spec 2.3, Task 4). */
  stage: 'starter' | 'building' | 'graduated';
}

/** The counterparty's public display name; the one way screens read it (a login name is never sent or shown). */
export function publicName(t: Pick<TraderSummary, 'displayName'>): string {
  return t.displayName;
}

/**
 * What `GET /v1/trades/:code` returns (apps/api/src/trades/view.ts `TradeView`, Task 6), as JSON:
 * amounts are decimal strings (atomic units, or the currency's minor units), dates ISO strings.
 * `fee` is present only in the poster's view. `funding` is present only for the seller and only
 * while the trade is unfunded (`setup`/`funding`); once funded it is never returned again.
 * test/tradeView.test.ts keeps this in step with the API's type.
 */
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
  /** When the seller tapped "Fund escrow" (Revision 2026-10-29b); after it the seller can't walk away. */
  fundStartedAt: string | null;
  securedAt: string | null;
  payBy: string | null;
  paidAt: string | null;
  confirmBy: string | null;
  finalAlertAt: string | null;
  /** When the buyer's device posted the final-alert seen-receipt (Task 25's FinalAlert); sent to the buyer only, null for the seller. */
  finalAlertSeenAt: string | null;
  settleBy: string | null;
  pausedAt: string | null;
  closedAt: string | null;
  /** The seller's "Confirm cancel" after a buyer-cancel refund (owner 2026-10-29); null until then. */
  cancelConfirmedAt: string | null;
  /** When the seller's Confirm cancel became available; the trade closes by itself 48 h later (owner 2026-10-29). */
  cancelConfirmableAt: string | null;
  nextDeadline: string | null;
  serverNow: string;
}

/** A trade view whose amounts are not plain digit strings: never parsed, never rendered. */
export class TradeShapeError extends Error {
  constructor(public readonly field: string) {
    super(`trade view: ${field} is not a plain amount`);
    this.name = 'TradeShapeError';
  }
}

/** A plain non-negative decimal of at most 30 digits: the only thing `BigInt()` is ever given from the API. */
const AMOUNT = /^[0-9]{1,30}$/;

const amount = (v: unknown, field: string): void => {
  if (typeof v !== 'string' || !AMOUNT.test(v)) throw new TradeShapeError(field);
};

/**
 * Checks every bigint string of a trade view BEFORE any screen calls `BigInt()` on it (review
 * 2026-10-27, Minor 5): a malformed one would otherwise throw during render and blank the room.
 * Returns the same object; throws TradeShapeError, which the room shows as "could not load".
 */
export function parseTradeView(raw: unknown): TradeView {
  if (raw === null || typeof raw !== 'object') throw new TradeShapeError('body');
  const v = raw as Record<string, unknown>;
  amount(v.amountAtomic, 'amountAtomic');
  amount(v.fiatCents, 'fiatCents');
  amount(v.maxFiatCents, 'maxFiatCents');
  amount(v.receivedAtomic, 'receivedAtomic');
  const rate = v.lockedRate as Record<string, unknown> | null | undefined;
  amount(rate?.centsPerXmr, 'lockedRate.centsPerXmr');
  if (v.grown !== null && v.grown !== undefined) {
    const g = v.grown as Record<string, unknown>;
    amount(g.fromAtomic, 'grown.fromAtomic');
    amount(g.fromFiatCents, 'grown.fromFiatCents');
  }
  if (v.funding !== null && v.funding !== undefined) amount((v.funding as Record<string, unknown>).sellerFundsAtomic, 'funding.sellerFundsAtomic');
  if (v.fee !== undefined && v.fee !== null) amount((v.fee as Record<string, unknown>).atomic, 'fee.atomic');
  return raw as TradeView;
}

/** GET /v1/trades/:code (404 for anyone but its two traders); the amounts are checked before anything reads them. */
export async function getTrade(code: string, signal?: AbortSignal): Promise<TradeView> {
  return parseTradeView(await api<unknown>(`/v1/trades/${encodeURIComponent(code)}`, signal ? { signal } : {}));
}

/**
 * The trade's payment method for the header and warnings. The view carries Task 3's profile as
 * `profile` (null until Task 3 wires `getProfile`) and no display name; until a name is in the
 * view, `profile.name` is read if present, else the method id (test/tradeRoom-tripwires.test.ts).
 */
export function methodOf(view: Pick<TradeView, 'methodId' | 'profile'>): { name: string; whatItIs: string; giftCard: boolean } {
  const p = (view.profile !== null && typeof view.profile === 'object' ? view.profile : {}) as Record<string, unknown>;
  return {
    name: typeof p.name === 'string' && p.name !== '' ? p.name : view.methodId,
    whatItIs: typeof p.whatItIs === 'string' ? p.whatItIs : '',
    giftCard: p.giftCard === true,
  };
}

/** POST /v1/trades/:code/events (Task 6); answers the new view, or throws ApiCallError (409 with the rule code). */
export function postTradeEvent(code: string, event: { type: string; fiatCents?: bigint }): Promise<TradeView> {
  return api<TradeView>(`/v1/trades/${encodeURIComponent(code)}/events`, { method: 'POST', body: event });
}
