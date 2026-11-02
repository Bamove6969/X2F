// The opt-in "Completed over $X in trades to date" line (owner 2026-11-01/02, via the lead; C12b).
// The exact total never leaves the server: only this rounded-DOWN bucket, in whole US dollars,
// always strictly below the total.

/** The lowest step: a total of this many dollars or less shows nothing (the lead's reading; an open question). */
export const TRADED_MIN_USD = 10_000;
const SMALL_STEP_USD = 10_000; // $10,000 steps up to $90,000+
const LARGE_FROM_USD = 100_000; // then $100,000+
const LARGE_STEP_USD = 50_000; // then $50,000 steps

/**
 * The bucket of a total in US cents: the largest step STRICTLY below the total, so the line's
 * "Completed over $X" is true even at a step (review M1: exactly $90,000.00 shows $80,000, and
 * $90,000.01 shows $90,000). Steps: $10,000 to $90,000, then $100,000, $150,000, $200,000, ...
 * `null` while no step is below the total (up to and including exactly $10,000).
 */
export function tradedBucketUsd(usdCents: bigint): number | null {
  if (usdCents < 0n) throw new RangeError('a traded total is never negative');
  if (usdCents === 0n) return null;
  // Whole dollars of (total - 1 cent): a step S (whole dollars) is below the total exactly when
  // S * 100 <= total - 1, i.e. S <= this.
  const usd = (usdCents - 1n) / 100n;
  if (usd < BigInt(TRADED_MIN_USD)) return null;
  const step = BigInt(usd < BigInt(LARGE_FROM_USD) ? SMALL_STEP_USD : LARGE_STEP_USD);
  return Number((usd / step) * step);
}

/** "$90,000+". */
export function tradedBucketLabel(usd: number): string {
  return `$${usd.toLocaleString('en-US')}+`;
}
