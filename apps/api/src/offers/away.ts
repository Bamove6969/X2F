import type { FastifyInstance } from 'fastify';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { assertMayTurnOn, inTransaction, switchOfferStatus, type OfferSwitchResult } from './routes.js';

/**
 * The Away switch (owner, 26 Nov 2026; migration 856), on Settings, Account.
 *
 * - `GET /v1/account/away` → `{ away, since }`.
 * - `PUT /v1/account/away { away: true }` → `{ away: true, since, paused }`: pauses every live offer
 *   of the account, marks the ones it paused (`offers.paused_by_away`) and sets
 *   `accounts.away_since` (kept when Away is already on). Pausing has no guard, as turning off
 *   never does (it works on stale Terms).
 * - `PUT /v1/account/away { away: false }` → `{ away: false, since: null, resumed }`: turns back on
 *   only the offers Away paused, each through the relist checks of `POST /v1/account/offers/status`
 *   (`switchOfferStatus`: methods, account, per-side caps, launch cap). An offer that fails one
 *   stays paused and its result names why; every mark is cleared, so it is then an ordinary paused
 *   offer. The whole-call relist guard applies first (`assertMayTurnOn`: 403 `terms-required`);
 *   Away then stays on.
 *
 * The account owner only (no `member` option: a team member gets 403 `owner-only`). The public
 * profile shows `away` (reputation/profile.ts).
 */
const requireOwner = requireSession({ kinds: ['trader'], allowStaleTerms: true });

export interface AwayState {
  away: boolean;
  since: string | null;
}

async function awayState(q: Queryable, accountId: string): Promise<AwayState> {
  const { rows } = await q.query<{ away_since: Date | null }>('select away_since from accounts where id = $1', [accountId]);
  const since = rows[0]?.away_since ?? null;
  return { away: since !== null, since: since === null ? null : since.toISOString() };
}

export function awayRoutes(app: FastifyInstance): void {
  const PATH = '/v1/account/away';
  app.get(PATH, { preHandler: requireOwner }, async (req): Promise<AwayState> => awayState(req.server.deps.db, req.auth.accountId));

  app.put(PATH, { preHandler: requireOwner }, async (req): Promise<AwayState & { paused?: string[]; resumed?: OfferSwitchResult[] }> => {
    const deps = req.server.deps;
    const body = req.body as Record<string, unknown> | null;
    if (body === null || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).join(',') !== 'away' || typeof body.away !== 'boolean') {
      throw new ApiError(400, 'bad-request');
    }
    const away = body.away;
    const accountId = req.auth.accountId;
    if (away) {
      const now = deps.clock();
      return inTransaction(deps.db, async (client) => {
        // Every live offer of mine: an offer already paused is left as it is and unmarked.
        const { switched } = await switchOfferStatus(client, deps, req.auth, 'all', 'paused', now, true);
        await client.query('update accounts set away_since = coalesce(away_since, $2) where id = $1', [accountId, now]);
        return { ...(await awayState(client, accountId)), paused: switched };
      });
    }
    await assertMayTurnOn(req, 'live');
    const now = deps.clock();
    return inTransaction(deps.db, async (client) => {
      const { results } = await switchOfferStatus(client, deps, req.auth, 'away', 'live', now);
      // The ones that stayed paused become ordinary paused offers (My offers turns them on by hand).
      await client.query('update offers set paused_by_away = false where account_id = $1 and paused_by_away', [accountId]);
      await client.query('update accounts set away_since = null where id = $1', [accountId]);
      return { away: false, since: null, resumed: results };
    });
  });
}
