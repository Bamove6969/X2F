import { PERMS, can, inWindow, validateHours, type LoginHours, type Perm, type StaffRole } from '@x2f/staff';
import type { FastifyRequest, preHandlerAsyncHookHandler, RouteOptions } from 'fastify';
import { requireSession } from '../auth/sessions.js';
import type { Queryable } from '../db/pool.js';
import { ApiError } from '../errors.js';
import { endSessionForHours } from './sweeper.js';

/**
 * What every staff route declares in `config.perm` (Plan 4 Task 4, least privilege): one `Perm`,
 * or one of the public markers. `public-setup` (Task 6's first-run setup) and `public-invite`
 * (Task 7's invite acceptance) are the plan's; `public-login` marks the login routes, logout and
 * the health check, which run before any session exists.
 */
export type StaffRoutePerm = Perm | 'public-setup' | 'public-invite' | 'public-login';
export const PUBLIC_PERMS = ['public-setup', 'public-invite', 'public-login'] as const;

export function isStaffRoutePerm(p: unknown): p is StaffRoutePerm {
  return typeof p === 'string' && ((PERMS as readonly string[]).includes(p) || (PUBLIC_PERMS as readonly string[]).includes(p));
}

/** What `requireStaff` puts on the request: always loaded from `staff_members` on this request. */
export interface StaffContext {
  accountId: string;
  role: StaffRole;
  username: string;
  hours: LoginHours;
  grants: Perm[];
}

declare module 'fastify' {
  interface FastifyContextConfig {
    /** Plan 4 Task 4: the staff app's route permission (required there; the trader API ignores it). */
    perm?: StaffRoutePerm;
  }
  interface FastifyRequest {
    /** Set by `requireStaff`; read it only on routes behind it. */
    staff: StaffContext;
  }
}

/** A staff member as stored, or null for an account without a staff row. */
export interface StaffRow {
  role: StaffRole;
  /** Null when the stored value is not valid LoginHours: then every hours check fails closed. */
  hours: LoginHours | null;
  grants: Perm[];
  switchedOff: boolean;
  username: string;
}

/** Reads the staff member's row on every call: role, hours and grants are never cached (round-2 N2). */
export async function loadStaff(db: Queryable, accountId: string): Promise<StaffRow | null> {
  const { rows } = await db.query<{ role: StaffRole; hours: unknown; grants: string[]; switched_off_at: Date | null; display_name: string }>(
    `select m.role, m.hours, m.grants, m.switched_off_at, a.display_name
       from staff_members m join accounts a on a.id = m.account_id
      where m.account_id = $1`,
    [accountId],
  );
  const r = rows[0];
  if (!r) return null;
  let hours: LoginHours | null;
  try {
    hours = validateHours(r.hours);
  } catch {
    hours = null;
  }
  return {
    role: r.role,
    hours,
    grants: r.grants.filter((g): g is Perm => (PERMS as readonly string[]).includes(g)),
    switchedOff: r.switched_off_at !== null,
    username: r.display_name,
  };
}

/** Whether the staff member may be logged in at `now`: the owner always; others inside valid hours only. */
export function withinHours(s: Pick<StaffRow, 'role' | 'hours'>, now: Date): boolean {
  if (s.role === 'owner') return true;
  return s.hours !== null && inWindow(s.hours, now);
}

const STAFF_GUARD = Symbol('requireStaff');

/**
 * The preHandlers of a staff route needing `perm`, in this order (Plan 4 Task 4):
 * 1. a live staff-app session (`requireSession`; else 401 `not-authenticated`, and 403
 *    `account-disabled` for a disabled account);
 * 2. the account is staff or the owner (else 401 `not-authenticated`);
 * 3. not switched off (403 `account-disabled`);
 * 4. inside the login hours (the owner always is); else the session is ended (and logged once,
 *    `staff.session-ended-hours`) and the answer is 401 `outside-login-hours`;
 * 5. `can(role, perm, grants)` (403 `forbidden`).
 * Sets `req.staff`. The role comes from the database on every request, never from the session.
 */
export function requireStaff(perm: Perm): preHandlerAsyncHookHandler[] {
  const guard: preHandlerAsyncHookHandler = async function (req: FastifyRequest) {
    const deps = req.server.deps;
    if (req.auth.kind !== 'staff' && req.auth.kind !== 'owner') throw new ApiError(401, 'not-authenticated');
    const s = await loadStaff(deps.db, req.auth.accountId);
    if (s === null) throw new ApiError(401, 'not-authenticated');
    if (s.switchedOff) throw new ApiError(403, 'account-disabled');
    const now = deps.clock();
    if (!withinHours(s, now)) {
      await endSessionForHours({ db: deps.db, clock: deps.clock, events: req.server.events }, req.auth.sessionId, req.auth.accountId);
      throw new ApiError(401, 'outside-login-hours');
    }
    if (!can(s.role, perm, s.grants)) throw new ApiError(403, 'forbidden');
    req.staff = { accountId: req.auth.accountId, role: s.role, username: s.username, hours: s.hours ?? 'any', grants: s.grants };
  };
  (guard as unknown as Record<symbol, Perm>)[STAFF_GUARD] = perm;
  // Every kind passes `requireSession` so that the guard answers a non-staff session with
  // `not-authenticated` (step 2). Staff have no Terms version; recovery sessions stay refused.
  return [requireSession({ allowStaleTerms: true }), guard];
}

/** The perm a route's `requireStaff` guard checks, or undefined when it has none. */
export function guardedPerm(preHandler: unknown): Perm | undefined {
  const hooks = Array.isArray(preHandler) ? preHandler : [preHandler];
  for (const h of hooks) {
    const p = typeof h === 'function' ? (h as unknown as Record<symbol, unknown>)[STAFF_GUARD] : undefined;
    if (typeof p === 'string') return p as Perm;
  }
  return undefined;
}

/**
 * The staff app's `onRoute` check: every route declares a perm, and a route declaring a `Perm` runs
 * `requireStaff` for exactly that perm (a public route runs none). Throws at startup otherwise.
 */
export function assertRoutePerm(r: Pick<RouteOptions, 'method' | 'url' | 'config' | 'preHandler'>): StaffRoutePerm {
  const name = `${[r.method].flat().join(',')} ${r.url}`;
  const perm = (r.config as { perm?: unknown } | undefined)?.perm;
  if (!isStaffRoutePerm(perm)) throw new Error(`staff route without a declared perm: ${name}`);
  const guarded = guardedPerm(r.preHandler);
  if ((PUBLIC_PERMS as readonly string[]).includes(perm)) {
    if (guarded !== undefined) throw new Error(`public staff route runs requireStaff: ${name}`);
  } else if (guarded !== perm) {
    throw new Error(`staff route ${name} declares ${perm} but does not run requireStaff('${perm}')`);
  }
  return perm;
}
