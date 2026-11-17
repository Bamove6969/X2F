import { can, type StaffRole } from './roles.js';

/**
 * Lien recovery (owner rules 16 Nov 2026; docs/lien-recovery.md). Pure: the API reserves and
 * records recoveries (apps/api/src/disputes/recovery.ts); this file holds the arithmetic and who may
 * decide a rate change.
 *
 * 1. Partial recovery: a trade recovers what its proceeds allow; the rest carries forward.
 * 2. No double compensation: the creditor never receives more than the lien's amount.
 * 3. Option b: the debtor keeps trading and their proceeds are deducted at the lien's rate, 50%
 *    by default. A moderator may propose another rate with a reason; a senior moderator (or the
 *    owner) decides; until approved the current rate applies.
 */

/** The owner's default: 50% of the debtor's proceeds, in basis points. */
export const DEFAULT_RECOVERY_RATE_BPS = 5000;
/**
 * Q1 (provisional owner answer, 17 Nov 2026; docs/lien-recovery.md): the highest rate a request may
 * propose, 90%. The same number as `LIEN_RECOVERY_MAX_BPS` in @x2f/trade (a test pins them equal):
 * the signed terms, every device and the moderation gate cap a recovery at this share of the
 * proceeds, and any rate other than the default is applied only once the moderation service has
 * verified the approving senior's `lien-rate` key tap.
 */
export const MAX_RECOVERY_RATE_BPS = 9000;
/** The longest reason a rate change request may carry. */
export const RATE_REASON_MAX = 500;

const BPS = 10_000n;

const isRate = (bps: unknown): bps is number => typeof bps === 'number' && Number.isSafeInteger(bps) && bps >= 1 && bps <= 10_000;

/**
 * What one trade recovers: `rate` of the debtor's proceeds, rounded down, and never more than the
 * lien's free remainder (`freeAtomic`: owed − recovered − reserved by trades in progress).
 */
export function recoveryFor(a: { proceedsAtomic: bigint; rateBps: number; freeAtomic: bigint }): bigint {
  if (typeof a.proceedsAtomic !== 'bigint' || a.proceedsAtomic < 0n) throw new RangeError('proceeds must not be negative');
  if (typeof a.freeAtomic !== 'bigint' || a.freeAtomic < 0n) throw new RangeError('remainder must not be negative');
  if (!isRate(a.rateBps)) throw new RangeError('bad rate');
  const byRate = (a.proceedsAtomic * BigInt(a.rateBps)) / BPS;
  return byRate < a.freeAtomic ? byRate : a.freeAtomic;
}

/** What is still owed to the creditor: the amount less every recovery. Throws when they add up to more (rule 2). */
export function lienRemaining(amountAtomic: bigint, recoveries: readonly bigint[]): bigint {
  if (typeof amountAtomic !== 'bigint' || amountAtomic <= 0n) throw new RangeError('amount must be positive');
  let left = amountAtomic;
  for (const r of recoveries) {
    if (typeof r !== 'bigint' || r <= 0n) throw new RangeError('a recovery must be positive');
    left -= r;
  }
  if (left < 0n) throw new RangeError('recovered more than owed');
  return left;
}

export type RateRequestRefusal = 'bad-rate' | 'reason-required' | 'reason-too-long';

/**
 * Why a moderator's proposed rate is refused, or null. Any change needs a reason (owner: "if they
 * change it at all then the system will force them to enter a reason").
 */
export function rateRequestRefusal(r: { rateBps: unknown; reason: unknown }): RateRequestRefusal | null {
  if (!isRate(r.rateBps) || r.rateBps > MAX_RECOVERY_RATE_BPS) return 'bad-rate';
  if (typeof r.reason !== 'string' || r.reason.trim() === '') return 'reason-required';
  if (r.reason.length > RATE_REASON_MAX) return 'reason-too-long';
  return null;
}

/** A senior moderator or the owner holding `rulings.approve` decides, never the one who proposed it. */
export function canDecideRateRequest(decider: { role: StaffRole; id: string }, proposerId: string): boolean {
  return (decider.role === 'senior' || decider.role === 'owner') && can(decider.role, 'rulings.approve') && decider.id !== proposerId;
}
