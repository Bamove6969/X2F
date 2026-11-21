import { normalizeTradeCode } from '@x2f/core';
import type { Party, TradeState } from '@x2f/trade';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireSession } from '../auth/sessions.js';
import { ApiError } from '../errors.js';
import { PUBLIC_NAME_COLUMN } from '../events/publicName.js';
import { hasAbility } from '../team/abilities.js';
import { TRADE_PART_ABILITY, TRADE_READ } from '../team/perms.js';
import { FINISH_OPEN_TRADES } from './routes.js';

/**
 * One row of `GET /v1/trades`: a subset of what `GET /v1/trades/:code` (view.ts `TradeView`)
 * already shows this party, so the list says nothing the room does not. No fee (the room shows it
 * to the poster only), no address, no payment details, no tx hash; the other side by public name only.
 */
export interface TradeListItem {
  code: string;
  role: Party;
  state: TradeState;
  amountAtomic: string;
  fiatCents: string;
  /** The locked rate's currency (`TradeView.lockedRate.currency`). */
  currency: string;
  counterparty: { displayName: string };
  takenAt: string;
  closedAt: string | null;
  /**
   * Plan 3 Task 42: "The account's Active trades list shows which member last acted on each trade
   * (from `team_audit`), visible to the account owner only." Only on an open row, only for the
   * account owner's session (never a member's): the newest row of the account's own team log by a
   * member on this trade (its name as the lead's list shows it, `team_members.display_name`, and
   * when), or null when no member has acted on it. The lead's own rows (`auditLead`, member null)
   * are not a member acting, and the other side's team log is never read.
   */
  lastActedBy?: { memberName: string; at: string } | null;
}

/** What `GET /v1/trades` answers: newest first; `next` is the cursor for the page after, null at the end. */
export interface TradeListPage {
  trades: TradeListItem[];
  next: string | null;
}

export type TradeListStatus = 'open' | 'completed';

export const TRADE_LIST_DEFAULT_LIMIT = 20;
export const TRADE_LIST_MAX_LIMIT = 100;
const MAX_CURSOR_LENGTH = 128;

/** The boxes for each part of the list (team/perms.ts, the trade room's too): open trades, and past ones. */
const PART_ABILITY: Readonly<Record<TradeListStatus, string>> = TRADE_PART_ABILITY;

/** A query value given once, as a string; absent → undefined; given twice or as anything else → 400. */
function one(query: unknown, name: string): string | undefined {
  if (query === null || typeof query !== 'object') return undefined;
  const v = (query as Record<string, unknown>)[name];
  if (v === undefined) return undefined;
  if (typeof v !== 'string') throw new ApiError(400, 'bad-request');
  return v;
}

/** The cursor's key: the row's `taken_at` to the microsecond (Postgres's own text, so it round-trips exactly) and its code. */
const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6})\|([0-9A-Z-]{1,40})$/;

function encodeCursor(takenKey: string, code: string): string {
  return Buffer.from(`${takenKey}|${code}`, 'utf8').toString('base64url');
}

/**
 * Review M1: the key's date and time must exist (no 30 February, month 13, 25:61:61 or year 0, which
 * Postgres would refuse with a 500): parsed as UTC it reads back to the same second.
 */
