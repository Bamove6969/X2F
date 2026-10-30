/**
 * Who gets what when a trade settles (spec 11.1, owner decision 2026-10-20).
 *
 * Every party derives the same list from the same trade facts and the escrow's
 * observed balance, taken only when balance == unlocked, so the payouts sweep
 * the whole escrow (Plan 1: no change output). Index 0 is always the party
 * receiving the trade's XMR and bears the network fee; the X2F fee output is
 * always exactly feeFor(amount).
 *
 * Extra XMR: a trade funded above its amount before "I've paid" grows, once releasable, to the
 * funded amount within the offer's limits (the state machine does that, so the
 * amount here is already the grown one). Whatever is left above
 * sellerFundsAtomic (dust, above the offer maximum, or after "I've paid") goes
 * back to the seller. Every refund or cancel pays everything to the seller,
 * which is also all the moderator service may ever sign (spec 3.3).
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

export function payoutsFor(f: PayoutFacts): Payout[] {
  const plan = escrowPlan({ amountAtomic: f.amountAtomic, poster: f.poster });
  if (f.feeAtomic !== plan.feeAtomic) throw new RangeError('fee does not match the amount');
  if (f.sellerFundsAtomic !== plan.sellerFundsAtomic) throw new RangeError('seller funds do not match the trade');
  if (f.balanceAtomic < 0n) throw new RangeError('balance must not be negative');
  const addresses = [f.buyerPayout, f.sellerRefund, f.feeWallet];
  for (const a of addresses) {
    if (typeof a !== 'string' || a === '') throw new RangeError('missing address');
  }
  if (new Set(addresses).size !== addresses.length) throw new RangeError('duplicate address');
  const balance = f.balanceAtomic;

  switch (f.kind) {
    case 'release': {
      if (balance < f.sellerFundsAtomic) throw new RangeError('underfunded');
      const surplus = balance - f.sellerFundsAtomic;
      const toBuyer = f.poster === 'seller' ? f.amountAtomic : f.amountAtomic - f.feeAtomic;
      return out([
        { address: f.buyerPayout, amountAtomic: toBuyer },
        { address: f.feeWallet, amountAtomic: f.feeAtomic },
        { address: f.sellerRefund, amountAtomic: surplus },
      ]);
    }
    case 'mutual-cancel':
    case 'buyer-cancel':
    case 'auto-refund':
    case 'lapse-refund':
      // Every refund: the whole balance, surplus included, to the seller's signed refund address.
      return out([{ address: f.sellerRefund, amountAtomic: balance }]);
    default:
      throw new RangeError('unknown settle kind');
  }
}
