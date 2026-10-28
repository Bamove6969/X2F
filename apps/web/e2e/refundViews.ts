// The SellerRefund board's trade as API views (Task 6's TradeView shape), for the unit tests and
// e2e/refund.spec.ts. The board: selling 1.25 XMR to mira.k via Zelle, trade K7M2-9QXA-4FTR-8WPN,
// on mira.k's buy ad (so the seller funded exactly 1.25 XMR and sees no fee), $412.50.
import type { TraderSummary, TradeView } from '../src/api/trade.js';

type RefundView = TradeView;

export const BOARD = {
  code: 'K7M2-9QXA-4FTR-8WPN',
  buyer: 'mira.k',
  seller: 'satoshi_ghost',
  method: 'Zelle',
} as const;

const MIN = 60_000;
/** The server's time in every board view: 5 minutes after the payment window ended. */
export const SERVER_NOW = '2026-10-25T13:45:00.000Z';
const iso = (offsetMin: number): string => new Date(Date.parse(SERVER_NOW) + offsetMin * MIN).toISOString();

const ZELLE_PROFILE = {
  id: 'ZELLE',
  name: BOARD.method,
  whatItIs: 'Zelle: a US bank-to-bank instant transfer built into most US banking apps.',
};

/** The other trader's card as the API sends it (public name only). */
const trader = (name: string): TraderSummary => ({ displayName: name, completedTrades: 0, online: true, lastSeenAt: null, typicalMinutes: null, positivePct: null, badges: [] });

/** The seller's view, `secured` with payBy 5 min ago and no extension used. */
export function sellerView(over: Partial<RefundView> = {}): RefundView {
  return {
    code: BOARD.code,
    role: 'seller',
    poster: 'buyer',
    state: 'secured',
    counterparty: trader(BOARD.buyer),
    methodId: 'ZELLE',
    profile: ZELLE_PROFILE,
    amountAtomic: '1250000000000',
    fiatCents: '41250',
    lockedRate: { currency: 'USD', centsPerXmr: '33000' },
    maxFiatCents: '50000',
    grown: null,
    receivedAtomic: '1250000000000',
    confirmations: 12,
    releasable: true,
    releasableEtaMin: null,
    funding: null,
    extensions: 0,
    cancelProposedBy: null,
    settling: null,
    dispute: null,
    txHash: null,
    takenAt: iso(-130),
    setupBy: iso(-115),
    fundBy: iso(-100),
    fundingSeenAt: iso(-120),
    securedAt: iso(-95),
    payBy: iso(-5),
    paidAt: null,
    confirmBy: null,
    finalAlertAt: null,
    finalAlertSeenAt: null,
    settleBy: null,
    pausedAt: null,
    closedAt: null,
    nextDeadline: iso(-5),
    serverNow: SERVER_NOW,
    ...over,
  };
}

/** The seller's view just after Cancel & get refund: the final alert started at server now. */
export function sellerRequestedView(over: Partial<RefundView> = {}): RefundView {
  return sellerView({ state: 'refund_requested', finalAlertAt: SERVER_NOW, nextDeadline: iso(15), ...over });
}

/** The buyer's view of the same trade during the final alert, which started at server now. */
export function buyerAlertView(over: Partial<RefundView> = {}): RefundView {
  return sellerView({
    role: 'buyer',
    counterparty: trader(BOARD.seller),
    state: 'refund_requested',
    finalAlertAt: SERVER_NOW,
    nextDeadline: iso(15),
    ...over,
  });
}
