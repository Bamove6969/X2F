// Plan 5 Task 4 (P5-A19, spec 5.2): platform feedback, the one-tap "How's X2F doing?" prompt the
// web shows after a completed trade (when `shouldAskFeedback` from @x2f/reputation says so).
// `POST /v1/feedback { mood, note? }` → 202.
//
// Unlinkable: the row holds a mood, an optional note and the day; no account, session, device,
// address or time of day (migration 302). Nothing about a submission is logged, its note least of all.
//
// Limit: FEEDBACK_DAILY sends per account per UTC day, counted in memory only (never stored, so it
// links no row to anyone; a restart forgets it). Over it, the answer is still 202 and nothing is
// stored, so the prompt never shows a refusal for what is only a courtesy.
//
// The same database-level residual as the feedback form applies (Postgres keeps insertion order in
// xmin/ctid; see form.ts and docs/coordination.md). The route does not touch the session.
//
// The staff side (perm `feedback.read`, GET /staff/v1/feedback, the staff-web Feedback page) waits
// for Plan 4: listFeedback and feedbackMoodCounts are ready for it (tripwires in test/feedback.test.ts).
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { requireSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import type { RetentionJob } from '../retention.js';
import { HIDDEN } from './form.js';

export const FEEDBACK_MOODS = ['great', 'ok', 'needs-work'] as const;
export type FeedbackMood = (typeof FEEDBACK_MOODS)[number];

export const FEEDBACK_NOTE_MAX = 500;
/** Sends per account per UTC day (in memory only, P5-A19). */
export const FEEDBACK_DAILY = 3;
/** P5-A19: rows are deleted after a year. */
export const FEEDBACK_RETENTION_DAYS = 365;
/** The staff page's counts cover this many days. */
export const FEEDBACK_COUNT_DAYS = 30;

const DAY_MS = 86_400_000;

export interface FeedbackItem {
  id: string;
  mood: FeedbackMood;
  note: string | null;
  createdOn: string;
}

/** Where a staff list page ends: the last row's day and id (rows are ordered by both). */
export interface FeedbackCursor {
  createdOn: string;
  id: string;
}

/**
 * The staff list's query (as listFeedbackForm): newest day first, then by id, 50 a page; `before` is
 * the last row of the previous page (a keyset cursor, so a day with more than 50 rows is never cut
 * short). No route serves it until Plan 4's staff API lands (NEEDS_P4_STAFF_FEEDBACK_ROUTE).
 */
export async function listFeedback(db: pg.Pool, o: { before?: FeedbackCursor; limit?: number } = {}): Promise<FeedbackItem[]> {
  const limit = Math.min(Math.max(o.limit ?? 50, 1), 50);
  const { rows } = await db.query<{ id: string; mood: FeedbackMood; note: string | null; created_on: string }>(
    `select id, mood, note, to_char(created_on, 'YYYY-MM-DD') as created_on
       from platform_feedback
      where ($1::date is null or (created_on, id) < ($1::date, $2::uuid))
      order by created_on desc, id desc
      limit $3`,
    [o.before?.createdOn ?? null, o.before?.id ?? null, limit],
  );
  return rows.map((r) => ({ id: r.id, mood: r.mood, note: r.note, createdOn: r.created_on }));
}

/** Great / OK / Needs work over the last FEEDBACK_COUNT_DAYS days (today and the 29 before it), for the staff page. */
export async function feedbackMoodCounts(db: pg.Pool, now: Date): Promise<{ great: number; ok: number; needsWork: number }> {
  const from = new Date(now.getTime() - (FEEDBACK_COUNT_DAYS - 1) * DAY_MS).toISOString().slice(0, 10);
  const { rows } = await db.query<{ mood: FeedbackMood; n: number }>(
    'select mood, count(*)::int as n from platform_feedback where created_on >= $1::date group by mood',
    [from],
  );
  const n = (m: FeedbackMood) => rows.find((r) => r.mood === m)?.n ?? 0;
  return { great: n('great'), ok: n('ok'), needsWork: n('needs-work') };
}

export const purgeFeedback: RetentionJob = {
  name: 'purgeFeedback',
  async run(db: pg.Pool, now: Date): Promise<number> {
    const cutoff = new Date(now.getTime() - FEEDBACK_RETENTION_DAYS * DAY_MS).toISOString().slice(0, 10);
    const { rowCount } = await db.query('delete from platform_feedback where created_on < $1::date', [cutoff]);
    return rowCount ?? 0;
  },
};

function parseBody(body: unknown): { mood: FeedbackMood; note: string | null } {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
  const { mood, note, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0) throw new ApiError(400, 'bad-request');
  if (typeof mood !== 'string' || !(FEEDBACK_MOODS as readonly string[]).includes(mood)) throw new ApiError(400, 'bad-request');
  if (note === undefined || note === null) return { mood: mood as FeedbackMood, note: null };
  if (typeof note !== 'string') throw new ApiError(400, 'bad-request');
  const clean = note.replace(/\r\n?/g, '\n').trim();
  if ([...clean].length > FEEDBACK_NOTE_MAX || HIDDEN.test(clean)) throw new ApiError(400, 'bad-request');
  // An empty note box sends "": stored as no note.
  return { mood: mood as FeedbackMood, note: clean === '' ? null : clean };
}

export function feedbackRoutes(app: FastifyInstance): void {
  // Per account per UTC day; cleared when the day changes. Never written anywhere.
  let day = '';
  const sent = new Map<string, number>();

  // touch: false: the send is not counted as activity, so it leaves no fresh last_seen_at beside the row.
  const trader = requireSession({ kinds: ['trader'], touch: false });
  app.post('/v1/feedback', { preHandler: trader }, async (req, reply) => {
    const f = parseBody(req.body);
    const now = req.server.deps.clock();
    const today = now.toISOString().slice(0, 10);
    if (today !== day) {
      day = today;
      sent.clear();
    }
    const accountId = req.auth.accountId;
    const count = sent.get(accountId) ?? 0;
    // Over the limit: the same 202, nothing stored.
    if (count >= FEEDBACK_DAILY) return reply.code(202).send({});
    // Held while the insert runs (so a parallel burst cannot pass the count) and given back if the
    // insert fails: a database error never uses up one of the account's sends.
    sent.set(accountId, count + 1);
    try {
      await req.server.deps.db.query('insert into platform_feedback (mood, note, created_on) values ($1, $2, $3)', [f.mood, f.note, today]);
    } catch (e) {
      if (day === today) sent.set(accountId, Math.max(0, (sent.get(accountId) ?? 1) - 1));
      throw e;
    }
    return reply.code(202).send({});
  });
}
