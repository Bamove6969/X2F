/**
 * cosignPolicy: the only gate in front of every `settle` call the trader's app makes.
 *
 * An outcome is allowed only when its payouts are exactly (same order, same amounts, same
 * addresses) what `payoutsFor` gives for one of the shapes this side may settle, over the
 * escrow balance this device read itself (`funds()`, only while balance == unlocked) and the
 * addresses each side signed in its `trade.terms`. Every surplus goes to the seller (Revision
 * 2026-10-20), so a list paying a surplus to anyone else never matches.
 *
 * Buyer: co-signs a seller-built release (index 0 = its own payout address) or a seller-built
 * lapse refund (only on a lapsed, underfunded escrow, where the buyer was never asked to pay);
 * builds its own buyer-cancel (mod co-signs) and mutual cancel (seller co-signs).
 * Seller: builds the release, the lapse refund and the no-show refund (mod co-signs, only in
 * refund_requested); co-signs a buyer-built mutual cancel; never touches a buyer-cancel.
 * Mod-built (Plan 4 rulings, only while disputed): co-signed only when it pays this side its
 * whole side of the trade at its own address (release for the buyer, full refund for the
 * seller), so no split can move this side's share to the counterparty.
 */
import type { Outcome, Payout } from '@x2f/escrow';
import { escrowPlan, payoutsFor, type SettleKind, type TradeState } from '@x2f/trade';

/** The trade facts the policy needs. Fee and seller funds are derived here, never read from the API. */
export interface PolicyTrade {
  state: TradeState;
  poster: 'seller' | 'buyer';
  amountAtomic: bigint;
  /** X2F's fee wallet, from the app's build config (VITE_FEE_WALLET), never from the API. */
  feeWallet: string;
}

export interface PolicyContext {
  role: 'buyer' | 'seller';
  /** This device's own address: the buyer's payout, the seller's refund. */
  own: { payout?: string; refund?: string };
  /** From this device's own funds(), only when balance == unlocked. */
  balance: bigint;
  trade: PolicyTrade;
  /** The addresses each side signed in its trade.terms signal. */
  signedTerms: { payout: string; refund: string };
}

type Party = Outcome['builder'];

/** Who builds and who co-signs each kind (spec 2.3, 3.1, 3.3). */
const ROUTE: Record<SettleKind, { builder: Party; cosigner: Party }> = {
  release: { builder: 'seller', cosigner: 'buyer' },
  'lapse-refund': { builder: 'seller', cosigner: 'buyer' },
  'auto-refund': { builder: 'seller', cosigner: 'mod' },
  'buyer-cancel': { builder: 'buyer', cosigner: 'mod' },
  'mutual-cancel': { builder: 'buyer', cosigner: 'seller' },
};

/** Open states in which the buyer may cancel alone after funding (Task 2). */
const BUYER_CANCEL_STATES: readonly TradeState[] = ['funding', 'securing', 'secured', 'paid', 'refund_requested', 'settling'];
const RELEASE_STATES: readonly TradeState[] = ['secured', 'paid', 'settling'];

function samePayouts(a: readonly Payout[], b: readonly Payout[]): boolean {
  return (
    Array.isArray(a) &&
    a.length === b.length &&
    a.every((p, i) => {
      const q = b[i]!;
      return typeof p === 'object' && p !== null && p.address === q.address && typeof p.amountAtomic === 'bigint' && p.amountAtomic === q.amountAtomic;
    })
  );
}

function expected(kind: SettleKind, c: PolicyContext): Payout[] {
  const plan = escrowPlan({ amountAtomic: c.trade.amountAtomic, poster: c.trade.poster });
  return payoutsFor({
    kind,
    amountAtomic: c.trade.amountAtomic,
    feeAtomic: plan.feeAtomic,
    poster: c.trade.poster,
    sellerFundsAtomic: plan.sellerFundsAtomic,
    balanceAtomic: c.balance,
    buyerPayout: c.signedTerms.payout,
    sellerRefund: c.signedTerms.refund,
    feeWallet: c.trade.feeWallet,
  });
}

function check(c: PolicyContext, o: Outcome): boolean {
  if (o.kind !== 'release' || (c.role !== 'buyer' && c.role !== 'seller')) return false;
  if (typeof c.balance !== 'bigint' || c.balance <= 0n) return false;
  if (o.builder === o.cosigner || (o.builder !== c.role && o.cosigner !== c.role)) return false;
  const mine = c.role === 'buyer' ? c.own.payout : c.own.refund;
  const signedMine = c.role === 'buyer' ? c.signedTerms.payout : c.signedTerms.refund;
  if (typeof mine !== 'string' || mine === '' || mine !== signedMine) return false;

  const state = c.trade.state;
  const { sellerFundsAtomic } = escrowPlan({ amountAtomic: c.trade.amountAtomic, poster: c.trade.poster });
  const is = (kind: SettleKind, builder: Party, cosigner: Party): boolean => {
    if (o.builder !== builder || o.cosigner !== cosigner) return false;
    let want: Payout[];
    try {
      want = expected(kind, c);
    } catch {
      return false; // underfunded release, bad facts: nothing to settle
    }
    return samePayouts(o.to, want);
  };
  const route = (kind: SettleKind): boolean => is(kind, ROUTE[kind].builder, ROUTE[kind].cosigner);

  if (c.role === 'buyer') {
    if (route('release')) return true;
    if (route('lapse-refund')) return state === 'lapsed' && c.balance < sellerFundsAtomic;
    if (route('buyer-cancel')) return BUYER_CANCEL_STATES.includes(state);
    if (route('mutual-cancel')) return true;
    return state === 'disputed' && is('release', 'mod', 'buyer');
  }
  if (route('release')) return RELEASE_STATES.includes(state);
  if (route('lapse-refund')) return state === 'lapsed';
  if (route('auto-refund')) return state === 'refund_requested';
  if (route('mutual-cancel')) return true;
  return state === 'disputed' && is('mutual-cancel', 'mod', 'seller');
}

/** True only for an outcome this side may settle (see the module comment). Never throws. */
export function cosignPolicy(ctx: PolicyContext, outcome: Outcome): boolean {
  try {
    return check(ctx, outcome);
  } catch {
    return false;
  }
}

/** The outcome for `kind` from this side's facts, or null when cosignPolicy would refuse it. */
export function outcomeFor(kind: SettleKind, ctx: PolicyContext): Outcome | null {
  let to: Payout[];
  try {
    to = expected(kind, ctx);
  } catch {
    return null;
  }
  const o: Outcome = { kind: 'release', to, ...ROUTE[kind] };
  return cosignPolicy(ctx, o) ? o : null;
}
