import { moneroUri, nextDeadline, releasableEta, type Party, type Trade } from '@x2f/trade';
import type { Queryable } from '../db/pool.js';

/**
 * A trader as another trader sees them (Task 4's shape). Task 4 owns the full summary
 * (`traders/summary.ts`); until it lands, `traderSummary` below fills what the trades table and
 * sessions already know, and Plan 5 fills `typicalMinutes`, `positivePct` and `badges`.
 */
export interface TraderSummary {
  username: string;
  completedTrades: number;
  online: boolean;
  lastSeenAt: string | null;
  typicalMinutes: number | null;
  positivePct: number | null;
  badges: string[];
}

/** Someone counts as online when one of their sessions was used this recently. */
export const ONLINE_MS = 5 * 60_000;

export async function traderSummary(q: Queryable, accountId: string, now: Date): Promise<TraderSummary> {
  const { rows } = await q.query<{ username: string; completed: string; last_seen: Date | null }>(
    `select a.username,
            (select count(*) from trades t
              where t.state = 'released' and (t.buyer_account_id = a.id or t.seller_account_id = a.id)) as completed,
            (select max(s.last_seen_at) from sessions s where s.account_id = a.id and s.revoked_at is null) as last_seen
       from accounts a where a.id = $1`,
    [accountId],
  );
  const r = rows[0];
  if (!r) throw new Error('trader missing');
  return {
    username: r.username,
    completedTrades: Number(r.completed),
    online: r.last_seen !== null && now.getTime() - r.last_seen.getTime() < ONLINE_MS,
    lastSeenAt: r.last_seen?.toISOString() ?? null,
    typicalMinutes: null,
    positivePct: null,
    badges: [],
  };
}

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
  securedAt: string | null;
  payBy: string | null;
  paidAt: string | null;
  confirmBy: string | null;
  finalAlertAt: string | null;
  /** When the buyer's first seen-receipt for the final alert landed (Task 19); null = not seen. Task 10 counts 15 min from it. */
  finalAlertSeenAt: string | null;
  settleBy: string | null;
  pausedAt: string | null;
  closedAt: string | null;
  nextDeadline: string | null;
  serverNow: string;
}

/** The extra facts a view needs that are not trade fields. */
export interface ViewContext {
  counterparty: TraderSummary;
  /** Task 3's method profile for `t.methodId` (null until Task 3 wires `getProfile`). */
  profile: unknown;
  sellerWalletApp: string | null;
  /** `trades.final_alert_seen_at` (not a machine field). */
  finalAlertSeenAt: Date | null;
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
    securedAt: iso(t.securedAt),
    payBy: iso(t.payBy),
    paidAt: iso(t.paidAt),
    confirmBy: iso(t.confirmBy),
    finalAlertAt: iso(t.finalAlertAt),
    finalAlertSeenAt: iso(ctx.finalAlertSeenAt),
    settleBy: iso(t.settleBy),
    pausedAt: iso(t.pausedAt),
    closedAt: iso(t.closedAt),
    nextDeadline: iso(nextDeadline(t)),
    serverNow: serverNow.toISOString(),
  };
  if (role === t.poster) view.fee = { atomic: t.feeAtomic.toString() };
  return view;
}
