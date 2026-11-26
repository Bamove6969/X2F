// Plan 5 Task 21 (owner, 2026-10-29; spec 5.2): the feedback form every "can't do that" popup
// links to. `POST /v1/feedback/form { kind, text, anonymous, from? }` → 202.
//
// Privacy: an anonymous row holds no account id, no session, no device, no address and no refusal
// code; a named row holds the account id (so staff can reach out) and the refusal code. Both keep
// only the day. Nothing about a submission is logged, its text least of all.
//
// Limits: FEEDBACK_FORM_DAILY sends per person (a team member on their own) per UTC day, counted in memory only (never stored,
// so it links no row to anyone; a restart forgets it), and at most one send per
// FEEDBACK_FORM_MIN_GAP_S seconds per account (owner 2026-11-02; no shared budget for everyone).
// Over the daily count: 429 `slow-down` with `retryAfterSeconds` to the next UTC midnight; too soon
// after the last send: 429 `slow-down` with the seconds left. The gap keeps only each account's
// "blocked until" time, in memory, and drops it once it has passed (review M2): after
// FEEDBACK_FORM_MIN_GAP_S nothing in memory says when an account last sent, so it links no row to
// anyone either. A failed insert gives back both the daily send and the gap.
// Both limits are per process: N API instances allow N sends per FEEDBACK_FORM_MIN_GAP_S (and N
// times the daily count). Fine for the single instance at launch; revisit if the API scales out.
//
// Residual, at the database level (review M1, recorded in docs/coordination.md): Postgres keeps
// insertion order in system columns (xmin, ctid), so someone with database access can still line
// an anonymous row up with other rows written around the same moment. The route does not touch the
// session (touch: false), and the form promises only "we don't record who sent it".
import { FEEDBACK_FORM_DAILY } from '@x2f/core';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import type { RetentionJob } from '../retention.js';

export const FEEDBACK_KINDS = ['complaint', 'feedback', 'recommendation'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_TEXT_MAX = 2000;
/** Sends per person per UTC day (in memory only); the number lives in @x2f/core, shared with the web. */
export { FEEDBACK_FORM_DAILY };
/** Owner 2026-11-02: at most one send per this many seconds per account (in memory only); no shared cap. */
export const FEEDBACK_FORM_MIN_GAP_S = 30;
/** As P5-A19 (Task 4's platform feedback): rows are deleted after a year. */
export const FEEDBACK_FORM_RETENTION_DAYS = 365;
/** A refusal code from the popup (`/feedback?from=<code>`), e.g. `starter-limit`. */
export const FROM_CODE = /^[a-z0-9-]{1,40}$/;

// Control and format characters (bidi overrides, invisible marks), except the line break, the tab,
// and the zero-width non-joiner and joiner (U+200C, U+200D: Persian and other scripts need ZWNJ,
// emoji sequences need ZWJ).
export const HIDDEN = /(?![\n\t\u200c\u200d])[\p{Cc}\p{Cf}]/u;
const DAY_MS = 86_400_000;

export interface FeedbackFormItem {
  id: string;
  kind: FeedbackKind;
  text: string;
  /** null for an anonymous row (or a named row whose account was deleted). */
  accountId: string | null;
  /**
   * D-058 (owner G20): the sender's public display name, so staff can follow up; null when
   * `accountId` is. Never the login name.
   */
  accountName: string | null;
  from: string | null;
  createdOn: string;
}

/** Where a staff list page ends: the last row's day and id (rows are ordered by both). */
export interface FeedbackFormCursor {
  createdOn: string;
  id: string;
}

/**
 * The staff list's query: newest day first, then by id, 50 a page; `before` is the last row of the
 * previous page (a keyset cursor, so a day with more than 50 rows is never cut short).
 * Served by the staff API's `GET /staff/v1/feedback/form` (staff/feedback.ts, perm `feedback.read`);
 * the staff web Feedback page (Plan 4 Task 16) is still owed (tripwire in test/feedback.test.ts).
 */
export async function listFeedbackForm(db: pg.Pool, o: { before?: FeedbackFormCursor; limit?: number } = {}): Promise<FeedbackFormItem[]> {
  const limit = Math.min(Math.max(o.limit ?? 50, 1), 50);
  const { rows } = await db.query<{
    id: string;
    kind: FeedbackKind;
    body: string;
    account_id: string | null;
    display_name: string | null;
    from_code: string | null;
    created_on: string;
  }>(
    `select f.id, f.kind, f.body, a.id as account_id, a.display_name, f.from_code, to_char(f.created_on, 'YYYY-MM-DD') as created_on
       from feedback_form f
       left join accounts a on a.id = f.account_id
      where ($1::date is null or (f.created_on, f.id) < ($1::date, $2::uuid))
      order by f.created_on desc, f.id desc
      limit $3`,
    [o.before?.createdOn ?? null, o.before?.id ?? null, limit],
  );
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    text: r.body,
    accountId: r.account_id,
    accountName: r.account_id === null ? null : r.display_name,
    from: r.from_code,
    createdOn: r.created_on,
  }));
}

export const purgeFeedbackForm: RetentionJob = {
  name: 'purgeFeedbackForm',
  async run(db: pg.Pool, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - FEEDBACK_FORM_RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10);
    const { rowCount } = await db.query('delete from feedback_form where created_on < $1::date', [cutoff]);
    return rowCount ?? 0;
  },
};

