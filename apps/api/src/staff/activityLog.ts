import { can, type Perm } from '@x2f/staff';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { PUBLIC_NAME_COLUMN } from '../events/publicName.js';
import { LOG_KINDS, assertDetail, isLogAction, isLogKind, type LogKind } from '../log/actions.js';
import { queryLog, type LogEntry } from '../log/query.js';
import { verifyLogChain } from '../log/verify.js';
import { getMethod } from '../methods/profiles.js';
import { requireStaff } from './guard.js';

/**
 * Plan 4 Task 19: the Activity log page's reads (board StaffLog). Every route reads only:
 * - `GET /staff/v1/log`: entries newest first, filtered by trade code, actor, kind and date, 50 a
 *   page (`before`). Declared `log.read.cases` (senior moderators and moderators: the staff scope
 *   of `queryLog`, disputed trades only and never staff, settings, owner, site, pay or news
 *   entries); a member who also holds `log.read.all` (the owner) reads everything.
 * - `GET /staff/v1/log/filters`: the actors and kinds the filters offer, in the reader's scope.
 * - `GET /staff/v1/log/active-disputes`: the board's "Active disputes" list.
 * - `GET /staff/v1/log/integrity` (`log.read.all`, the owner): the chain check (`verifyLogChain`,
 *   the whole chain re-hashed) and the moderation process's log alarm (`site_flags.log_alarm`).
 *
 * What an entry shows (Global Constraints: never chat text, ruling reasons, addresses or IPs): the
 * stored `detail` is re-checked against its action's schema on the way out (`assertDetail`), so a
 * row that does not fit (a tampered or older row) shows no detail at all (`withheld: true`) rather
 * than whatever it holds. Names are public display names only; a trader is named by their side of
 * the trade, with their display name from the trade.
 * Reading the log is not itself logged: it is never an action on a case (R37's "involved" counts
 * log entries on a case, and reading the log must not make a reviewer ineligible).
 */

export const LOG_PAGE = 50;
/** The largest page a caller may ask for (one more row is read to know whether an older page exists). */
export const LOG_LIMIT_MAX = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const ID = /^[1-9]\d{0,18}$/;

/** Detail keys that hold an account or staff id, resolved to a display name in `names`. */
const ACCOUNT_KEYS = ['staffId', 'accountId'] as const;

export interface LogEntryView {
  id: string;
  at: string;
  tradeCode: string | null;
  actor: { kind: LogEntry['actorKind']; role: string | null; id: string | null; name: string | null };
  action: string;
  detail: Record<string, unknown>;
  /** The stored detail did not fit its action's schema, so none of it is shown. */
  withheld?: true;
}

/** Whether the caller reads the whole log (the owner) or the staff scope. */
const readsAll = (req: FastifyRequest) => can(req.staff.role, 'log.read.all' satisfies Perm, req.staff.grants);

function utcDay(s: string, plusDays = 0): Date {
  if (!DAY.test(s)) throw new ApiError(400, 'bad-request');
  const d = new Date(`${s}T00:00:00.000Z`);
  if (!Number.isFinite(d.getTime()) || d.toISOString().slice(0, 10) !== s) throw new ApiError(400, 'bad-request');
  return new Date(d.getTime() + plusDays * 86_400_000);
}

/** The detail as the page may show it: re-checked against the action's schema, else nothing. */
export function shownDetail(action: string, detail: unknown): { detail: Record<string, unknown>; withheld: boolean } {
  if (!isLogAction(action) || detail === null || typeof detail !== 'object' || Array.isArray(detail)) return { detail: {}, withheld: true };
  try {
    assertDetail(action, detail);
    return { detail: detail as Record<string, unknown>, withheld: false };
  } catch {
    return { detail: {}, withheld: true };
  }
}

