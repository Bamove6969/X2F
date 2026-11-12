import { describe, expect, it } from 'vitest';
import {
  BLUR_CHECK_COMMENT_MAX,
  BLUR_CHECK_EVERY_NTH_DEFAULT,
  BLUR_KINDS,
  BlurCheckError,
  blurCheckDue,
  parseBlurCheckAnswer,
  ymdEnd,
} from '../src/index.js';

// P-012 (owner Q47, 6 Nov) and P-013 (owner p9-8, 8 Nov): "Was this proof blurred correctly?" on
// every proof at first (both parties), then on every Nth proof. A No asks for a comment.

describe('blurCheckDue: every proof until a date, then every Nth', () => {
  const until = ymdEnd(20270115)!;
  it('reads YYYYMMDD as the end of that UTC day; anything else is null', () => {
    expect(until.toISOString()).toBe('2027-01-16T00:00:00.000Z');
    for (const bad of [0, 2027011, 202701150, 20271301, 20270230, 20270100, -20270115, 1.5]) expect(ymdEnd(bad), String(bad)).toBeNull();
  });
  it('asks on every proof up to and including the last day', () => {
    for (const n of [1, 2, 3, 7, 11]) expect(blurCheckDue({ allUntil: until, everyNth: 10 }, new Date('2027-01-15T23:59:59Z'), n)).toBe(true);
  });
  it('after it, only on every Nth proof (by the site-wide proof count)', () => {
    const after = new Date('2027-01-16T00:00:00Z');
    const due = [1, 2, 9, 10, 11, 19, 20, 30].filter((n) => blurCheckDue({ allUntil: until, everyNth: 10 }, after, n));
    expect(due).toEqual([10, 20, 30]);
    expect([1, 19, 20, 40].filter((n) => blurCheckDue({ allUntil: until, everyNth: 20 }, after, n))).toEqual([20, 40]);
  });
  it('with no end date set, every proof is asked (fails toward asking)', () => {
    expect(blurCheckDue({ allUntil: null, everyNth: 10 }, new Date('2030-01-01T00:00:00Z'), 7)).toBe(true);
  });
  it('defaults and kinds', () => {
    expect(BLUR_CHECK_EVERY_NTH_DEFAULT).toBe(10);
    expect(BLUR_KINDS).toEqual(['auto', 'manual', 'both', 'none']);
    expect(() => blurCheckDue({ allUntil: null, everyNth: 0 }, new Date(), 1)).toThrow(RangeError);
    expect(() => blurCheckDue({ allUntil: null, everyNth: 10 }, new Date(), 0)).toThrow(RangeError);
  });
});

describe('parseBlurCheckAnswer', () => {
  const code = (fn: () => unknown) => {
    try {
      fn();
    } catch (e) {
      if (e instanceof BlurCheckError) return e.code;
      throw e;
    }
    return 'ok';
  };
  it('Yes carries no comment; No may carry one (trimmed; blank is none)', () => {
    expect(parseBlurCheckAnswer({ correct: true })).toEqual({ correct: true, comment: null });
    expect(parseBlurCheckAnswer({ correct: false })).toEqual({ correct: false, comment: null });
    expect(parseBlurCheckAnswer({ correct: false, comment: '  My name was not hidden.  ' })).toEqual({ correct: false, comment: 'My name was not hidden.' });
    expect(parseBlurCheckAnswer({ correct: false, comment: '   ' })).toEqual({ correct: false, comment: null });
  });
  it('refuses a bad shape, a comment on a Yes, a long comment and hidden characters', () => {
    expect(code(() => parseBlurCheckAnswer(null))).toBe('bad-shape');
    expect(code(() => parseBlurCheckAnswer({ correct: 'yes' }))).toBe('bad-shape');
    expect(code(() => parseBlurCheckAnswer({ correct: false, comment: 3 }))).toBe('bad-shape');
    expect(code(() => parseBlurCheckAnswer({ correct: false, extra: 1 }))).toBe('bad-shape');
    expect(code(() => parseBlurCheckAnswer({ correct: true, comment: 'fine' }))).toBe('comment-on-yes');
    expect(code(() => parseBlurCheckAnswer({ correct: false, comment: 'x'.repeat(BLUR_CHECK_COMMENT_MAX + 1) }))).toBe('comment-too-long');
    expect(code(() => parseBlurCheckAnswer({ correct: false, comment: 'a‮b' }))).toBe('comment-bad-character');
    expect(parseBlurCheckAnswer({ correct: false, comment: 'line one\nline two' }).comment).toBe('line one\nline two');
  });
});
