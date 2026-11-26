/**
 * The account owner's audit log of team members' actions (Plan 2 Task 18; spec 6.7, R44).
 *
 * `auditMember` is called inside the transaction of every member action that has an effect, so
 * the row exists exactly when the action committed; for the account owner's own actions it does
 * nothing. Reads never log. The table is append-only (migration 015's triggers). Trade codes in it
 * are cleared by the database itself when the trade is deleted (R36; migration 199's trigger on
 * `trades`), so no purge can forget it.
 */
import type pg from 'pg';
import { withTx } from '../auth/liveSession.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { hasAbility, type AbilityNeed } from './abilities.js';
import { assertInsideBand, bandOf, insideHours } from './limits.js';

/** Every action the log records. */
export type AuditAction =
  // Offers boxes.
  | 'offer-posted'
  | 'offer-paused'
  | 'offer-relisted'
  | 'offer-removed'
  // Trades boxes.
  | 'trade-taken'
  | 'trade-wallet-set'
  | 'dispute-opened'
  | 'appeal-filed'
  // Trade events a member may send (MEMBER_SIGNING_EVENTS are refused before this point).
  | 'mark-paid'
  | 'extend'
  | 'request-refund'
  | 'buyer-cancel'
  | 'propose-cancel'
  | 'accept-cancel'
  | 'withdraw-cancel'
  | 'walk-away'
  | 'confirm-cancel'
  // Owner p4-8: the lead's waiting changes, by a member the lead gave a hold box.
  | 'hold-changes-cancelled'
  | 'hold-changes-approved'
  // Notes on traders (S-094): added, never deleted by a member.
  | 'note-added'
  // Team tickets (owner Q69, J-14 ported): a member's support ticket, its lines and its close (never the text).
  | 'ticket-opened'
  | 'ticket-replied'
  | 'ticket-closed';

/**
 * Actions only the account owner takes that the team log still records (T-076, p7-1: every
 * release is logged with name and amount; members never release, so the name is the lead's).
 * Written only on a team account (one with a live member or open invite).
 */
export type LeadAuditAction = 'release-started';

/** The offer actions the member's trade-size band limits (J-20 review F2): the ones that create or widen exposure. */
export const BANDED_OFFER_ACTIONS: ReadonlySet<AuditAction> = new Set<AuditAction>(['offer-posted', 'offer-relisted']);

/** The box each action needs (the route's `requireSession({ member })`), checked again live by `auditMember`. */
export const ACTION_ABILITY: Readonly<Record<AuditAction, string>> = {
  'offer-posted': 'offers-post',
  'offer-paused': 'offers-pause',
  'offer-relisted': 'offers-pause',
  'offer-removed': 'offers-delete',
  'trade-taken': 'trades-take',
  'trade-wallet-set': 'trades-accept',
  // Never a member's (D-066: the route is owner-only); named so the map is total.
  'dispute-opened': 'disputes-open',
  'appeal-filed': 'disputes-appeal',
  'mark-paid': 'trades-mark-paid',
  extend: 'trades-extend',
  'request-refund': 'trades-cancel-no-show',
  'buyer-cancel': 'trades-cancel',
  'propose-cancel': 'trades-cancel',
  'accept-cancel': 'trades-cancel',
  'withdraw-cancel': 'trades-cancel',
  'walk-away': 'trades-cancel',
  'confirm-cancel': 'trades-confirm-cancel',
  // Hold model v3's (gone since 26 Nov 2026), kept so older log rows still read; no route writes them.
  'hold-changes-cancelled': 'hold-cancel',
  'hold-changes-approved': 'hold-end',
  'note-added': 'notes-add',
  'ticket-opened': 'support-open',
  'ticket-replied': 'support-open',
  'ticket-closed': 'support-open',
};

/** Who acted: the session's account and member (null for the account owner). */
export interface Actor {
  accountId: string;
  memberId: string | null;
}

