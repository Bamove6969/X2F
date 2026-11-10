import {
  NEGATIVE_MAX_STARS,
  POSITIVE_MIN_STARS,
  bothRolesTypical,
  earnedBadges,
  resolveVisibility,
  typicalMinutes,
} from '@x2f/reputation';
import type { Queryable } from '../db/pool.js';
import { PUBLIC_NAME_COLUMN } from '../events/publicName.js';
import { verifiedPastRepBySite } from '../pastrep/store.js';
import { importedLines, tradedOverXmr, tradedXmrSql, type ImportedLine } from './tradedTotal.js';
import { COMPLETED_TRADES_SQL, loadStarterSettings, stageFor, type Stage, type StarterSettings } from './stage.js';

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
  badges: string[];
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
 * seller is lost by the buyer. Read from the live trades until Plan 5 Task 20's running total
 * (`lost_disputes`) exists, so after the 30-day delete it can only undercount; Clean record needs 100
 * completed trades as well.
 */
const LOST_DISPUTES_SQL = `(select count(*) from dispute_rulings dr join trades t on t.code = dr.code
   where not exists (select 1 from dispute_rulings d2 where d2.code = dr.code and d2.seq = dr.seq and d2.round > dr.round)
     and ((dr.outcome in ('release-to-buyer', 'seller-sends-xmr', 'seller-returns-fiat') and t.seller_account_id = a.id)
       or (dr.outcome = 'refund-to-seller' and t.buyer_account_id = a.id)))`;

/**
 * SQL: the disputes `a.id` won, the mirror of LOST_DISPUTES_SQL by the same latest ruling: a release
 * to the buyer, or the seller told to send XMR or return fiat, is won by the buyer; a refund to the
 * seller is won by the seller. An after-refund "no action" ruling counts for neither side, as in
 * LOST_DISPUTES_SQL (owner question, J-21). Read from the live trades until Task 20's running totals.
 */
const WON_DISPUTES_SQL = `(select count(*) from dispute_rulings dr join trades t on t.code = dr.code
   where not exists (select 1 from dispute_rulings d2 where d2.code = dr.code and d2.seq = dr.seq and d2.round > dr.round)
     and ((dr.outcome in ('release-to-buyer', 'seller-sends-xmr', 'seller-returns-fiat') and t.buyer_account_id = a.id)
       or (dr.outcome = 'refund-to-seller' and t.seller_account_id = a.id)))`;

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
  const out = new Map<string, TraderSummary>();
  const ids = [...new Set(accountIds)];
  if (ids.length === 0) return out;
  const s = settings ?? (await loadStarterSettings(q));
  // The name column is a constant, never input.
  const { rows } = await q.query<{
    id: string; name: string; created_at: Date; completed: string; last_seen: Date | null; show_traded: boolean; traded: string;
    positive: string; negative: string; pay: number[] | null; release: number[] | null; pgp: boolean; security_key: boolean; lost: string; won: string;
  }>(
    `select a.id, a.${PUBLIC_NAME_COLUMN} as name, a.created_at,
            ${COMPLETED_TRADES_SQL} as completed,
            ${lastSeenSql('a.id', '$2::uuid')} as last_seen,
            a.show_traded_total as show_traded, ${tradedXmrSql('a.id')}::text as traded,
            rv.positive, rv.negative,
            (select m.minutes from account_action_minutes m where m.account_id = a.id and m.kind = 'pay') as pay,
            (select m.minutes from account_action_minutes m where m.account_id = a.id and m.kind = 'release') as release,
            exists (select 1 from pgp_keys k where k.account_id = a.id) as pgp,
            exists (select 1 from webauthn_credentials w where w.account_id = a.id and w.kind = 'security-key') as security_key,
            ${LOST_DISPUTES_SQL} as lost,
            ${WON_DISPUTES_SQL} as won
       from accounts a
       cross join lateral (
         select count(*) filter (where not r.neutral and r.stars >= $3) as positive,
                count(*) filter (where not r.neutral and r.stars <= $4) as negative
           from reviews r where r.subject_id = a.id
       ) rv
      where a.id = any($1::uuid[])`,
    [ids, viewerId, POSITIVE_MIN_STARS, NEGATIVE_MAX_STARS],
  );
  const since = onlineSince(now).getTime();
  const sites = await verifiedPastRepBySite(q, rows.filter((r) => r.show_traded).map((r) => r.id));
  for (const r of rows) {
    const completed = Number(r.completed);
    const stage = stageFor(s, completed, r.created_at, now);
    // % positive (P5-A2, @x2f/reputation positivePct): positive over positive plus negative, rounded
    // down; Neutral and 3 stars count for neither. Review disputes (Task 19) are not built, so every
    // submitted review counts.
    const positive = Number(r.positive);
    const rated = positive + Number(r.negative);
    const positivePct = rated === 0 ? null : Math.floor((positive * 100) / rated);
    const pay = r.pay ?? [];
    const release = r.release ?? [];
    // Both lists' last 20 together (review 2, I2): a plain concatenation's "last 20" was only releases.
    const both = bothRolesTypical(pay, release);
    const role = roles?.get(r.id);
    const typical = role === 'seller' ? typicalMinutes(release) : role === 'buyer' ? typicalMinutes(pay) : both.minutes;
    const earned = earnedBadges(
      {
        stage,
        completedTrades: completed,
        positivePct,
        ratedReviews: rated,
        // Fast: "usually pays or releases within 10 min", over both lists.
        typicalMinutes: both.minutes,
        typicalSamples: both.samples,
        // NEEDS_TASK_20_LOST_DISPUTES (review 2, M1): Clean record reads lost disputes from the live
        // trades, so once the 30-day trade delete runs it would undercount and claim "no lost disputes"
        // falsely. The Plan 7 trade purge must not land before Task 20's `lost_disputes` running total
        // replaces LOST_DISPUTES_SQL (or Clean record is withheld). docs/coordination.md records this.
        lostDisputes: Number(r.lost),
        accountCreatedAt: r.created_at,
        hasPgp: r.pgp,
        hasSecurityKey: r.security_key,
        // Past reputation shows as its own verified lines (`imported`), not as a card badge.
        pastRep: [],
      },
      now,
    );
    // No badge settings exist yet (Plan 5 Task 5), so the spec 5.4 defaults apply: New first, then
    // Trusted, a trade milestone, Fast, Veteran in the featured slots, every other earned badge after.
    const shown = resolveVisibility(earned, { chosen: false, levels: {}, order: [] });
    out.set(r.id, {
      displayName: r.name,
      completedTrades: completed,
      online: r.last_seen !== null && r.last_seen.getTime() >= since,
      // Public, so only to the 5 minutes, floored (review M3): enough for "last seen", not for timing someone's requests.
      lastSeenAt: r.last_seen === null ? null : new Date(Math.floor(r.last_seen.getTime() / LAST_SEEN_STEP_MS) * LAST_SEEN_STEP_MS).toISOString(),
      typicalMinutes: typical,
      positivePct,
      badges: [...shown.featured, ...shown.more],
      stage,
      tradedOverXmr: tradedOverXmr(r.show_traded, r.traded),
      imported: r.show_traded ? importedLines(sites.get(r.id)) : [],
      disputes: { won: Number(r.won), lost: Number(r.lost) },
    });
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
