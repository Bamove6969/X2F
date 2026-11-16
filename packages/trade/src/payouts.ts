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
 * back to the seller. Every refund or cancel pays everything to the seller.
 * A moderator's ruling pays by the `dispute-buyer` / `dispute-seller` sets
 * (Plan 4 Task 15; owner g63, 7 Nov: the poster pays the 1% only when the trade completes).
 */
import type { Payout } from '@x2f/escrow';
import type { AttestedTerms } from './attestation.js';
import { escrowPlan } from './money.js';

export type SettleKind = 'release' | 'mutual-cancel' | 'buyer-cancel' | 'auto-refund' | 'lapse-refund';

export const SETTLE_KINDS: readonly SettleKind[] = ['release', 'mutual-cancel', 'buyer-cancel', 'auto-refund', 'lapse-refund'];

/**
 * A moderator-built set for a published ruling (Plan 4 Tasks 13-15; owner g63, 7 Nov, replacing
 * Revision 2026-10-29c's "a settled dispute pays the 1%"):
 * - 'dispute-buyer': the ruling moves the trade forward, so it completes and the poster pays the
 *   1%: the release (buyer first, then the exact fee, any surplus to the seller);
 * - 'dispute-seller': a full reversal (all funds back to the original parties), so no fee: the
 *   whole balance to the seller, whoever posted (the site pays the moderator itself).
 * Which outcomes charge the fee, including appeals and liens, is `rulingFee` in @x2f/staff.
 * Kept apart from SettleKind: no trader route settles these, only the moderator builds them.
 */
export type RulingKind = 'dispute-buyer' | 'dispute-seller';

/** Plan 4 Task 14 (R-M2): the kinds a ruling's own payout is reported and recorded as. */
export const RULING_KINDS: readonly RulingKind[] = ['dispute-buyer', 'dispute-seller'];
export const isRulingKind = (k: unknown): k is RulingKind => k === 'dispute-buyer' || k === 'dispute-seller';

export interface PayoutFacts {
  kind: SettleKind | RulingKind;
  amountAtomic: bigint;
  feeAtomic: bigint;
  poster: 'seller' | 'buyer';
  sellerFundsAtomic: bigint;
  /** The escrow's whole balance, read only while balance == unlocked. */
  balanceAtomic: bigint;
  buyerPayout: string;
  sellerRefund: string;
  feeWallet: string;
  /**
   * Lien recovery from the attested terms (`AttestedTerms.lienRecovery`; docs/lien-recovery.md):
   * paid to the creditor out of the buyer's proceeds on a completed trade only. Absent: none.
   * Network fee (owner 16 Nov, `wip/third-netfee-split`): if each receiving output pays an equal
   * share, the creditor's output is a receiving output and pays one share too.
   */
  lienRecovery?: { address: string; amountAtomic: bigint };
}

function out(list: Payout[]): Payout[] {
  const kept = list.filter((p) => p.amountAtomic !== 0n);
  if (kept.length === 0) throw new RangeError('nothing-to-pay');
  return kept;
}

/**
 * A lien recovery checked against the buyer's proceeds: positive, below the proceeds (the buyer
 * always keeps something), to an address that is none of the trade's own. None: amount 0.
 */
function recoveryOf(r: { address: string; amountAtomic: bigint } | undefined, proceeds: bigint, own: readonly string[]): Payout {
  if (r === undefined) return { address: '', amountAtomic: 0n };
  if (typeof r !== 'object' || r === null || typeof r.address !== 'string' || r.address === '' || own.includes(r.address)) {
    throw new RangeError('bad recovery address');
  }
  if (typeof r.amountAtomic !== 'bigint' || r.amountAtomic <= 0n || r.amountAtomic >= proceeds) throw new RangeError('bad recovery amount');
  return { address: r.address, amountAtomic: r.amountAtomic };
}

