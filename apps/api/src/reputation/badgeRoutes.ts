import { BadgeError, applyChoice, levelShown, nextMilestones, type BadgeId, type Visibility } from '@x2f/reputation';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { withTx } from '../auth/liveSession.js';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { traderFacts } from '../traders/summary.js';
import { isBadgeId, isVisibility, savePrefs } from './prefs.js';

/**
 * Plan 5 Task 5: badge settings (BadgeSettings board).
 *
 * - `GET /v1/account/badges` → `BadgeSettings`: every badge the account has earned with the level
 *   it shows at (Featured, On hover, Hidden), the resolved Featured and "+N" lists exactly as offer
 *   cards and the profile show them, and the next milestones ("500 trades 212 / 500").
 * - `PUT /v1/account/badges { id, level }` → the same, plus `notice`: the board's "<name> moved to
 *   On hover. Only 2 badges can be featured." when featuring a third bumped the oldest, else null.
 *   400 `new-is-fixed` for any change to New, 400 `not-earned` for a badge the account has not
 *   earned (nothing is saved), 400 `bad-request` for anything else malformed.
 *
 * The only badge write is visibility; nothing here can grant a badge (spec 5.4). Trader sessions of
 * the account owner only: a member gets 403 `owner-only` (no `member` option), like the traded-total
 * setting, since it changes how the account presents itself.
 */

export interface BadgeSettings {
  earned: { id: BadgeId; level: Visibility }[];
  featured: BadgeId[];
  more: BadgeId[];
  nextMilestones: { label: string; have: number; need: number }[];
}

export async function badgeSettings(q: Queryable, accountId: string, now: Date): Promise<BadgeSettings & { prefs: Parameters<typeof applyChoice>[1]; earnedIds: BadgeId[] }> {
  const f = (await traderFacts(q, [accountId], now, accountId)).get(accountId);
  if (!f) throw new ApiError(404, 'not-found');
  return {
    earned: f.earned.map((id) => ({ id, level: levelShown(f.earned, f.prefs, id) ?? 'hidden' })),
    featured: [...f.shown.featured],
    more: [...f.shown.more],
    nextMilestones: nextMilestones({ completedTrades: f.completedTrades, lostDisputes: f.lostDisputes }),
    prefs: f.prefs,
    earnedIds: f.earned,
  };
}

function publicSettings(s: BadgeSettings): BadgeSettings {
  return { earned: s.earned, featured: s.featured, more: s.more, nextMilestones: s.nextMilestones };
}

function bodyOf(req: FastifyRequest): { id: BadgeId; level: Visibility } {
  const b = req.body as { id?: unknown; level?: unknown } | null;
  if (b === null || typeof b !== 'object' || Array.isArray(b)) throw new ApiError(400, 'bad-request');
  if (!isBadgeId(b.id) || !isVisibility(b.level)) throw new ApiError(400, 'bad-request');
  return { id: b.id, level: b.level };
}

export function badgeRoutes(app: FastifyInstance): void {
  const trader = requireSession({ kinds: ['trader'] });
  const PATH = '/v1/account/badges';

  app.get(PATH, { preHandler: trader }, async (req) => publicSettings(await badgeSettings(req.server.deps.db, req.auth.accountId, req.server.deps.clock())));

  app.put(PATH, { preHandler: trader }, async (req) => {
    const { id, level } = bodyOf(req);
    const deps = req.server.deps;
    const accountId = req.auth.accountId;
    return withTx(deps.db, async (c) => {
      const now = deps.clock();
      // One writer at a time per account: the row is created empty if missing, then locked, so two
      // quick taps apply one after the other (the second sees the first's bump).
      await c.query(
        'insert into badge_prefs (account_id, updated_at) values ($1, $2) on conflict (account_id) do nothing',
        [accountId, now],
      );
      await c.query('select 1 from badge_prefs where account_id = $1 for update', [accountId]);
      const before = await badgeSettings(c, accountId, now);
      let next;
      try {
        next = applyChoice(before.earnedIds, before.prefs, id, level);
      } catch (e) {
        if (e instanceof BadgeError) throw new ApiError(400, e.code);
        throw e;
      }
      await savePrefs(c, accountId, next.prefs, now);
      return { ...publicSettings(await badgeSettings(c, accountId, now)), notice: next.notice };
    });
  });
}
