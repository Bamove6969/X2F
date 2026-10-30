// Plan 5 Task 21 (owner, 2026-10-29; spec 5.2): the feedback form every "can't do that" popup
// links to. `POST /v1/feedback/form { kind, text, anonymous, from? }` → 202.
//
// Privacy: an anonymous row holds no account id, no session, no device, no address and no refusal
// code; a named row holds the account id (so staff can reach out) and the refusal code. Both keep
// only the day. Nothing about a submission is logged, its text least of all.
//
// Limits: FEEDBACK_FORM_DAILY sends per account per UTC day, counted in memory only (never stored,
// so it links no row to anyone; a restart forgets it), and one shared token bucket for everyone.
// Over the daily count: 429 `slow-down` with `retryAfterSeconds` to the next UTC midnight.
//
// Residual, at the database level (review M1, recorded in docs/coordination.md): Postgres keeps
// insertion order in system columns (xmin, ctid), so someone with database access can still line
// an anonymous row up with other rows written around the same moment. The route does not touch the
// session (touch: false), and the form promises only "we don't record who sent it".
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import type { BucketSize } from '../limits.js';
import { TokenBucket } from '../limits.js';
import type { RetentionJob } from '../retention.js';

export const FEEDBACK_KINDS = ['complaint', 'feedback', 'recommendation'] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export const FEEDBACK_TEXT_MAX = 2000;
/** Sends per account per UTC day (in memory only). */
export const FEEDBACK_FORM_DAILY = 5;
/** One budget for every sender: anonymous rows carry no account, so nothing finer is possible after the daily count. */
export const FEEDBACK_FORM_BUCKET: BucketSize = { capacity: 30, perMinute: 10 };
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
 * Plan 4's staff API and the Task 4 Feedback page call it once they are on the main line (see the
 * tripwire in test/feedbackForm.test.ts); no route serves it yet.
 */
export async function listFeedbackForm(db: pg.Pool, o: { before?: FeedbackFormCursor; limit?: number } = {}): Promise<FeedbackFormItem[]> {
  const limit = Math.min(Math.max(o.limit ?? 50, 1), 50);
  const { rows } = await db.query<{ id: string; kind: FeedbackKind; body: string; account_id: string | null; from_code: string | null; created_on: string }>(
    `select id, kind, body, account_id, from_code, to_char(created_on, 'YYYY-MM-DD') as created_on
       from feedback_form
      where ($1::date is null or (created_on, id) < ($1::date, $2::uuid))
      order by created_on desc, id desc
      limit $3`,
    [o.before?.createdOn ?? null, o.before?.id ?? null, limit],
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, text: r.body, accountId: r.account_id, from: r.from_code, createdOn: r.created_on }));
}

export const purgeFeedbackForm: RetentionJob = {
  name: 'purgeFeedbackForm',
  async run(db: pg.Pool, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - FEEDBACK_FORM_RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10);
    const { rowCount } = await db.query('delete from feedback_form where created_on < $1::date', [cutoff]);
    return rowCount ?? 0;
  },
};

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
  const bucket = new TokenBucket(FEEDBACK_FORM_BUCKET.capacity, FEEDBACK_FORM_BUCKET.perMinute, app.deps.clock);
  // Per account per UTC day; cleared when the day changes. Never written anywhere.
  let day = '';
  const sent = new Map<string, number>();

  // A trader refused for a hold, a backup session or old Terms is exactly who may want to say so.
  // allowHeld is a recorded exception to requireSession's rule (see its comment). touch: false: the
  // send is not counted as activity, so it leaves no fresh last_seen_at beside an anonymous row.
  const trader = requireSession({ kinds: ['trader'], allowRecovery: true, allowHeld: true, allowStaleTerms: true, touch: false });
  app.post('/v1/feedback/form', { preHandler: trader }, async (req, reply) => {
    const f = parseBody(req.body);
    const now = req.server.deps.clock();
    const today = now.toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      sent.clear();
    }
    const accountId = req.auth.accountId;
    const count = sent.get(accountId) ?? 0;
    if (count >= FEEDBACK_FORM_DAILY) {
      const midnight = Date.parse(`${today}T00:00:00Z`) + DAY_MS;
      throw new ApiError(429, 'slow-down', { retryAfterSeconds: Math.max(1, Math.ceil((midnight - now.getTime()) / 1000)) });
    }
    bucket.take();
    // Held while the insert runs (so a parallel burst cannot pass the count) and given back if the
    // insert fails: a database error never uses up one of the account's sends.
    sent.set(accountId, count + 1);
    try {
      await req.server.deps.db.query('insert into feedback_form (kind, body, account_id, from_code, created_on) values ($1, $2, $3, $4, $5)', [
        f.kind,
        f.text,
        f.anonymous ? null : accountId,
        f.anonymous ? null : f.from,
        today,
      ]);
    } catch (e) {
      if (day === today) sent.set(accountId, Math.max(0, (sent.get(accountId) ?? 1) - 1));
      throw e;
    }
    return reply.code(202).send({});
  });
}