/** A trade's amount, for its log rows ("every action logged with name and amount", T-076). */
async function tradeAmount(q: Queryable, code: string): Promise<Record<string, string>> {
  const { rows } = await q.query<{ amount_atomic: string; fiat_cents: string; locked_currency: string }>(
    'select amount_atomic::text, fiat_cents::text, locked_currency from trades where code = $1',
    [code],
  );
  const r = rows[0];
  return r ? { amountAtomic: r.amount_atomic, fiatCents: r.fiat_cents, currency: r.locked_currency } : {};
}

/** A JSON value a log row's detail may hold (plain facts: ids, numbers, flags, lists of them). */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
type Detail = Record<string, Json>;

/** One band of an offer in the log (migration 490's offer_tiers): its range in the offer's unit, its margin and its conditions. */
type AuditBand = { min: string; max: string; marginBps: number; minTrades: number | null; methodIds: string[] | null };

/**
 * An offer's terms, for its log rows (review 2026-11-09 M2, the owner's "name and amount" rule: an
 * offer has no single amount, so what a reader can check it against: its side and amount unit, each
 * currency with its bands (J-16, migration 490: the range in the unit's minor units, the margin over
 * that currency's market, the trade rule and the methods the band is for) and each method with its
 * price adjustment and the currencies it is offered in). Never the methods' payment instructions
 * (payment details stay out of the log, and a removed offer blanks them). A removed offer may be
 * deleted later, and then the log is the only record of what a member posted or switched.
 */
async function offerTerms(q: Queryable, offerId: string): Promise<Detail> {
  const { rows } = await q.query<{ side: string; amount_unit: string; price_mode: string }>(
    'select side, amount_unit, price_mode from offers where id = $1',
    [offerId],
  );
  const r = rows[0];
  if (!r) return { offerId };
  // Read in the caller's transaction, one statement at a time (the four tables are written once, in the post).
  const currencies = await q.query<{ currency: string }>('select currency from offer_currencies where offer_id = $1 order by position', [offerId]);
  const tiers = await q.query<{ currency: string; min_amount: string; max_amount: string; margin_bps: number; min_trades: number | null; method_ids: string[] | null }>(
    `select currency, min_amount::text, max_amount::text, margin_bps, min_trades, method_ids
       from offer_tiers where offer_id = $1 order by currency, position`,
    [offerId],
  );
  const methods = await q.query<{ method_id: string; adjust_bps: number }>('select method_id, adjust_bps from offer_methods where offer_id = $1 order by position', [offerId]);
  const pairs = await q.query<{ method_id: string; currency: string }>(
    `select p.method_id, p.currency from offer_method_currencies p join offer_currencies c using (offer_id, currency)
      where p.offer_id = $1 order by c.position`,
    [offerId],
  );
  const bands = new Map<string, AuditBand[]>();
  for (const t of tiers.rows) {
    const list = bands.get(t.currency) ?? [];
    list.push({ min: t.min_amount, max: t.max_amount, marginBps: t.margin_bps, minTrades: t.min_trades, methodIds: t.method_ids });
    bands.set(t.currency, list);
  }
  return {
    offerId,
    side: r.side,
    amountUnit: r.amount_unit,
    priceMode: r.price_mode,
    currencies: currencies.rows.map((c) => ({ currency: c.currency, bands: bands.get(c.currency) ?? [] })),
    methods: methods.rows.map((m) => ({
      methodId: m.method_id,
      adjustBps: m.adjust_bps,
      currencies: pairs.rows.filter((p) => p.method_id === m.method_id).map((p) => p.currency),
    })),
  };
}

/**
 * Writes one audit row for a member's action (nothing for the account owner). `detail` must hold
 * no wallet address, key, token, secret, IP address or user agent: ids and plain facts only. On a
 * trade the row also gets the trade's amount (XMR atomic, fiat cents and currency), on an offer its
 * terms (side, unit, currencies with their bands, methods: `offerTerms`, read in the action's
 * transaction after its write, so every offer route passes `offerId`); the member's name is the
 * log's join on `team_members` (the row stays after removal).
 *
 * Review M1: `requireSession` checked the member before the handler ran, and a removal or a box
 * change may have committed since. So the member's row is read again here `for share`, inside the
 * action's transaction: a removal or abilities change (both UPDATE that row) either waits for this
 * action to commit, or has committed and this action is refused and rolls back: 401
 * `not-authenticated` for a removed member, 403 `forbidden` for one who no longer holds the box.
 */
