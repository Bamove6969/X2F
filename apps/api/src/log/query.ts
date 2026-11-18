import { normalizeTradeCode } from '@x2f/core';
import type { Queryable } from '../db/pool.js';
import { LOG_KINDS, OWNER_ONLY_PREFIXES, type LogKind } from './actions.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface LogEntry {
  id: string;
  at: Date;
  actorKind: 'staff' | 'trader' | 'system';
  actorId: string | null;
  actorRole: string | null;
  tradeCode: string | null;
  action: string;
  /** Null when the stored text is not a JSON object (only a tampered row: the chain check finds it). */
  detail: Record<string, unknown> | null;
}

function parseDetail(s: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(s) as unknown;
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export const LOG_PAGE_MAX = 200;

/**
 * Reads the log, newest first. `tradeCode` may be typed with or without dashes (an invalid code
 * matches nothing); `before` is an entry id to page from.
 * - Scope `all` is the owner's (`log.read.all`).
 * - A staff scope (`log.read.cases`) shows only entries on a trade that has a dispute (any staff
 *   member with `disputes.handle` may see every dispute's case, Task 11), and never `staff.*`,
 *   `settings.*`, `owner.*`, `site.*`, `shift.*`, `pay.*` or `news.*` entries.
 */
export async function queryLog(
  db: Queryable,
  q: {
    tradeCode?: string;
    scope: 'all' | { staffId: string };
    before?: string;
    limit: number;
    /** Plan 4 Task 19: who acted: a staff id, `system`, or a trader side. */
    actor?: { staffId: string } | 'system' | 'buyer' | 'seller';
    /** Plan 4 Task 19: one of LOG_KINDS (by action prefix). */
    kind?: LogKind;
    /** Plan 4 Task 19: entries at or after `from` and before `to`. */
    from?: Date;
    to?: Date;
  },
): Promise<LogEntry[]> {
  if (!Number.isInteger(q.limit) || q.limit < 1 || q.limit > LOG_PAGE_MAX) throw new RangeError('limit out of range');
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.tradeCode !== undefined) {
    const code = normalizeTradeCode(q.tradeCode);
    if (code === null) return [];
    args.push(code);
    where.push(`l.trade_code = $${args.length}`);
  }
  if (q.before !== undefined) {
    // A safe integer only (review m2): a larger value would reach Postgres as an out-of-range bigint.
    if (!/^[1-9]\d{0,15}$/.test(q.before) || !Number.isSafeInteger(Number(q.before))) throw new RangeError('before is not an entry id');
    args.push(q.before);
    where.push(`l.id < $${args.length}`);
  }
  if (q.actor !== undefined) {
    if (q.actor === 'system') where.push(`l.actor_kind = 'system'`);
    else if (q.actor === 'buyer' || q.actor === 'seller') {
      args.push(q.actor);
      where.push(`l.actor_kind = 'trader' and l.actor_role = $${args.length}`);
    } else {
      if (!UUID.test(q.actor.staffId)) throw new RangeError('actor is not a staff id');
      args.push(q.actor.staffId);
      where.push(`l.actor_kind = 'staff' and l.actor_id = $${args.length}::uuid`);
    }
  }
  if (q.kind !== undefined) {
    if (!Object.hasOwn(LOG_KINDS, q.kind)) throw new RangeError('unknown kind');
    // Fixed literals from LOG_KINDS (letters and a dot), never input.
    where.push(`(${LOG_KINDS[q.kind].prefixes.map((p) => `l.action like '${p}%'`).join(' or ')})`);
  }
  for (const [d, op] of [[q.from, '>='], [q.to, '<']] as const) {
    if (d === undefined) continue;
    if (!Number.isFinite(d.getTime())) throw new RangeError('invalid date');
    args.push(d);
    where.push(`l.at ${op} $${args.length}`);
  }
  if (q.scope !== 'all') {
    where.push('l.trade_code is not null');
    where.push('exists (select 1 from disputes d where d.code = l.trade_code)');
    // Fixed literals from OWNER_ONLY_PREFIXES (letters and a dot), never input.
    for (const p of OWNER_ONLY_PREFIXES) where.push(`l.action not like '${p}%'`);
  }
  args.push(q.limit);
  const { rows } = await db.query<{
    id: string;
    at: Date;
    actor_kind: LogEntry['actorKind'];
    actor_id: string | null;
    actor_role: string | null;
    trade_code: string | null;
    action: string;
    detail: string;
  }>(
    `select l.id::text as id, l.at, l.actor_kind, l.actor_id::text as actor_id, l.actor_role, l.trade_code, l.action, l.detail
       from activity_log l
      ${where.length > 0 ? `where ${where.join(' and ')}` : ''}
      order by l.id desc
      limit $${args.length}`,
    args,
  );
  return rows.map((r) => ({
    id: r.id,
    at: r.at,
    actorKind: r.actor_kind,
    actorId: r.actor_id,
    actorRole: r.actor_role,
    tradeCode: r.trade_code,
    action: r.action,
    detail: parseDetail(r.detail),
  }));
}
