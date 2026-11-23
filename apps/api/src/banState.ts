/**
 * Plan 4 Task 27: what a ban (account_bans, migration 780) means on the trader side. Both kinds stop
 * trading: a trade ban is no new trades or offers, and a site ban includes that. A ban stands
 * until `until` by the server clock (null = lifetime), or until staff lift it; `settleEndedBans`
 * (staff/bans.ts) then writes `ended_at` and the log entry.
 *
 * The point checks (posting, taking, the site gate) read `until` against the clock, so a ban ends to
 * the second. The offer lists cannot (their queries carry no clock): they hide the offers of an
 * account whose ban has no `ended_at` yet, so a timed ban's offers come back within the settle
 * job's minute.
 */
import { normalizeTradeCode } from '@x2f/core';
import type { BanReasonCode } from '@x2f/staff';
import type { Queryable } from './db/pool.js';
import { ApiError } from './errors.js';

/** SQL: true while `col`'s account has a ban not yet ended or lifted (the lists' test). */
export const banHidesSql = (col: string): string =>
  `exists (select 1 from account_bans bn where bn.account_id = ${col} and bn.ended_at is null and bn.lifted_at is null)`;

export interface ActiveBan {
  id: string;
  kind: 'trade' | 'site';
  reasonCode: BanReasonCode;
  until: Date | null;
}

/** The account's bans in force at `now` (trade first, then site). */
export async function activeBans(db: Queryable, accountId: string, now: Date): Promise<ActiveBan[]> {
  const { rows } = await db.query<{ id: string; kind: 'trade' | 'site'; reason_code: BanReasonCode; until: Date | null }>(
    `select id, kind, reason_code, until from account_bans
      where account_id = $1 and ended_at is null and lifted_at is null and (until is null or until > $2)
      order by kind desc`,
    [accountId, now],
  );
  return rows.map((r) => ({ id: r.id, kind: r.kind, reasonCode: r.reason_code, until: r.until }));
}

/**
 * Lead call (Task 27 Q4): the 409 `trade-ban` for this account, carrying the general reason and the
 * end (null: lifetime) of the ban that stops it trading (a site ban first, it says more); null when
 * none does.
 */
export async function tradeBanRefusal(db: Queryable, accountId: string, now: Date): Promise<ApiError | null> {
  const bans = await activeBans(db, accountId, now);
  const b = bans.find((x) => x.kind === 'site') ?? bans[0];
  return b === undefined ? null : new ApiError(409, 'trade-ban', { reasonCode: b.reasonCode, until: b.until?.toISOString() ?? null });
}

/** True while any ban stops this account trading at `now`. */
export async function tradeBanned(db: Queryable, accountId: string, now: Date): Promise<boolean> {
  return (await activeBans(db, accountId, now)).length > 0;
}

/** SQL: true while trade `t` is unfinished: open (`closed_at` null), or with a dispute not closed (an open appeal included). */
export const UNFINISHED_SQL = `(t.closed_at is null or exists (select 1 from disputes d where d.code = t.code and d.status <> 'closed'))`;

/** An open trade or a dispute not closed (an open appeal included): what a site-banned person may still finish. */
export async function hasUnfinished(db: Queryable, accountId: string): Promise<boolean> {
  const { rows } = await db.query<{ open: boolean }>(
    `select exists (select 1 from trades t where (t.seller_account_id = $1 or t.buyer_account_id = $1) and ${UNFINISHED_SQL}) as open`,
    [accountId],
  );
  return rows[0]!.open;
}

/**
 * Review S1: the account's unfinished trades for the ban notice's links, newest first. `dispute`:
 * the trade has a dispute not closed (the notice links its dispute screen), else the trade room.
 */