export async function auditMember(
  q: Queryable,
  actor: Actor,
  a: { action: AuditAction; tradeCode?: string | null; offerId?: string; detail?: Detail },
  now: Date,
): Promise<void> {
  if (actor.memberId === null) return;
  // J-20 review F2 (p11-134, lead default): the band applies to an offer only when the action puts
  // it in front of takers (post, relist); pausing and removing it always work.
  const banded = a.offerId !== undefined && BANDED_OFFER_ACTIONS.has(a.action) ? a.offerId : null;
  await assertLiveMember(q, actor, ACTION_ABILITY[a.action], now, { tradeCode: a.tradeCode ?? null, offerId: banded });
  const detail = {
    ...(a.tradeCode ? await tradeAmount(q, a.tradeCode) : {}), ...(a.offerId ? await offerTerms(q, a.offerId) : {}), ...(a.detail ?? {}),
  };
  await q.query(
    'insert into team_audit (account_id, member_id, at, action, trade_code, detail) values ($1, $2, $3, $4, $5, $6)',
    [actor.accountId, actor.memberId, now, a.action, a.tradeCode ?? null, JSON.stringify(detail)],
  );
}

/**
 * The account owner's own action that the team log records (`LeadAuditAction`), with the trade's
 * amount; only on a team account (a live member or open invite now), and never for a member (who
 * cannot take these actions at all). The row's `member_id` is null: "the lead".
 */
export async function auditLead(q: Queryable, actor: Actor, a: { action: LeadAuditAction; tradeCode: string }, now: Date): Promise<void> {
  if (actor.memberId !== null) return;
  const { rows } = await q.query('select 1 from team_members where account_id = $1 and removed_at is null and (joined_at is not null or invite_expires_at > $2) limit 1', [
    actor.accountId, now,
  ]);
  if (rows.length === 0) return;
  await q.query('insert into team_audit (account_id, member_id, at, action, trade_code, detail) values ($1, null, $2, $3, $4, $5)', [
    actor.accountId, now, a.action, a.tradeCode, JSON.stringify(await tradeAmount(q, a.tradeCode)),
  ]);
}

/**
 * The live check alone (review round 2, n2): for a member, reads the member's row again `for
 * share` inside the caller's transaction and refuses a removed member (401 `not-authenticated`) or
 * one who no longer holds `need` (403 `forbidden`), exactly as `auditMember` does, without writing
 * a log row. For a write a member's request causes that is not itself an audited action (the
 * `return-confirmed` a member's Confirm cancel records first). Nothing for the account owner.
 *
 * J-20, read from the same locked row: outside the member's working hours at `now` → 401
 * `outside-login-hours` (p7-11); an action on a trade (`on.tradeCode`) or an offer (`on.offerId`)
 * outside the member's trade-size band → 403 `outside-trade-band` (p7-4, team/limits.ts).
 */
export async function assertLiveMember(
  q: Queryable,
  actor: Actor,
  need: AbilityNeed,
  now: Date,
  on: { tradeCode?: string | null; offerId?: string | null } = {},
): Promise<void> {
  if (actor.memberId === null) return;
  const { rows } = await q.query<{ abilities: string[]; band_min_atomic: string | null; band_max_atomic: string | null; hours: unknown }>(
    `select tm.abilities, tm.band_min_atomic::text, tm.band_max_atomic::text, tm.hours from team_members tm
      where tm.id = $1 and tm.account_id = $2 and tm.removed_at is null and tm.joined_at is not null
      for share`,
    [actor.memberId, actor.accountId],
  );
  const live = rows[0];
  if (!live) throw new ApiError(401, 'not-authenticated');
  if (!hasAbility(live.abilities, need)) throw new ApiError(403, 'forbidden');
  if (!insideHours(live.hours, now)) throw new ApiError(401, 'outside-login-hours');
  await assertInsideBand(q, bandOf(live.band_min_atomic, live.band_max_atomic), on);
}

// ---- Reading the log (team audit v2, migration 855) ----

