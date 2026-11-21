import {
  NEGATIVE_MAX_STARS,
  POSITIVE_MIN_STARS,
  bothRolesTypical,
  earnedBadges,
  resolveVisibility,
  typicalMinutes,
  type BadgeId,
  type BadgePrefs,
} from '@x2f/reputation';
import type { Queryable } from '../db/pool.js';
import { PUBLIC_NAME_COLUMN } from '../events/publicName.js';
import { verifiedPastRepBySite } from '../pastrep/store.js';
import { reviewCountsSql } from '../reviews/disputes.js';
import { prefsFromRow } from '../reputation/prefs.js';
import { importedLines, tradedOverXmr, tradedXmrSql, type ImportedLine } from './tradedTotal.js';
import { FINAL_SALES_SQL, rulingCountsSql } from './finalOutcome.js';
import { COMPLETED_TRADES_SQL, loadStarterSettings, purgedSql, stageFor, type Stage, type StarterSettings } from './stage.js';

/**
 * A trader as anyone else sees them (plan Task 4): on offer cards (`GET /v1/offers`), the
 * single-offer route and the trade view's counterparty. The trust row (design review 8 Nov, item 5)
 * is real data: `positivePct` from submitted reviews, `typicalMinutes` from the running action-time
 * lists (traders/actionTimes.ts) and `badges` from @x2f/reputation's earning rules.
 *
 * `displayName` is the PUBLIC display name (spec 6.1, FU-A), read through events/publicName.ts's
 * column; never the private login name.
 */
export interface TraderSummary {
  /** The public display name; the private login name is never shown to anyone. */
  displayName: string;
  completedTrades: number;
  online: boolean;
  lastSeenAt: string | null;
  typicalMinutes: number | null;
  positivePct: number | null;
  /**
   * The badges shown, Featured first, then the "+N" list (Plan 5 Task 5): earned from records on
   * every read, in the trader's own visibility (badge_prefs); Hidden ones are left out.
   */
  badges: string[];
  /** How many of `badges` are Featured (New included while it shows); the rest are the "+N" list. */
  featuredBadges: number;
  /** The starter-limits stage (spec 2.3; plan Task 4 Revision 2026-10-26): the New badge shows until 'graduated'. */
  stage: Stage;
  /**
   * Owner Q63 (6 Nov 2026; was C12b's dollars): the "X+ XMR traded to date" line, X in whole XMR
   * rounded down (@x2f/reputation `tradedBucketXmr`); null unless the trader opted in and has traded
   * MORE than 10 XMR. Never the exact total.
   */
  tradedOverXmr: number | null;
  /** Owner Q64, p4-1: verified imported volume, one line per site in whole US dollars (opt-in like the XMR line; [] when off). */
  imported: ImportedLine[];
  /**
   * D-049 (owner 28 Oct, leaning yes; lead default, J-21): the profile's "Disputes: N won, M lost",
   * each dispute by its latest ruling. Public, like the Clean record badge it already feeds.
   */
  disputes: { won: number; lost: number };
}

/** Someone counts as online when one of their sessions was used this recently (to the 5-minute bucket: see `onlineSince`). */
export const ONLINE_MS = 5 * 60_000;

/** `lastSeenAt` is rounded down to this step. */
export const LAST_SEEN_STEP_MS = 5 * 60_000;

/**
 * Online means a session was used in the current or the previous 5-minute bucket (round-2 review
 * Minor 2): so for 5 to 10 minutes after the last request, and the answer only changes on a bucket
 * boundary. An exact "less than 5 minutes ago" flipped to offline exactly 5 minutes after the last
 * request, so anyone polling an offer learned that request's time, which flooring `lastSeenAt`
 * hides. `online` is therefore a function of the public `lastSeenAt` and the clock.
 */
export function onlineSince(now: Date): Date {
  return new Date((Math.floor(now.getTime() / LAST_SEEN_STEP_MS) * LAST_SEEN_STEP_MS) - ONLINE_MS);
}

