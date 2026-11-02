// The opt-in "$X+ in trades to date" line (owner 2026-11-01/02, via the lead; C12b; exact words Design's).
// The exact total never leaves the server: only this rounded-DOWN bucket, in whole US dollars.

/** Below this many dollars the line shows nothing; reaching it exactly is enough (owner 2026-11-02: "at least $10,000"). */
export const TRADED_MIN_USD = 10_000;
const SMALL_STEP_USD = 10_000; // $10,000 steps up to $90,000+
const LARGE_FROM_USD = 100_000; // then $100,000+
const LARGE_STEP_USD = 50_000; // then $50,000 steps

/**
 * The bucket of a total in US cents: the largest step the total has REACHED (owner 2026-11-02: at
 * least, so exactly $90,000.00 shows $90,000). `null` below $10,000; else the total rounded down to $10,000
 * steps below $100,000 and to $50,000 steps from $100,000 ($100,000, $150,000, $200,000, ...).
 */
export function tradedBucketUsd(usdCents: bigint): number | null {
  if (usdCents < 0n) throw new RangeError('a traded total is never negative');
  const usd = usdCents / 100n;
  if (usd < BigInt(TRADED_MIN_USD)) return null;
  const step = BigInt(usd < BigInt(LARGE_FROM_USD) ? SMALL_STEP_USD : LARGE_STEP_USD);
  return Number((usd / step) * step);
}

/** "$90,000+". */
export function tradedBucketLabel(usd: number): string {
  return `$${usd.toLocaleString('en-US')}+`;
}