/** What a row is about: a member's work, the team's own changes, or access (logins, sessions, refused attempts). */
export type AuditCategory = 'work' | 'team' | 'access';
export const AUDIT_CATEGORIES: readonly AuditCategory[] = ['work', 'team', 'access'];
export type ActorKind = 'member' | 'lead' | 'system';

/** Actions the database writes itself (migration 855's triggers) and the API's refused-attempt row. */
export const TEAM_ACTIONS = ['member-invited', 'member-joined', 'abilities-changed', 'limits-changed', 'member-removed', 'invite-closed'] as const;
export const ACCESS_ACTIONS = ['member-login', 'session-ended', 'attempt-refused', 'attempts-throttled'] as const;

export interface AuditEntry {
  id: string;
  at: string;
  /** Who acted: a member (memberId set), the account owner, or X2F itself. */
  actorKind: ActorKind;
  /** The member who acted, or null for the account owner or X2F. */
  memberId: string | null;
  memberName: string | null;
  /** True for the account owner's own row (kept for older clients). */
  byLead: boolean;
  /** The member the row is about (the actor for their own work; the member changed, logged in or refused). */
  subjectId: string | null;
  subjectName: string | null;
  category: AuditCategory;
  action: string;
  tradeCode: string | null;
  detail: unknown;
  /** The chain link (hex): SHA-256(prevHash || line). */
  hash: string;
  prevHash: string | null;
}

export const AUDIT_PAGE = 200;
/** At most this many rows in one export; a bigger log is exported in date ranges. */
export const AUDIT_EXPORT_MAX = 20_000;

export interface AuditFilter {
  from?: Date;
  to?: Date;
  /** Rows a member acted in or is the subject of (any of these). */
  members?: readonly string[];
  categories?: readonly AuditCategory[];
  actions?: readonly string[];
  tradeCode?: string;
  /** Paging: only rows with a smaller id (the previous page's `next`). */
  before?: string;
  /** A member reading their own log (the `team-see-log` box): only rows they acted in or are about. */
  onlyMember?: string;
  limit?: number;
}

interface RawRow {
  id: string;
  at: Date;
  actor_kind: ActorKind;
  member_id: string | null;
  actor_name: string | null;
  subject_id: string | null;
  subject_name: string | null;
  category: AuditCategory;
  action: string;
  trade_code: string | null;
  detail: unknown;
  hash: Buffer;
  prev_hash: Buffer | null;
  line?: string;
}

function where(accountId: string, f: AuditFilter): { sql: string; params: unknown[] } {
  const params: unknown[] = [accountId];
  const parts = ['l.account_id = $1'];
  const add = (sql: (n: string) => string, v: unknown) => {
    params.push(v);
    parts.push(sql(`$${params.length}`));
  };
  if (f.from) add((n) => `l.at >= ${n}`, f.from);
  if (f.to) add((n) => `l.at < ${n}`, f.to);
  if (f.members && f.members.length > 0) add((n) => `(l.member_id = any(${n}::uuid[]) or l.subject_id = any(${n}::uuid[]))`, f.members);
  if (f.onlyMember) add((n) => `(l.member_id = ${n}::uuid or l.subject_id = ${n}::uuid)`, f.onlyMember);
  if (f.categories && f.categories.length > 0) add((n) => `l.category = any(${n}::text[])`, f.categories);
  if (f.actions && f.actions.length > 0) add((n) => `l.action = any(${n}::text[])`, f.actions);
  if (f.tradeCode) add((n) => `l.trade_commit = sha256(convert_to(${n}::text, 'UTF8'))`, f.tradeCode);
  if (f.before) add((n) => `l.id < ${n}::bigint`, f.before);
  return { sql: parts.join(' and '), params };
}

const SELECT = `select l.id::text as id, l.at, l.actor_kind, l.member_id, am.trade_tag as actor_name,
                       l.subject_id, sm.trade_tag as subject_name, l.category, l.action, l.trade_code, l.detail,
                       l.hash, l.prev_hash`;
const FROM = `from team_audit l
          left join team_members am on am.id = l.member_id
          left join team_members sm on sm.id = l.subject_id`;

