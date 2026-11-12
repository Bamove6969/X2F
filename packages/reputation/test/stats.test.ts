import { describe, expect, it } from 'vitest';
import {
  FEEDBACK_EVERY,
  NEGATIVE_MAX_STARS,
  PCT_MIN_REVIEWS,
  POSITIVE_MIN_STARS,
  TYPICAL_MIN_SAMPLES,
  TYPICAL_WINDOW,
  actionMinutes,
  bothRolesTypical,
  classify,
  isCompletedTrade,
  median,
  positivePct,
  ratedReviewCount,
  pushActionMinutes,
  shouldAskFeedback,
  typicalMinutes,
  type ReviewForStats,
} from '../src/index.js';
import * as rep from '../src/index.js';

describe('classify (P5-A1)', () => {
  it('4-5 positive, 1-2 negative, 3 and Neutral neutral', () => {
    expect([POSITIVE_MIN_STARS, NEGATIVE_MAX_STARS]).toEqual([4, 2]);
    expect([1, 2, 3, 4, 5].map((stars) => classify({ neutral: false, stars }))).toEqual(['negative', 'negative', 'neutral', 'positive', 'positive']);
    expect(classify({ neutral: true, stars: null })).toBe('neutral');
  });
});

describe('no review weighting (owner 2026-11-01, item 26)', () => {
  it('@x2f/reputation has no weight function, weight mode or weight bounds any more', () => {
    for (const name of ['reviewWeight', 'WEIGHT_MODE', 'REVIEW_WEIGHT_FLOOR_USD_CENTS', 'REVIEW_WEIGHT_CAP_USD_CENTS']) {
      expect(Object.keys(rep), name).not.toContain(name);
    }
  });
});

describe('positivePct (every rated review counts once, owner 2026-11-01)', () => {
  it('one positive and one negative is 50', () => {
    expect(positivePct([{ kind: 'positive' }, { kind: 'negative' }])).toBe(50);
  });
  it('is null with only 3-star and Neutral reviews, or none', () => {
    expect(positivePct([{ kind: 'neutral' }])).toBeNull();
    expect(positivePct([])).toBeNull();
  });
  it('rounds down to a whole percent', () => {
    expect(positivePct([{ kind: 'positive' }, { kind: 'positive' }, { kind: 'negative' }])).toBe(66);
    expect(positivePct([{ kind: 'positive' }])).toBe(100);
    expect(positivePct([{ kind: 'negative' }])).toBe(0);
  });
  it('neutral reviews do not move it', () => {
    expect(positivePct([{ kind: 'positive' }, { kind: 'negative' }, { kind: 'neutral' }, { kind: 'neutral' }])).toBe(50);
  });
  it('leaves out reviews under dispute or removed (Task 19), keeps stands and comments-removed', () => {
    const base = [{ kind: 'positive' as const }];
    expect(positivePct([...base, { kind: 'negative', dispute: 'open' }])).toBe(100);
    expect(positivePct([...base, { kind: 'negative', dispute: 'removed' }])).toBe(100);
    expect(positivePct([...base, { kind: 'negative', dispute: 'stands' }])).toBe(50);
    expect(positivePct([...base, { kind: 'negative', dispute: 'comments-removed' }])).toBe(50);
    expect(positivePct([{ kind: 'positive', dispute: 'open' }])).toBeNull();
  });
  it('honours a minimum review count when one is set (P5-A32 option b; default 0)', () => {
    expect(PCT_MIN_REVIEWS).toBe(0);
    const four = Array.from({ length: 4 }, () => ({ kind: 'positive' as const }));
    expect(positivePct(four, { minReviews: 5 })).toBeNull();
    expect(positivePct([...four, { kind: 'negative' }], { minReviews: 5 })).toBe(80);
    expect(positivePct([...four, { kind: 'neutral' }], { minReviews: 5 })).toBeNull();
  });
  it('a review carries no weight and no USD amount', () => {
    // @ts-expect-error weight is not part of ReviewForStats (no dollar weighting)
    const w: ReviewForStats = { kind: 'positive', weight: 1_000n };
    // @ts-expect-error usdCents is not part of ReviewForStats
    const u: ReviewForStats = { kind: 'positive', usdCents: 1_000n };
    expect([w.kind, u.kind]).toEqual(['positive', 'positive']);
  });
});

describe('ratedReviewCount (review M4)', () => {
  it('counts positive and negative reviews that count in stats', () => {
    expect(
      ratedReviewCount([
        { kind: 'positive' },
        { kind: 'negative' },
        { kind: 'neutral' },
        { kind: 'negative', dispute: 'open' },
        { kind: 'positive', dispute: 'removed' },
        { kind: 'positive', dispute: 'stands' },
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

describe('bothRolesTypical: Fast and the role-less time over both lists (review 2, I2)', () => {
  const n = (k: number, v: number) => Array.from({ length: k }, () => v);
  it('20 payments at 240 min and 20 releases at 1 min is not fast: the median sees all 40', () => {
    expect(bothRolesTypical(n(20, 240), n(20, 1))).toEqual({ minutes: 120, samples: 40 });
    expect(bothRolesTypical(n(20, 1), n(20, 240))).toEqual({ minutes: 120, samples: 40 });
  });
  it('takes the last 20 of each list, and the sample count is what the median saw', () => {
    expect(bothRolesTypical([...n(5, 500), ...n(20, 2)], n(3, 4))).toEqual({ minutes: 2, samples: 23 });
    expect(bothRolesTypical([], n(2, 4))).toEqual({ minutes: null, samples: 2 });
    expect(bothRolesTypical([1], [3, 5])).toEqual({ minutes: 3, samples: 3 });
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

describe('no public cancel rate (owner T-017; J-21 review F6)', () => {
  // All cancel types are recorded as ONE cancel figure seen only by moderators (the moderator case
  // view, J-21); P5-A9's public profile cancel rate is superseded, so the package exports none.
  it('exports no cancel-rate helper', async () => {
    const pkg = (await import('../src/index.js')) as Record<string, unknown>;
    expect(Object.keys(pkg).filter((k) => /cancel/i.test(k))).toEqual([]);
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
