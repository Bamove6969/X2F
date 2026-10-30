// Review rules (Plan 5 Task 1): phrases, validation, the blind reveal and review-dispute status.
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
  | 'note-personal-details'
  | 'neutral-with-details'
  | 'late-review-neutral-only'
  | 'late-review-closed';

export class ReviewError extends Error {
  constructor(readonly code: ReviewErrorCode) {
    super(code);
    this.name = 'ReviewError';
  }
}

const STAR_KEYS = new Set(['neutral', 'stars', 'phrases', 'tradeBadges', 'note']);
const LINE_BREAK = /[\r\n\u2028\u2029\u0085]/;

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
  const note = typeof i.note === 'string' ? i.note.trim() : '';
  if (note !== '') {
    if (LINE_BREAK.test(note)) throw new ReviewError('note-multiline');
    if ([...note].length > REVIEW_NOTE_MAX) throw new ReviewError('note-too-long');
    if (hasPersonalDetails(note)) throw new ReviewError('note-personal-details');
    out.note = note;
  }
  return out;
}

// ---- Blind reveal (spec 5.3, P5-A5) ----

export const REVEAL_AFTER_DAYS = 7;
const DAY_MS = 86_400_000;

export interface RevealFacts {
  /** When the trade became reviewable: its close for a release, the dispute's close for a disputed trade. */
  reviewableSince: Date;
  submitted: { buyer: Date | null; seller: Date | null };
}

/**
 * When both reviews of a trade become visible: the later submission once both sides have rated, but
 * never later than `reviewableSince + 7 days` (spec 5.3: "until both are submitted, or 7 days pass").
 */
export function revealAt(a: RevealFacts): Date {
  const deadline = a.reviewableSince.getTime() + REVEAL_AFTER_DAYS * DAY_MS;
  const { buyer, seller } = a.submitted;
  if (buyer && seller) return new Date(Math.min(deadline, Math.max(buyer.getTime(), seller.getTime())));
  return new Date(deadline);
}

export function isRevealed(a: RevealFacts, now: Date): boolean {
  return now.getTime() >= revealAt(a).getTime();
}

// ---- Late reviews (P5-A31, OPEN: the owner has not picked; the default keeps the draft) ----

export type LateReviewMode = 'any' | 'neutral-only' | 'closed';
/** P5-A31 default (c) "keep as drafted". The owner picks before Task 18. */
export const LATE_REVIEW: LateReviewMode = 'any';

/**
 * Checks a review submitted after the other side's review was already revealed to this reviewer.
 * `'neutral-only'`: only Neutral; `'closed'`: no review at all (the trade stops blocking, Task 3).
 */
export function assertLateReviewAllowed(i: ReviewInput, afterReveal: boolean, mode: LateReviewMode = LATE_REVIEW): void {
  if (!afterReveal || mode === 'any') return;
  if (mode === 'closed') throw new ReviewError('late-review-closed');
  if (!i.neutral) throw new ReviewError('late-review-neutral-only');
}

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
