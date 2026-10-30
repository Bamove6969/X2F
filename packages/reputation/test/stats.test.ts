import { describe, expect, it } from 'vitest';
import {
  CANCEL_RATE_MIN_TRADES,
  FEEDBACK_EVERY,
  NEGATIVE_MAX_STARS,
  PCT_MIN_REVIEWS,
  POSITIVE_MIN_STARS,
  REVIEW_WEIGHT_CAP_USD_CENTS,
  REVIEW_WEIGHT_FLOOR_USD_CENTS,
  TYPICAL_MIN_SAMPLES,
  TYPICAL_WINDOW,
  WEIGHT_MODE,
  actionMinutes,
  cancelRatePct,
  classify,
  isCompletedTrade,
  median,
  positivePct,
  ratedReviewCount,
  pushActionMinutes,
  reviewWeight,
  shouldAskFeedback,
  typicalMinutes,
} from '../src/index.js';

describe('classify (P5-A1)', () => {
  it('4-5 positive, 1-2 negative, 3 and Neutral neutral', () => {
    expect([POSITIVE_MIN_STARS, NEGATIVE_MAX_STARS]).toEqual([4, 2]);
    expect([1, 2, 3, 4, 5].map((stars) => classify({ neutral: false, stars }))).toEqual(['negative', 'negative', 'neutral', 'positive', 'positive']);
    expect(classify({ neutral: true, stars: null })).toBe('neutral');
  });
});

describe('reviewWeight (P5-A2)', () => {
  it('clamps the USD value between the floor and the cap', () => {
    expect(WEIGHT_MODE).toBe('linear');
    expect([REVIEW_WEIGHT_FLOOR_USD_CENTS, REVIEW_WEIGHT_CAP_USD_CENTS]).toEqual([1_000n, 100_000n]);
    expect(reviewWeight(500n)).toBe(1_000n);
    expect(reviewWeight(50_000n)).toBe(50_000n);
    expect(reviewWeight(10_000_000n)).toBe(100_000n);
  });
  it('a trade with no stored USD value weighs the floor (pre-migration trades)', () => {
    expect(reviewWeight(null)).toBe(1_000n);
  });
  it('steps mode (P5-A32 option a) gives 1, 2 or 3', () => {
    expect(reviewWeight(9_999n, 'steps')).toBe(1n);
    expect(reviewWeight(10_000n, 'steps')).toBe(2n);
    expect(reviewWeight(50_000n, 'steps')).toBe(2n);
    expect(reviewWeight(50_001n, 'steps')).toBe(3n);
    expect(reviewWeight(null, 'steps')).toBe(1n);
  });
});

describe('positivePct', () => {
  it('one positive $10 and one negative $1,000 is 0 (floor of 0.99%)', () => {
    expect(
      positivePct([
        { kind: 'positive', weight: 1_000n },
        { kind: 'negative', weight: 100_000n },
      ]),
    ).toBe(0);
  });
  it('is null with only 3-star and Neutral reviews, or none', () => {
    expect(positivePct([{ kind: 'neutral', weight: 5_000n }])).toBeNull();
    expect(positivePct([])).toBeNull();
  });
  it('rounds down to a whole percent', () => {
    const rs = [
      ...Array.from({ length: 2 }, () => ({ kind: 'positive' as const, weight: 1_000n })),
      { kind: 'negative' as const, weight: 1_000n },
    ];
    expect(positivePct(rs)).toBe(66);
    expect(positivePct([{ kind: 'positive', weight: 1n }])).toBe(100);
  });
  it('leaves out reviews under dispute or removed (Task 19), keeps stands and comments-removed', () => {
    const base = [{ kind: 'positive' as const, weight: 1_000n }];
    expect(positivePct([...base, { kind: 'negative', weight: 1_000n, dispute: 'open' }])).toBe(100);
    expect(positivePct([...base, { kind: 'negative', weight: 1_000n, dispute: 'removed' }])).toBe(100);
    expect(positivePct([...base, { kind: 'negative', weight: 1_000n, dispute: 'stands' }])).toBe(50);
    expect(positivePct([...base, { kind: 'negative', weight: 1_000n, dispute: 'comments-removed' }])).toBe(50);
    expect(positivePct([{ kind: 'positive', weight: 1_000n, dispute: 'open' }])).toBeNull();
  });
  it('honours a minimum review count when one is set (P5-A32 option b; default 0)', () => {
    expect(PCT_MIN_REVIEWS).toBe(0);
    const four = Array.from({ length: 4 }, () => ({ kind: 'positive' as const, weight: 1_000n }));
    expect(positivePct(four, { minReviews: 5 })).toBeNull();
    expect(positivePct([...four, { kind: 'negative', weight: 1_000n }], { minReviews: 5 })).toBe(80);
    expect(positivePct([...four, { kind: 'neutral', weight: 1_000n }], { minReviews: 5 })).toBeNull();
  });
  it('sums the stored weight as given (M1: only the weight is kept, never the USD amount)', () => {
    const rs = [
      { kind: 'positive' as const, weight: reviewWeight(1_000n, 'steps') },
      { kind: 'negative' as const, weight: reviewWeight(100_000n, 'steps') },
    ];
    expect(positivePct(rs)).toBe(25);
    expect(positivePct([{ kind: 'positive', weight: 1n }, { kind: 'negative', weight: 3n }])).toBe(25);
    expect(() => positivePct([{ kind: 'positive', weight: 0n }])).toThrow(RangeError);
  });
  it('takes no USD amount', () => {
    // @ts-expect-error usdCents is not part of WeightedReview any more
    const r: Parameters<typeof positivePct>[0][number] = { kind: 'positive', weight: 1_000n, usdCents: 1_000n };
    expect(r.kind).toBe('positive');
  });
});

