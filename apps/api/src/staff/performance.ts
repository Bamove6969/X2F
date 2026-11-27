import {
  PERIODS,
  chartStart,
  personMetrics,
  periodStart,
  weekly,
  type CaseRow,
  type Period,
  type PersonMetrics,
  type RulingDraft,
  type StaffRole,
} from '@x2f/staff';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Queryable } from '../db/pool.js';
import { disputeSettings } from '../disputes/settings.js';
import { ApiError } from '../errors.js';
import { requireStaff } from './guard.js';
import { idParam } from './members.js';

/**
 * Plan 4 Task 20: moderator performance (spec 6.6, "owner only"; perm `perf.read`).
 *
 * - `GET /staff/v1/performance?period=30d|90d|all` (default 30d) → `{ period, firstResponseH,
 *   people: [{ id, name, role, ...PersonMetrics }] }`: every staff member who can handle disputes
 *   (senior moderators, moderators, the owner), in the board's order.
 * - `GET /staff/v1/performance/:id/weeks` → `{ id, name, role, firstResponseH, from, summary,
 *   weeks }`: the last 8 weeks (Monday UTC) for the Show chart panel, `summary` over those weeks.
 *   404 `not-found` for anyone who is not such a staff member.
 *
 * The figures come from data that already exists (no table of their own):
 * - `disputes` (opening, the current round's reply deadline and first reply, the machine's
 *   `ruling`/`round1` drafts, `published_at`, `overturned`, the assignee) and `dispute_appeals`
 *   (the appeal's time: round 2's start);
 * - `ruling_drafts` (the published proposal's proposer, proposal time and publication time);
 * - the activity log's `chat.message-sent` entries (who sent each round's first reply: the
 *   dispute row keeps only when).
 * Round 1 of an appealed dispute keeps its first reply in `round1` but not its reply deadline, so
 * that deadline is read as the opening plus the current first-response setting.
 *
 * Privacy: the answers hold staff names, roles and numbers only, never a trade code, a trader
 * or anything a trader wrote. The figures cover the disputes still kept (the dispute purge, R6,
 * deletes a dispute 90 days after it closes), so "All time" is the kept disputes' all time.
 */

interface Row {
  round: 1 | 2;
  status: string;
  opened_at: Date;
  reply_due_at: Date;
  first_reply_at: Date | null;
  assignee: string | null;
  ruling: Pick<RulingDraft, 'proposer'> | null;
  round1: (Pick<RulingDraft, 'proposer'> & { firstReplyAt: string | null }) | null;
  published_at: Date | null;
  overturned: boolean | null;
  appealed_at: Date | null;
  r1_proposer: string | null;
  r1_proposed_at: Date | null;
  r2_proposer: string | null;
  r2_proposed_at: Date | null;
  r2_decided_at: Date | null;
  r1_reply_by: string | null;
  r2_reply_by: string | null;
}

/** The earliest staff chat message on the trade from `start` up to the first reply (that is the first reply). */
const replyBy = (start: string, reply: string) => `(select l.actor_id::text from activity_log l
    where l.trade_code = d.code and l.action = 'chat.message-sent' and l.actor_kind = 'staff'
      and l.detail::jsonb->>'mode' is distinct from 'true'
      and l.at >= ${start} and l.at <= ${reply}
    order by l.at, l.id limit 1)`;

const draft = (round: 1 | 2) => `left join lateral (select x.proposer::text as proposer, x.proposed_at, x.decided_at from ruling_drafts x
    where x.code = d.code and x.seq = d.seq and x.round = ${round} and x.status = 'published'
    order by x.decided_at desc limit 1) r${round} on true`;

const R1_REPLY_AT = `case when d.round = 1 then d.first_reply_at else (d.round1 ->> 'firstReplyAt')::timestamptz end`;

const ROWS = `select d.round, d.status, d.opened_at, d.reply_due_at, d.first_reply_at, d.assignee::text as assignee, d.ruling, d.round1,
    d.published_at, d.overturned, a.at as appealed_at,
    r1.proposer as r1_proposer, r1.proposed_at as r1_proposed_at,
    r2.proposer as r2_proposer, r2.proposed_at as r2_proposed_at, r2.decided_at as r2_decided_at,
    ${replyBy('d.opened_at', R1_REPLY_AT)} as r1_reply_by,
    case when d.round = 2 then ${replyBy('a.at', 'd.first_reply_at')} end as r2_reply_by
  from disputes d
  left join dispute_appeals a on a.code = d.code and a.seq = d.seq
  ${draft(1)}
  ${draft(2)}`;

const ROUND1_DONE = new Set(['published', 'final', 'complying', 'closed']);
const ROUND2_DONE = new Set(['final', 'complying', 'closed']);
const OPEN_1 = new Set(['open', 'awaiting-approval']);
const OPEN_2 = new Set(['appealed', 'awaiting-approval']);
const H = 3_600_000;

