import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from '../errors.js';
import { listFeedbackForm } from '../feedback/form.js';
import { feedbackMoodCounts, listFeedback } from '../feedback/mood.js';
import { withTx } from '../auth/hold.js';
import { requireStaff } from './guard.js';
import { log } from './members.js';

/** A page cursor as the client sends it back: `<YYYY-MM-DD>_<uuid>` (the last row's day and id). */
const CURSOR = /^(\d{4}-\d{2}-\d{2})_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

function cursorOf(req: FastifyRequest): { createdOn: string; id: string } | undefined {
  const raw = (req.query as { before?: unknown }).before;
  if (raw === undefined) return undefined;
  const m = typeof raw === 'string' ? CURSOR.exec(raw) : null;
  if (!m || !Number.isFinite(Date.parse(`${m[1]}T00:00:00Z`))) throw new ApiError(400, 'bad-request');
  return { createdOn: m[1]!, id: m[2]! };
}

/** The cursor of the page after `items` (50 a page), or null on the last page. */
const nextOf = (items: readonly { createdOn: string; id: string }[]) => {
  const last = items.length === 50 ? items[49] : undefined;
  return last ? `${last.createdOn}_${last.id}` : null;
};

/**
 * Plan 5 Tasks 4 and 21 on the staff API (perm `feedback.read`: the owner and senior moderators by
 * role, moderators and helpers when the owner ticks it, owner Q60). D-058 (owner G20, "named shows
 * the account so staff can follow up"; lead 12 Nov, replacing lead review 7 Nov M5): a named form
 * row carries its `accountId` and the account's public display name (`accountName`, never the
 * login name) for everyone who reads feedback, and every opening of the list is logged
 * (`feedback.form-opened`) so the owner can see who looked.
 * - `GET /staff/v1/feedback?before` → `{ items: { id, mood, note, createdOn }[], counts, next }`,
 *   the one-tap "How's X2F doing?" answers (`listFeedback`) with the 30-day Great / OK / Needs work
 *   counts (`feedbackMoodCounts`);
 * - `GET /staff/v1/feedback/form?before` → `{ items: { id, kind, text, accountName, from, createdOn }[], next }`,
 *   the feedback form every "can't do that" popup links to (`listFeedbackForm`; `accountName` null
 *   for an anonymous row). The raw account id is never sent (review m1, lead 12 Nov), and the
 *   opening is logged once per staff session per FORM_OPEN_LOG_WINDOW_MS (review m2).
 * `before` is the `next` of the previous page.
 */
/**
 * Review m2 (lead 12 Nov): the list opening is logged at most once per staff session in this long
 * (the first read of the window, with how many named rows it showed); later reads and pages in the
 * window are not logged again, so the hash-chained log (and its lock) cannot be flooded.
 */
export const FORM_OPEN_LOG_WINDOW_MS = 5 * 60_000;

export function staffFeedbackRoutes(app: FastifyInstance): void {
  /** Staff session id → when its window's entry was logged (this API process; pruned as it goes). */
  const formOpenLogged = new Map<string, number>();
  const perm = 'feedback.read' as const;
  const opts = { config: { perm }, preHandler: requireStaff(perm) };
  app.get('/staff/v1/feedback', opts, async (req) => {
    const before = cursorOf(req);
    const { db, clock } = req.server.deps;
    const items = await listFeedback(db, before ? { before } : {});
    return { items, counts: await feedbackMoodCounts(db, clock()), next: nextOf(items) };
  });
  app.get('/staff/v1/feedback/form', opts, async (req) => {
    const before = cursorOf(req);
    const { db, clock } = req.server.deps;
    // Review m2: claim this session's window synchronously, before any await, so parallel reads of one
    // session log once; given back if the read or the log fails, so a failure never skips an entry.
    const now = clock().getTime();
    for (const [session, at] of formOpenLogged) if (now - at >= FORM_OPEN_LOG_WINDOW_MS) formOpenLogged.delete(session);
    const session = req.auth.sessionId;
    const due = !formOpenLogged.has(session);
    if (due) formOpenLogged.set(session, now);
    try {
      const rows = await listFeedbackForm(db, before ? { before } : {});
      // D-058: the list names senders, so the session's first opening in the window is logged with how many it named.
      if (due) await withTx(db, (c) => log(c, req, 'feedback.form-opened', { namedRows: rows.filter((i) => i.accountId !== null).length }));
      // Review m1 (lead 12 Nov): the sender's public display name only; the raw account id never leaves the API.
      const items = rows.map((r) => ({ id: r.id, kind: r.kind, text: r.text, accountName: r.accountName, from: r.from, createdOn: r.createdOn }));
      return { items, next: nextOf(rows) };
    } catch (e) {
      if (due && formOpenLogged.get(session) === now) formOpenLogged.delete(session);
      throw e;
    }
  });
}