/**
 * Per-account send gap (review M2): `key -> blocked until` (ms), nothing else. Expired entries are
 * dropped on every take, so an entry lives at most `gapMs`. Entries are kept in insertion order
 * (re-inserted on take), which is "blocked until" order while the clock moves forward, so the sweep
 * stops at the first entry still blocking. At most `maxKeys` entries: past that the oldest goes
 * (that account could send early; nothing worse).
 */
export class SendGap {
  private readonly until = new Map<string, number>();

  constructor(
    private readonly gapMs: number,
    private readonly maxKeys = 100_000,
  ) {}

  get size(): number {
    return this.until.size;
  }

  blockedUntil(key: string): number | undefined {
    return this.until.get(key);
  }

  /** Drops every entry from the front whose time has passed. */
  sweep(now: number): void {
    for (const [k, t] of this.until) {
      if (t > now) return;
      this.until.delete(k);
    }
  }

  /** Synchronous check-and-set: throws 429 `slow-down` with the seconds left, or blocks `key` and returns until when. */
  take(key: string, now: number): number {
    this.sweep(now);
    const t = this.until.get(key);
    if (t !== undefined && t > now) throw new ApiError(429, 'slow-down', { retryAfterSeconds: Math.max(1, Math.ceil((t - now) / 1000)) });
    const until = now + this.gapMs;
    this.until.delete(key);
    this.until.set(key, until);
    for (const k of this.until.keys()) {
      if (this.until.size <= this.maxKeys) break;
      this.until.delete(k);
    }
    return until;
  }

  /** Gives back the gap a take returned (a failed insert); a newer gap for the key is left alone. */
  give(key: string, until: number): void {
    if (this.until.get(key) === until) this.until.delete(key);
  }
}

interface FormBody {
  kind: FeedbackKind;
  text: string;
  anonymous: boolean;
  from: string | null;
}

function parseBody(body: unknown): FormBody {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
  const { kind, text, anonymous, from, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw new ApiError(400, 'bad-request');
  if (typeof kind !== 'string' || !(FEEDBACK_KINDS as readonly string[]).includes(kind)) throw new ApiError(400, 'bad-request');
  if (typeof anonymous !== 'boolean' || typeof text !== 'string') throw new ApiError(400, 'bad-request');
  const clean = text.replace(/\r\n?/g, '\n').trim();
  const length = [...clean].length;
  if (length < 1 || length > FEEDBACK_TEXT_MAX || HIDDEN.test(clean)) throw new ApiError(400, 'bad-request');
  if (from !== undefined && from !== null && (typeof from !== 'string' || !FROM_CODE.test(from))) throw new ApiError(400, 'bad-request');
  return { kind: kind as FeedbackKind, text: clean, anonymous, from: typeof from === 'string' ? from : null };
}

export function feedbackFormRoutes(app: FastifyInstance): void {
  // One send per FEEDBACK_FORM_MIN_GAP_S per account (429 slow-down with the seconds left).
  const gap = new SendGap(FEEDBACK_FORM_MIN_GAP_S * 1000);
  // Per account per UTC day; cleared when the day changes. Never written anywhere.
  let day = '';
  const sent = new Map<string, number>();

  // A trader refused for a hold, a backup session or old Terms is exactly who may want to say so.
  // allowHeld is a recorded exception to requireSession's rule (see its comment). touch: false: the
  // send is not counted as activity, so it leaves no fresh last_seen_at beside an anonymous row.
  // A team member refused something may say so too (Plan 2 Task 18), with the Send X2F feedback box (Job 1c; Q69: per member).
  const trader = requireSession({ kinds: ['trader'], allowStaleTerms: true, touch: false, member: 'feedback-send' });
  app.post('/v1/feedback/form', { preHandler: trader }, async (req, reply) => {
    const f = parseBody(req.body);
    const now = req.server.deps.clock();
    const today = now.toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      sent.clear();
    }
    const accountId = req.auth.accountId;
    // Owner Q69: a team member's sends are their own (the in-memory key only; a named row still holds
    // the team account, which staff can reach).
    const who = req.auth.memberId !== null ? `member:${req.auth.memberId}` : accountId;
    const count = sent.get(who) ?? 0;
    if (count >= FEEDBACK_FORM_DAILY) {
      const midnight = Date.parse(`${today}T00:00:00Z`) + DAY_MS;
      // `limit: 'daily'` lets the form say why (owner Q67: the cap is there to stop spam).
      throw new ApiError(429, 'slow-down', { retryAfterSeconds: Math.max(1, Math.ceil((midnight - now.getTime()) / 1000)), limit: 'daily' });
    }
    // Both taken synchronously, before any await, so a parallel burst from one account gets exactly
    // one 202; both given back if the insert fails: a database error never uses up a send or the gap.
    const until = gap.take(who, now.getTime());
    sent.set(who, count + 1);
    try {
      await req.server.deps.db.query('insert into feedback_form (kind, body, account_id, from_code, created_on) values ($1, $2, $3, $4, $5)', [
        f.kind,
        f.text,
        f.anonymous ? null : accountId,
        f.anonymous ? null : f.from,
        today,
      ]);
    } catch (e) {
      if (day === today) sent.set(who, Math.max(0, (sent.get(who) ?? 1) - 1));
      gap.give(who, until);
      throw e;
    }
    return reply.code(202).send({});
  });
}
