/**
 * Who gets what when a trade settles (spec 11.1, owner decision 2026-10-20).
 *
 * Every party derives the same list from the same trade facts and the escrow's
 * observed balance, taken only when balance == unlocked, so the payouts sweep
 * the whole escrow (Plan 1: no change output). Index 0 is always the party
 * receiving the trade's XMR. Who pays the payout's network fee (owner, 16 Nov:
 * "paid by the person who is set to receive it ... We should also pay for our
 * fees"): the payout's network fee is shared by its receiving outputs, one
 * equal share per output. On a completed trade (release, dispute-buyer) the
 * buyer's output and the X2F fee output are marked `bearsNetworkFee` and each
 * pays its share as wallet2 splits it (@x2f/core `networkFeeShares`: any odd
 * atomic unit off the buyer's), so the fee output is feeFor(amount) before its
 * share of the network fee; a surplus returned to the seller pays none of it. A refund's one
 * output to the seller is unmarked and bears all of it, as before.
 *
 * Extra XMR: a trade funded above its amount before "I've paid" grows, once releasable, to the
 * funded amount within the offer's limits (the state machine does that, so the
 * amount here is already the grown one). Whatever is left above
 * sellerFundsAtomic (dust, above the offer maximum, or after "I've paid") goes
 * back to the seller. Every refund or cancel pays everything to the seller.
 * A moderator's ruling pays by the `dispute-buyer` / `dispute-seller` sets
 * (Plan 4 Task 15; owner g63, 7 Nov: the poster pays the 1% only when the trade completes).
 */
import { networkFeeShares } from '@x2f/core';
import { MAX_NETWORK_FEE, type Payout } from '@x2f/escrow';
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
   * Network fee (lead default at the 26 Nov merge of lien recovery with the network-fee split; owner to
   * confirm before liens are switched on): the creditor's output is NOT marked `bearsNetworkFee`, so it
   * receives the signed recovery exactly. The buyer's output (which keeps at least LIEN_BUYER_KEEPS_ATOMIC)
   * and the fee output share the network fee as on any completed trade, so `feeWalletNetworkFee` holds.
   */
  lienRecovery?: { address: string; amountAtomic: bigint };
}

function out(list: Payout[]): Payout[] {
  const kept = list.filter((p) => p.amountAtomic !== 0n);
  if (kept.length === 0) throw new RangeError('nothing-to-pay');
  return kept;
}

/**
 * Lien recovery limits (review B1, B3; provisional owner answers of 17 Nov 2026, docs/lien-recovery.md
 * "Provisional owner answers"). Each is one constant, so an owner answer changes one line.
 *
 * Q1: the largest share of the buyer's proceeds any recovery may take, in basis points, whatever
 * rate a lien carries: 90%. Every co-signer and the moderation gate refuse more from the signed terms
 * alone. A rate above the 50% default needs a senior moderator's key tap that the moderation service
 * itself verifies (apps/moderation lienRecovery.ts).
 */
export const LIEN_RECOVERY_MAX_BPS = 9000;
/** The owner's default rate (rule 3): 50% of the debtor's proceeds. */
export const LIEN_DEFAULT_RATE_BPS = 5000;
/** Q1 margin: what the buyer keeps above the largest network fee, 0.01 XMR. */
export const LIEN_BUYER_MARGIN_ATOMIC = 10_000_000_000n;
/**
 * Review B3 and Q1: what the buyer's output always keeps after a recovery: the largest network fee a
 * release may take from it (index 0 bears it, `MAX_NETWORK_FEE`) plus the margin, so the buyer keeps
 * at least 0.01 XMR net. wallet2 cannot subtract a fee from an output that is not larger than it.
 */
export const LIEN_BUYER_KEEPS_ATOMIC = MAX_NETWORK_FEE + LIEN_BUYER_MARGIN_ATOMIC;
/**
 * Q5: the smallest recovery a trade pays the creditor, 0.01 XMR. A smaller one (a small trade, or the
 * lien's last remainder) is not paid: the remainder carries forward to a trade that can pay it.
 */
export const LIEN_RECOVERY_MIN_ATOMIC = 10_000_000_000n;

const isRateBps = (bps: unknown): bps is number => typeof bps === 'number' && Number.isSafeInteger(bps) && bps >= 1 && bps <= LIEN_RECOVERY_MAX_BPS;

/**
 * The most one trade may recover from `proceedsAtomic` (the buyer's share of a release): 90%, rounded
 * down, reduced so the buyer keeps LIEN_BUYER_KEEPS_ATOMIC; 0 when nothing fits.
 */
