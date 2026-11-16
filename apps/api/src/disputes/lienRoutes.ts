import { canDecideRateRequest, rateRequestRefusal } from '@x2f/staff';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withTx } from '../auth/hold.js';
import { requireSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import { appendLog } from '../log/append.js';
import { consumeKeyTap } from '../staff/keyTap.js';
import { requireStaff } from '../staff/guard.js';
import { LIEN_FIGURES_SQL, lienFigures, type LienFiguresRow } from './recovery.js';
import { actorOf, body as bodyOf } from './staffRoutes.js';

/**
 * Lien recovery routes (owner rules 16 Nov 2026; docs/lien-recovery.md).
 *
 * Staff:
 * - `GET /staff/v1/liens/:id` (`disputes.handle`): the lien's figures, its recoveries and rate requests.
 * - `POST /staff/v1/liens/:id/rate { rateBps, reason }` (`disputes.handle`): a moderator proposes a
 *   new rate; a reason is always required (owner: "if they change it at all"). Pending until decided;
 *   the current rate (default 50%) applies meanwhile. One pending request per lien (409 `request-pending`).
 * - `POST /staff/v1/liens/:id/rate/:req/approve { tapId }` (`rulings.approve`): a senior moderator or
 *   the owner, never the proposer (403 `forbidden`), with a `lien-rate` key tap bound to the request
 *   and rate; sets the lien's rate.
 * - `POST /staff/v1/liens/:id/rate/:req/reject {}` (`rulings.approve`): never the proposer.
 * Each is logged (`lien.rate-*`); the reason stays in `lien_rate_requests`, never in the log.
 * NEEDS_STAFF_WEB_LIEN_RATE: the staff site's screen (and its KeyTapDialog caller) is not built.
 *
 * Trader:
 * - `GET /v1/account/liens`: what this account owes (owed, recovered, remaining, current rate) and
 *   the recoveries arriving on liens owed to it. No account ids, no addresses.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function param(req: FastifyRequest, key: string): string {
  const v = (req.params as Record<string, unknown>)[key];
  if (typeof v !== 'string' || !UUID.test(v.toLowerCase())) throw new ApiError(404, 'not-found');
  return v.toLowerCase();
}

interface RequestRow {
  id: string;
  proposed_bps: number;
  reason: string;
  proposed_by: string;
  proposed_at: Date;
  status: 'pending' | 'approved' | 'rejected';
  decided_by: string | null;
  decided_at: Date | null;
}

export function lienRoutes(app: FastifyInstance): void {
  const handle = { preHandler: requireStaff('disputes.handle'), config: { perm: 'disputes.handle' as const } };
  const approver = { preHandler: requireStaff('rulings.approve'), config: { perm: 'rulings.approve' as const } };

  app.get('/staff/v1/liens/:id', handle, async (req) => {
    const db = req.server.deps.db;
    const id = param(req, 'id');
    const row = (await db.query<LienFiguresRow>(`${LIEN_FIGURES_SQL} where l.id = $1`, [id])).rows[0];
    if (!row) throw new ApiError(404, 'not-found');
    const recoveries = await db.query<{ trade_code: string; amount_atomic: string; at: Date }>(
      'select trade_code, amount_atomic::text, at from lien_recoveries where lien_id = $1 order by at, id',
      [id],
    );
    const requests = await db.query<RequestRow>(
      `select id::text, proposed_bps, reason, proposed_by::text, proposed_at, status, decided_by::text, decided_at
         from lien_rate_requests where lien_id = $1 order by proposed_at, id`,
      [id],
    );
    return {
      lien: lienFigures(row),
      recoveries: recoveries.rows.map((r) => ({ tradeCode: r.trade_code, amountAtomic: r.amount_atomic, at: r.at.toISOString() })),
      rateRequests: requests.rows.map((r) => ({
        id: r.id, rateBps: r.proposed_bps, reason: r.reason, proposedBy: r.proposed_by, proposedAt: r.proposed_at.toISOString(),
        status: r.status, decidedBy: r.decided_by, decidedAt: r.decided_at?.toISOString() ?? null,
      })),
    };
  });

  app.post('/staff/v1/liens/:id/rate', handle, async (req, reply) => {
    const b = bodyOf(req, ['rateBps', 'reason']);
    const refusal = rateRequestRefusal({ rateBps: b.rateBps, reason: b.reason });
    if (refusal !== null) throw new ApiError(400, 'bad-request', { field: refusal === 'bad-rate' ? 'rateBps' : 'reason' });
    const id = param(req, 'id');
    const me = actorOf(req);
    const { db, clock } = req.server.deps;
    const requestId = await withTx(db, async (c) => {
      const now = clock();
      const lien = (await c.query<{ status: string }>('select status from liens where id = $1 for update', [id])).rows[0];
      if (!lien) throw new ApiError(404, 'not-found');
      if (lien.status !== 'active' && lien.status !== 'suspended') throw new ApiError(409, 'wrong-state');
      const pending = await c.query(`select 1 from lien_rate_requests where lien_id = $1 and status = 'pending'`, [id]);
      if ((pending.rowCount ?? 0) > 0) throw new ApiError(409, 'request-pending');
      const r = await c.query<{ id: string }>(
        `insert into lien_rate_requests (lien_id, proposed_bps, reason, proposed_by, proposed_at) values ($1, $2, $3, $4, $5) returning id::text`,
        [id, b.rateBps, b.reason, me.id, now],
      );
      const requestId = r.rows[0]!.id;
      await appendLog(c, { at: now, actor: me, tradeCode: null, action: 'lien.rate-proposed', detail: { lienId: id, requestId, rateBps: b.rateBps as number } });
      return requestId;
    });
    return reply.code(201).send({ id: requestId, status: 'pending' });
  });

  /** The pending request `:req` of lien `:id`, locked, with the lien locked first; refuses its proposer. */
  async function pendingFor(c: import('pg').PoolClient, req: FastifyRequest): Promise<{ lienId: string; r: RequestRow }> {
    const lienId = param(req, 'id');
    const requestId = param(req, 'req');
    const lien = (await c.query<{ status: string }>('select status from liens where id = $1 for update', [lienId])).rows[0];
    if (!lien) throw new ApiError(404, 'not-found');
    const r = (
      await c.query<RequestRow>(
        `select id::text, proposed_bps, reason, proposed_by::text, proposed_at, status, decided_by::text, decided_at
           from lien_rate_requests where id = $1 and lien_id = $2 for update`,
        [requestId, lienId],
      )
    ).rows[0];
    if (!r) throw new ApiError(404, 'not-found');
    if (r.status !== 'pending') throw new ApiError(409, 'wrong-state');
    if (!canDecideRateRequest({ role: req.staff.role, id: req.staff.accountId }, r.proposed_by)) throw new ApiError(403, 'forbidden');
    return { lienId, r };
  }

  app.post('/staff/v1/liens/:id/rate/:req/approve', approver, async (req) => {
    const b = bodyOf(req, ['tapId']);
    if (typeof b.tapId !== 'string') throw new ApiError(400, 'bad-request');
    const tapId = b.tapId;
    const me = actorOf(req);
    const { db, clock } = req.server.deps;
    return withTx(db, async (c) => {
      const now = clock();
      const { lienId, r } = await pendingFor(c, req);
      const lien = (await c.query<{ status: string }>('select status from liens where id = $1', [lienId])).rows[0]!;
      if (lien.status !== 'active' && lien.status !== 'suspended') throw new ApiError(409, 'wrong-state');
      await consumeKeyTap(c, tapId, me.id, { kind: 'lien-rate', lienId, requestId: r.id, rateBps: r.proposed_bps }, now, { sessionId: req.auth.sessionId });
      await c.query(`update lien_rate_requests set status = 'approved', decided_by = $2, decided_at = $3 where id = $1`, [r.id, me.id, now]);
      await c.query('update liens set recovery_rate_bps = $2 where id = $1', [lienId, r.proposed_bps]);
      await appendLog(c, { at: now, actor: me, tradeCode: null, action: 'lien.rate-approved', detail: { lienId, requestId: r.id, rateBps: r.proposed_bps } });
      return { id: r.id, status: 'approved', rateBps: r.proposed_bps };
    });
  });

  app.post('/staff/v1/liens/:id/rate/:req/reject', approver, async (req) => {
    bodyOf(req, []);
    const me = actorOf(req);
    const { db, clock } = req.server.deps;
    return withTx(db, async (c) => {
      const now = clock();
      const { lienId, r } = await pendingFor(c, req);
      await c.query(`update lien_rate_requests set status = 'rejected', decided_by = $2, decided_at = $3 where id = $1`, [r.id, me.id, now]);
      await appendLog(c, { at: now, actor: me, tradeCode: null, action: 'lien.rate-rejected', detail: { lienId, requestId: r.id } });
      return { id: r.id, status: 'rejected' };
    });
  });
}

