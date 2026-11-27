import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withTx } from '../auth/liveSession.js';
import { ApiError } from '../errors.js';
import {
  DECISION_REASON_MAX,
  DECISION_REASON_MIN,
  DISPUTE_OUTCOMES,
  STAFF_PAGE,
  decideReviewDispute,
  listOpenReviewDisputes,
  type CommentRemoval,
  type DisputeOutcome,
} from '../reviews/disputes.js';
import { requireStaff } from './guard.js';
import { log } from './members.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** A page cursor: `<ISO openedAt>_<uuid>` (the last row's). */
const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

function afterOf(req: FastifyRequest): { openedAt: Date; id: string } | undefined {
  const raw = (req.query as { after?: unknown }).after;
  if (raw === undefined) return undefined;
  const m = typeof raw === 'string' ? CURSOR.exec(raw) : null;
  if (!m || !Number.isFinite(Date.parse(m[1]!))) throw new ApiError(400, 'bad-request');
  return { openedAt: new Date(m[1]!), id: m[2]! };
}

const strs = (v: unknown): v is string[] => Array.isArray(v) && v.length <= 8 && v.every((x) => typeof x === 'string' && x.length <= 64);

function parseRemoval(v: unknown): CommentRemoval | null {
  if (v === undefined) return null;
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new ApiError(400, 'bad-request', { field: 'remove' });
  const { note = false, phrases = [], tradeBadges = [], ...rest } = v as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || typeof note !== 'boolean' || !strs(phrases) || !strs(tradeBadges)) throw new ApiError(400, 'bad-request', { field: 'remove' });
  return { note, phrases: [...new Set(phrases)], tradeBadges: [...new Set(tradeBadges)] };
}

/**
 * Plan 5 Task 19 on the staff API (perm `reputation.review`: moderators, senior moderators and the
 * owner; a helper is refused `forbidden` by the guard).
 * - `GET /staff/v1/review-disputes?after` → `{ items: StaffReviewDispute[], next }`: the open
 *   disputes, oldest first, 50 a page: the review (stars, phrases, trade badges, note, method, month,
 *   the writer's side), the subject's reason and the trade code while the trade still exists. Never
 *   either trader's name.
 * - `POST /staff/v1/review-disputes/:id/decide { outcome, reason, remove? }` → `{ ok: true }`:
 *   `outcome` is `stands`, `comments-removed` (with `remove: { note?, phrases?, tradeBadges? }`,
 *   which must remove something the review has; the stars stay) or `removed`; `reason` at least 20
 *   characters (plan Task 19), kept with the dispute, never logged. 409 `dispute-decided` for a
 *   dispute already decided; 400 `bad-request` for a bad body or removal; 404 `not-found`.
 *   Logged (`review.dispute-decided`) with the dispute id and the outcome only, in the same transaction.
 *
 * Lead default, owner question: no security-key tap for a decision (P5-A24 asks none for past
 * reputation either).
 */
export function staffReviewDisputeRoutes(app: FastifyInstance): void {
  const perm = 'reputation.review' as const;
  const opts = { config: { perm }, preHandler: requireStaff(perm) };

  app.get('/staff/v1/review-disputes', opts, async (req) => {
    const after = afterOf(req);
    const items = await listOpenReviewDisputes(req.server.deps.db, after);
    const last = items.length === STAFF_PAGE ? items[STAFF_PAGE - 1] : undefined;
    return { items, next: last ? `${last.openedAt}_${last.id}` : null };
  });

  app.post('/staff/v1/review-disputes/:id/decide', opts, async (req) => {
    const { id: raw } = req.params as { id: string };
    const id = raw.toLowerCase();
    if (!UUID.test(id)) throw new ApiError(404, 'not-found');
    const body = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
    const { outcome, reason, remove, ...rest } = body as Record<string, unknown>;
    if (Object.keys(rest).length > 0) throw new ApiError(400, 'bad-request');
    if (typeof outcome !== 'string' || !(DISPUTE_OUTCOMES as readonly string[]).includes(outcome)) throw new ApiError(400, 'bad-request', { field: 'outcome' });
    const text = typeof reason === 'string' ? reason.trim() : '';
    const len = [...text].length;
    if (len < DECISION_REASON_MIN || len > DECISION_REASON_MAX) throw new ApiError(400, 'bad-request', { field: 'reason' });
    const removal = parseRemoval(remove);
    if ((outcome === 'comments-removed') !== (removal !== null)) throw new ApiError(400, 'bad-request', { field: 'remove' });
    const { db, clock } = req.server.deps;
    const now = clock();
    return withTx(db, async (c) => {
      const r = await decideReviewDispute(c, id, { outcome: outcome as DisputeOutcome, reason: text, by: req.staff.accountId, removal }, now);
      if (r.result === 'not-found') throw new ApiError(404, 'not-found');
      if (r.result === 'decided') throw new ApiError(409, 'dispute-decided');
      if (r.result === 'bad-removal') throw new ApiError(400, 'bad-request', { field: 'remove' });
      await log(c, req, 'review.dispute-decided', { disputeId: id, outcome });
      return { ok: true };
    });
  });
}
