import { normalizeTradeCode } from '@x2f/core';
import { can, type Perm } from '@x2f/staff';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { PUBLIC_NAME_COLUMN } from '../events/publicName.js';
import { LOG_KINDS, OWNER_ONLY_PREFIXES, assertDetail, isLogAction, isLogKind, type LogKind } from '../log/actions.js';
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
 * - `GET /staff/v1/log/active-disputes`: the board's "Active disputes" list, newest opened first,
 *   100 a page (`before`: the last code of the page before; review m7).
 * - `GET /staff/v1/log/integrity` (`log.read.all`, the owner): what the page shows on load, the
 *   entry count, the newest entry's id and the moderation process's log alarm
 *   (`site_flags.log_alarm`). It re-hashes nothing (review m7).
 * - `POST /staff/v1/log/integrity/check` (`log.read.all`): the chain check, on the owner's
 *   "Check integrity" only. It is the whole check every time (`verifyLogChain` from the first row,
 *   never from a checkpoint), so it is exactly as strong as the old check on every load: a check
 *   from a checkpoint trusts every row before it, and someone who rewrites old rows and re-chains
 *   them up to the checkpoint would pass it. The continuous watch stays the moderation process's
 *   own checkpointed check (Task 14), which raises `log_alarm`.
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
/** Active disputes a page (review m7: paged, newest opened first). */
export const ACTIVE_PAGE = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** An entry id: a plain decimal that is a safe integer (review m2: a larger one is a 400, never Postgres's bigint error). */
const ID = /^[1-9]\d{0,15}$/;
const isEntryId = (s: string): boolean => ID.test(s) && Number.isSafeInteger(Number(s));
/** A page size: a plain decimal, 1 to 999 before the cap (review m3: no `1e2`, `0x10`, spaces or a sign). */
const LIMIT = /^[1-9][0-9]{0,2}$/;

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
    if (s.before !== undefined && !isEntryId(s.before)) throw new ApiError(400, 'bad-request');
    if (s.limit !== undefined && !LIMIT.test(s.limit)) throw new ApiError(400, 'bad-request');
    const limit = s.limit === undefined ? LOG_PAGE : Number(s.limit);
    if (limit > LOG_LIMIT_MAX) throw new ApiError(400, 'bad-request');

    const db = req.server.deps.db;
    // One more than the page, to know whether an older page exists.
    const rows = await queryLog(db, {
      // OWNER p12-11 (log/query.ts CHAT_READ_VISIBILITY): which chat.read entries this person sees
      // goes by their role; any other role gets the narrowest (a moderator's).
      scope: all ? 'all' : { staffId: req.staff.accountId, ...(req.staff.role === 'senior' || req.staff.role === 'mod' || req.staff.role === 'helper' ? { role: req.staff.role } : {}) },
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
    // The staff who appear in the reader's scope (the staff scope: on disputed trades, never the
    // owner-only kinds, the same clauses as queryLog's; review m5). Fixed literals from
    // OWNER_ONLY_PREFIXES (letters and a dot), never input.
    const notOwnerOnly = OWNER_ONLY_PREFIXES.map((p) => ` and l.action not like '${p}%'`).join('');
    const { rows } = await db.query<{ id: string; name: string; role: string | null }>(
      `select distinct on (a.id) a.id::text as id, a.${PUBLIC_NAME_COLUMN} as name, m.role
         from (select distinct l.actor_id from activity_log l
                where l.actor_kind = 'staff' and l.actor_id is not null
                  and ($1::boolean or (l.trade_code is not null and exists (select 1 from disputes d where d.code = l.trade_code)${notOwnerOnly}))) x
         join accounts a on a.id = x.actor_id
         left join staff_members m on m.account_id = a.id
        order by a.id`,
      [all],
    );
    rows.sort((a, b) => a.name.localeCompare(b.name));
    const kinds = (Object.keys(LOG_KINDS) as LogKind[]).filter((k) => all || !LOG_KINDS[k].ownerOnly);
    return { scope: all ? 'all' : 'cases', actors: rows.map((r) => ({ id: r.id, name: r.name, role: r.role })), kinds };
  });

  // Review m7: paged, newest opened first. The cursor is the last code of the page before; its
  // dispute's opening is read back, so the cursor needs no time of its own (no precision lost).
  app.get('/staff/v1/log/active-disputes', { preHandler: cases, config: cfg }, async (req) => {
    const q = (req.query ?? {}) as Record<string, unknown>;
    if (Object.keys(q).some((k) => k !== 'before' && k !== 'limit')) throw new ApiError(400, 'bad-request');
    for (const v of Object.values(q)) if (typeof v !== 'string') throw new ApiError(400, 'bad-request');
    const s = q as { before?: string; limit?: string };
    if (s.limit !== undefined && !LIMIT.test(s.limit)) throw new ApiError(400, 'bad-request');
    const limit = s.limit === undefined ? ACTIVE_PAGE : Number(s.limit);
    if (limit > ACTIVE_PAGE) throw new ApiError(400, 'bad-request');
    const db = req.server.deps.db;
    const latest = 'd.seq = (select max(x.seq) from disputes x where x.code = d.code)';
    const args: unknown[] = [limit + 1];
    let after = '';
    if (s.before !== undefined) {
      const code = normalizeTradeCode(s.before);
      if (code === null) throw new ApiError(400, 'bad-request');
      // The cursor's dispute may have closed since its page was read: it still marks the place.
      const cur = await db.query<{ opened_at: Date }>(`select d.opened_at from disputes d where d.code = $1 and ${latest}`, [code]);
      if (!cur.rows[0]) throw new ApiError(404, 'not-found');
      args.push(cur.rows[0].opened_at, code);
      after = ' and (d.opened_at < $2 or (d.opened_at = $2 and d.code > $3))';
    }
    const { rows } = await db.query<{ code: string; method_id: string; amount_atomic: string; status: string }>(
      `select d.code, t.method_id, t.amount_atomic::text as amount_atomic, d.status
         from disputes d join trades t on t.code = d.code
        where ${latest} and d.status <> 'closed'${after}
        order by d.opened_at desc, d.code
        limit $1`,
      args,
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((r) => ({ code: r.code, method: r.method_id, methodName: methodName(r.method_id), xmr: r.amount_atomic, status: r.status })),
      next: rows.length > limit ? page[page.length - 1]!.code : null,
    };
  });

  const owner = { preHandler: requireStaff('log.read.all'), config: { perm: 'log.read.all' as const } };
  /** The count, the newest entry and the alarm: cheap reads, no hashing. */
  const status = async (db: Queryable) => {
    const flags = await db.query<{ log_alarm: Date | null }>('select log_alarm from site_flags limit 1');
    const count = await db.query<{ n: string }>('select count(*)::text as n from activity_log');
    const head = await db.query<{ id: string }>('select l.id::text as id from activity_log l order by l.id desc limit 1');
    return { entries: Number(count.rows[0]?.n ?? 0), headId: head.rows[0]?.id ?? null, alarm: flags.rows[0]?.log_alarm?.toISOString() ?? null };
  };

  app.get('/staff/v1/log/integrity', owner, async (req) => status(req.server.deps.db));

  app.post('/staff/v1/log/integrity/check', owner, async (req) => {
    if (req.body !== undefined && req.body !== null && (typeof req.body !== 'object' || Object.keys(req.body).length > 0)) throw new ApiError(400, 'bad-request');
    const deps = req.server.deps;
    const checkedAt = deps.clock();
    // The whole chain from its first row, every time (see the header): never from a checkpoint.
    const chain = await verifyLogChain(deps.db);
    const s = await status(deps.db);
    return {
      checkedAt: checkedAt.toISOString(),
      chain: chain.ok ? { ok: true, headId: chain.head?.id ?? null } : { ok: false, brokenAt: chain.brokenAt },
      entries: s.entries,
      alarm: s.alarm,
    };
  });
}
