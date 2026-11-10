/**
 * The account owner's audit log of team members' actions (Plan 2 Task 18; spec 6.7, R44).
 *
 * `auditMember` is called inside the transaction of every member action that has an effect, so
 * the row exists exactly when the action committed; for the account owner's own actions it does
 * nothing. Reads never log. The table is append-only (migration 015's triggers). Trade codes in it
 * are cleared by the database itself when the trade is deleted (R36; migration 199's trigger on
 * `trades`), so no purge can forget it.
 */
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
  | 'note-added';

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
  // A stronger hold box includes the weaker ones (`effectiveAbilities`).
  'hold-changes-cancelled': 'hold-cancel',
  'hold-changes-approved': 'hold-end',
  'note-added': 'notes-add',
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

export interface AuditEntry {
  id: string;
  at: string;
  /** Null for the account owner's own row (`auditLead`). */
  memberId: string | null;
  memberName: string | null;
  byLead: boolean;
  action: string;
  tradeCode: string | null;
  detail: unknown;
}

export const AUDIT_PAGE = 200;

/** The account's log, newest first, at most `AUDIT_PAGE` rows, optionally within [from, to) and for one member. */
export async function listAudit(
  q: Queryable,
  accountId: string,
  f: { from?: Date; to?: Date; memberId?: string } = {},
): Promise<AuditEntry[]> {
  const { rows } = await q.query<{ id: string; at: Date; member_id: string | null; display_name: string | null; action: string; trade_code: string | null; detail: unknown }>(
    `select l.id::text as id, l.at, l.member_id, m.display_name, l.action, l.trade_code, l.detail
       from team_audit l left join team_members m on m.id = l.member_id
      where l.account_id = $1
        and ($2::timestamptz is null or l.at >= $2) and ($3::timestamptz is null or l.at < $3)
        and ($4::uuid is null or l.member_id = $4)
      order by l.at desc, l.id desc limit ${AUDIT_PAGE}`,
    [accountId, f.from ?? null, f.to ?? null, f.memberId ?? null],
  );
  return rows.map((r) => ({
    id: r.id, at: r.at.toISOString(), memberId: r.member_id, memberName: r.display_name, byLead: r.member_id === null,
    action: r.action, tradeCode: r.trade_code, detail: r.detail,
  }));
}