/** Every dispute round as a `CaseRow` (two rows for an appealed dispute). */
export async function caseRows(db: Queryable, firstResponseH: number): Promise<CaseRow[]> {
  const { rows } = await db.query<Row>(ROWS);
  const out: CaseRow[] = [];
  for (const r of rows) {
    const appealed = r.round === 2;
    const r1Published = appealed || ROUND1_DONE.has(r.status);
    const r1ReplyAt = appealed ? (r.round1?.firstReplyAt ? new Date(r.round1.firstReplyAt) : null) : r.first_reply_at;
    const r1Proposer = r1Published ? (r.r1_proposer ?? (appealed ? r.round1?.proposer : r.ruling?.proposer) ?? null) : null;
    const r1RuledAt = r1Published ? r.published_at : null;
    out.push({
      round: 1,
      openedAt: r.opened_at,
      replyDueAt: appealed ? new Date(r.opened_at.getTime() + firstResponseH * H) : r.reply_due_at,
      firstReplyAt: r1ReplyAt,
      firstReplyBy: r1ReplyAt === null ? null : r.r1_reply_by,
      proposer: r1RuledAt === null ? null : r1Proposer,
      proposedAt: r1RuledAt === null ? null : (r.r1_proposed_at ?? r1RuledAt),
      ruledAt: r1RuledAt,
      overturned: r.overturned === true,
      assignee: appealed ? null : r.assignee,
      open: !appealed && OPEN_1.has(r.status),
    });
    if (!appealed || r.appealed_at === null) continue;
    const decided = ROUND2_DONE.has(r.status) && r.r2_decided_at !== null;
    out.push({
      round: 2,
      openedAt: r.appealed_at,
      replyDueAt: r.reply_due_at,
      firstReplyAt: r.first_reply_at,
      firstReplyBy: r.first_reply_at === null ? null : r.r2_reply_by,
      proposer: decided ? (r.r2_proposer ?? r.ruling?.proposer ?? null) : null,
      proposedAt: decided ? r.r2_proposed_at : null,
      ruledAt: decided ? r.r2_decided_at : null,
      overturned: false,
      assignee: r.assignee,
      open: OPEN_2.has(r.status),
    });
  }
  return out;
}

interface Person {
  id: string;
  name: string;
  role: StaffRole;
}

/** The board's order: senior moderators, moderators, then the owner; by name within a role. */
const PEOPLE = `select m.account_id::text as id, a.display_name as name, m.role
  from staff_members m join accounts a on a.id = m.account_id
  where m.role in ('senior', 'mod', 'owner')
  order by case m.role when 'senior' then 0 when 'mod' then 1 else 2 end, a.display_name`;

function periodOf(req: FastifyRequest): Period {
  const raw = (req.query as Record<string, unknown> | undefined)?.period;
  if (raw === undefined) return '30d';
  if (typeof raw !== 'string' || !(PERIODS as readonly string[]).includes(raw)) throw new ApiError(400, 'bad-request', { field: 'period' });
  return raw as Period;
}

export type PersonRow = Person & PersonMetrics;

export function staffPerformanceRoutes(app: FastifyInstance): void {
  const opts = { config: { perm: 'perf.read' as const }, preHandler: requireStaff('perf.read') };

  app.get('/staff/v1/performance', opts, async (req) => {
    const period = periodOf(req);
    const { db, clock } = req.server.deps;
    const now = clock();
    const { firstResponseH } = await disputeSettings(db);
    const rows = await caseRows(db, firstResponseH);
    const people = (await db.query<Person>(PEOPLE)).rows;
    const from = periodStart(period, now);
    return {
      period,
      firstResponseH,
      people: people.map((p): PersonRow => ({ id: p.id, name: p.name, role: p.role, ...personMetrics(rows, p.id, from, now) })),
    };
  });

  app.get('/staff/v1/performance/:id/weeks', opts, async (req) => {
    const id = idParam(req);
    const { db, clock } = req.server.deps;
    const now = clock();
    const person = (await db.query<Person>(`select * from (${PEOPLE}) p where p.id = $1`, [id])).rows[0];
    if (person === undefined) throw new ApiError(404, 'not-found');
    const { firstResponseH } = await disputeSettings(db);
    const rows = await caseRows(db, firstResponseH);
    const from = chartStart(now);
    return {
      id: person.id,
      name: person.name,
      role: person.role,
      firstResponseH,
      from: from.toISOString(),
      summary: personMetrics(rows, person.id, from, now),
      weeks: weekly(rows, person.id, now).map((w) => ({ weekOf: w.weekOf, start: w.start.toISOString(), cases: w.cases, firstReplyMin: w.firstReplyMin })),
    };
  });
}
