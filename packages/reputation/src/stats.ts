// Stats maths (Plan 5 Task 1). Money stays bigint; percentages are whole numbers rounded down.
// Built for Task 20's running totals: every input here is something an account can keep after its
// trades are purged (review kind and its precomputed weight, counts, the last 20 action durations).
// A review keeps only its weight (`reviewWeight` at review time), never the trade's USD amount
// (review M1, lead 2026-10-30): a permanent, anonymous review must not carry an amount.
import { countsInStats, type ReviewDisputeStatus } from './reviews.js';

// ---- Classification (P5-A1) ----

export const POSITIVE_MIN_STARS = 4;
export const NEGATIVE_MAX_STARS = 2;

export type ReviewKind = 'positive' | 'negative' | 'neutral';

/** 4-5 stars positive, 1-2 negative; 3 stars and Neutral are neutral (they count toward reviewCount only). */
export function classify(r: { neutral: boolean; stars: number | null }): ReviewKind {
  if (r.neutral || r.stars === null) return 'neutral';
  if (r.stars >= POSITIVE_MIN_STARS) return 'positive';
  if (r.stars <= NEGATIVE_MAX_STARS) return 'negative';
  return 'neutral';
}

// ---- Weights (P5-A2, P5-A32) ----

export const REVIEW_WEIGHT_FLOOR_USD_CENTS = 1_000n;
export const REVIEW_WEIGHT_CAP_USD_CENTS = 100_000n;

/**
 * P5-A32 (OPEN, owner has not picked): `'linear'` is the draft (weight = USD value, clamped);
 * `'steps'` is option (a): 1x under $100, 2x to $500, 3x above.
 */
export type WeightMode = 'linear' | 'steps';
export const WEIGHT_MODE: WeightMode = 'linear';
/** P5-A32 option (b): % positive only from this many positive-or-negative reviews. 0 = the draft (off). */
export const PCT_MIN_REVIEWS = 0;

const STEP_2_FROM_USD_CENTS = 10_000n; // $100
const STEP_3_ABOVE_USD_CENTS = 50_000n; // $500

/**
 * The weight of one review from its trade's take-time USD value, computed once when the review is
 * stored; only the result is kept. `null` (a trade taken before the value was stored) weighs the
 * floor. Never converts at today's rate.
 */
export function reviewWeight(usdCents: bigint | null, mode: WeightMode = WEIGHT_MODE): bigint {
  const v = usdCents ?? REVIEW_WEIGHT_FLOOR_USD_CENTS;
  if (mode === 'steps') {
    if (v < STEP_2_FROM_USD_CENTS) return 1n;
    return v <= STEP_3_ABOVE_USD_CENTS ? 2n : 3n;
  }
  if (v < REVIEW_WEIGHT_FLOOR_USD_CENTS) return REVIEW_WEIGHT_FLOOR_USD_CENTS;
  return v > REVIEW_WEIGHT_CAP_USD_CENTS ? REVIEW_WEIGHT_CAP_USD_CENTS : v;
}

export interface WeightedReview {
  kind: ReviewKind;
  /** The stored weight from `reviewWeight` (never the USD amount). */
  weight: bigint;
  /** Task 19: an open or removed dispute takes the review out of the numbers. */
  dispute?: ReviewDisputeStatus | null;
}

/**
 * % positive = sum(weight of positive) / sum(weight of positive + negative), rounded down.
 * `null` when no positive or negative review counts (or fewer than `minReviews` of them).
 * Callers pass only revealed reviews (blind reveal, spec 5.3).
 */
export function positivePct(rs: readonly WeightedReview[], opts: { minReviews?: number } = {}): number | null {
  const minReviews = opts.minReviews ?? PCT_MIN_REVIEWS;
  let pos = 0n;
  let total = 0n;
  let n = 0;
  for (const r of rs) {
    if (r.kind === 'neutral' || !countsInStats(r.dispute ?? null)) continue;
    const w = r.weight;
    if (w < 1n) throw new RangeError('a review weight is at least 1');
    total += w;
    if (r.kind === 'positive') pos += w;
    n++;
  }
  if (n === 0 || n < minReviews) return null;
  return Number((pos * 100n) / total);
}

/** Positive and negative reviews that count in stats (Trusted's minimum, review M4). */
export function ratedReviewCount(rs: readonly WeightedReview[]): number {
  return rs.filter((r) => r.kind !== 'neutral' && countsInStats(r.dispute ?? null)).length;
}

// ---- Typical time (P5-A8) ----

export const TYPICAL_WINDOW = 20;
export const TYPICAL_MIN_SAMPLES = 3;

/** Median of whole numbers; with an even count, the floor of the mean of the two middle values. */
export function median(xs: readonly number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  if (s.length % 2 === 1) return s[mid]!;
  return Math.floor((s[mid - 1]! + s[mid]!) / 2);
}

/** Median of the last 20 samples (oldest first), `null` below 3. */
export function typicalMinutes(samples: readonly number[]): number | null {
  const recent = samples.slice(-TYPICAL_WINDOW);
  return recent.length < TYPICAL_MIN_SAMPLES ? null : median(recent);
}

/** Whole minutes from `from` to `to`, rounded down, never below 0 (a buyer who paid before secured). */
export function actionMinutes(from: Date, to: Date): number {
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / 60_000));
}

/**
 * Task 20's running list: appends one action duration and keeps the last 20 (no trade codes, no dates;
 * lead decision 2026-10-29). Returns a new array.
 */
export function pushActionMinutes(recent: readonly number[], minutes: number): number[] {
  if (!Number.isInteger(minutes) || minutes < 0) throw new RangeError('action minutes must be a whole number >= 0');
  return [...recent, minutes].slice(-TYPICAL_WINDOW);
}

// ---- Cancel rate (P5-A9) ----

export const CANCEL_RATE_MIN_TRADES = 5;

/** Trades this trader ended alone or by a mutual cancel they proposed, over trades that reached funding. */
export function cancelRatePct(a: { cancelledByMe: number; reachedFunding: number }): number | null {
  if (a.reachedFunding < CANCEL_RATE_MIN_TRADES) return null;
  return Math.min(100, Math.floor((a.cancelledByMe * 100) / a.reachedFunding));
}

// ---- Completed trades (R38, P5-A13 as revised 2026-10-29) ----

/**
 * A completed trade: released, or refunded to settle a dispute. A settled dispute counts whoever won
 * (R38); a refund with no dispute and every cancel do not. Same rule as Plan 3's
 * `COMPLETED_TRADES_SQL` (apps/api/src/traders/stage.ts).
 */
export function isCompletedTrade(t: { state: string; disputed: boolean }): boolean {
  return t.state === 'released' || (t.state === 'refunded' && t.disputed);
}

// ---- Platform feedback (P5-A19) ----

export const FEEDBACK_EVERY = 10;

/** Ask "How's X2F doing?" after the 1st completed trade and every 10th. */
export function shouldAskFeedback(completedTrades: number): boolean {
  return completedTrades === 1 || (completedTrades > 0 && completedTrades % FEEDBACK_EVERY === 0);
}
