import type { FastifyInstance, FastifyRequest } from 'fastify';
import { ApiError } from '../errors.js';
import { listFeedbackForm } from '../feedback/form.js';
import { feedbackMoodCounts, listFeedback } from '../feedback/mood.js';
import { blurCheckCounts, listBlurChecks } from '../proof/blurCheck.js';
import { requireStaff } from './guard.js';

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
 * role, moderators and helpers when the owner ticks it, owner Q60). A named form row's `accountId`
 * goes only to the owner and senior moderators (lead review 7 Nov M5): a moderator or helper
 * reading by grant gets `accountId: null` on every row, so feedback can't be used to look people up.
 * - `GET /staff/v1/feedback?before` → `{ items: { id, mood, note, createdOn }[], counts, next }`,
 *   the one-tap "How's X2F doing?" answers (`listFeedback`) with the 30-day Great / OK / Needs work
 *   counts (`feedbackMoodCounts`);
 * - `GET /staff/v1/feedback/form?before` → `{ items: { id, kind, text, accountId, from, createdOn }[], next }`,
 *   the feedback form every "can't do that" popup links to (`listFeedbackForm`; `accountId` null
 *   for an anonymous row).
 * - `GET /staff/v1/feedback/blur-checks?before` → `{ items: { id, correct, comment, role, method, blur, createdOn }[], counts: { yes, no }, next }`,
 *   the "Was this proof blurred correctly?" answers (P-012/P-013, proof/blurCheck.ts), with the 30-day
 *   Yes / No counts. They name no trade and no person, so every reader gets the same rows.
 * `before` is the `next` of the previous page.
 */
export function staffFeedbackRoutes(app: FastifyInstance): void {
  const perm = 'feedback.read' as const;
  const opts = { config: { perm }, preHandler: requireStaff(perm) };
  app.get('/staff/v1/feedback', opts, async (req) => {
    const before = cursorOf(req);
    const { db, clock } = req.server.deps;
    const items = await listFeedback(db, before ? { before } : {});
    return { items, counts: await feedbackMoodCounts(db, clock()), next: nextOf(items) };
  });
  app.get('/staff/v1/feedback/blur-checks', opts, async (req) => {
    const before = cursorOf(req);
    const { db, clock } = req.server.deps;
    const items = await listBlurChecks(db, before ? { before } : {});
    return { items, counts: await blurCheckCounts(db, clock()), next: nextOf(items) };
  });
  app.get('/staff/v1/feedback/form', opts, async (req) => {
    const before = cursorOf(req);
    const items = await listFeedbackForm(req.server.deps.db, before ? { before } : {});
    // Lead review 7 Nov M5: who sent a named row is for the owner and senior moderators only.
    const named = req.staff.role === 'owner' || req.staff.role === 'senior';
    return { items: named ? items : items.map((i) => ({ ...i, accountId: null })), next: nextOf(items) };
  });
}
