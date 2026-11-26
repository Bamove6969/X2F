import type { FastifyInstance } from 'fastify';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { tradeSelfDestruct } from '../retention/tradePurge.js';
import { requireStaff } from './guard.js';

/**
 * Owner 26 Nov 2026: the owner's audit of every trade not deleted yet, by status
 * (`GET /staff/v1/trades/status`, log.read.all: the owner only). A trade's status, first that fits:
 * - `lien`: a lien from its disputes is unpaid (active, or suspended during an appeal); it has no
 *   delete date until the lien ends;
 * - `uncollectible`: a lien from it was written off by the owner (and none is unpaid);
 * - `disputed`: a dispute or appeal is open;
 * - `open`: not closed yet;
 * - `completed`: released to the buyer;
 * - `closed`: ended another way (refunded, cancelled, lapsed).
 * Each row has the trade's code, state, when it was taken and closed, its XMR amount, its delete
 * date (null while it has none) and its liens. Trade codes and amounts only: no trader name.
 */

export const TRADE_STATUSES = ['lien', 'uncollectible', 'disputed', 'open', 'completed', 'closed'] as const;
export type TradeAuditStatus = (typeof TRADE_STATUSES)[number];
const PAGE = 50;

const STATUS_SQL = `case
    when exists (select 1 from liens l where l.from_code = t.code and l.status in ('active', 'suspended')) then 'lien'
    when t.state = 'disputed' or exists (select 1 from disputes d where d.code = t.code and d.status <> 'closed') then 'disputed'
    when exists (select 1 from liens l where l.from_code = t.code and l.status = 'uncollectible') then 'uncollectible'
    when t.closed_at is null then 'open'
    when t.state = 'released' then 'completed'
    else 'closed'
  end`;

export async function tradeStatusPage(q: Queryable, a: { status: TradeAuditStatus | null; before: { at: Date; code: string } | null }) {
  const counts = await q.query<{ status: TradeAuditStatus; n: number }>(
    `select s.status, count(*)::int as n from (select ${STATUS_SQL} as status from trades t) s group by s.status`,
  );
  const { rows } = await q.query<{ code: string; state: string; status: TradeAuditStatus; taken_at: Date; closed_at: Date | null; amount_atomic: string }>(
    `select * from (
       select t.code, t.state, ${STATUS_SQL} as status, t.taken_at, t.closed_at, t.amount_atomic::text
         from trades t
     ) x
     where ($1::text is null or x.status = $1)
       and ($2::timestamptz is null or (x.taken_at, x.code) < ($2::timestamptz, $3::text))
     order by x.taken_at desc, x.code desc limit ${PAGE + 1}`,
    [a.status, a.before?.at ?? null, a.before?.code ?? null],
  );
  const more = rows.length > PAGE;
  const page = rows.slice(0, PAGE);
  const liens = page.length === 0 ? [] : (await q.query<{ id: string; from_code: string; status: string; amount_atomic: string; recovered: string; lifted_at: Date | null }>(
    `select l.id::text, l.from_code, l.status, l.amount_atomic::text,
            (select coalesce(sum(r.amount_atomic), 0) from lien_recoveries r where r.lien_id = l.id)::text as recovered, l.lifted_at
       from liens l where l.from_code = any($1::text[]) order by l.created_at, l.id`,
    [page.map((r) => r.code)],
  )).rows;
  const trades = [];
  for (const r of page) {
    const { deleteAt } = await tradeSelfDestruct(q, r.code);
    trades.push({
      code: r.code, state: r.state, status: r.status, takenAt: r.taken_at.toISOString(), closedAt: r.closed_at?.toISOString() ?? null,
      amountAtomic: r.amount_atomic, deleteAt: deleteAt?.toISOString() ?? null,
      liens: liens.filter((l) => l.from_code === r.code).map((l) => ({
        id: l.id, status: l.status, amountAtomic: l.amount_atomic, recoveredAtomic: l.recovered, endedAt: l.lifted_at?.toISOString() ?? null,
      })),
    });
  }
  const last = page[page.length - 1];
  return {
    counts: Object.fromEntries(TRADE_STATUSES.map((s) => [s, counts.rows.find((c) => c.status === s)?.n ?? 0])) as Record<TradeAuditStatus, number>,
    trades,
    next: more && last ? `${last.taken_at.toISOString()}~${last.code}` : null,
  };
}

export function staffTradeStatusRoutes(app: FastifyInstance): void {
  const opts = { preHandler: requireStaff('log.read.all'), config: { perm: 'log.read.all' as const } };
  app.get('/staff/v1/trades/status', opts, async (req) => {
    const qs = req.query as Record<string, unknown>;
    if (Object.keys(qs).some((k) => k !== 'status' && k !== 'before')) throw new ApiError(400, 'bad-request');
    const status = qs.status === undefined || qs.status === '' ? null : qs.status;
    if (status !== null && !(TRADE_STATUSES as readonly unknown[]).includes(status)) throw new ApiError(400, 'bad-request', { field: 'status' });
    let before: { at: Date; code: string } | null = null;
    if (qs.before !== undefined) {
      const m = typeof qs.before === 'string' ? /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)~([A-Z0-9-]{1,40})$/.exec(qs.before) : null;
      if (!m || !Number.isFinite(Date.parse(m[1]!))) throw new ApiError(400, 'bad-request', { field: 'before' });
      before = { at: new Date(m[1]!), code: m[2]! };
    }
    return tradeStatusPage(req.server.deps.db, { status: status as TradeAuditStatus | null, before });
  });
}
