import { normalizeTradeCode } from '@x2f/core';
import { ReviewError, assertLateReviewAllowed, reviewWeight, validateReview, type ReviewErrorCode, type Side } from '@x2f/reputation';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { requireSession } from '../auth/sessions.js';
import { ApiError, type ApiErrorCode } from '../errors.js';
import { loadTradeRow, type TradeRow } from '../trades/store.js';
import { lateReviewMode, pendingReviews } from './gate.js';
import { hasPersonalDetails } from './sensitive.js';
import { insertReview, reviewableSince, reviewsOfTrade, revealFacts, toPublicReview, type PublicReview } from './store.js';

/**
 * Plan 5 Task 3: reviews with blind reveal (spec 5.1, 5.3).
 *
 * - `GET /v1/reviews/pending` (trader) → `{ trades: { code, counterparty, reviewableSince }[] }`: the
 *   trades this trader must rate before their next trade (the gate, gate.ts). `counterparty` is the
 *   other trader's public display name.
 * - `GET /v1/trades/:code/review` (participant) → `{ reviewable, mine, theirs, revealAt }`: `theirs`
 *   only once revealed (both rated, or 7 days after the trade became reviewable); `revealAt` is null
 *   while the trade is not reviewable and has no review.
 * - `POST /v1/trades/:code/review` (participant) body `ReviewInput` → 201 with no body. Refusals:
 *   409 `not-reviewable`, 409 `review-exists`, 400 with the @x2f/reputation `ReviewError` code
 *   (including P5-A31's `late-review-neutral-only` / `late-review-closed`).
 *
 * The reviewer's side and the subject come from the trade row and the session, never the body. A
 * review stores only its weight (`reviewWeight` of the trade's take-time `usd_cents`), and no
 * answer carries an amount, a weight, a reviewer, an account id or an exact time. An unknown code
 * and someone else's trade get the same 404.
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
  revealAt: string | null;
}

export function reviewRoutes(app: FastifyInstance): void {
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
    const now = deps.clock();
    const since = await reviewableSince(deps.db, code);
    const reviews = await reviewsOfTrade(deps.db, code);
    const reveal = revealFacts(since, reviews);
    const mine = reviews[side];
    const theirs = reviews[other(side)];
    const lateClosed = lateReviewMode() === 'closed' && theirs !== null && reveal !== null && reveal.revealed(now);
    return {
      reviewable: since !== null && mine === null && !lateClosed,
      mine: mine === null ? null : toPublicReview(mine),
      theirs: theirs !== null && reveal !== null && reveal.revealed(now) ? toPublicReview(theirs) : null,
      revealAt: reveal === null ? null : reveal.revealAt.toISOString(),
    };
  });

  app.post('/v1/trades/:code/review', { preHandler: trader }, async (req, reply) => {
    const deps = req.server.deps;
    const code = codeOf(req);
    const me = req.auth.accountId;
    await inTransaction(deps.db, async (c) => {
      // The trade row locked, so a dispute opened meanwhile (which locks it too) is seen or waits.
      const row = await loadTradeRow(c, code, true);
      const side = row === null ? null : sideOf(row, me);
      if (row === null || side === null) throw new ApiError(404, 'not-found');
      const since = await reviewableSince(c, code);
      if (since === null) throw new ApiError(409, 'not-reviewable');
      const reviews = await reviewsOfTrade(c, code);
      if (reviews[side] !== null) throw new ApiError(409, 'review-exists');
      const rated = other(side);
      const now = deps.clock();
      let input;
      try {
        input = validateReview(req.body, rated, hasPersonalDetails);
        // P5-A31: late = the other side's review was already revealed to this reviewer.
        const reveal = revealFacts(since, reviews);
        const afterReveal = reviews[rated] !== null && reveal !== null && reveal.revealed(now);
        assertLateReviewAllowed(input, afterReveal, lateReviewMode());
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
          weight: reviewWeight(row.usd_cents === null ? null : BigInt(row.usd_cents)),
          methodId: row.method_id,
          reviewableSince: since,
          createdAt: now,
        });
      } catch (e) {
        // The unique (trade_code, reviewer_role) backstop of a double submit.
        if ((e as { code?: unknown } | null)?.code === '23505') throw new ApiError(409, 'review-exists');
        throw e;
      }
    });
    return reply.code(201).send();
  });
}
