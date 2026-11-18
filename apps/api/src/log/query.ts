import { normalizeTradeCode } from '@x2f/core';
import type { Queryable } from '../db/pool.js';
import { OWNER_ONLY_PREFIXES } from './actions.js';

export interface LogEntry {
  id: string;
  at: Date;
  actorKind: 'staff' | 'trader' | 'system';
  actorId: string | null;
  actorRole: string | null;
  tradeCode: string | null;
  action: string;
  detail: Record<string, unknown>;
}

export const LOG_PAGE_MAX = 200;

/**
 * OWNER: p12-11. Who sees the `chat.read` entries (each staff read of a disputed chat, design build
 * task 9). Built to the design's recommendation (section 6, Q11) until the owner answers page 12:
 * the owner sees all of them (scope `all`); a senior moderator sees those on their cases (a trade
 * whose current dispute is assigned to them, or that they acted on themselves); a moderator (and a
 * helper) sees only their own. The traders' and the system's entries are not `chat.read` entries
 * and are unchanged.
 */
export const CHAT_READ_VISIBILITY = { owner: 'all', senior: 'own-cases', mod: 'own', helper: 'own' } as const;

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
  q: { tradeCode?: string; scope: 'all' | { staffId: string; role?: 'senior' | 'mod' | 'helper' }; before?: string; limit: number },
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
    if (!/^[1-9]\d{0,18}$/.test(q.before)) throw new RangeError('before is not an entry id');
    args.push(q.before);
    where.push(`l.id < $${args.length}`);
  }
  if (q.scope !== 'all') {
    where.push('l.trade_code is not null');
    where.push('exists (select 1 from disputes d where d.code = l.trade_code)');
    // Fixed literals from OWNER_ONLY_PREFIXES (letters and a dot), never input.
    for (const p of OWNER_ONLY_PREFIXES) where.push(`l.action not like '${p}%'`);
    // OWNER p12-11: the chat.read entries this person may see (no role given: the narrowest, a moderator's).
    args.push(q.scope.staffId);
    const me = `$${args.length}::uuid`;
    const seen = CHAT_READ_VISIBILITY[q.scope.role ?? 'mod'];
    if (seen === 'own') where.push(`(l.action <> 'chat.read' or l.actor_id = ${me})`);
    else {
      where.push(`(l.action <> 'chat.read' or l.actor_id = ${me}
        or exists (select 1 from disputes d where d.code = l.trade_code and d.assignee = ${me} and d.seq = (select max(seq) from disputes x where x.code = l.trade_code))
        or exists (select 1 from activity_log o where o.trade_code = l.trade_code and o.actor_kind = 'staff' and o.actor_id = ${me} and o.action <> 'chat.read'))`);
    }
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
    detail: JSON.parse(r.detail) as Record<string, unknown>,
  }));
}