export async function unfinishedTrades(db: Queryable, accountId: string): Promise<{ code: string; dispute: boolean }[]> {
  const { rows } = await db.query<{ code: string; dispute: boolean }>(
    `select t.code, exists (select 1 from disputes d where d.code = t.code and d.status <> 'closed') as dispute
       from trades t
      where (t.seller_account_id = $1 or t.buyer_account_id = $1) and ${UNFINISHED_SQL}
      order by t.taken_at desc, t.code desc`,
    [accountId],
  );
  return rows;
}

/** True when `raw` names a trade of the account's that is unfinished. */
async function unfinishedTrade(db: Queryable, accountId: string, raw: unknown): Promise<boolean> {
  const code = typeof raw === 'string' ? normalizeTradeCode(raw) : null;
  if (code === null) return false;
  const { rows } = await db.query<{ ok: boolean }>(
    `select exists (select 1 from trades t where t.code = $2 and (t.seller_account_id = $1 or t.buyer_account_id = $1) and ${UNFINISHED_SQL}) as ok`,
    [accountId, code],
  );
  return rows[0]!.ok;
}

/** True when `raw` names a chat of the account's on an unfinished trade (never an offer chat). */
async function unfinishedChat(db: Queryable, accountId: string, raw: unknown): Promise<boolean> {
  const code = typeof raw === 'string' ? normalizeTradeCode(raw) : null;
  if (code === null) return false;
  const { rows } = await db.query<{ ok: boolean }>(
    `select exists (select 1 from chats c join trades t on t.code = c.trade_code
                     where c.code = $2 and (c.seller_account_id = $1 or c.buyer_account_id = $1)
                       and (t.seller_account_id = $1 or t.buyer_account_id = $1) and ${UNFINISHED_SQL}) as ok`,
    [accountId, code],
  );
  return rows[0]!.ok;
}

/**
 * Task 27, 2026-10-29b ("a site-banned user can log in only while something is unfinished ... they
 * can then reach only what finishes it"): the trader routes a site-banned session reaches.
 *
 * - Always: the notice, who they are, the Terms, and the feedback form (owner: everyone refused can
 *   say so; review S4).
 * - While anything is unfinished, the account-wide reads and upkeep the trade room and the app shell
 *   need (review S1, S3): live events, wallets and alerts (read), news, methods, prices and
 *   currencies (read), the hold banner, this device's push subscription, the chat-key courier, and
 *   approving a new device's login.
 * - Review MF1: a trade's own routes only for that trade, when it is one of the account's
 *   unfinished trades (its events, wallet step, chat, dispute and appeal; never its review); a
 *   chat's routes only for the chat of such a trade (never an offer chat, never a closed trade's);
 *   a nudge only in such a trade or its chat (`context`). Never the chat list.
 * - Batch 10a lead call 1 (widened on purpose, re-verified in batch 10a round 2): the trade room's
 *   later routes. While anything is unfinished, the account's own freeze read (the app's freeze
 *   watch, D-016). As a trade's own routes, for that unfinished trade only: its blur checks
 *   (P-012/P-013: the asks, the announce and the answer) and its proofs (Plan 5 Task 14: the upload
 *   and the read).
 * - Bans onto main (lead default, 21 Nov, the same rule and the same scopes as lead call 1): the
 *   room's routes main gained after bans. For an unfinished trade only: its signed ruling statement
 *   (Haveno review finding 2, read by the escrow runtime) and the seller's payment proof for a
 *   ruling (Plan 4 Task 12, A6: what finishes a `seller-sends-xmr` dispute). For such a trade's
 *   chat only: the chat key record, read and posted (chat membership design task 4), and the
 *   fallback grant to the moderator (task 6).
 *
 * - D-005, My trades (was NEEDS_TRADES_LIST; lead call 1, batch 10a a1a75df1): `GET /v1/trades`
 *   passes while anything is unfinished, AND the list itself then returns only the unfinished trades
 *   (trades/list.ts: `and (not siteBanned or UNFINISHED_SQL)`, `siteBanned` from the session
 *   query's ban on req.auth), for the account owner and its members alike. The two go together:
 *   the gate entry alone would show a banned person their whole history.
 * NEEDS_DEVICE_BOUND: batch 10a OQ-1 (lead call, e2af08d5) puts S-085's proof pair, `POST
 * /v1/account/session/proof` and `/challenge` (wip/lead-device-bound, not on main), in ALWAYS: it
 * renews only the caller's own bound cookie and starts nothing, so a banned person with nothing
 * unfinished keeps their notice past BOUND_TTL_MS instead of being sent to login.
 *
 * Nothing that starts anything new: no offers, takes, new chats, settings.
 */
