/**
 * X2F platform fee calculation.
 *
 * All amounts are bigint atomic units (piconero).
 * 1 XMR = 1_000_000_000_000 piconero.
 */

/** X2F platform fee in basis points (1% = 100 bps). */
export const X2F_FEE_BPS = 100n;

/** Basis points per whole (10,000 bps = 100%). */
const BPS_DENOMINATOR = 10_000n;

/**
 * Compute the platform fee for a given amount.
 *
 * Uses bigint division, which floors toward zero for non-negative values.
 * Pure bigint arithmetic, so there is no precision loss above
 * Number.MAX_SAFE_INTEGER.
 *
 * @param amountAtomic - Trade amount in atomic units (must be >= 0).
 * @returns The fee in atomic units (floored).
 * @throws {RangeError} If amountAtomic is negative.
 */
export function feeFor(amountAtomic: bigint): bigint {
  if (amountAtomic < 0n) {
    throw new RangeError('amountAtomic must not be negative');
  }
  return (amountAtomic * X2F_FEE_BPS) / BPS_DENOMINATOR;
}
