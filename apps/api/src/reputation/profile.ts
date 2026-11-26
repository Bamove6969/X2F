import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireInside } from '../auth/frontDoor.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { listedOfferCount } from '../offers/routes.js';
import { reviewShownSql } from '../reviews/disputes.js';
import { REVIEW_COLUMNS, toPublicReview, type PublicReview, type ReviewRow } from '../reviews/store.js';
import { displayKeyOf } from '../nudge/names.js';
import { hasBlocked } from '../traders/blocks.js';
import { traderFacts } from '../traders/summary.js';
import type { ImportedLine } from '../traders/tradedTotal.js';

/**
 * Plan 5 Task 5: a trader's public profile, `GET /v1/traders/:name`.
 *
 * Behind the front door (owner, 8 Nov 2026: no free tours), so only a set-up trader (or a member of
 * one) reads it. `:name` is the PUBLIC display name, matched on `display_key`; a private login name
 * never matches. Only live trader accounts have profiles (never staff, the owner, a member's login,
 * or a disabled, site-banned or closed account: `traderIdByName`).
 * An unknown name, and a trader who blocked the viewer (traders/blocks.ts `hasBlocked`), get the
 * same 404 `not-found`; the blocker still opens the blocked person's profile.
 *
 * Shares the bare minimum (spec 1): no login name, account id, email, amount, volume beyond the
 * opt-in rounded lines the offer cards already show, PGP fingerprint, reviewer, trade code or exact
 * time other than the coarse `lastSeenAt` (traders/summary.ts). No cancel figure (owner T-017:
 * moderators only). Reviews are the newest PROFILE_REVIEWS, month and year only (P5-A10), each
 * shown as soon as it is submitted (owner 2026-11-02) unless its trade's appeal holds it (R-011).
 */

/** P5-A10: the newest reviews a profile lists. */
export const PROFILE_REVIEWS = 20;

/** The longest display name a route looks up (spec 6.1 names are far shorter). */
const NAME_MAX = 64;

export interface TraderProfile {
  displayName: string;
  /** True when this is the viewer's own account (the web adds "Choose badges" and the settings links). */
  self: boolean;
  /** The month the account was created, "YYYY-MM" (UTC). */
  memberSince: string;
  online: boolean;
  lastSeenAt: string | null;
  stats: {
    completedTrades: number;
    positivePct: number | null;
    /** Positive and negative reviews behind `positivePct` (3 stars and Neutral count for neither). */
    ratedReviews: number;
    /** Every review shown (rated, 3 stars and Neutral). */
    reviewCount: number;
    /** The typical payment time in minutes (board "typical payment time"; P5-A8), null below 3 payments. */
    typicalMinutes: number | null;
    /** D-049 (Revision 2026-10-29c): "Disputes: N won, M lost". */
    disputes: { won: number; lost: number };
  };
  /** Badge ids as the trader chose to show them; Hidden ones are in neither list. */
  badges: { featured: string[]; more: string[] };
  /** P5-A17: "Account protected with PGP" only while the PGP badge is not Hidden. */
  pgpProtected: boolean;
  /** Task 12: the signed record is on the profile ("Signed trade history available · Verify"). */
  recordPublic: boolean;
  tradedOverXmr: number | null;
  imported: ImportedLine[];
  /**
   * Task 19: on the trader's OWN profile only (`self`), each review also carries its `id` and whether
   * it can still be disputed (`disputable`: never disputed; one dispute per review, lead default).
   * Nobody else ever gets a review's id.
   */
  reviews: (PublicReview & { id?: string; disputable?: boolean })[];
  /** Live offers anyone may see right now. */
  offers: number;
}

/**
 * A live trader account by its public display name, or null: unknown, not a trader, or disabled or
 * closed (a ban, a staff switch-off, the inactivity close: lead call 18 Nov on OQ1), or site-banned
 * at `now` (Plan 4 Task 27: a site ban in force, timed or lifetime, read by the clock as the gate
 * reads it; lead, 21 Nov). Each answers exactly as an unknown name; the rows stay for moderators.
 * A trade ban alone keeps the profile (it hides only the offers).
 */