export function lienRecoveryCap(proceedsAtomic: bigint): bigint {
  if (typeof proceedsAtomic !== 'bigint' || proceedsAtomic <= LIEN_BUYER_KEEPS_ATOMIC) return 0n;
  const byRate = (proceedsAtomic * BigInt(LIEN_RECOVERY_MAX_BPS)) / 10_000n;
  const keep = proceedsAtomic - LIEN_BUYER_KEEPS_ATOMIC;
  return byRate < keep ? byRate : keep;
}

/**
 * The exact recovery one trade pays (review B1: the API reserves it, the moderation service signs only
 * this figure, the buyer's quote shows it): `min(floor(proceeds × rate / 10000), left, cap)`, where
 * `left` is what is owed less what is already recovered or signed into other trades' terms, and the cap
 * is `lienRecoveryCap`; 0 when that is below LIEN_RECOVERY_MIN_ATOMIC (Q5: carried forward). Throws
 * RangeError on a rate outside 1..LIEN_RECOVERY_MAX_BPS or a negative figure.
 */
export function expectedRecovery(a: { proceedsAtomic: bigint; rateBps: number; leftAtomic: bigint }): bigint {
  if (typeof a.proceedsAtomic !== 'bigint' || a.proceedsAtomic < 0n) throw new RangeError('proceeds must not be negative');
  if (typeof a.leftAtomic !== 'bigint' || a.leftAtomic < 0n) throw new RangeError('remainder must not be negative');
  if (!isRateBps(a.rateBps)) throw new RangeError('bad rate');
  let r = (a.proceedsAtomic * BigInt(a.rateBps)) / 10_000n;
  if (a.leftAtomic < r) r = a.leftAtomic;
  const cap = lienRecoveryCap(a.proceedsAtomic);
  if (cap < r) r = cap;
  return r >= LIEN_RECOVERY_MIN_ATOMIC ? r : 0n;
}

/** What a completed trade (`release`, `dispute-buyer`) pays the buyer before any recovery, from the signed deal. */
export function buyerProceeds(deal: Pick<AttestedTerms['deal'], 'poster' | 'takeAmountAtomic'>): bigint {
  const take = BigInt(deal.takeAmountAtomic);
  return deal.poster === 'seller' ? take : take - escrowPlan({ amountAtomic: take, poster: deal.poster }).feeAtomic;
}

/**
 * A lien recovery checked against the buyer's proceeds: at least LIEN_RECOVERY_MIN_ATOMIC (Q5), at
 * most `lienRecoveryCap` (review B1, B3, Q1), to an address that is none of the trade's own (B2).
 * None: amount 0. Every co-signer and the gate build the set through here, so a forged set is refused.
 */
function recoveryOf(r: { address: string; amountAtomic: bigint } | undefined, proceeds: bigint, own: readonly string[]): Payout {
  if (r === undefined) return { address: '', amountAtomic: 0n };
  if (typeof r !== 'object' || r === null || typeof r.address !== 'string' || r.address === '' || own.includes(r.address)) {
    throw new RangeError('bad recovery address');
  }
  if (typeof r.amountAtomic !== 'bigint' || r.amountAtomic < LIEN_RECOVERY_MIN_ATOMIC || r.amountAtomic > lienRecoveryCap(proceeds)) throw new RangeError('bad recovery amount');
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
        { address: f.buyerPayout, amountAtomic: toBuyer - rec.amountAtomic, bearsNetworkFee: true },
        { address: f.feeWallet, amountAtomic: f.feeAtomic, bearsNetworkFee: true },
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
 * The buyer's and the fee wallet's minimums are marked `bearsNetworkFee` as in payoutsFor: the check
 * (PartyHandle.proveSweep) allows each to be short by exactly its wallet2 share of the tx's fee.
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
        { address: terms.buyerPayout, amountAtomic: toBuyer - rec.amountAtomic, bearsNetworkFee: true },
        { address: feeWallet, amountAtomic: plan.feeAtomic, bearsNetworkFee: true },
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

/**
 * Owner 16 Nov 2026: what X2F's fee output paid of a settlement's network fee `txFeeAtomic`, for
 * the books (the API's revenue ledger). The payout's network fee is shared by its receiving outputs,
 * one equal share per output: a completed trade (`release`, `dispute-buyer`) marks the buyer's
 * output (index 0) and the fee output (index 1) in payoutsFor, so the fee output pays its wallet2
 * share, floor(fee / 2) (the odd unit is the buyer's). Every other kind has no fee output: none.
 * For a set that has a fee output (a fee of zero has none; book nothing then).
 */
export function feeWalletNetworkFee(kind: SettleKind | RulingKind, txFeeAtomic: bigint): bigint {
  if (typeof txFeeAtomic !== 'bigint' || txFeeAtomic < 0n) throw new RangeError('network fee must not be negative');
  if (kind !== 'release' && kind !== 'dispute-buyer') return 0n;
  return networkFeeShares(txFeeAtomic, [true, true])[1]!;
}
