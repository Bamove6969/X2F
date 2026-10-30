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
