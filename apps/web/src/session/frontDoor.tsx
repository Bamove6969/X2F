/**
 * The front door (owner, 8 Nov 2026): "No one gets to make it past the front door and see behind the
 * curtains without signing an agreement, creating an account and logging in. There are no free tours
 * for outsiders."
 *
 * A logged-out visitor sees only the front door: the Landing board (`/`, design review 2026-11-08
 * item 1), log in, create an account (the setup flow with its Terms), account recovery (the backup
 * login), the Terms text, a team member's invite, and "My account has been compromised" (J-14,
 * D-059: the person may have lost every way in). Every other screen sends them to the Landing
 * board, keeping where they were going in `returnTo` (always through safeReturnTo); its Create
 * account and Log in carry it on, and the login returns there. An account on an old Terms version goes to the Terms
 * screen first, a recovery (backup) session only reaches the screens its session may use, and while
 * the session loads nothing behind the door renders. The API is the real enforcement
 * (apps/api/src/auth/frontDoor.ts); this keeps the screens from ever showing an empty shell of it.
 */
import { useRef } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';
import { safeReturnTo } from '../api/client.js';
import type { Session } from './useSession.js';
import { useSession } from './useSession.js';

/** The front door's own screens: open to anyone, signed in or not. */
const FRONT_DOOR: readonly RegExp[] = [/^\/$/, /^\/login$/, /^\/login\/backup$/, /^\/setup(\/.*)?$/, /^\/terms$/, /^\/team\/join$/, /^\/help\/[a-z-]+$/, /^\/support\/compromised$/];

/**
 * What a recovery (backup) session may open: adding a login method (Security), finishing an open
 * trade, the feedback form and support tickets (J-14), as the API allows (`allowRecovery`). Anything else goes to Security.
 */
const RECOVERY: readonly RegExp[] = [/^\/settings\/security$/, /^\/trade\/[^/]+(\/dispute)?$/, /^\/feedback$/, /^\/support(\/[^/]+)?$/];
export const RECOVERY_HOME = '/settings/security';

/** Whether `pathname` is one of the front door's screens. */
export function isFrontDoor(pathname: string): boolean {
  return FRONT_DOOR.some((r) => r.test(pathname));
}

export type DoorVerdict = { kind: 'wait' } | { kind: 'in' } | { kind: 'go'; to: string };

function me(session: Session): { kind?: unknown; level?: unknown; termsCurrent?: unknown } | null {
  if (session.status !== 'signed-in') return null;
  const m = session.me as unknown;
  return m !== null && typeof m === 'object' ? (m as { kind?: unknown; level?: unknown; termsCurrent?: unknown }) : null;
}

/**
 * True for a full session of a trader account on the current Terms (a team member's session is a row
 * of the account they work for). Anything less, or a field missing, is outside.
 */
export function isInside(session: Session): boolean {
  const m = me(session);
  return m !== null && m.kind === 'trader' && m.level === 'full' && m.termsCurrent === true;
}

/**
 * Where a screen behind the door sends this session: `wait` while it loads, `in` for a set-up trader
 * (or a recovery session on a screen it may use), else `go` to the Landing board, the Terms or Security.
 */
export function doorVerdict(session: Session, pathname: string, search: string): DoorVerdict {
  if (isFrontDoor(pathname)) return { kind: 'in' };
  if (session.status === 'loading') return { kind: 'wait' };
  const returnTo = encodeURIComponent(safeReturnTo(pathname + search));
  // The API client already sends a 403 `terms-required` to the Terms screen; go the same way.
  if (session.status === 'error' && session.code === 'terms-required') return { kind: 'go', to: `/terms?returnTo=${returnTo}` };
  const m = me(session);
  // Signed out, or the session could not be read (a network fault): the Landing board, whose Create
  // account and Log in come back here.
  if (m === null || m.kind !== 'trader') return { kind: 'go', to: `/?returnTo=${returnTo}` };
  // Not finished setting up: the current Terms are not accepted yet.
  if (m.termsCurrent !== true) return { kind: 'go', to: `/terms?returnTo=${returnTo}` };
  if (m.level === 'full') return { kind: 'in' };
  if (m.level === 'recovery') return RECOVERY.some((r) => r.test(pathname)) ? { kind: 'in' } : { kind: 'go', to: RECOVERY_HOME };
  return { kind: 'go', to: `/login?returnTo=${returnTo}` };
}

/**
 * The route element around every screen behind the front door. On the first load nothing renders
 * until the session is known. A re-check (`refreshSession()`, e.g. after a screen changed the
 * account) also reads `loading`; a screen already let in on this same path stays mounted through it,
 * so it keeps its own state (a status line, a form), and the new answer then decides as usual.
 */
export function BehindTheDoor() {
  const session = useSession();
  const { pathname, search } = useLocation();
  const v = doorVerdict(session, pathname, search);
  const letIn = useRef<string | null>(null);
  if (v.kind === 'wait') return letIn.current === pathname ? <Outlet /> : null;
  letIn.current = v.kind === 'in' ? pathname : null;
  if (v.kind === 'go') return <Navigate to={v.to} replace />;
  return <Outlet />;
}
