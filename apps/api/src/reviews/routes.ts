import { normalizeTradeCode } from '@x2f/core';
import { ReviewError, validateReview, type ReviewErrorCode, type Side } from '@x2f/reputation';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { requireSession } from '../auth/sessions.js';
import { ApiError, type ApiErrorCode } from '../errors.js';
import { loadTradeRow, type TradeRow } from '../trades/store.js';
import { appendLog } from '../log/append.js';
import { DISPUTE_REASON_MAX, openReviewDispute } from './disputes.js';
import { pendingReviews } from './gate.js';
import { hasPersonalDetails } from './sensitive.js';
import { hasSkipped, insertReview, insertSkip, reviewableSince, reviewsHeld, reviewsOfTrade, toPublicReview, type PublicReview, type ReviewRow } from './store.js';

/**
 * Plan 5 Task 3: reviews (spec 5.1) and Skip review (owner 2026-11-01, item 28).
 *
 * - `GET /v1/reviews/pending` (trader) → `{ trades: { code, counterparty, reviewableSince }[] }`: the
 *   trades this trader must rate or skip before their next trade (the gate, gate.ts).
 *   `counterparty` is the other trader's public Trade Tag.
 * - `GET /v1/trades/:code/review` (participant) → `{ reviewable, mine, theirs, skipped, held }`: `theirs`
 *   as soon as the other side has submitted it (owner 2026-11-02: no blind reveal); `skipped` is
 *   true when the CALLER skipped (the other side's skip is never shown: it shows nothing to anyone).
 *   `held` (R-011): an appeal on the trade is pending, so its feedback is on hold: `theirs` is null
 *   (shown to nobody but its writer) until the appeal's result decides; `mine` stays the writer's.
 * - `POST /v1/trades/:code/review` (participant) body `ReviewInput` → 201 with no body.
 * - `POST /v1/trades/:code/review/skip` (participant) → 204 with no body: this side is done with
 *   the trade (gate, pending list) and leaves no review.
 *   Both POSTs refuse 409 `not-reviewable`, 409 `review-exists` (this side already reviewed OR
 *   skipped); the review also 400 with the @x2f/reputation `ReviewError` code.
 *
 * - `POST /v1/reviews/:id/dispute` (Task 19) body `{ reason }` (1 to 1000 characters, required; no
 *   reason list for now, Revision 2026-10-29b) → 201 with no body. Only the review's subject; anyone
 *   else, and an unknown id, get the same 404. 409 `not-disputable` (removed, or on hold by an appeal),
 *   409 `review-disputed` (already disputed: one dispute per review, lead default). The review shows
 *   "Under review" at once. Logged as `review.disputed` with the dispute id only, never the reason.
 *
 * The reviewer's side and the subject come from the trade row and the session, never the body. A
 * review stores no amount and no weight (owner 2026-11-01), and no answer carries an amount, a
 * reviewer, an account id or an exact time. An unknown code and someone else's trade get the same 404.
 */

const trader = requireSession({ kinds: ['trader'] });

// Every ReviewError code is an API error code (compile-time check).
const asApiCode = (c: ReviewErrorCode): ApiErrorCode => c;

function codeOf(req: FastifyRequest): string {
  const raw = (req.params as { code?: unknown }).code;
  const code = typeof raw === 'string' ? normalizeTradeCode(raw) : null;
  if (code === null) throw new ApiError(404, 'not-found');
  return code;
}

function sideOf(row: TradeRow, accountId: string): Side | null {
  if (row.buyer_account_id === accountId) return 'buyer';
  if (row.seller_account_id === accountId) return 'seller';
  return null;
}

const other = (s: Side): Side => (s === 'buyer' ? 'seller' : 'buyer');

async function inTransaction<T>(db: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('begin');
    try {
      const out = await fn(client);
      await client.query('commit');
      return out;
    } catch (e) {
      await client.query('rollback');
      throw e;
    }
  } finally {
    client.release();
  }
}

export interface TradeReviewView {
  reviewable: boolean;
  mine: PublicReview | null;
  theirs: PublicReview | null;
  /** The caller skipped reviewing this trade. */
  skipped: boolean;
  /** R-011: the trade's feedback is on hold while an appeal is pending (`theirs` is withheld). */
  held: boolean;
}

/**
 * The checks both POSTs share, in a transaction with the trade row locked (so a dispute opened
 * meanwhile, which locks it too, is seen or waits, and a review and a skip of one side serialize).
 */
async function reviewableSide(c: pg.PoolClient, code: string, me: string): Promise<{ row: TradeRow; side: Side }> {
  const row = await loadTradeRow(c, code, true);
  const side = row === null ? null : sideOf(row, me);
  if (row === null || side === null) throw new ApiError(404, 'not-found');
  if ((await reviewableSince(c, code)) === null) throw new ApiError(409, 'not-reviewable');
  if ((await reviewsOfTrade(c, code))[side] !== null || (await hasSkipped(c, code, side))) throw new ApiError(409, 'review-exists');
  return { row, side };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The dispute body: `{ reason }`, a non-blank string of at most DISPUTE_REASON_MAX characters, nothing else. */
function disputeReason(body: unknown): string {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'bad-request');
  const { reason, ...rest } = body as Record<string, unknown>;
  if (Object.keys(rest).length > 0 || typeof reason !== 'string') throw new ApiError(400, 'bad-request');
  const text = reason.trim();
  if (text.length === 0 || [...text].length > DISPUTE_REASON_MAX) throw new ApiError(400, 'bad-request', { field: 'reason' });
  return text;
}

