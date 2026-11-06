import { describe, expect, it } from 'vitest';
import {
  BAD_PHRASES,
  GOOD_PHRASES,
  REVIEW_NOTE_MAX,
  ReviewError,
  STAR_MAX,
  TRADE_BADGES,
  UNDER_REVIEW_LABEL,
  countsInStats,
  reviewMonth,
  validateReview,
  type ReviewErrorCode,
} from '../src/index.js';
import * as rep from '../src/index.js';

const none = () => false;

function codeOf(fn: () => unknown): ReviewErrorCode | 'no-throw' {
  try {
    fn();
  } catch (e) {
    if (e instanceof ReviewError) return e.code;
    throw e;
  }
  return 'no-throw';
}

describe('phrases (P5-A7, board apostrophe)', () => {
  it('names the good phrase after the rated side', () => {
    expect(GOOD_PHRASES('seller')).toEqual(['Fast release', 'Friendly', 'Clear instructions', 'Would trade again']);
    expect(GOOD_PHRASES('buyer')).toEqual(['Fast payment', 'Friendly', 'Clear instructions', 'Would trade again']);
  });
  it('keeps the board apostrophe in the bad phrases', () => {
    expect(BAD_PHRASES).toEqual(['Slow', 'Went quiet', 'Asked for ID', 'Payment didn’t match']);
  });
  it('stars are 1-5 only (Revision 2026-10-29b)', () => {
    expect(STAR_MAX).toBe(5);
  });
});

describe('validateReview', () => {
  it('passes a plan example and normalises the lists', () => {
    expect(validateReview({ neutral: false, stars: 5, phrases: ['Fast release'], note: 'Smooth' }, 'seller', none)).toEqual({
      neutral: false,
      stars: 5,
      phrases: ['Fast release'],
      tradeBadges: [],
      note: 'Smooth',
    });
  });
  it('checks the phrase against the rated side', () => {
    const i = { neutral: false, stars: 5, phrases: ['Fast payment'] };
    expect(codeOf(() => validateReview(i, 'seller', none))).toBe('bad-phrase');
    expect(codeOf(() => validateReview(i, 'buyer', none))).toBe('no-throw');
  });
  it('allows bad phrases and no phrases at all', () => {
    expect(codeOf(() => validateReview({ neutral: false, stars: 2, phrases: ['Slow', 'Payment didn’t match'] }, 'buyer', none))).toBe('no-throw');
    expect(codeOf(() => validateReview({ neutral: false, stars: 3, phrases: [] }, 'buyer', none))).toBe('no-throw');
    // A straight apostrophe is not the board phrase.
    expect(codeOf(() => validateReview({ neutral: false, stars: 2, phrases: ["Payment didn't match"] }, 'buyer', none))).toBe('bad-phrase');
  });
  it('refuses a repeated phrase', () => {
    expect(codeOf(() => validateReview({ neutral: false, stars: 4, phrases: ['Friendly', 'Friendly'] }, 'buyer', none))).toBe('duplicate-phrase');
  });
  it.each([0, 6, 4.5, -1, Number.NaN, '5', null, undefined])('refuses stars %s', (stars) => {
    expect(codeOf(() => validateReview({ neutral: false, stars, phrases: [] }, 'buyer', none))).toBe('bad-stars');
  });
  it('refuses a note over the limit, with a line break, or with personal details', () => {
    expect(REVIEW_NOTE_MAX).toBe(120);
    const ok = 'a'.repeat(120);
    expect(codeOf(() => validateReview({ neutral: false, stars: 5, phrases: [], note: ok }, 'buyer', none))).toBe('no-throw');
    expect(codeOf(() => validateReview({ neutral: false, stars: 5, phrases: [], note: ok + 'a' }, 'buyer', none))).toBe('note-too-long');
    for (const br of ['a\nb', 'a\rb', 'a\u2028b', 'a\u2029b', 'a\u000Bb', 'a\u000Cb', 'a\u0085b']) {
      expect(codeOf(() => validateReview({ neutral: false, stars: 5, phrases: [], note: br }, 'buyer', none))).toBe('note-multiline');
    }
    // Other controls and bidi embeddings/overrides/isolates (review M3).
    const bad = ['a\u0000b', 'a\tb', 'a\u001Bb', 'a\u007Fb', 'a\u009Bb', ...[0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066, 0x2067, 0x2068, 0x2069].map((c) => `a${String.fromCodePoint(c)}b`)];
    for (const note of bad) {
      expect(codeOf(() => validateReview({ neutral: false, stars: 5, phrases: [], note }, 'buyer', none))).toBe('note-bad-character');
    }
    expect(codeOf(() => validateReview({ neutral: false, stars: 5, phrases: [], note: 'mail me' }, 'buyer', () => true))).toBe('note-personal-details');
  });
  it('counts note length in characters, not UTF-16 units', () => {
    const emojiish = '\u{1F600}'.repeat(120);
    expect(codeOf(() => validateReview({ neutral: false, stars: 5, phrases: [], note: emojiish }, 'buyer', none))).toBe('no-throw');
  });
  it('normalises the note to NFC before the length check', () => {
    const decomposed = 'e\u0301'.repeat(120);
    expect(validateReview({ neutral: false, stars: 5, phrases: [], note: decomposed }, 'buyer', none)).toMatchObject({ note: '\u00e9'.repeat(120) });
  });
  it('drops an empty or blank note and trims a kept one', () => {
    expect(validateReview({ neutral: false, stars: 4, phrases: [], note: '   ' }, 'buyer', none)).toEqual({ neutral: false, stars: 4, phrases: [], tradeBadges: [] });
    expect(validateReview({ neutral: false, stars: 4, phrases: [], note: ' ok ' }, 'buyer', none)).toMatchObject({ note: 'ok' });
  });
  it('does not call the personal-details check for a blank note', () => {
    let called = false;
    validateReview({ neutral: false, stars: 4, phrases: [], note: '' }, 'buyer', () => ((called = true), true));
    expect(called).toBe(false);
  });
  it('a Neutral review carries nothing else', () => {
    expect(validateReview({ neutral: true }, 'buyer', none)).toEqual({ neutral: true });
    for (const extra of [{ stars: 3 }, { phrases: [] }, { note: 'x' }, { tradeBadges: [] }]) {
      expect(codeOf(() => validateReview({ neutral: true, ...extra }, 'buyer', none))).toBe('neutral-with-details');
    }
  });
  it('validates trade badges against the list (Revision 2026-10-29)', () => {
    const [first] = TRADE_BADGES;
    expect(first).toBeDefined();
    expect(validateReview({ neutral: false, stars: 5, phrases: [], tradeBadges: [first] }, 'buyer', none)).toMatchObject({ tradeBadges: [first] });
    expect(codeOf(() => validateReview({ neutral: false, stars: 5, phrases: [], tradeBadges: ['Best ever'] }, 'buyer', none))).toBe('bad-trade-badge');
    expect(codeOf(() => validateReview({ neutral: false, stars: 5, phrases: [], tradeBadges: [first, first] }, 'buyer', none))).toBe('duplicate-trade-badge');
  });
  it('refuses anything that is not a review object', () => {
    for (const bad of [null, 'x', 5, [], {}, { neutral: 'no' }, { neutral: false, stars: 5 }, { neutral: false, stars: 5, phrases: 'Slow' }, { neutral: false, stars: 5, phrases: [1] }, { neutral: false, stars: 5, phrases: [], note: 3 }, { neutral: false, stars: 5, phrases: [], extra: 1 }, { neutral: false, stars: 5, phrases: [], tradeBadges: 'x' }]) {
      expect(codeOf(() => validateReview(bad, 'buyer', none))).toBe('bad-shape');
    }
  });
});

