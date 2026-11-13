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
 * a member with the Offers role (spec 6.7). A signed-out session keeps the Post offer tab (PostOffer
 * itself sends a signed-out poster to setup). While the session loads the role is not known yet, so
 * the tab waits (C11 review N2: a Trades-only member saw it appear and vanish on each cold load).
 */
export function mayPostOffers(session: Session): boolean {
  if (session.status === 'loading') return false;
  // Owner 2 Nov 2026: only vendor accounts post offers (a member works for the account's type).
  if (accountTypeOf(session) === 'trader') return false;
  const m = memberOf(session);
  return m === null || m.roles.includes('offers');
}

/**
 * Owner 2 Nov 2026: the signed-in account's type, 'trader' or 'vendor'; null when signed out,
 * loading, or the API sent none (an older build: the API still refuses a trader's post).
 */
export function accountTypeOf(session: Session): 'trader' | 'vendor' | null {
  if (session.status !== 'signed-in') return null;
  const t = (session.me as { accountType?: unknown }).accountType;
  return t === 'trader' || t === 'vendor' ? t : null;
}

/**
 * The boxes the account owner ticked for this member (`GET /v1/account/me`.`member.abilities`),
 * for the member tour (tour/memberSteps.ts); [] for anyone else or an older API.
 */
export function memberAbilities(session: Session): string[] {
  if (memberOf(session) === null || session.status !== 'signed-in') return [];
  const a = ((session.me as { member?: { abilities?: unknown } }).member ?? {}).abilities;
  return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : [];
}