async function displayNames(db: Queryable, ids: readonly string[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids)].filter((i) => UUID.test(i));
  if (unique.length === 0) return {};
  // The column name is the constant, never input.
  const { rows } = await db.query<{ id: string; name: string }>(`select id::text as id, ${PUBLIC_NAME_COLUMN} as name from accounts where id = any($1::uuid[])`, [unique]);
  return Object.fromEntries(rows.map((r) => [r.id, r.name]));
}

/** Each listed trade's two traders' display names, by side. */
async function traderNames(db: Queryable, codes: readonly string[]): Promise<Map<string, { buyer: string | null; seller: string | null }>> {
  const unique = [...new Set(codes)];
  const out = new Map<string, { buyer: string | null; seller: string | null }>();
  if (unique.length === 0) return out;
  const { rows } = await db.query<{ code: string; buyer: string | null; seller: string | null }>(
    `select t.code, b.${PUBLIC_NAME_COLUMN} as buyer, s.${PUBLIC_NAME_COLUMN} as seller
       from trades t left join accounts b on b.id = t.buyer_account_id left join accounts s on s.id = t.seller_account_id
      where t.code = any($1::text[])`,
    [unique],
  );
  for (const r of rows) out.set(r.code, { buyer: r.buyer, seller: r.seller });
  return out;
}

const methodName = (id: string): string => getMethod(id)?.name ?? id;