const ALWAYS = new Set(['GET /v1/account/ban', 'GET /v1/account/me', 'GET /v1/terms', 'POST /v1/account/terms', 'POST /v1/feedback/form']);
const ACCOUNT: readonly RegExp[] = [
  /^GET \/v1\/events$/,
  /^GET \/v1\/wallets(\/rule)?$/,
  /^GET \/v1\/account\/alerts$/,
  /^GET \/v1\/(news|methods|price|currencies)$/,
  /^GET \/v1\/account\/hold$/,
  /^(GET|POST|DELETE) \/v1\/account\/push$/,
  /^(GET|POST) \/v1\/account\/chat-keys$/,
  /^DELETE \/v1\/account\/chat-keys\/:id$/,
  /^GET \/v1\/account\/approvals(\/:id)?$/,
  /^POST \/v1\/account\/approvals\/:id$/,
  /^GET \/v1\/account\/freeze$/,
  // D-005: the trades list, filtered to the unfinished trades under a site ban (trades/list.ts).
  /^GET \/v1\/trades$/,
];
const TRADE: readonly RegExp[] = [
  /^GET \/v1\/trades\/:code(\/(attestation|confirmations|dispute))?$/,
  /^POST \/v1\/trades\/:code\/(events|wallet|identity|chat|dispute|appeal)$/,
  /^GET \/v1\/trades\/:code\/blur-checks$/,
  /^POST \/v1\/trades\/:code\/blur-checks\/:proofId$/,
  /^POST \/v1\/trades\/:code\/proofs\/:(id|proofId)\/blur-check$/,
  /^(GET|PUT) \/v1\/trades\/:code\/proofs\/:id$/,
  /^GET \/v1\/trades\/:code\/(ruling|after-refund)-statement$/,
  /^POST \/v1\/trades\/:code\/payment-proof$/,
];
const CHAT: readonly RegExp[] = [
  /^GET \/v1\/chats\/:chat(\/(attestation|envelopes|key))?$/,
  /^POST \/v1\/chats\/:chat\/(envelopes|identity|key|grant)$/,
];
const NUDGE = 'POST /v1/nudges';

export interface GatedRequest {
  method: string;
  /** The route's template (`req.routeOptions.url`). */
  url: string;
  params: unknown;
  body: unknown;
}

const field = (o: unknown, k: string): unknown => (o !== null && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined);

/** Whether a site-banned account's request passes the gate (the session check answers 403 `banned` otherwise). */
export async function siteBanAllows(db: Queryable, accountId: string, req: GatedRequest): Promise<boolean> {
  const route = `${req.method === 'HEAD' ? 'GET' : req.method} ${req.url}`;
  if (ALWAYS.has(route)) return true;
  if (ACCOUNT.some((re) => re.test(route))) return hasUnfinished(db, accountId);
  if (TRADE.some((re) => re.test(route))) return unfinishedTrade(db, accountId, field(req.params, 'code'));
  if (CHAT.some((re) => re.test(route))) return unfinishedChat(db, accountId, field(req.params, 'chat'));
  if (route === NUDGE) {
    const context = field(req.body, 'context');
    return (await unfinishedTrade(db, accountId, context)) || unfinishedChat(db, accountId, context);
  }
  return false;
}
