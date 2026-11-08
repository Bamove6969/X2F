// The traded-to-date buckets (owner 2026-11-01/02, via the lead; C12b). Owner Q63 (6 Nov): the public
// line is the XMR one below ("X+ XMR traded to date"); the dollar bucket is no longer public (the
// dollar total is for moderators). The exact total never leaves the server: only a rounded-DOWN bucket.

/**
 * The lowest step: a total of this many dollars or less shows nothing; MORE than it shows "$10,000+"
 * (owner 2026-11-03: "To earn a plus you have to have MORE than the number").
 */
export const TRADED_MIN_USD = 10_000;
const SMALL_STEP_USD = 10_000; // $10,000 steps up to $90,000+
const LARGE_FROM_USD = 100_000; // then $100,000+
const LARGE_STEP_USD = 50_000; // then $50,000 steps

/**
 * The bucket of a total in US cents: the largest step S with total STRICTLY more than S (owner
 * 2026-11-03: "$30,001 earns $30,000+"; exactly $30,000.00 shows $20,000+, $30,000.01 shows $30,000+;
 * review M1's rule, 99a9863e, restored). Steps: $10,000 to $90,000 by $10,000, then $100,000, then
 * $50,000 steps ($150,000, $200,000, ...). `null` up to and including exactly $10,000.
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

// Owner Q63 (6 Nov 2026): the offer card shows the amount TRADED IN XMR to date, not dollars. The
// same rules as the dollar line: opt-in, rounded DOWN, a plus needs MORE than the step. The steps
// mirror the dollar ladder (OWNER-Q: the lead's default, not the owner's numbers): more than 10 XMR
// to show anything, 10 XMR steps to 90, then 100, then 50 XMR steps. Exact words: Design's.

/** Atomic units per XMR. */
const PICO = 1_000_000_000_000n;
/** The lowest XMR step: this many XMR or less shows nothing. */
export const TRADED_MIN_XMR = 10;
const SMALL_STEP_XMR = 10n;
const LARGE_FROM_XMR = 100n;
const LARGE_STEP_XMR = 50n;

/** The bucket of an XMR total in atomic units, in whole XMR: the largest step strictly below it; null up to 10 XMR. */
export function tradedBucketXmr(atomic: bigint): number | null {
  if (atomic < 0n) throw new RangeError('a traded total is never negative');
  if (atomic === 0n) return null;
  const xmr = (atomic - 1n) / PICO;
  if (xmr < BigInt(TRADED_MIN_XMR)) return null;
  const step = xmr < LARGE_FROM_XMR ? SMALL_STEP_XMR : LARGE_STEP_XMR;
  return Number((xmr / step) * step);
}

/** "90+ XMR". */
export function tradedBucketXmrLabel(xmr: number): string {
  return `${xmr.toLocaleString('en-US')}+ XMR`;
}