function entryOf(r: RawRow): AuditEntry {
  return {
    id: r.id, at: r.at.toISOString(), actorKind: r.actor_kind, memberId: r.member_id, memberName: r.actor_name,
    byLead: r.actor_kind === 'lead', subjectId: r.subject_id, subjectName: r.subject_name, category: r.category,
    action: r.action, tradeCode: r.trade_code, detail: r.detail, hash: r.hash.toString('hex'), prevHash: r.prev_hash?.toString('hex') ?? null,
  };
}

/** One page of the account's log, newest first, with the id to pass as `before` for the next page (null at the end). */
export async function listAudit(q: Queryable, accountId: string, f: AuditFilter = {}): Promise<{ entries: AuditEntry[]; next: string | null }> {
  const limit = Math.min(Math.max(f.limit ?? AUDIT_PAGE, 1), AUDIT_PAGE);
  const w = where(accountId, f);
  const { rows } = await q.query<RawRow>(`${SELECT} ${FROM} where ${w.sql} order by l.id desc limit ${limit + 1}`, w.params);
  const page = rows.slice(0, limit).map(entryOf);
  return { entries: page, next: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null };
}

/** An export row: the entry and the exact text its hash covers, so the chain can be re-checked offline. */
export interface ExportRow extends AuditEntry {
  line: string;
}

/** Every row the filter matches, oldest first (at most `AUDIT_EXPORT_MAX`; `truncated` says when there were more). */
export async function exportAudit(q: Queryable, accountId: string, f: AuditFilter = {}): Promise<{ rows: ExportRow[]; truncated: boolean }> {
  const { before: _paging, ...all } = f;
  const w = where(accountId, all);
  const { rows } = await q.query<RawRow>(
    `${SELECT}, team_audit_line(l) as line ${FROM} where ${w.sql} order by l.id asc limit ${AUDIT_EXPORT_MAX + 1}`,
    w.params,
  );
  return { rows: rows.slice(0, AUDIT_EXPORT_MAX).map((r) => ({ ...entryOf(r), line: r.line ?? '' })), truncated: rows.length > AUDIT_EXPORT_MAX };
}

/** A fingerprint the owner kept: an entry id and its hash (hex). */
export interface Fingerprint {
  id: string;
  hash: string;
}

export interface AuditIntegrity {
  /** The whole chain re-computes and links. */
  ok: boolean;
  entries: number;
  /** The first row that fails, when not ok. */
  brokenAt: string | null;
  /** The last good row: the fingerprint to keep. */
  head: Fingerprint | null;
  /** When a fingerprint was given: it is still in the chain with the same hash (and the chain is ok up to it). */
  fingerprint?: { id: string; matches: boolean };
}

/** Re-computes the account's chain (`team_audit_verify`) and, if given, checks a kept fingerprint against it. */
export async function verifyAudit(q: Queryable, accountId: string, kept?: Fingerprint): Promise<AuditIntegrity> {
  const { rows } = await q.query<{ ok: boolean; entries: string; broken_at: string | null; head_id: string | null; head_hash: Buffer | null }>(
    'select ok, entries::text, broken_at::text, head_id::text, head_hash from team_audit_verify($1)',
    [accountId],
  );
  const v = rows[0]!;
  const out: AuditIntegrity = {
    ok: v.ok, entries: Number(v.entries), brokenAt: v.broken_at,
    head: v.head_id !== null && v.head_hash !== null ? { id: v.head_id, hash: v.head_hash.toString('hex') } : null,
  };
  if (kept) {
    const { rows: k } = await q.query<{ hash: Buffer }>('select hash from team_audit where account_id = $1 and id = $2::bigint', [accountId, kept.id]);
    const stored = k[0]?.hash.toString('hex');
    // A kept row past the first broken one cannot be vouched for, even if its stored hash matches.
    const before = v.ok || (v.broken_at !== null && BigInt(kept.id) < BigInt(v.broken_at));
    out.fingerprint = { id: kept.id, matches: stored !== undefined && stored === kept.hash.toLowerCase() && before };
  }
  return out;
}