/** `GET /v1/account/liens`: the trader's own liens, both ways (rules 1-3: what is owed, recovered, left, and the rate). */
export function accountLienRoutes(app: FastifyInstance): void {
  app.get('/v1/account/liens', { preHandler: requireSession({ kinds: ['trader'] }) }, async (req) => {
    const db = req.server.deps.db;
    const me = req.auth.accountId;
    const rows = (
      await db.query<LienFiguresRow>(
        `${LIEN_FIGURES_SQL} where (l.debtor_account_id = $1 or l.creditor_account_id = $1) and l.status in ('active', 'suspended', 'repaid')
          order by l.created_at, l.id`,
        [me],
      )
    ).rows;
    const strip = (r: LienFiguresRow) => {
      const { debtorId: _d, creditorId: _c, ...f } = lienFigures(r);
      return f;
    };
    const owedTo = [];
    for (const r of rows.filter((x) => x.creditor === me)) {
      const rec = await db.query<{ amount_atomic: string; at: Date }>('select amount_atomic::text, at from lien_recoveries where lien_id = $1 order by at, id', [r.id]);
      owedTo.push({ ...strip(r), recoveries: rec.rows.map((x) => ({ amountAtomic: x.amount_atomic, at: x.at.toISOString() })) });
    }
    return { owes: rows.filter((x) => x.debtor === me && x.status !== 'repaid').map(strip), owedTo };
  });
}
