import { catalogMethodName } from '../methods/catalogNames.js';
import { api } from './client.js';

/** The trade's state (packages/trade `TradeState`; listed here so the web build needs no server code). */
export type TradeState =
  | 'setup'
  | 'funding'
  | 'securing'
  | 'secured'
  | 'paid'
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
 * is the PUBLIC Trade Tag (FU-A); the private login name is never sent. Read it only through
 * `publicName`.
 */
export interface TraderSummary {
  tradeTag: string;
  completedTrades: number;
  online: boolean;
  lastSeenAt: string | null;
  typicalMinutes: number | null;
  positivePct: number | null;
  badges: string[];
  /** Plan 5 Task 5: how many of `badges` are Featured (New included); the rest are "+N". */
  featuredBadges?: number;
  /** The starter-limits stage (spec 2.3, Task 4). */
  stage: 'starter' | 'building' | 'graduated';
  /** Owner Q63: the opt-in traded line's rounded-down whole XMR, or null (not shown in the trade room yet). */
  tradedOverXmr?: number | null;
  /** Owner Q64, p4-1: verified imported volume per site, in whole US dollars. */
  imported?: { site: string; overUsd: number }[];
  /** D-049 (J-21): disputes won and lost, by each one's latest ruling (the profile's "Disputes: N won, M lost"). */
  disputes?: { won: number; lost: number };
}

/** The counterparty's public Trade Tag; the one way screens read it (a login name is never sent or shown). */
export function publicName(t: Pick<TraderSummary, 'tradeTag'>): string {
  return t.tradeTag;
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
  // No `paymentInstructions` here on purpose (instr-hash review I1): the API sends the locked text,
  // but it is unsigned. Only the escrow runtime reads it (from `unknown`, escrow/adapters.ts), and a
  // screen shows payment instructions only from `EscrowStatus.paymentInstructions`, which passes them
  // on only when they hash to the moderator-attested ones (Task 34 review I1).
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
  /**
   * D-005 (Plan 4 Task 24): until when this viewer may still file an appeal against the dispute's
   * ruling; null otherwise (and for a team member without the File an appeal box). Missing from an
   * older API or a live-event view: read as null.
   */
  appealUntil?: string | null;
  /**
   * Lien recovery (owner 16 Nov 2026, docs/lien-recovery.md): to the buyer only, the part of their
   * proceeds this trade pays to the person they owe; absent when none. The buyer's device confirmed
   * it at take (ConfirmedDeal.lienRecoveryAtomic); not shown on screen yet (Liens.tsx).
   */
  lienRecoveryAtomic?: string;
  txHash: string | null;
  takenAt: string;
  setupBy: string | null;
  fundBy: string | null;
  fundingSeenAt: string | null;
  /** When the seller tapped "Fund escrow" (Revision 2026-10-29b); after it the seller can't walk away. */
  fundStartedAt: string | null;
  securedAt: string | null;
  payBy: string | null;
  /** The buyer's time to pay in minutes, the payment method's, fixed at take (owner p9-6); missing from an older API (90). */
  payWindowMin?: number;
  paidAt: string | null;
  confirmBy: string | null;
  /**
   * The trade's confirm window in minutes, fixed at take by the payment type (owner 2026-11-07 F9:
   * 90 for instant types up to 4 days). Either side may dispute in `paid` from `confirmBy` (owner p9-4).
   */
  confirmWindowMin: number;
  settleBy: string | null;
  /**
   * When a trader's side of the settlement was reported done (Task 9 I/O, lead decision b): the
   * trade then waits for the network's sweep and the settle window no longer reverts it. Null
   * until then. `settleBy` is unchanged (a dispute stays open after it).
   */
  releaseClaimedAt: string | null;
  pausedAt: string | null;
  closedAt: string | null;
  /** The seller's "Confirm cancel" after a buyer-cancel refund (owner 2026-10-29); null until then. */
  cancelConfirmedAt: string | null;
  /** When the seller's Confirm cancel became available; the trade closes by itself 48 h later (owner 2026-10-29). */
  cancelConfirmableAt: string | null;
  /**
   * When the seller first nudged the buyer after the escrow was secured; null = not yet. A record
   * only: nudges are optional (owner 8 Nov, p6-1), the seller's cancel needs none.
   */
  sellerNudgedAt: string | null;
  nextDeadline: string | null;
  /**
   * Plan 7 Task 3: when the trade self-destructs on the server (30 days after it ended, or 90 days
   * after its last dispute closed); null while it has no date. Absent from an older API.
   */
  deleteAt?: string | null;
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
  if (v.deleteAt !== undefined && v.deleteAt !== null && (typeof v.deleteAt !== 'string' || !Number.isFinite(Date.parse(v.deleteAt)))) {
    throw new TradeShapeError('deleteAt');
  }
  if (v.lienRecoveryAtomic !== undefined) amount(v.lienRecoveryAtomic, 'lienRecoveryAtomic');
  return raw as TradeView;
}

/** GET /v1/trades/:code (404 for anyone but its two traders); the amounts are checked before anything reads them. */
export async function getTrade(code: string, signal?: AbortSignal): Promise<TradeView> {
  return parseTradeView(await api<unknown>(`/v1/trades/${encodeURIComponent(code)}`, signal ? { signal } : {}));
}

/**
 * The trade's payment method for the header and warnings. The name is the bundled catalog's for the
 * view's method id (review M2: the trade room hands its screens the moderator-attested id), never
 * the profile's; the id itself when the catalog has none. The explainer and the gift-card flag come
 * from Task 3's profile (`profile`, null until Task 3 wires `getProfile`; the room drops it when the
 * view's method is not the attested one).
 */
export function methodOf(view: Pick<TradeView, 'methodId' | 'profile'>): { name: string; whatItIs: string; giftCard: boolean } {
  const p = (view.profile !== null && typeof view.profile === 'object' ? view.profile : {}) as Record<string, unknown>;
  return {
    name: catalogMethodName(view.methodId),
    whatItIs: typeof p.whatItIs === 'string' ? p.whatItIs : '',
    giftCard: p.giftCard === true,
  };
}

/** POST /v1/trades/:code/events (Task 6); answers the new view, or throws ApiCallError (409 with the rule code). */
export function postTradeEvent(code: string, event: { type: string; fiatCents?: bigint }): Promise<TradeView> {
  return api<TradeView>(`/v1/trades/${encodeURIComponent(code)}/events`, { method: 'POST', body: event });
}
