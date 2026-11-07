// Review rules (Plan 5 Task 1): phrases, validation and review-dispute status.
// Pure: no I/O and no clock reads. The personal-details check on notes is passed in (Task 3 passes
// `s => detectSensitiveText(s).length > 0` from @x2f/proof), so this package has no dependencies.

export type Side = 'buyer' | 'seller';

/** Stars are 1-5 only (Revision 2026-10-29b: the 1-10 variant is dropped). A constant, not a setting. */
export const STAR_MAX = 5;
export type Stars = 1 | 2 | 3 | 4 | 5;

/** One line, at most this many characters (P5-A6). */
export const REVIEW_NOTE_MAX = 120;

/**
 * Good phrases (spec 5.1, P5-A7): "Fast payment" when rating a buyer, "Fast release" when rating a
 * seller (the Review board says "Fast release"; spec 5.1 says "Fast payment").
 */
export function GOOD_PHRASES(rated: Side): readonly string[] {
  return [rated === 'buyer' ? 'Fast payment' : 'Fast release', 'Friendly', 'Clear instructions', 'Would trade again'];
}

/** Bad phrases (spec 5.1). The apostrophe is the board's U+2019. */
export const BAD_PHRASES: readonly string[] = ['Slow', 'Went quiet', 'Asked for ID', 'Payment didn’t match'];

/**
 * Badges that describe the trade (owner, Revision 2026-10-29). The owner has not given the list yet;
 * these are the plan's examples.
 */
// COPY-UNSIGNED: the owner gives the final list.
export const TRADE_BADGES: readonly string[] = ['Smooth trade', 'Great communication'];

export type ReviewInput =
  | { neutral: true }
  | { neutral: false; stars: Stars; phrases: string[]; tradeBadges: string[]; note?: string };

export type ReviewErrorCode =
  | 'bad-shape'
  | 'bad-stars'
  | 'bad-phrase'
  | 'duplicate-phrase'
  | 'bad-trade-badge'
  | 'duplicate-trade-badge'
  | 'note-too-long'
  | 'note-multiline'
  | 'note-bad-character'
  | 'note-personal-details'
  | 'neutral-with-details';

export class ReviewError extends Error {
  constructor(readonly code: ReviewErrorCode) {
    super(code);
    this.name = 'ReviewError';
  }
}

const STAR_KEYS = new Set(['neutral', 'stars', 'phrases', 'tradeBadges', 'note']);
const LINE_BREAK = /[\n\v\f\r\u0085\u2028\u2029]/;
/** Other controls (C0, DEL, C1) and bidi embeddings, overrides and isolates (review M3). */
const BAD_CHARACTER = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function stringList(v: unknown): string[] {
  if (!Array.isArray(v) || !v.every((x): x is string => typeof x === 'string')) throw new ReviewError('bad-shape');
  return [...v];
}

function checkList(xs: string[], allowed: readonly string[], bad: ReviewErrorCode, dup: ReviewErrorCode): void {
  const seen = new Set<string>();
  for (const x of xs) {
    if (!allowed.includes(x)) throw new ReviewError(bad);
    if (seen.has(x)) throw new ReviewError(dup);
    seen.add(x);
  }
}

/**
 * Validates a submitted review body. `rated` is the side being rated (it decides the "Fast" phrase).
 * Throws `ReviewError`. A blank note is dropped; a kept note is trimmed.
 */
export function validateReview(i: unknown, rated: Side, hasPersonalDetails: (note: string) => boolean): ReviewInput {
  if (!isRecord(i) || typeof i.neutral !== 'boolean') throw new ReviewError('bad-shape');
  const keys = Object.keys(i);
  if (i.neutral) {
    if (keys.length !== 1) throw new ReviewError('neutral-with-details');
    return { neutral: true };
  }
  if (keys.some((k) => !STAR_KEYS.has(k)) || !('phrases' in i)) throw new ReviewError('bad-shape');
  const phrases = stringList(i.phrases);
  const tradeBadges = 'tradeBadges' in i ? stringList(i.tradeBadges) : [];
  if (i.note !== undefined && typeof i.note !== 'string') throw new ReviewError('bad-shape');

  const stars = i.stars;
  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > STAR_MAX) throw new ReviewError('bad-stars');

  checkList(phrases, [...GOOD_PHRASES(rated), ...BAD_PHRASES], 'bad-phrase', 'duplicate-phrase');
  checkList(tradeBadges, TRADE_BADGES, 'bad-trade-badge', 'duplicate-trade-badge');

  const out: ReviewInput = { neutral: false, stars: stars as Stars, phrases, tradeBadges };
  const note = typeof i.note === 'string' ? i.note.normalize('NFC').trim() : '';
  if (note !== '') {
    if (LINE_BREAK.test(note)) throw new ReviewError('note-multiline');
    if (BAD_CHARACTER.test(note)) throw new ReviewError('note-bad-character');
    if ([...note].length > REVIEW_NOTE_MAX) throw new ReviewError('note-too-long');
    if (hasPersonalDetails(note)) throw new ReviewError('note-personal-details');
    out.note = note;
  }
  return out;
}

// ---- No blind reveal, no late-review modes (owner 2026-11-02) ----
// A review shows to the other side and publicly as soon as it is submitted, so there is no reveal
// deadline (spec 5.3's 7 days) and no P5-A31 rule for a review given after the other one showed.

// ---- Review disputes (Task 19, Revision 2026-10-29b) ----

/** `open` shows "Under review"; the moderator's outcomes are `stands`, `comments-removed` and `removed`. */
export type ReviewDisputeStatus = 'open' | 'stands' | 'comments-removed' | 'removed';

export const UNDER_REVIEW_LABEL = 'Under review';

/**
 * Whether a review counts in % positive, Trusted and the other badges. An open dispute gives the person
 * reviewed the benefit of the doubt (lead default 2026-10-29b); a removed review counts nowhere;
 * `comments-removed` keeps the stars, so it counts.
 */
export function countsInStats(dispute: ReviewDisputeStatus | null): boolean {
  return dispute === null || dispute === 'stands' || dispute === 'comments-removed';
}

// ---- Public date (P5-A10 as revised 2026-10-29b: month and year only) ----

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "Mar 2026", in UTC, so the exact time can't be matched to a trade. */
export function reviewMonth(d: Date): string {
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