export function reviewRoutes(app: FastifyInstance): void {
  app.post('/v1/reviews/:id/dispute', { preHandler: trader }, async (req, reply) => {
    const deps = req.server.deps;
    const raw = (req.params as { id?: unknown }).id;
    const id = typeof raw === 'string' ? raw.toLowerCase() : '';
    if (!UUID.test(id)) throw new ApiError(404, 'not-found');
    const reason = disputeReason(req.body);
    const now = deps.clock();
    await inTransaction(deps.db, async (c) => {
      const r = await openReviewDispute(c, id, req.auth.accountId, reason, now);
      if (r === 'not-found') throw new ApiError(404, 'not-found');
      if (r === 'not-disputable') throw new ApiError(409, 'not-disputable');
      if (r === 'disputed') throw new ApiError(409, 'review-disputed');
      const { rows } = await c.query<{ id: string; side: Side }>(
        `select d.id, case r.reviewer_role when 'buyer' then 'seller' else 'buyer' end as side
           from review_disputes d join reviews r on r.id = d.review_id where d.review_id = $1`,
        [id],
      );
      // The trade code is not logged: the log must not tie a permanent review to its trade.
      await appendLog(c, { at: now, actor: { kind: 'trader', side: rows[0]!.side }, tradeCode: null, action: 'review.disputed', detail: { disputeId: rows[0]!.id } });
    });
    return reply.code(201).send();
  });

  app.get('/v1/reviews/pending', { preHandler: trader }, async (req) => {
    const deps = req.server.deps;
    const list = await pendingReviews(deps.db, req.auth.accountId, deps.clock());
    return { trades: list.map((p) => ({ code: p.code, counterparty: p.counterparty, reviewableSince: p.reviewableSince.toISOString() })) };
  });

  app.get('/v1/trades/:code/review', { preHandler: trader }, async (req): Promise<TradeReviewView> => {
    const deps = req.server.deps;
    const code = codeOf(req);
    const row = await loadTradeRow(deps.db, code);
    const side = row === null ? null : sideOf(row, req.auth.accountId);
    if (row === null || side === null) throw new ApiError(404, 'not-found');
    const since = await reviewableSince(deps.db, code);
    const reviews = await reviewsOfTrade(deps.db, code);
    const skipped = await hasSkipped(deps.db, code, side);
    const held = await reviewsHeld(deps.db, code);
    const mine = reviews[side];
    const theirs = held ? null : reviews[other(side)];
    // Task 19: a review a moderator removed shows to nobody, its writer included (it still means
    // this side has reviewed: `reviewable` stays false).
    const shown = (r: ReviewRow | null) => (r === null || r.removed ? null : toPublicReview(r));
    return {
      reviewable: since !== null && mine === null && !skipped,
      mine: shown(mine),
      theirs: shown(theirs),
      skipped,
      held,
    };
  });

  app.post('/v1/trades/:code/review', { preHandler: trader }, async (req, reply) => {
    const deps = req.server.deps;
    const code = codeOf(req);
    const me = req.auth.accountId;
    await inTransaction(deps.db, async (c) => {
      const { row, side } = await reviewableSide(c, code, me);
      const rated = other(side);
      let input;
      try {
        input = validateReview(req.body, rated, hasPersonalDetails);
      } catch (e) {
        if (e instanceof ReviewError) throw new ApiError(400, asApiCode(e.code));
        throw e;
      }
      try {
        await insertReview(c, {
          tradeCode: code,
          reviewerId: me,
          subjectId: rated === 'buyer' ? row.buyer_account_id : row.seller_account_id,
          reviewerRole: side,
          input,
          methodId: row.method_id,
          createdAt: deps.clock(),
        });
      } catch (e) {
        // The unique (trade_code, reviewer_role) backstop of a double submit.
        if ((e as { code?: unknown } | null)?.code === '23505') throw new ApiError(409, 'review-exists');
        throw e;
      }
    });
    return reply.code(201).send();
  });

  app.post('/v1/trades/:code/review/skip', { preHandler: trader }, async (req, reply) => {
    const deps = req.server.deps;
    const code = codeOf(req);
    const me = req.auth.accountId;
    await inTransaction(deps.db, async (c) => {
      const { side } = await reviewableSide(c, code, me);
      try {
        await insertSkip(c, code, side);
      } catch (e) {
        // The primary key (trade_code, side) backstop of a double tap.
        if ((e as { code?: unknown } | null)?.code === '23505') throw new ApiError(409, 'review-exists');
        throw e;
      }
    });
    return reply.code(204).send();
  });
}
