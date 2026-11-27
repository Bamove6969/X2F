import type { Queryable } from '../db/pool.js';
import { LIEN_FIGURES_SQL, lienFigures, type LienFiguresRow } from './recovery.js';

/**
 * Owner 26 Nov 2026 (docs/lien-recovery.md "Grace"): a lien's grace as the staff case, the staff lien
 * view and the traders' lien view read it (no routes here, so the case view can import it).
 */

/** A lien's grace as staff and the two traders see it (null fields: not set). */
export interface GraceView {
  /** `collect`: collecting from the debtor's trades (never in grace, or switched). */
  mode: 'collect' | 'grace';
  /** How the traders agreed it is paid (the moderator's words), or null. */
  method: string | null;
  graceUntil: string | null;
  lapsedAt: string | null;
  escalatedAt: string | null;
  collectStartedAt: string | null;
  repaidOffPlatformAt: string | null;
}

interface GraceRow {
  id: string;
  grace_method: string | null;
  grace_until: Date | null;
  grace_lapsed_at: Date | null;
  grace_escalated_at: Date | null;
  collect_started_at: Date | null;
  repaid_off_platform_at: Date | null;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

function viewOf(r: GraceRow): GraceView {
  return {
    mode: r.grace_until === null || r.collect_started_at !== null ? 'collect' : 'grace',
    method: r.grace_method,
    graceUntil: iso(r.grace_until),
    lapsedAt: iso(r.grace_lapsed_at),
    escalatedAt: iso(r.grace_escalated_at),
    collectStartedAt: iso(r.collect_started_at),
    repaidOffPlatformAt: iso(r.repaid_off_platform_at),
  };
}

/** The grace of each lien in `ids`. */
export async function graceOf(q: Queryable, ids: readonly string[]): Promise<Map<string, GraceView>> {
  if (ids.length === 0) return new Map();
  const { rows } = await q.query<GraceRow>(
    `select id::text, grace_method, grace_until, grace_lapsed_at, grace_escalated_at, collect_started_at, repaid_off_platform_at
       from liens where id = any($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map((r) => [r.id, viewOf(r)]));
}

/** A lien's remainder once its grace is known: nothing is left once the person owed signed off. */
export const remainingWith = (remainingAtomic: string, g: GraceView | undefined): string => (g?.repaidOffPlatformAt != null ? '0' : remainingAtomic);

/**
 * SQL over `disputes d`: the dispute's lien whose grace lapsed waits for a person (not switched, not
 * paid off the platform, still binding). `escalated`: only those sent to a senior (true), only those
 * not (false). `ruler`: only liens that staff member ruled (a parameter), or any (null).
 */
export const GRACE_WAITING_SQL = (escalated: boolean, ruler: string | null) => `exists (select 1 from liens gl
   where gl.from_code = d.code and gl.dispute_seq = d.seq and gl.status = 'active'
     and gl.grace_lapsed_at is not null and gl.collect_started_at is null and gl.repaid_off_platform_at is null
     and gl.grace_escalated_at is ${escalated ? 'not ' : ''}null${ruler === null ? '' : ` and gl.ruled_by = ${ruler}`})`;


/** What the staff case view shows of the dispute's liens (ModCase `LienPanel`). */
export async function caseLiens(q: Queryable, code: string, seq: number, me: string) {
  const rows = (
    await q.query<LienFiguresRow & { ruled_by: string | null; debtor_side: 'buyer' | 'seller' }>(
      `${LIEN_FIGURES_SQL.replace('from liens l', `, l.ruled_by::text, case when l.debtor_account_id = t.buyer_account_id then 'buyer' else 'seller' end as debtor_side
          from liens l join trades t on t.code = l.from_code`)}
        where l.from_code = $1 and l.dispute_seq = $2 order by l.created_at, l.id`,
      [code, seq],
    )
  ).rows;
  const graces = await graceOf(q, rows.map((r) => r.id));
  const pending = await q.query<{ lien_id: string; id: string; proposed_bps: number; reason: string; proposed_by: string }>(
    `select lien_id::text, id::text, proposed_bps, reason, proposed_by::text from lien_rate_requests where lien_id = any($1::uuid[]) and status = 'pending'`,
    [rows.map((r) => r.id)],
  );
  return rows.map((r) => {
    const f = lienFigures(r);
    const g = graces.get(f.id) ?? null;
    const p = pending.rows.find((x) => x.lien_id === f.id);
    return {
      id: f.id, status: f.status, debtor: r.debtor_side, amountAtomic: f.amountAtomic, recoveredAtomic: f.recoveredAtomic,
      remainingAtomic: remainingWith(f.remainingAtomic, g ?? undefined), rateBps: f.rateBps, createdAt: f.createdAt,
      ruledByYou: r.ruled_by === me, grace: g,
      pendingRate: p === undefined ? null : { id: p.id, rateBps: p.proposed_bps, reason: p.reason, proposedByYou: p.proposed_by === me },
    };
  });
}
