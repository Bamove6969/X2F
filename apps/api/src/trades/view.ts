import { moneroUri, nextDeadline, releasableEta, type Party, type Trade } from '@x2f/trade';
import type { TraderSummary } from '../traders/summary.js';

// The counterparty's summary is Task 4's (traders/summary.ts); re-exported for existing importers.
export { ONLINE_MS, traderSummary, type TraderSummary } from '../traders/summary.js';

/** The viewer's side of the trade, or null for anyone else. */
export function roleOf(t: Trade, accountId: string): Party | null {
  if (t.buyerId === accountId) return 'buyer';
  if (t.sellerId === accountId) return 'seller';
  return null;
}

const iso = (d: Date | null): string | null => (d === null ? null : d.toISOString());

/**
 * What `GET /v1/trades/:code` returns. Amounts are decimal strings (atomic units, or the
 * currency's minor units), dates ISO strings. `fee` exists only in the poster's view (the taker
 * never sees a fee, Global Constraints). The escrow address, the funding link and the exact
 * amount to send go only to the seller and only while the trade is unfunded (Revision
 * 2026-10-21: once funded they are never returned again).
 */
export interface TradeView {
  code: string;
  role: Party;
  poster: Party;
  state: Trade['state'];
  counterparty: TraderSummary;
  methodId: string;
  profile: unknown;
  amountAtomic: string;
  fiatCents: string;
  lockedRate: { currency: string; centsPerXmr: string };
  /**
   * The offer's maximum fiat total, fixed at take (Revision 2026-10-20): a growth stays within
   * it. The browser escrow runtime (Task 12) checks it against the deal the user confirmed.
   */
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
  settling: Trade['settling'];
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
  settleBy: string | null;
  /**
   * When the moderator's watcher reported that a buyer or seller says their side of the
   * settlement is done (Task 9 I/O, lead decision b): from then on the trade waits for the network
   * to show the sweep, and the settle window no longer reverts it. The claim time only, for both
   * traders; nothing else about the moderator. `settleBy` is unchanged (a dispute stays open after it).
   * Null outside `settling`: an escalation from `settling` leaves the claim on the trade, and it is
   * not live there (plan Revision 2026-10-29), so the view never sends it (lead decision M5).
   */
  releaseClaimedAt: string | null;
  pausedAt: string | null;
  closedAt: string | null;
  /** The seller's "Confirm cancel" after a buyer-cancel refund (owner 2026-10-29); null until then. */
  cancelConfirmedAt: string | null;
  /** When the seller's Confirm cancel became available; the trade closes by itself 48 h later (owner 2026-10-29). */
  cancelConfirmableAt: string | null;
  /**
   * When the seller first nudged the buyer after the escrow was secured (migration 119); null = not
   * yet. A record only: nudges are optional (owner 8 Nov, p6-1), the seller's cancel needs none.
   */
  sellerNudgedAt: string | null;
  nextDeadline: string | null;
  serverNow: string;
  /**
   * Hold model v3: the other party's account has a temporary problem (a recovery-code hold; the
   * trade is paused or was cancelled, trades/held.ts). The partner is told only that, never
   * why. False when the view is built without it (live events).
   */
  counterpartyProblem: boolean;
  /**
   * Owner G7 (lead review 8 Nov I5): this trade's buyer-cancel is recorded and waits for the other
   * account's temporary problem to end (no coins move meanwhile). False when built without it.
   */
  cancelWaiting: boolean;
}

/** The extra facts a view needs that are not trade fields. */
export interface ViewContext {
  counterparty: TraderSummary;
  /** Task 3's method profile for `t.methodId` (null until Task 3 wires `getProfile`). */
  profile: unknown;
  sellerWalletApp: string | null;
  /** Hold model v3: see `TradeView.counterpartyProblem`. */
  counterpartyProblem?: boolean;
  /** See `TradeView.cancelWaiting`. */
  cancelWaiting?: boolean;
}

/**
 * The single serializer for a trade (Task 6). Throws for a viewer who is not a participant; the
 * route answers 404 before calling it.
 */
export function toTradeView(t: Trade, viewerId: string, serverNow: Date, ctx: ViewContext): TradeView {
  const role = roleOf(t, viewerId);
  if (role === null) throw new Error('not a participant');
  const unfunded = t.state === 'setup' || t.state === 'funding';
  const view: TradeView = {
    code: t.code,
    role,
    poster: t.poster,
    state: t.state,
    counterparty: ctx.counterparty,
    methodId: t.methodId,
    profile: ctx.profile,
    amountAtomic: t.amountAtomic.toString(),
    fiatCents: t.fiatCents.toString(),
    lockedRate: { currency: t.lockedRate.currency, centsPerXmr: t.lockedRate.centsPerXmr.toString() },
    maxFiatCents: t.maxFiatCents.toString(),
    grown: t.grown
      ? { at: t.grown.at.toISOString(), fromAtomic: t.grown.fromAtomic.toString(), fromFiatCents: t.grown.fromFiatCents.toString() }
      : null,
    receivedAtomic: t.receivedAtomic.toString(),
    confirmations: t.confirmations,
    releasable: t.releasable,
    releasableEtaMin: releasableEta(t),
    funding:
      role === 'seller' && unfunded
        ? {
            sellerFundsAtomic: t.sellerFundsAtomic.toString(),
            escrowAddress: t.escrowAddress,
            uri: t.escrowAddress === null ? null : moneroUri(t.escrowAddress, t.sellerFundsAtomic),
            walletApp: ctx.sellerWalletApp,
          }
        : null,
    extensions: t.extensions,
    cancelProposedBy: t.cancelProposedBy,
    settling: t.settling,
    dispute: t.dispute ? { by: t.dispute.by, at: t.dispute.at.toISOString() } : null,
    txHash: t.txHash,
    takenAt: t.takenAt.toISOString(),
    setupBy: iso(t.setupBy),
    fundBy: iso(t.fundBy),
    fundingSeenAt: iso(t.fundingSeenAt),
    fundStartedAt: iso(t.fundStartedAt),
    securedAt: iso(t.securedAt),
    payBy: iso(t.payBy),
    paidAt: iso(t.paidAt),
    confirmBy: iso(t.confirmBy),
    settleBy: iso(t.settleBy),
    releaseClaimedAt: t.state === 'settling' ? iso(t.releaseClaimedAt) : null,
    pausedAt: iso(t.pausedAt),
    closedAt: iso(t.closedAt),
    cancelConfirmedAt: iso(t.cancelConfirmedAt),
    cancelConfirmableAt: iso(t.cancelConfirmableAt),
    sellerNudgedAt: iso(t.sellerNudgedAt),
    nextDeadline: iso(nextDeadline(t)),
    serverNow: serverNow.toISOString(),
    counterpartyProblem: ctx.counterpartyProblem ?? false,
    cancelWaiting: ctx.cancelWaiting ?? false,
  };
  if (role === t.poster) view.fee = { atomic: t.feeAtomic.toString() };
  return view;
}
