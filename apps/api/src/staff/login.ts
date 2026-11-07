import { navFor, windowEndsAt } from '@x2f/staff';
import type { FastifyInstance } from 'fastify';
import { pgpLoginRoutes } from '../auth/pgp.js';
import { logoutRoute, sessionPolicy } from '../auth/sessions.js';
import { securityKeyLoginRoutes } from '../auth/webauthn.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { loadStaff, requireStaff, withinHours } from './guard.js';

const PUBLIC_LOGIN = { perm: 'public-login' } as const;

/**
 * Plan 4 Task 4's `afterAuthenticate` for every staff login step. It runs only after the key or the
 * PGP code has verified, so a bad credential still gets Plan 2's refusal and nothing here can be
 * used to learn someone's hours. A staff account with no staff row, or one switched off: 403
 * `account-disabled`; outside the login hours (the owner has none): 403 `outside-login-hours`.
 */
export function staffLoginCheck(deps: { db: Queryable; clock: () => Date }): (accountId: string) => Promise<void> {
  return async (accountId) => {
    const s = await loadStaff(deps.db, accountId);
    if (s === null || s.switchedOff) throw new ApiError(403, 'account-disabled');
    if (!withinHours(s, deps.clock())) throw new ApiError(403, 'outside-login-hours');
  };
}

/**
 * The staff login, logout and `me` routes:
 * - `POST /staff/v1/login/security-key/{start,finish}` and `POST /staff/v1/login/pgp/{start,finish}`
 *   (Plan 2's plugins, kinds staff and owner, always two factors); a security key whose AAGUID is no
 *   longer on the current allowlist is not offered and is refused (`recheckAllowlist`, Plan 4 M1);
 * - `POST /staff/v1/logout` (never 401, clears the staff cookie);
 * - `GET /staff/v1/me` → `{ displayName, role, nav, sessionEndsAt }`, where `sessionEndsAt` is the
 *   earliest of the idle limit, the absolute limit and the end of the login window.
 */
export async function staffLoginRoutes(app: FastifyInstance): Promise<void> {
  const afterAuthenticate = staffLoginCheck(app.deps);
  const kinds = ['staff', 'owner'] as const;
  await app.register(securityKeyLoginRoutes, {
    prefix: '/staff/v1/login/security-key', kinds: [...kinds], realm: 'staff', afterAuthenticate, routeConfig: PUBLIC_LOGIN, recheckAllowlist: true,
  });
  await app.register(async (sub) => pgpLoginRoutes(sub, { kinds: [...kinds], afterAuthenticate, routeConfig: PUBLIC_LOGIN }), {
    prefix: '/staff/v1/login/pgp',
  });
  logoutRoute(app, '/staff/v1/logout', PUBLIC_LOGIN);

  app.get('/staff/v1/me', { config: { perm: 'self' }, preHandler: requireStaff('self') }, async (req) => {
    const now = req.server.deps.clock();
    const { rows } = await req.server.deps.db.query<{ created_at: Date }>('select created_at from sessions where id = $1', [req.auth.sessionId]);
    const policy = sessionPolicy(req.auth.kind, req.auth.level);
    // This request touched the session, so the idle limit runs from now.
    const ends = [now.getTime() + policy.idleMs, rows[0]!.created_at.getTime() + policy.absoluteMs];
    const windowEnd = req.staff.role === 'owner' ? null : windowEndsAt(req.staff.hours, now);
    if (windowEnd !== null) ends.push(windowEnd.getTime());
    return {
      displayName: req.staff.displayName,
      role: req.staff.role,
      nav: navFor(req.staff.role, req.staff.grants),
      sessionEndsAt: new Date(Math.min(...ends)).toISOString(),
    };
  });
}
