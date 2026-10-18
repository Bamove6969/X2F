/**
 * Who gets what when a trade settles (spec 11.1).
 *
 * Every party derives the same list from the same trade facts and the escrow's
 * observed balance, taken only when balance == unlocked, so the payouts sweep
 * the whole escrow (Plan 1: no change output). Index 0 is always the party
 * receiving the trade's XMR and bears the network fee; the X2F fee output is
 * always exactly feeFor(amount). Anything above sellerFundsAtomic (a surplus)
 * goes to the ad poster.
 */
import type { Payout } from '@x2f/escrow';
import { escrowPlan } from './money.js';

export type SettleKind = 'release' | 'mutual-cancel' | 'buyer-cancel' | 'auto-refund' | 'lapse-refund';

export const SETTLE_KINDS: readonly SettleKind[] = ['release', 'mutual-cancel', 'buyer-cancel', 'auto-refund', 'lapse-refund'];

export interface PayoutFacts {
  kind: SettleKind;
  amountAtomic: bigint;
  feeAtomic: bigint;
  poster: 'seller' | 'buyer';
  sellerFundsAtomic: bigint;
  /** The escrow's whole balance, read only while balance == unlocked. */
  balanceAtomic: bigint;
  buyerPayout: string;
  sellerRefund: string;
  feeWallet: string;
}

function out(list: Payout[]): Payout[] {
  const kept = list.filter((p) => p.amountAtomic !== 0n);
  if (kept.length === 0) throw new RangeError('nothing-to-pay');
  return kept;
}

/**
 * The moderator service may sign only a payment of the whole balance to the
 * seller's own signed refund address (spec 3.3), so every automatic refund is
 * one output to the seller.
 *
 * OPEN OWNER QUESTION (plan 3, Revision 2026-10-18): on a BUYER's ad a surplus
 * would otherwise belong to the buyer-poster. Default built here: the seller
 * receives the surplus too, so the moderator's guard stays "refund address
 * only". To flip it, change only this function (and widen buyerCancelDecision
 * and autoRefundDecision to allow a second output to the buyer).
 */
function automaticRefund(f: PayoutFacts): Payout[] {
  return out([{ address: f.sellerRefund, amountAtomic: f.balanceAtomic }]);
}

export function payoutsFor(f: PayoutFacts): Payout[] {
  const plan = escrowPlan({ amountAtomic: f.amountAtomic, poster: f.poster });
  if (f.feeAtomic !== plan.feeAtomic) throw new RangeError('fee does not match the amount');
  if (f.sellerFundsAtomic !== plan.sellerFundsAtomic) throw new RangeError('seller funds do not match the trade');
  if (f.balanceAtomic < 0n) throw new RangeError('balance must not be negative');
  for (const a of [f.buyerPayout, f.sellerRefund, f.feeWallet]) {
    if (typeof a !== 'string' || a === '') throw new RangeError('missing address');
  }
  const balance = f.balanceAtomic;
  const surplus = balance > f.sellerFundsAtomic ? balance - f.sellerFundsAtomic : 0n;

  switch (f.kind) {
    case 'release': {
      if (balance < f.sellerFundsAtomic) throw new RangeError('underfunded');
      if (f.poster === 'seller') {
        return out([
          { address: f.buyerPayout, amountAtomic: f.amountAtomic },
          { address: f.feeWallet, amountAtomic: f.feeAtomic },
          { address: f.sellerRefund, amountAtomic: surplus },
        ]);
      }
      return out([
        { address: f.buyerPayout, amountAtomic: f.amountAtomic - f.feeAtomic + surplus },
        { address: f.feeWallet, amountAtomic: f.feeAtomic },
      ]);
    }
    case 'mutual-cancel': {
      if (f.poster === 'seller') return out([{ address: f.sellerRefund, amountAtomic: balance }]);
      return out([
        { address: f.sellerRefund, amountAtomic: balance - surplus },
        { address: f.buyerPayout, amountAtomic: surplus },
      ]);
    }
    case 'buyer-cancel':
    case 'auto-refund':
    case 'lapse-refund':
      return automaticRefund(f);
    default:
      throw new RangeError('unknown settle kind');
  }
}
