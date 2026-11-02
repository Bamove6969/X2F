/**
 * Plan 2 Task 18: is this session a team member's? `GET /v1/account/me` sends `member`
 * (`{ name, roles }`) for a member's session and null for the account owner's.
 */
import type { Session } from './useSession.js';

export interface TeamMemberSession {
  name: string;
  roles: readonly string[];
}

/** The member a signed-in session belongs to, or null (the account owner, signed out, loading). */
export function memberOf(session: Session): TeamMemberSession | null {
  if (session.status !== 'signed-in') return null;
  const m = (session.me as { member?: unknown }).member;
  if (m === null || m === undefined || typeof m !== 'object') return null;
  const { name, roles } = m as { name?: unknown; roles?: unknown };
  return { name: typeof name === 'string' ? name : '', roles: Array.isArray(roles) ? roles.filter((r): r is string => typeof r === 'string') : [] };
}

/**
 * Whether this session may post offers (design review 2026-11-01, shot 26): the account owner and
 * a member with the Offers role (spec 6.7). A session not signed in yet keeps the Post offer tab
 * (PostOffer itself sends a signed-out poster to setup).
 */
export function mayPostOffers(session: Session): boolean {
  const m = memberOf(session);
  return m === null || m.roles.includes('offers');
}