describe('ratedReviewCount (review M4)', () => {
  it('counts positive and negative reviews that count in stats', () => {
    expect(
      ratedReviewCount([
        { kind: 'positive', weight: 1n },
        { kind: 'negative', weight: 1n },
        { kind: 'neutral', weight: 1n },
        { kind: 'negative', weight: 1n, dispute: 'open' },
        { kind: 'positive', weight: 1n, dispute: 'removed' },
        { kind: 'positive', weight: 1n, dispute: 'stands' },
      ]),
    ).toBe(3);
  });
});

describe('median and typicalMinutes (P5-A8)', () => {
  it('median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2);
    expect(median([])).toBeNull();
    expect(median([4, 1])).toBe(2);
  });
  it('does not reorder the caller array', () => {
    const xs = [3, 1, 2];
    median(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
  it('typicalMinutes needs 3 samples and uses the last 20', () => {
    expect([TYPICAL_WINDOW, TYPICAL_MIN_SAMPLES]).toEqual([20, 3]);
    expect(typicalMinutes([5, 7])).toBeNull();
    expect(typicalMinutes([5, 7, 9])).toBe(7);
    const old = Array.from({ length: 30 }, () => 100);
    const recent = Array.from({ length: 20 }, () => 4);
    expect(typicalMinutes([...old, ...recent])).toBe(4);
  });
});

describe('running action minutes (Task 20: last 20, no codes or dates)', () => {
  it('appends and keeps only the last 20', () => {
    let xs: number[] = [];
    for (let i = 1; i <= 25; i++) xs = pushActionMinutes(xs, i);
    expect(xs).toHaveLength(20);
    expect(xs[0]).toBe(6);
    expect(xs[19]).toBe(25);
  });
  it('does not change the input', () => {
    const xs = [1, 2];
    pushActionMinutes(xs, 3);
    expect(xs).toEqual([1, 2]);
  });
  it('actionMinutes floors at 0 and rounds down to whole minutes', () => {
    const t = new Date('2026-03-01T00:00:00Z');
    expect(actionMinutes(t, new Date(t.getTime() + 6 * 60_000 + 59_999))).toBe(6);
    expect(actionMinutes(t, new Date(t.getTime() - 60_000))).toBe(0);
  });
  it('pushActionMinutes refuses a negative or fractional value', () => {
    expect(() => pushActionMinutes([], -1)).toThrow();
    expect(() => pushActionMinutes([], 1.5)).toThrow();
  });
});

describe('cancelRatePct (P5-A9)', () => {
  it('is null below 5 trades that reached funding', () => {
    expect(CANCEL_RATE_MIN_TRADES).toBe(5);
    expect(cancelRatePct({ cancelledByMe: 1, reachedFunding: 4 })).toBeNull();
  });
  it('rounds down', () => {
    expect(cancelRatePct({ cancelledByMe: 1, reachedFunding: 50 })).toBe(2);
    expect(cancelRatePct({ cancelledByMe: 1, reachedFunding: 3 * 17 })).toBe(1);
    expect(cancelRatePct({ cancelledByMe: 0, reachedFunding: 5 })).toBe(0);
  });
  it('never exceeds 100', () => {
    expect(cancelRatePct({ cancelledByMe: 9, reachedFunding: 5 })).toBe(100);
  });
});

describe('isCompletedTrade (R38: a settled dispute counts whoever won)', () => {
  it('released counts, disputed or not', () => {
    expect(isCompletedTrade({ state: 'released', disputed: false })).toBe(true);
    expect(isCompletedTrade({ state: 'released', disputed: true })).toBe(true);
  });
  it('a refund counts only when it settled a dispute', () => {
    expect(isCompletedTrade({ state: 'refunded', disputed: true })).toBe(true);
    expect(isCompletedTrade({ state: 'refunded', disputed: false })).toBe(false);
  });
  it('cancels and open trades never count', () => {
    expect(isCompletedTrade({ state: 'cancelled', disputed: false })).toBe(false);
    expect(isCompletedTrade({ state: 'disputed', disputed: true })).toBe(false);
    expect(isCompletedTrade({ state: 'paid', disputed: false })).toBe(false);
  });
});

describe('shouldAskFeedback (P5-A19)', () => {
  it('after the first trade and every 10th', () => {
    expect(FEEDBACK_EVERY).toBe(10);
    expect([0, 1, 2, 10, 20, 21].map(shouldAskFeedback)).toEqual([false, true, false, true, true, false]);
  });
});