export async function traderIdByName(q: Queryable, name: string, now: Date): Promise<string | null> {
  const { rows } = await q.query<{ id: string }>(
    `select a.id from accounts a
      where a.display_key = $1 and a.kind = 'trader' and a.disabled_at is null and a.closed_at is null
        and not exists (select 1 from account_bans b
                         where b.account_id = a.id and b.kind = 'site' and b.ended_at is null and b.lifted_at is null
                           and (b.until is null or b.until > $2))`,
    // The stored key as checkDisplayName makes it (NFC, JavaScript lower case; migration 800), not lower().
    [displayKeyOf(name), now],
  );
  return rows[0]?.id ?? null;
}

/**
 * The trader `:name` names, as `viewer` may see them, or 404 `not-found` (unknown, not a trader,
 * or the trader blocked the viewer: the same answer).
 */
export async function visibleTrader(q: Queryable, req: FastifyRequest): Promise<string> {
  const raw = (req.params as { name?: unknown }).name;
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > NAME_MAX) throw new ApiError(404, 'not-found');
  const id = await traderIdByName(q, raw, req.server.deps.clock());
  if (id === null || (await hasBlocked(q, id, req.auth.accountId))) throw new ApiError(404, 'not-found');
  return id;
}

function monthOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The reviews a profile shows, newest first, and how many there are (none held by a pending appeal). */
export async function shownReviews(q: Queryable, accountId: string, limit: number): Promise<{ count: number; latest: (ReviewRow & { disputed: boolean })[] }> {
  // Task 19: a review a moderator removed shows nowhere; one under review shows with its label.
  const shown = reviewShownSql('r');
  const [{ rows: count }, { rows: latest }] = await Promise.all([
    q.query<{ n: string }>(`select count(*) as n from reviews r where r.subject_id = $1 and ${shown}`, [accountId]),
    q.query<ReviewRow & { disputed: boolean }>(
      `select ${REVIEW_COLUMNS}, exists (select 1 from review_disputes d where d.review_id = r.id) as disputed
         from reviews r where r.subject_id = $1 and ${shown} order by r.created_at desc, r.id limit $2`,
      [accountId, limit],
    ),
  ]);
  return { count: Number(count[0]!.n), latest };
}

export async function traderProfile(q: Queryable, accountId: string, viewerId: string, now: Date): Promise<TraderProfile> {
  // The payment time, as the board's "typical payment time" says (P5-A8).
  const f = (await traderFacts(q, [accountId], now, viewerId, undefined, new Map([[accountId, 'buyer']]))).get(accountId);
  if (!f) throw new ApiError(404, 'not-found');
  const [{ rows: extra }, reviews, offers] = await Promise.all([
    q.query<{ record_public: boolean | null }>(
      `select (select bp.portable_public from badge_prefs bp where bp.account_id = a.id) as record_public
         from accounts a where a.id = $1`,
      [accountId],
    ),
    shownReviews(q, accountId, PROFILE_REVIEWS),
    listedOfferCount(q, accountId, now),
  ]);
  const s = f.summary;
  return {
    displayName: s.displayName,
    self: viewerId === accountId,
    memberSince: monthOf(f.createdAt),
    online: s.online,
    lastSeenAt: s.lastSeenAt,
    stats: {
      completedTrades: s.completedTrades,
      positivePct: s.positivePct,
      ratedReviews: f.ratedReviews,
      reviewCount: reviews.count,
      typicalMinutes: s.typicalMinutes,
      disputes: s.disputes,
    },
    badges: { featured: [...f.shown.featured], more: [...f.shown.more] },
    pgpProtected: f.shown.featured.includes('pgp') || f.shown.more.includes('pgp'),
    recordPublic: extra[0]?.record_public === true,
    tradedOverXmr: s.tradedOverXmr,
    imported: s.imported,
    reviews: reviews.latest.map((r) => (viewerId === accountId ? { ...toPublicReview(r), id: r.id, disputable: !r.disputed } : toPublicReview(r))),
    offers,
  };
}

/** `GET /v1/traders/:name` → `TraderProfile`; 404 `not-found` for an unknown name or a block. */
export function profileRoutes(app: FastifyInstance): void {
  app.get('/v1/traders/:name', { preHandler: requireInside }, async (req) => {
    const db = req.server.deps.db;
    const id = await visibleTrader(db, req);
    return traderProfile(db, id, req.auth.accountId, req.server.deps.clock());
  });
}
