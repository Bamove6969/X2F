/**
 * Plan 4 Task 27: what a ban (account_bans, migration 560) means on the trader side. Both kinds stop
 * trading: a trade ban is no new trades or offers, and a site ban includes that. A ban stands
 * until `until` by the server clock (null = lifetime), or until staff lift it; `settleEndedBans`
 * (staff/bans.ts) then writes `ended_at` and the log entry.
 *
 * The point checks (posting, taking, the site gate) read `until` against the clock, so a ban ends to
 * the second. The offer lists cannot (their queries carry no clock): they hide the offers of an
 * account whose ban has no `ended_at` yet, so a timed ban's offers come back within the settle
 * job's minute.
 */
import type { BanReasonCode } from '@x2f/staff';
import type { Queryable } from './db/pool.js';

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

/** True while any ban stops this account trading at `now`. */
export async function tradeBanned(db: Queryable, accountId: string, now: Date): Promise<boolean> {
  return (await activeBans(db, accountId, now)).length > 0;
}

/** The site ban in force at `now`, or null. */
export async function siteBan(db: Queryable, accountId: string, now: Date): Promise<ActiveBan | null> {
  return (await activeBans(db, accountId, now)).find((b) => b.kind === 'site') ?? null;
}

/** An open trade or a dispute not closed (an open appeal included): what a site-banned person may still finish. */
export async function hasUnfinished(db: Queryable, accountId: string): Promise<boolean> {
  const { rows } = await db.query<{ open: boolean }>(
    `select exists (select 1 from trades t where (t.seller_account_id = $1 or t.buyer_account_id = $1) and t.closed_at is null)
         or exists (select 1 from disputes d join trades t on t.code = d.code
                     where (t.seller_account_id = $1 or t.buyer_account_id = $1) and d.status <> 'closed') as open`,
    [accountId],
  );
  return rows[0]!.open;
}

/**
 * Task 27, 2026-10-29b ("a site-banned user can log in only while something is unfinished ... they
 * can then reach only what finishes it"): the trader routes a site-banned session reaches. Always:
 * the notice and who they are (the app shell). With an open trade or dispute: the trade's own
 * routes (its events, wallet step, chat, dispute and appeal; never its review), the chats, the
 * live events, and reading wallets and alerts. Nothing that starts anything new.
 */
const ALWAYS = new Set(['GET /v1/account/ban', 'GET /v1/account/me', 'GET /v1/terms', 'POST /v1/account/terms']);
const TO_FINISH: readonly RegExp[] = [
  /^(GET|HEAD) \/v1\/trades\/:code(\/(attestation|confirmations|dispute))?$/,
  /^POST \/v1\/trades\/:code\/(events|wallet|identity|chat|dispute|appeal)$/,
  /^(GET|HEAD) \/v1\/chats(\/:chat(\/(attestation|envelopes))?)?$/,
  /^POST \/v1\/chats\/:chat\/(envelopes|identity)$/,
  /^(GET|HEAD) \/v1\/events$/,
  /^(GET|HEAD) \/v1\/wallets(\/rule)?$/,
  /^(GET|HEAD) \/v1\/account\/alerts$/,
];

export function siteBanAllows(route: string, unfinished: boolean): boolean {
  if (ALWAYS.has(route) || ALWAYS.has(route.replace(/^HEAD /, 'GET '))) return true;
  return unfinished && TO_FINISH.some((re) => re.test(route));
}