/**
 * The newest use of `account`'s live sessions, in SQL; null to a `viewer` (a uuid expression, may
 * be null) the account has blocked. Online status is private data (owner ruling 2026-10-28): a
 * blocked person must not even see that someone is online, so to them the account looks like one
 * with no live session (as after logging out everywhere), which does not tell them about the block.
 */
export function lastSeenSql(account: string, viewer: string): string {
  return `(select max(s.last_seen_at) from sessions s where s.account_id = ${account} and s.revoked_at is null
    and not exists (select 1 from account_blocks b where b.account_id = ${account} and b.blocked_id = ${viewer}))`;
}

/**
 * SQL: the disputes `a.id` lost, by each dispute's latest ruling (Plan 5's Clean record). A release
 * to the buyer, or the seller told to send XMR or return fiat, is lost by the seller; a refund to the
 * seller is lost by the buyer. Task 20: the live trades' rulings plus `purged_lost`, which the trade
 * purge adds each purged trade's count to in the same transaction (701, retention/tradePurge.ts), so
 * deleting a trade changes nothing. A dispute whose appeal is pending counts neither way until the appeal is
 * decided (R-011 / R-012, J-21 review F1; `rulingCountsSql`, shared with J-21's won count).
 */
export const LOST_DISPUTES_SQL = `(${lostDisputesLiveSql()} + ${purgedSql('purged_lost')})`;

/** LOST_DISPUTES_SQL's live part alone, with `extra` added to its WHERE (trade alias `t`; see completedTradesLiveSql). */
export function lostDisputesLiveSql(extra = ''): string {
  return `(select count(*) from dispute_rulings dr join trades t on t.code = dr.code
   where not exists (select 1 from dispute_rulings d2 where d2.code = dr.code and d2.seq = dr.seq and d2.round > dr.round)
     and ${rulingCountsSql('dr.code', 'dr.seq')}
     and ((dr.outcome in ('release-to-buyer', 'seller-sends-xmr', 'seller-returns-fiat') and t.seller_account_id = a.id)
       or (dr.outcome = 'refund-to-seller' and t.buyer_account_id = a.id)) ${extra})`;
}

/**
 * SQL: the disputes `a.id` won, the mirror of LOST_DISPUTES_SQL by the same latest ruling: a release
 * to the buyer, or the seller told to send XMR or return fiat, is won by the buyer; a refund to the
 * seller is won by the seller. An after-refund "no action" ruling counts for neither side, as in
 * LOST_DISPUTES_SQL (owner question, J-21). Live plus `purged_won`, as LOST_DISPUTES_SQL. A dispute
 * whose appeal is pending counts for neither side until the appeal is decided (`rulingCountsSql`, the
 * same helper as the lost count: Revision 2026-10-29c, Task 20 review).
 */
export const WON_DISPUTES_SQL = `(${wonDisputesLiveSql()} + ${purgedSql('purged_won')})`;

/** WON_DISPUTES_SQL's live part alone, with `extra` added to its WHERE (trade alias `t`; see completedTradesLiveSql). */
export function wonDisputesLiveSql(extra = ''): string {
  return `(select count(*) from dispute_rulings dr join trades t on t.code = dr.code
   where not exists (select 1 from dispute_rulings d2 where d2.code = dr.code and d2.seq = dr.seq and d2.round > dr.round)
     and ${rulingCountsSql('dr.code', 'dr.seq')}
     and ((dr.outcome in ('release-to-buyer', 'seller-sends-xmr', 'seller-returns-fiat') and t.buyer_account_id = a.id)
       or (dr.outcome = 'refund-to-seller' and t.seller_account_id = a.id)) ${extra})`;
}

/**
 * Everything the profile and badge settings need beside the summary (Plan 5 Task 5), from the same
 * single query: never returned as is.
 */
export interface TraderFacts {
  summary: TraderSummary;
  /** Every earned badge, Hidden ones included (the owner's own settings list them). */
  earned: BadgeId[];
  prefs: BadgePrefs;
  shown: { featured: BadgeId[]; more: BadgeId[] };
  createdAt: Date;
  /** Released trades plus settled disputes whoever won, as the badges count them. */
  completedTrades: number;
  lostDisputes: number;
  /** Positive and negative reviews behind `positivePct`. */
  ratedReviews: number;
}