/** The attested recovery as `payoutsFor` takes it (bigint), or undefined. */
export function attestedRecovery(terms: Pick<AttestedTerms, 'lienRecovery'>): { address: string; amountAtomic: bigint } | undefined {
  const r = terms.lienRecovery;
  return r === undefined ? undefined : { address: r.address, amountAtomic: BigInt(r.amountAtomic) };
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
    case 'release':
    case 'dispute-buyer': {
      if (balance < f.sellerFundsAtomic) throw new RangeError('underfunded');
      const surplus = balance - f.sellerFundsAtomic;
      const toBuyer = f.poster === 'seller' ? f.amountAtomic : f.amountAtomic - f.feeAtomic;
      const rec = recoveryOf(f.lienRecovery, toBuyer, addresses);
      return out([
        { address: f.buyerPayout, amountAtomic: toBuyer - rec.amountAtomic },
        { address: f.feeWallet, amountAtomic: f.feeAtomic },
        ...(rec.amountAtomic > 0n ? [rec] : []),
        { address: f.sellerRefund, amountAtomic: surplus },
      ]);
    }
    case 'mutual-cancel':
    case 'buyer-cancel':
    case 'auto-refund':
    case 'lapse-refund':
    case 'dispute-seller':
      // Every refund, and a ruling's full reversal (owner g63: no fee): the whole balance, surplus
      // included, to the seller's signed refund address.
      return out([{ address: f.sellerRefund, amountAtomic: balance }]);
    default:
      throw new RangeError('unknown settle kind');
  }
}

/**
 * Review I1 (2026-10-29): the least a sweep must provably pay (by its tx key) before the moderator's
 * watcher counts a sweep that its wallet shows only through a party's imported multisig info, i.e. a
 * seller–buyer settlement it did not co-sign. A trade party could otherwise forge partial key images
 * so that the mod's wallet attributes some unrelated tx to the escrow. With this check such a "fake"
 * sweep is harmless: the tx really paid the right parties at least what they are owed.
 *
 * From the moderator's OWN signed terms only (addresses and the take-time deal), never an API read,
 * plus the sweep's spent amount as the mod's wallet records it:
 * - `release`: the buyer's signed payout gets at least the take-time buyer amount (amount on a
 *   seller's ad, amount − fee on a buyer's ad) and the fee wallet at least the take-time fee. A grown
 *   trade (payoutsFor) only pays more, so an honest release always passes; the seller's surplus is
 *   not checked (only the seller could lose it, and only by forging against itself).
 * - `lapse-refund`, `mutual-cancel` (the seller–buyer refunds): the seller's signed refund address gets
 *   everything the sweep spent.
 * - `auto-refund`, `buyer-cancel`: the moderator co-signs these, so its own wallet shows them; null
 *   (an import never shows one).
 * Payout 0 bears the network fee: the check allows it to be short by exactly the tx's fee.
 */
export function sweepMinimums(a: { kind: SettleKind; terms: AttestedTerms; feeWallet: string; sweptAtomic: bigint }): Payout[] | null {
  const { terms, feeWallet } = a;
  const addresses = [terms.buyerPayout, terms.sellerRefund, feeWallet];
  for (const x of addresses) if (typeof x !== 'string' || x === '') throw new RangeError('missing address');
  if (new Set(addresses).size !== addresses.length) throw new RangeError('duplicate address');
  switch (a.kind) {
    case 'release': {
      const take = BigInt(terms.deal.takeAmountAtomic);
      const plan = escrowPlan({ amountAtomic: take, poster: terms.deal.poster });
      const toBuyer = terms.deal.poster === 'seller' ? take : take - plan.feeAtomic;
      const rec = recoveryOf(attestedRecovery(terms), toBuyer, addresses);
      return out([
        { address: terms.buyerPayout, amountAtomic: toBuyer - rec.amountAtomic },
        { address: feeWallet, amountAtomic: plan.feeAtomic },
        ...(rec.amountAtomic > 0n ? [rec] : []),
      ]);
    }
    case 'lapse-refund':
    case 'mutual-cancel':
      if (typeof a.sweptAtomic !== 'bigint' || a.sweptAtomic <= 0n) throw new RangeError('nothing-to-pay');
      return [{ address: terms.sellerRefund, amountAtomic: a.sweptAtomic }];
    case 'auto-refund':
    case 'buyer-cancel':
      return null;
    default:
      throw new RangeError('unknown settle kind');
  }
}