function realInstant(takenKey: string): boolean {
  if (takenKey.startsWith('0000')) return false;
  const ms = Date.parse(`${takenKey.slice(0, 19)}Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 19) === takenKey.slice(0, 19);
}

function decodeCursor(raw: string): { takenKey: string; code: string } {
  if (raw.length === 0 || raw.length > MAX_CURSOR_LENGTH || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new ApiError(400, 'bad-request');
  const m = CURSOR.exec(Buffer.from(raw, 'base64url').toString('utf8'));
  if (!m || normalizeTradeCode(m[2]!) !== m[2] || !realInstant(m[1]!)) throw new ApiError(400, 'bad-request');
  return { takenKey: m[1]!, code: m[2]! };
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return TRADE_LIST_DEFAULT_LIMIT;
  if (!/^[1-9][0-9]{0,2}$/.test(raw)) throw new ApiError(400, 'bad-request');
  const n = Number(raw);
  if (n > TRADE_LIST_MAX_LIMIT) throw new ApiError(400, 'bad-request');
  return n;
}

/**
 * The parts of the list this session may read. The account owner: both. A team member: open trades
 * with See active trades, completed ones with See trade history (the boxes' own words, team/abilities.ts);
 * the route's guard already refused a member with neither.
 */
function partsFor(req: FastifyRequest): TradeListStatus[] {
  if (req.auth.memberId === null) return ['open', 'completed'];
  return (['open', 'completed'] as const).filter((p) => hasAbility(req.auth.memberAbilities, PART_ABILITY[p]));
}

interface ListRow {
  code: string;
  role: Party;
  state: TradeState;
  amount_atomic: string;
  fiat_cents: string;
  locked_currency: string;
  counterparty_name: string;
  taken_at: Date;
  closed_at: Date | null;
  taken_key: string;
}

/**
 * Plan 3 Task 42: for each of these trades, the newest action a member of this account logged on it
 * (`team_audit`, the account's own log only; ties by the log's id), with the member's name. A
 * removed member keeps their row in `team_members`, so the name stays.
 */
async function lastMemberActions(req: FastifyRequest, accountId: string, codes: string[]): Promise<Map<string, { memberName: string; at: string }>> {
  const out = new Map<string, { memberName: string; at: string }>();
  if (codes.length === 0) return out;
  const { rows } = await req.server.deps.db.query<{ trade_code: string; display_name: string; at: Date }>(
    `select distinct on (l.trade_code) l.trade_code, m.display_name, l.at
       from team_audit l join team_members m on m.id = l.member_id and m.account_id = l.account_id
      where l.account_id = $1 and l.member_id is not null and l.trade_code = any($2::text[])
      order by l.trade_code, l.at desc, l.id desc`,
    [accountId, codes],
  );
  for (const r of rows) out.set(r.trade_code, { memberName: r.display_name, at: r.at.toISOString() });
  return out;
}

/**
 * `GET /v1/trades?status=open|completed&cursor&limit` (lead job, register D-005: the completed-trades
 * list the appeal button sits on). The caller's account's own trades as buyer or seller, newest
 * taken first (ties by code), `limit` a page (default 20, at most 100). Completed is every trade
 * that has closed (`closed_at` set: released, refunded, cancelled, a lapse with nothing sent);
 * open is the rest, a dispute included. Without `status`, every part the session may read.
 *
 * The same sessions as the trade room (FINISH_OPEN_TRADES: a trader session, a backup session and a
 * held one too) and the same boxes for members (TRADE_READ), each part then needing its own box (a
 * part asked for without it: 403 `forbidden`). The list reads only the live `trades` table: a trade
 * the retention rule deleted (R36) is gone, with no stub. The account owner's open rows also say which
 * member last acted (`lastActedBy`, Plan 3 Task 42).
 */
export function tradeListRoute(app: FastifyInstance): void {
  const session = requireSession({ ...FINISH_OPEN_TRADES, member: TRADE_READ });
  app.get('/v1/trades', { preHandler: session }, async (req): Promise<TradeListPage> => {
    const status = one(req.query, 'status');
    if (status !== undefined && status !== 'open' && status !== 'completed') throw new ApiError(400, 'bad-request');
    const rawCursor = one(req.query, 'cursor');
    const cursor = rawCursor === undefined ? null : decodeCursor(rawCursor);
    const limit = parseLimit(one(req.query, 'limit'));
    const may = partsFor(req);
    if (status !== undefined && !may.includes(status)) throw new ApiError(403, 'forbidden');
    const parts = status !== undefined ? [status] : may;
    const open = parts.includes('open');
    const completed = parts.includes('completed');
    const me = req.auth.accountId;
    // The name column is a constant, never input.
    const { rows } = await req.server.deps.db.query<ListRow>(
      `select t.code, case when t.buyer_account_id = $1 then 'buyer' else 'seller' end as role, t.state,
              t.amount_atomic::text as amount_atomic, t.fiat_cents::text as fiat_cents, t.locked_currency,
              a.${PUBLIC_NAME_COLUMN} as counterparty_name, t.taken_at, t.closed_at,
              to_char(t.taken_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US') as taken_key
         from trades t
         join accounts a on a.id = case when t.buyer_account_id = $1 then t.seller_account_id else t.buyer_account_id end
        where (t.buyer_account_id = $1 or t.seller_account_id = $1)
          and (($2::boolean and t.closed_at is null) or ($3::boolean and t.closed_at is not null))
          and ($4::timestamp is null or (t.taken_at, t.code) < (($4::timestamp at time zone 'UTC'), $5::text))
        order by t.taken_at desc, t.code desc
        limit $6`,
      [me, open, completed, cursor?.takenKey ?? null, cursor?.code ?? null, limit + 1],
    );
    const shown = rows.slice(0, limit);
    const last = shown[shown.length - 1];
    const acted = req.auth.memberId === null ? await lastMemberActions(req, me, shown.filter((r) => r.closed_at === null).map((r) => r.code)) : null;
    return {
      trades: shown.map((r) => ({
        code: r.code,
        role: r.role,
        state: r.state,
        amountAtomic: BigInt(r.amount_atomic).toString(),
        fiatCents: BigInt(r.fiat_cents).toString(),
        currency: r.locked_currency,
        counterparty: { displayName: r.counterparty_name },
        takenAt: r.taken_at.toISOString(),
        closedAt: r.closed_at === null ? null : r.closed_at.toISOString(),
        ...(acted !== null && r.closed_at === null ? { lastActedBy: acted.get(r.code) ?? null } : {}),
      })),
      next: rows.length > limit && last !== undefined ? encodeCursor(last.taken_key, last.code) : null,
    };
  });
}