export interface MemberSummary {
  memberId: string;
  name: string;
  status: 'invited' | 'active' | 'removed';
  /** Rows the member acted in, by category, in the window. */
  work: number;
  logins: number;
  refused: number;
  /** Rows about the member written by the account owner (box and limit changes) in the window. */
  changes: number;
  lastActionAt: string | null;
  lastLoginAt: string | null;
}

/** Per member, what the log holds for them since `since` (the screen's overview cards). */
export async function summariseAudit(q: Queryable, accountId: string, since: Date): Promise<MemberSummary[]> {
  const { rows } = await q.query<{
    id: string; trade_tag: string; joined_at: Date | null; removed_at: Date | null;
    work: string; logins: string; refused: string; changes: string; last_action_at: Date | null; last_login_at: Date | null;
  }>(
    `select m.id, m.trade_tag, m.joined_at, m.removed_at,
            count(*) filter (where l.category = 'work' and l.member_id = m.id)::text as work,
            count(*) filter (where l.action = 'member-login')::text as logins,
            count(*) filter (where l.action = 'attempt-refused')::text as refused,
            count(*) filter (where l.category = 'team' and l.actor_kind = 'lead')::text as changes,
            max(l.at) filter (where l.member_id = m.id and l.category = 'work') as last_action_at,
            max(l.at) filter (where l.action = 'member-login') as last_login_at
       from team_members m
       left join team_audit l on l.account_id = m.account_id and l.subject_id = m.id and l.at >= $2
      where m.account_id = $1
      group by m.id
      order by (m.removed_at is not null), m.created_at`,
    [accountId, since],
  );
  return rows.map((r) => ({
    memberId: r.id, name: r.trade_tag,
    status: r.removed_at !== null ? 'removed' : r.joined_at !== null ? 'active' : 'invited',
    work: Number(r.work), logins: Number(r.logins), refused: Number(r.refused), changes: Number(r.changes),
    lastActionAt: r.last_action_at?.toISOString() ?? null, lastLoginAt: r.last_login_at?.toISOString() ?? null,
  }));
}

// ---- Refused attempts (category 'access') ----

/** The refusals that say a member reached past what they may do, and so belong in the log. */
export const REFUSAL_CODES: ReadonlySet<string> = new Set(['owner-only', 'forbidden', 'outside-trade-band', 'outside-login-hours', 'member-cannot-sign']);
/** At most this many refused-attempt rows per member per hour, so a looping client cannot flood the log; one more row says so. */
export const REFUSALS_PER_HOUR = 30;

/**
 * Logs one refused request by a member: the route pattern (never the URL with its ids or query),
 * the method and the refusal code. Its own statement, after the refused request rolled back.
 */
export async function auditRefusal(
  pool: pg.Pool,
  who: { accountId: string; memberId: string },
  r: { method: string; route: string; code: string },
  now: Date,
): Promise<void> {
  // Count and insert under the account's chain lock (the one team_audit_chain takes), so two refusals
  // at once cannot both see 30 and write two attempts-throttled rows.
  await withTx(pool, async (q) => {
    await q.query('select pg_advisory_xact_lock(7240002, hashtext($1::text))', [who.accountId]);
    const { rows } = await q.query<{ n: number }>(
      `select count(*)::int as n from team_audit
        where account_id = $1 and subject_id = $2 and action in ('attempt-refused', 'attempts-throttled') and at > $3`,
      [who.accountId, who.memberId, new Date(now.getTime() - 3_600_000)],
    );
    const n = rows[0]?.n ?? 0;
    if (n > REFUSALS_PER_HOUR) return;
    const throttled = n === REFUSALS_PER_HOUR;
    await q.query(
      `insert into team_audit (account_id, member_id, actor_kind, subject_id, category, at, action, detail)
       select $1, $2, 'member', $2, 'access', $3, $4, $5
        where exists (select 1 from team_members where id = $2 and account_id = $1)`,
      [
        who.accountId, who.memberId, now, throttled ? 'attempts-throttled' : 'attempt-refused',
        JSON.stringify(throttled ? { perHour: REFUSALS_PER_HOUR } : { method: r.method, route: r.route.slice(0, 120), reason: r.code }),
      ],
    );
  });
}