/** A trader's side, for the typical time a card shows: a seller's release time, a buyer's payment time. */
export type SummaryRole = 'buyer' | 'seller';

/**
 * The summaries of `accountIds` (unknown ids are left out), in one query, as `viewerId` (the signed-in
 * trader asking, or null) may see them: `online` and `lastSeenAt` are hidden from someone the
 * account has blocked. `roles` picks each account's typical time (P5-A8): as seller, the release
 * time ("Releases in ~8 min"); as buyer, the payment time ("Pays in ~6 min"); with no role, the
 * median of both lists' last 20 together (@x2f/reputation bothRolesTypical).
 */
export async function traderSummaries(
  q: Queryable,
  accountIds: readonly string[],
  now: Date,
  viewerId: string | null,
  settings?: StarterSettings,
  roles?: ReadonlyMap<string, SummaryRole>,
): Promise<Map<string, TraderSummary>> {
  const facts = await traderFacts(q, accountIds, now, viewerId, settings, roles);
  return new Map([...facts].map(([id, f]) => [id, f.summary]));
}

/** `traderSummaries` with the facts behind each summary (one query for any number of accounts). */
export async function traderFacts(
  q: Queryable,
  accountIds: readonly string[],
  now: Date,
  viewerId: string | null,
  settings?: StarterSettings,
  roles?: ReadonlyMap<string, SummaryRole>,
): Promise<Map<string, TraderFacts>> {
  const out = new Map<string, TraderFacts>();
  const ids = [...new Set(accountIds)];
  if (ids.length === 0) return out;
  const s = settings ?? (await loadStarterSettings(q));
  // The name column is a constant, never input.
  const { rows } = await q.query<{
    id: string; name: string; created_at: Date; completed: string; sales: string; fast: number; last_seen: Date | null; show_traded: boolean; traded: string;
    positive: string; negative: string; pay: number[] | null; release: number[] | null; pgp: boolean; security_key: boolean; lost: string; won: string;
    bp_chosen: boolean | null; bp_levels: unknown; bp_order: string[] | null;
  }>(
    `select a.id, a.${PUBLIC_NAME_COLUMN} as name, a.created_at,
            ${COMPLETED_TRADES_SQL} as completed,
            ${FINAL_SALES_SQL} as sales,
            coalesce((select tt.fast_payments from account_traded_totals tt where tt.account_id = a.id), 0) as fast,
            ${lastSeenSql('a.id', '$2::uuid')} as last_seen,
            a.show_traded_total as show_traded, ${tradedXmrSql('a.id')}::text as traded,
            rv.positive, rv.negative,
            (select m.minutes from account_action_minutes m where m.account_id = a.id and m.kind = 'pay') as pay,
            (select m.minutes from account_action_minutes m where m.account_id = a.id and m.kind = 'release') as release,
            exists (select 1 from pgp_keys k where k.account_id = a.id) as pgp,
            exists (select 1 from webauthn_credentials w where w.account_id = a.id and w.kind = 'security-key') as security_key,
            ${LOST_DISPUTES_SQL} as lost,
            ${WON_DISPUTES_SQL} as won,
            bp.chosen as bp_chosen, bp.levels as bp_levels, bp.featured_order as bp_order
       from accounts a
       left join badge_prefs bp on bp.account_id = a.id
       cross join lateral (
         select count(*) filter (where not r.neutral and r.stars >= $3) as positive,
                count(*) filter (where not r.neutral and r.stars <= $4) as negative
           from reviews r where r.subject_id = a.id and ${reviewCountsSql('r')}
       ) rv
      where a.id = any($1::uuid[])`,
    [ids, viewerId, POSITIVE_MIN_STARS, NEGATIVE_MAX_STARS],
  );
  const since = onlineSince(now).getTime();
  const sites = await verifiedPastRepBySite(q, rows.filter((r) => r.show_traded).map((r) => r.id));
  for (const r of rows) {
    // The stage counts R38's way (a settled dispute whoever won, no automatic drop: D-048); the count
    // traders see and the badges follow the final binding outcome (R-012, traders/finalOutcome.ts).
    // Which one should drive the stage is an owner question.
    const stage = stageFor(s, Number(r.completed), r.created_at, now);
    const completed = Number(r.sales);
    // % positive (P5-A2, @x2f/reputation positivePct): positive over positive plus negative, rounded
    // down; Neutral and 3 stars count for neither. A review on hold while its trade's appeal is
    // pending (R-011), one under review (an open dispute, Task 19) and one a moderator removed count
    // for neither (reviews/disputes.ts reviewCountsSql).
    const positive = Number(r.positive);
    const rated = positive + Number(r.negative);
    const positivePct = rated === 0 ? null : Math.floor((positive * 100) / rated);
    const pay = r.pay ?? [];
    const release = r.release ?? [];
    // Both lists' last 20 together (review 2, I2): a plain concatenation's "last 20" was only releases.
    const role = roles?.get(r.id);
    const typical = role === 'seller' ? typicalMinutes(release) : role === 'buyer' ? typicalMinutes(pay) : bothRolesTypical(pay, release).minutes;
    const earned = earnedBadges(
      {
        stage,
        completedTrades: completed,
        positivePct,
        ratedReviews: rated,
        // Fast (R-042): 30 payments sent in under half the time to pay (traders/actionTimes.ts countFastPayment).
        fastPayments: r.fast,
        // Review 2, M1 (was NEEDS_TASK_20_LOST_DISPUTES): Clean record reads the lost disputes of the
        // live trades plus those the Plan 7 trade purge moved into `purged_lost` (701), so deleting a
        // trade never makes it claim "no lost disputes" falsely.
        lostDisputes: Number(r.lost),
        accountCreatedAt: r.created_at,
        hasPgp: r.pgp,
        hasSecurityKey: r.security_key,
        // Past reputation shows as its own verified lines (`imported`), not as a card badge.
        pastRep: [],
      },
      now,
    );
    // The trader's own visibility (Plan 5 Task 5, badge_prefs); before a first choice the spec 5.4
    // defaults: New first, then Trusted, a trade milestone, Fast, Veteran in the featured slots,
    // every other earned badge after. New always shows; Hidden badges are in neither list.
    const prefs = prefsFromRow({ chosen: r.bp_chosen, levels: r.bp_levels, featured_order: r.bp_order });
    const shown = resolveVisibility(earned, prefs);
    const summary: TraderSummary = {
      displayName: r.name,
      completedTrades: completed,
      online: r.last_seen !== null && r.last_seen.getTime() >= since,
      // Public, so only to the 5 minutes, floored (review M3): enough for "last seen", not for timing someone's requests.
      lastSeenAt: r.last_seen === null ? null : new Date(Math.floor(r.last_seen.getTime() / LAST_SEEN_STEP_MS) * LAST_SEEN_STEP_MS).toISOString(),
      typicalMinutes: typical,
      positivePct,
      badges: [...shown.featured, ...shown.more],
      featuredBadges: shown.featured.length,
      stage,
      tradedOverXmr: tradedOverXmr(r.show_traded, r.traded),
      imported: r.show_traded ? importedLines(sites.get(r.id)) : [],
      disputes: { won: Number(r.won), lost: Number(r.lost) },
    };
    out.set(r.id, { summary, earned, prefs, shown, createdAt: r.created_at, completedTrades: completed, lostDisputes: Number(r.lost), ratedReviews: rated });
  }
  return out;
}

/** One trader's summary as `viewerId` may see it; throws for an unknown account. */
export async function traderSummary(
  q: Queryable,
  accountId: string,
  now: Date,
  viewerId: string | null,
  role?: SummaryRole,
): Promise<TraderSummary> {
  const t = (await traderSummaries(q, [accountId], now, viewerId, undefined, role === undefined ? undefined : new Map([[accountId, role]]))).get(accountId);
  if (!t) throw new Error('trader missing');
  return t;
}
