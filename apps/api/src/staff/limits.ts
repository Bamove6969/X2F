import { LIMIT_STAGES, type KeyTapIntent, type LimitStage } from '@x2f/staff';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type pg from 'pg';
import { withTx } from '../auth/hold.js';
import { loadDispute } from '../disputes/store.js';
import { actorOf, body, codeOf, mayWork } from '../disputes/staffRoutes.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import { tradeCap, type Stage } from '../traders/stage.js';
import { consumeKeyTap } from './keyTap.js';
import { requireStaff } from './guard.js';

/**
 * Plan 4 Task 26 (Revision 2026-10-29, owner): recommended account limits, replacing the automatic
 * stage drop. A moderator recommends limits for a habitual offender or an obvious hit-and-run case;
 * a senior moderator or the owner, never the one who recommended them, decides with a security-key
 * tap. An approved limit is an `account_limits` row (migration 760) that `tradeCap` reads: the lower
 * of the stage's cap and the limit's, or the account held to a stage. The reason is staff-only: it
 * is never sent to the trader and never written to the activity log (which holds ids only).
 *
 * - `POST /staff/v1/accounts/:id/limit-recommendations { capUsd | stage, reason }` (perm
 *   `disputes.handle`) → 201 `{ id }`. `capUsd` a whole number of US dollars (1 to 1,000,000);
 *   `stage` 'starter' or 'building'; exactly one. `reason` at least 40 characters once trimmed (400
 *   `reason-too-short`), at most 2000. 404 for anything but a trader account; 409 `wrong-state` while
 *   another recommendation for the account waits (one at a time, lead default).
 * - `POST /staff/v1/disputes/:code/limit-recommendations { side, capUsd | stage, reason }` (perm
 *   `disputes.handle`): the same from a case (ModCase "Recommend limits"), naming the buyer or the
 *   seller, so a moderator never needs an account id. Whoever may work the case (its assignee, a
 *   senior moderator or the owner; never someone involved in round 1 of an appeal) → else 403
 *   `forbidden-case`. The log entry is on the case.
 * - `GET /staff/v1/limit-recommendations` (perm `rulings.approve`) → the waiting ones, oldest first,
 *   with the reason, for the decider.
 * - `POST /staff/v1/accounts/:id/limit-recommendations/:recId/decide { approve, tapId }` (perm
 *   `rulings.approve`) → 200 `{ status: 'approved' | 'declined' }`. The tap is an `account-limit`
 *   intent naming the recommendation, the account, the decision and what it sets. 409 `same-person`
 *   for the recommender; 409 `wrong-state` once decided; 404 for a recommendation of another account.
 *
 * Lead defaults, owner questions: an approved limit has no end time and no route lifts it yet; a
 * stage limit is shown to the account itself (its own stage) but never to anyone else.
 */

export const LIMIT_REASON_MIN = 40;
export const LIMIT_REASON_MAX = 2000;
export const LIMIT_CAP_USD_MAX = 1_000_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Limit {
  capUsd: number | null;
  stage: LimitStage | null;
}

function idParam(req: FastifyRequest, name: 'id' | 'recId'): string {
  const v = (req.params as Record<string, unknown>)[name];
  if (typeof v !== 'string' || !UUID.test(v)) throw new ApiError(404, 'not-found');
  return v.toLowerCase();
}

/** A recommendation's limit and reason from the body (`extra` keys allowed besides). */
function parseLimit(b: Record<string, unknown>): Limit & { reason: string } {
  const hasCap = Object.hasOwn(b, 'capUsd');
  const hasStage = Object.hasOwn(b, 'stage');
  if (hasCap === hasStage) throw new ApiError(400, 'bad-request');
  let capUsd: number | null = null;
  let stage: LimitStage | null = null;
  if (hasCap) {
    const c = b.capUsd;
    if (typeof c !== 'number' || !Number.isInteger(c) || c < 1 || c > LIMIT_CAP_USD_MAX) throw new ApiError(400, 'bad-request');
    capUsd = c;
  } else {
    if (!(LIMIT_STAGES as readonly unknown[]).includes(b.stage)) throw new ApiError(400, 'bad-request');
    stage = b.stage as LimitStage;
  }
  const reason = b.reason;
  if (typeof reason !== 'string' || reason.length > LIMIT_REASON_MAX) throw new ApiError(400, 'bad-request');
  if (reason.trim().length < LIMIT_REASON_MIN) throw new ApiError(400, 'reason-too-short');
  return { capUsd, stage, reason };
}

/** The log detail of a limit: the one of cap or stage it sets. */
const limitDetail = (l: Limit): { capUsd: number } | { stage: LimitStage } => (l.capUsd !== null ? { capUsd: l.capUsd } : { stage: l.stage! });

