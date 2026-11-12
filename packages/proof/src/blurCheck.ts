// P-012 (owner Q47, 6 Nov 2026) and P-013 (owner p9-8, 8 Nov): "Was this proof blurred correctly?"
// Owner Q47: "in the first couple months of the system, on every proof that is posted, it'll ask ...
// And if they say no, it'll ask them for comment ... that will go right into feedback for the people
// we designate ... after a couple of months ... every tenth person or every twentieth person."
// p9-8: in the first month ask BOTH parties every time. The schedule is a setting: every proof until
// a date, then every Nth proof on the site. Pure: no clock reads, no I/O.

/**
 * How the posted proof was blurred: `auto`, X2F's privacy tool only; `manual`, only boxes the
 * uploader drew (the tool found nothing, or its boxes were all removed); `both`, the tool's boxes
 * with the uploader's changes; `none`, nothing blurred. Owner Q18 / P-015: "whether the blur was ours
 * (automatic) or added by the buyer (manual)".
 */
export const BLUR_KINDS = ['auto', 'manual', 'both', 'none'] as const;
export type BlurKind = (typeof BLUR_KINDS)[number];

/** Owner Q47's "every tenth or every twentieth": the default N once the first weeks are over (a setting). */
export const BLUR_CHECK_EVERY_NTH_DEFAULT = 10;
export const BLUR_CHECK_EVERY_NTH_MAX = 1000;
/** A No's comment, at most (as the "no amount" explanation). */
export const BLUR_CHECK_COMMENT_MAX = 500;

export interface BlurCheckSchedule {
  /** Every proof is asked before this moment (the end of the setting's last day); null: no end set, every proof. */
  allUntil: Date | null;
  /** After it, the proofs whose site-wide number is a multiple of this. */
  everyNth: number;
}

/**
 * A `YYYYMMDD` whole number (the owner setting `blur_check_all_until`) as the END of that UTC day
 * (the next midnight), so the date itself is still "every proof". Null when it is not a real date.
 */
export function ymdEnd(ymd: number): Date | null {
  if (!Number.isSafeInteger(ymd) || ymd < 10000101 || ymd > 99991231) return null;
  const y = Math.floor(ymd / 10000);
  const m = Math.floor(ymd / 100) % 100;
  const d = ymd % 100;
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) return null;
  return new Date(t + 86_400_000);
}

/** Whether proof number `proofNo` (1-based, site-wide) posted at `now` asks both parties. */
export function blurCheckDue(s: BlurCheckSchedule, now: Date, proofNo: number): boolean {
  if (!Number.isSafeInteger(s.everyNth) || s.everyNth < 1) throw new RangeError('everyNth must be a whole number >= 1');
  if (!Number.isSafeInteger(proofNo) || proofNo < 1) throw new RangeError('proofNo must be a whole number >= 1');
  if (s.allUntil === null || now.getTime() < s.allUntil.getTime()) return true;
  return proofNo % s.everyNth === 0;
}

export type BlurCheckErrorCode = 'bad-shape' | 'comment-on-yes' | 'comment-too-long' | 'comment-bad-character';

export class BlurCheckError extends Error {
  constructor(readonly code: BlurCheckErrorCode) {
    super(code);
    this.name = 'BlurCheckError';
  }
}

/** Control and format characters (bidi overrides, invisible marks), except the line break and the tab. */
const HIDDEN = /(?![\n\t‌‍])[\p{Cc}\p{Cf}]/u;

/**
 * An answer's body: `{ correct: boolean, comment?: string }`. Only a No carries a comment (trimmed;
 * blank is none). Throws BlurCheckError.
 */
export function parseBlurCheckAnswer(b: unknown): { correct: boolean; comment: string | null } {
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new BlurCheckError('bad-shape');
  const r = b as Record<string, unknown>;
  if (Object.keys(r).some((k) => k !== 'correct' && k !== 'comment') || typeof r.correct !== 'boolean') throw new BlurCheckError('bad-shape');
  if (r.comment !== undefined && typeof r.comment !== 'string') throw new BlurCheckError('bad-shape');
  const comment = typeof r.comment === 'string' ? r.comment.normalize('NFC').trim() : '';
  if (r.correct) {
    if (comment !== '') throw new BlurCheckError('comment-on-yes');
    return { correct: true, comment: null };
  }
  if (comment === '') return { correct: false, comment: null };
  if ([...comment].length > BLUR_CHECK_COMMENT_MAX) throw new BlurCheckError('comment-too-long');
  if (HIDDEN.test(comment)) throw new BlurCheckError('comment-bad-character');
  return { correct: false, comment };
}
