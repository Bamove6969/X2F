import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireInside } from '../auth/frontDoor.js';
import { recoveryHoldHidesSql } from '../auth/holdSql.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { listedOfferCount } from '../offers/routes.js';
import { toPublicReview, type PublicReview, type ReviewRow } from '../reviews/store.js';
import { hasBlocked } from '../traders/blocks.js';
import { reviewHeldSql } from '../traders/finalOutcome.js';
import { traderFacts } from '../traders/summary.js';
import type { ImportedLine } from '../traders/tradedTotal.js';

/**
 * Plan 5 Task 5: a trader's public profile, `GET /v1/traders/:name`.
 *
 * Behind the front door (owner, 8 Nov 2026: no free tours), so only a set-up trader (or a member of
 * one) reads it. `:name` is the PUBLIC display name, matched on `display_key`; a private login name
 * never matches. Only trader accounts have profiles (never staff, the owner or a member's login).
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
  reviews: PublicReview[];
  /** Live offers anyone may see right now. */
  offers: number;
}

/** A trader account by its public display name, or null (unknown, or not a trader). */
export async function traderIdByName(q: Queryable, name: string): Promise<string | null> {
  const { rows } = await q.query<{ id: string }>("select id from accounts where display_key = lower($1) and kind = 'trader'", [name]);
  return rows[0]?.id ?? null;
}

/**
 * The trader `:name` names, as `viewer` may see them, or 404 `not-found` (unknown, not a trader,
 * or the trader blocked the viewer: the same answer).
 */
export async function visibleTrader(q: Queryable, req: FastifyRequest): Promise<string> {
  const raw = (req.params as { name?: unknown }).name;
  if (typeof raw !== 'string' || raw.length < 1 || raw.length > NAME_MAX) throw new ApiError(404, 'not-found');
  const id = await traderIdByName(q, raw);
  if (id === null || (await hasBlocked(q, id, req.auth.accountId))) throw new ApiError(404, 'not-found');
  return id;
}

function monthOf(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The reviews a profile shows, newest first, and how many there are (none held by a pending appeal). */
export async function shownReviews(q: Queryable, accountId: string, limit: number): Promise<{ count: number; latest: ReviewRow[] }> {
  const held = reviewHeldSql('r');
  const [{ rows: count }, { rows: latest }] = await Promise.all([
    q.query<{ n: string }>(`select count(*) as n from reviews r where r.subject_id = $1 and not ${held}`, [accountId]),
    q.query<ReviewRow>(`select r.* from reviews r where r.subject_id = $1 and not ${held} order by r.created_at desc, r.id limit $2`, [accountId, limit]),
  ]);
  return { count: Number(count[0]!.n), latest };
}

export async function traderProfile(q: Queryable, accountId: string, viewerId: string, now: Date): Promise<TraderProfile> {
  // The payment time, as the board's "typical payment time" says (P5-A8).
  const f = (await traderFacts(q, [accountId], now, viewerId, undefined, new Map([[accountId, 'buyer']]))).get(accountId);
  if (!f) throw new ApiError(404, 'not-found');
  const [{ rows: extra }, reviews, offers] = await Promise.all([
    q.query<{ hidden: boolean; record_public: boolean | null }>(
      `select ${recoveryHoldHidesSql('a.id')} as hidden, (select bp.portable_public from badge_prefs bp where bp.account_id = a.id) as record_public
         from accounts a where a.id = $1`,
      [accountId],
    ),
    shownReviews(q, accountId, PROFILE_REVIEWS),
    listedOfferCount(q, accountId, now),
  ]);
  const s = f.summary;
  // During a recovery-code hold the account is offline to everyone and its offers are hidden (owner
  // 1 Nov), so its profile shows no presence and no offers either; nothing says why.
  const hidden = extra[0]?.hidden === true && viewerId !== accountId;
  return {
    displayName: s.displayName,
    self: viewerId === accountId,
    memberSince: monthOf(f.createdAt),
    online: hidden ? false : s.online,
    lastSeenAt: hidden ? null : s.lastSeenAt,
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
    reviews: reviews.latest.map(toPublicReview),
    offers: hidden ? 0 : offers,
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