async function recommend(
  req: FastifyRequest,
  accountId: string,
  l: Limit & { reason: string },
  code: string | null,
): Promise<{ id: string }> {
  const { db, clock } = req.server.deps;
  const now = clock();
  const me = actorOf(req);
  return withTx(db, async (c: pg.PoolClient) => {
    const acct = await c.query<{ kind: string }>('select kind from accounts where id = $1 for update', [accountId]);
    if (acct.rows[0]?.kind !== 'trader') throw new ApiError(404, 'not-found');
    const pending = await c.query('select 1 from limit_recommendations where account_id = $1 and status = $2', [accountId, 'pending']);
    if (pending.rows.length > 0) throw new ApiError(409, 'wrong-state');
    const { rows } = await c.query<{ id: string }>(
      `insert into limit_recommendations (account_id, cap_usd, stage, reason, from_code, recommended_by, created_at)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [accountId, l.capUsd, l.stage, l.reason, code, me.id, now],
    );
    const id = rows[0]!.id;
    await appendLog(c, { at: now, actor: me, tradeCode: code, action: 'limits.recommended', detail: { recId: id, accountId, ...limitDetail(l) } });
    return { id };
  });
}

export function staffLimitRoutes(app: FastifyInstance): void {
  const handle = { config: { perm: 'disputes.handle' as const }, preHandler: requireStaff('disputes.handle') };
  const approve = { config: { perm: 'rulings.approve' as const }, preHandler: requireStaff('rulings.approve') };

  app.post('/staff/v1/accounts/:id/limit-recommendations', handle, async (req, reply) => {
    const accountId = idParam(req, 'id');
    const l = parseLimit(body(req, ['capUsd', 'stage', 'reason'], ['reason']));
    return reply.code(201).send(await recommend(req, accountId, l, null));
  });

  app.post('/staff/v1/disputes/:code/limit-recommendations', handle, async (req, reply) => {
    const b = body(req, ['side', 'capUsd', 'stage', 'reason'], ['side', 'reason']);
    if (b.side !== 'buyer' && b.side !== 'seller') throw new ApiError(400, 'bad-request');
    const l = parseLimit(b);
    const { db } = req.server.deps;
    const code = await codeOf(db, req);
    const d = await loadDispute(db, code);
    if (d === null) throw new ApiError(404, 'not-found');
    if (!mayWork(d, req)) throw new ApiError(403, 'forbidden-case');
    const t = await db.query<{ buyer: string; seller: string }>(
      'select buyer_account_id as buyer, seller_account_id as seller from trades where code = $1',
      [code],
    );
    if (!t.rows[0]) throw new ApiError(404, 'not-found');
    const accountId = b.side === 'buyer' ? t.rows[0].buyer : t.rows[0].seller;
    return reply.code(201).send(await recommend(req, accountId, l, code));
  });

  app.get('/staff/v1/limit-recommendations', approve, async (req) => {
    const { db, clock } = req.server.deps;
    const now = clock();
    const { rows } = await db.query<{
      id: string; account_id: string; display_name: string; cap_usd: number | null; stage: LimitStage | null; reason: string;
      from_code: string | null; recommended_by: string; by_name: string; created_at: Date;
    }>(
      `select r.id, r.account_id, a.display_name, r.cap_usd, r.stage, r.reason, r.from_code, r.recommended_by, s.display_name as by_name, r.created_at
         from limit_recommendations r
         join accounts a on a.id = r.account_id
         join accounts s on s.id = r.recommended_by
        where r.status = 'pending'
        order by r.created_at, r.id
        limit 200`,
    );
    const recommendations = [];
    for (const r of rows) {
      const cap = await tradeCap(db, r.account_id, now);
      recommendations.push({
        id: r.id,
        accountId: r.account_id,
        displayName: r.display_name,
        capUsd: r.cap_usd,
        stage: r.stage,
        reason: r.reason,
        code: r.from_code,
        recommendedBy: r.by_name,
        // The decider's own recommendation shows, so the screen offers no decision on it.
        mine: r.recommended_by === req.staff.accountId,
        createdAt: r.created_at.toISOString(),
        currentStage: cap.stage satisfies Stage,
        currentCapUsdCents: cap.capUsdCents === null ? null : cap.capUsdCents.toString(),
      });
    }
    return { recommendations };
  });

  app.post('/staff/v1/accounts/:id/limit-recommendations/:recId/decide', approve, async (req) => {
    const accountId = idParam(req, 'id');
    const recId = idParam(req, 'recId');
    const b = body(req, ['approve', 'tapId']);
    if (typeof b.approve !== 'boolean' || typeof b.tapId !== 'string') throw new ApiError(400, 'bad-request');
    const approved = b.approve;
    const tapId = b.tapId;
    const { db, clock } = req.server.deps;
    const now = clock();
    const me = actorOf(req);
    return withTx(db, async (c: pg.PoolClient) => {
      const { rows } = await c.query<{ account_id: string; cap_usd: number | null; stage: LimitStage | null; from_code: string | null; recommended_by: string; status: string }>(
        'select account_id, cap_usd, stage, from_code, recommended_by, status from limit_recommendations where id = $1 for update',
        [recId],
      );
      const r = rows[0];
      if (!r || r.account_id !== accountId) throw new ApiError(404, 'not-found');
      if (r.status !== 'pending') throw new ApiError(409, 'wrong-state');
      if (r.recommended_by === me.id) throw new ApiError(409, 'same-person');
      const intent: KeyTapIntent = { kind: 'account-limit', recId, accountId, approve: approved, capUsd: r.cap_usd, stage: r.stage };
      await consumeKeyTap(c, tapId, me.id, intent, now, { sessionId: req.auth.sessionId });
      await c.query('update limit_recommendations set status = $2, decided_by = $3, decided_at = $4 where id = $1', [recId, approved ? 'approved' : 'declined', me.id, now]);
      if (approved) {
        await c.query(
          `insert into account_limits (account_id, cap_usd, stage, until, set_by, recommendation_id, created_at)
           values ($1, $2, $3, null, $4, $5, $6)`,
          [accountId, r.cap_usd, r.stage, me.id, recId, now],
        );
      }
      await appendLog(c, { at: now, actor: me, tradeCode: r.from_code, action: 'limits.decided', detail: { recId, approved } });
      return { status: approved ? ('approved' as const) : ('declined' as const) };
    });
  });
}
