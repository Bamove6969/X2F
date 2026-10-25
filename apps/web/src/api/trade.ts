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
 * The other trader as the API shows them (apps/api/src/trades/view.ts `TraderSummary`). The name
 * is always the PUBLIC display name (FU-A): before wip/lead-p2-fua merges the API calls it
 * `username` (the public column), after it `displayName`. Read it only through `publicName`.
 */
export interface TraderSummary {
  displayName?: string;
  /** The public name before FU-A (the column was renamed `display_name`); never a login name. */
  username?: string;
  completedTrades: number;
  online: boolean;
  lastSeenAt: string | null;
  typicalMinutes: number | null;
  positivePct: number | null;
  badges: string[];
}

/** The counterparty's public display name; the one way screens read it (a login name is never sent or shown). */
export function publicName(t: Pick<TraderSummary, 'displayName' | 'username'>): string {
  return t.displayName ?? t.username ?? '';
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

/** GET /v1/trades/:code (404 for anyone but its two traders). */
export function getTrade(code: string, signal?: AbortSignal): Promise<TradeView> {
  return api<TradeView>(`/v1/trades/${encodeURIComponent(code)}`, signal ? { signal } : {});
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