describe('no blind reveal and no late-review modes (owner 2026-11-02: a review shows once submitted)', () => {
  it('@x2f/reputation has no reveal deadline or late-review rule any more', () => {
    for (const name of ['REVEAL_AFTER_DAYS', 'revealAt', 'isRevealed', 'LATE_REVIEW', 'assertLateReviewAllowed']) {
      expect(Object.keys(rep), name).not.toContain(name);
    }
    // @ts-expect-error the late-review refusals are gone with the late-review modes
    const late: ReviewErrorCode = 'late-review-closed';
    expect(late).toBe('late-review-closed');
  });
});

describe('review disputes (Task 19, Revision 2026-10-29b)', () => {
  it('only an undisputed, standing or trimmed review counts', () => {
    expect(countsInStats(null)).toBe(true);
    expect(countsInStats('stands')).toBe(true);
    expect(countsInStats('comments-removed')).toBe(true);
    expect(countsInStats('open')).toBe(false);
    expect(countsInStats('removed')).toBe(false);
    expect(UNDER_REVIEW_LABEL).toBe('Under review');
  });
});

describe('reviewMonth (P5-A10, month and year only)', () => {
  it('formats in UTC', () => {
    expect(reviewMonth(new Date('2026-03-31T23:59:59Z'))).toBe('Mar 2026');
    expect(reviewMonth(new Date('2026-01-01T00:00:00Z'))).toBe('Jan 2026');
    expect(reviewMonth(new Date('2025-12-15T00:00:00Z'))).toBe('Dec 2025');
  });
});
