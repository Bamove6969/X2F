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
 * Whether this session may read a part of the trades list, so My trades is worth a tab (review
 * trades-list m1; design review shot 26: no tab that only leads to a refusal): the account owner, and
 * a member with See active trades or See trade history (the boxes `GET /v1/account/me` sends as
 * `member.abilities`; an older API's roles only: the Trades role). Signed out, the tab stays, as Post
 * offer's does; while the session loads it waits.
 */
export function mayReadTrades(session: Session): boolean {
  if (session.status === 'loading') return false;
  if (session.status !== 'signed-in') return true;
  const m = (session.me as { member?: unknown }).member;
  if (m === null || m === undefined || typeof m !== 'object') return true;
  const abilities = (m as { abilities?: unknown }).abilities;
  if (Array.isArray(abilities)) return abilities.includes('trades-see-active') || abilities.includes('trades-see-history');
  return memberOf(session)?.roles.includes('trades') ?? false;
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