export function staffLogRoutes(app: FastifyInstance): void {
  const cases = requireStaff('log.read.cases');
  const cfg = { perm: 'log.read.cases' as const };

  app.get('/staff/v1/log', { preHandler: cases, config: cfg }, async (req) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    const allowed = ['code', 'actor', 'kind', 'from', 'to', 'before', 'limit'];
    if (Object.keys(q).some((k) => !allowed.includes(k))) throw new ApiError(400, 'bad-request');
    for (const v of Object.values(q)) if (typeof v !== 'string') throw new ApiError(400, 'bad-request');
    const s = q as Record<string, string | undefined>;
    const all = readsAll(req);

    let actor: Parameters<typeof queryLog>[1]['actor'];
    if (s.actor !== undefined && s.actor !== '') {
      if (s.actor === 'system' || s.actor === 'buyer' || s.actor === 'seller') actor = s.actor;
      else if (UUID.test(s.actor)) actor = { staffId: s.actor };
      else throw new ApiError(400, 'bad-request');
    }
    let kind: LogKind | undefined;
    if (s.kind !== undefined && s.kind !== '') {
      if (!isLogKind(s.kind)) throw new ApiError(400, 'bad-request');
      // An owner-only kind in the staff scope matches nothing: refused rather than shown empty.
      if (!all && LOG_KINDS[s.kind].ownerOnly) throw new ApiError(400, 'bad-request');
      kind = s.kind;
    }
    const from = s.from ? utcDay(s.from) : undefined;
    const to = s.to ? utcDay(s.to, 1) : undefined;
    if (from && to && from >= to) throw new ApiError(400, 'bad-request');
    if (s.before !== undefined && !ID.test(s.before)) throw new ApiError(400, 'bad-request');
    const limit = s.limit === undefined ? LOG_PAGE : Number(s.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > LOG_LIMIT_MAX) throw new ApiError(400, 'bad-request');

    const db = req.server.deps.db;
    // One more than the page, to know whether an older page exists.
    const rows = await queryLog(db, {
      scope: all ? 'all' : { staffId: req.staff.accountId },
      limit: limit + 1,
      ...(s.code ? { tradeCode: s.code } : {}),
      ...(s.before ? { before: s.before } : {}),
      ...(actor !== undefined ? { actor } : {}),
      ...(kind !== undefined ? { kind } : {}),
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
    });
    const page = rows.slice(0, limit);
    const shown = page.map((e) => ({ e, ...shownDetail(e.action, e.detail) }));
    const ids: string[] = [];
    for (const x of shown) {
      if (x.e.actorKind === 'staff' && x.e.actorId) ids.push(x.e.actorId);
      for (const k of ACCOUNT_KEYS) if (typeof x.detail[k] === 'string') ids.push(x.detail[k] as string);
    }
    const names = await displayNames(db, ids);
    const traders = await traderNames(db, page.flatMap((e) => (e.actorKind === 'trader' && e.tradeCode ? [e.tradeCode] : [])));
    const entries: LogEntryView[] = shown.map(({ e, detail, withheld }) => {
      let name: string | null = null;
      if (e.actorKind === 'staff' && e.actorId) name = names[e.actorId] ?? null;
      if (e.actorKind === 'trader' && e.tradeCode && (e.actorRole === 'buyer' || e.actorRole === 'seller')) name = traders.get(e.tradeCode)?.[e.actorRole] ?? null;
      return {
        id: e.id,
        at: e.at.toISOString(),
        tradeCode: e.tradeCode,
        actor: { kind: e.actorKind, role: e.actorRole, id: e.actorKind === 'staff' ? e.actorId : null, name },
        action: e.action,
        detail,
        ...(withheld ? { withheld: true as const } : {}),
      };
    });
    return { scope: all ? 'all' : 'cases', entries, names, next: rows.length > limit ? page[page.length - 1]!.id : null };
  });

  app.get('/staff/v1/log/filters', { preHandler: cases, config: cfg }, async (req) => {
    const all = readsAll(req);
    const db = req.server.deps.db;
    // The staff who appear in the reader's scope (the staff scope: on disputed trades, never the owner-only kinds).
    const { rows } = await db.query<{ id: string; name: string; role: string | null }>(
      `select distinct on (a.id) a.id::text as id, a.${PUBLIC_NAME_COLUMN} as name, m.role
         from (select distinct l.actor_id from activity_log l
                where l.actor_kind = 'staff' and l.actor_id is not null
                  and ($1::boolean or (l.trade_code is not null and exists (select 1 from disputes d where d.code = l.trade_code)))) x
         join accounts a on a.id = x.actor_id
         left join staff_members m on m.account_id = a.id
        order by a.id`,
      [all],
    );
    rows.sort((a, b) => a.name.localeCompare(b.name));
    const kinds = (Object.keys(LOG_KINDS) as LogKind[]).filter((k) => all || !LOG_KINDS[k].ownerOnly);
    return { scope: all ? 'all' : 'cases', actors: rows.map((r) => ({ id: r.id, name: r.name, role: r.role })), kinds };
  });

  app.get('/staff/v1/log/active-disputes', { preHandler: cases, config: cfg }, async (req) => {
    const { rows } = await req.server.deps.db.query<{ code: string; method_id: string; amount_atomic: string; status: string }>(
      `select d.code, t.method_id, t.amount_atomic::text as amount_atomic, d.status
         from disputes d join trades t on t.code = d.code
        where d.seq = (select max(x.seq) from disputes x where x.code = d.code) and d.status <> 'closed'
        order by d.opened_at desc, d.code
        limit 500`,
    );
    return { items: rows.map((r) => ({ code: r.code, method: r.method_id, methodName: methodName(r.method_id), xmr: r.amount_atomic, status: r.status })) };
  });

  app.get('/staff/v1/log/integrity', { preHandler: requireStaff('log.read.all'), config: { perm: 'log.read.all' } }, async (req) => {
    const deps = req.server.deps;
    const checkedAt = deps.clock();
    const chain = await verifyLogChain(deps.db);
    const flags = await deps.db.query<{ log_alarm: Date | null }>('select log_alarm from site_flags limit 1');
    const count = await deps.db.query<{ n: string }>('select count(*)::text as n from activity_log');
    return {
      checkedAt: checkedAt.toISOString(),
      chain: chain.ok ? { ok: true, headId: chain.head?.id ?? null } : { ok: false, brokenAt: chain.brokenAt },
      entries: Number(count.rows[0]?.n ?? 0),
      alarm: flags.rows[0]?.log_alarm?.toISOString() ?? null,
    };
  });
}
