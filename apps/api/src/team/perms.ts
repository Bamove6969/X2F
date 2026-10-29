/**
 * Team members' roles and what each allows (Plan 2 Task 18; spec 6.7, R44; owner 2026-10-29c).
 *
 * - **Offers:** create, delete, adjust and turn the account's offers on or off.
 * - **Trades:** take offers and accept trades for the account, set the trade's payout wallet from
 *   the account's own list, mark money sent, cancel, open a dispute or an appeal (and chat and
 *   proof, Plan 3 Task 42).
 * - *Lead defaults (owner may change):* everything else is the account owner's alone (payout
 *   wallets, members and their roles, login methods, Settings → Security, the Terms, sessions,
 *   alerts, deleting the account): a member gets 403 `owner-only`.
 * - No member may sign escrow (R44, spec 3.1): releasing, funding and registering a trade's
 *   signing identity need the trade's party key, which today lives only on the account owner's
 *   device. Until a per-member key scheme is designed (OPEN, Plan 3 Task 42) they get 403
 *   `member-cannot-sign`.
 *
 * The check itself is `requireSession({ member })` (auth/sessions.ts), so a route that does not
 * name a role refuses members: new routes are owner-only until someone decides otherwise.
 */
import type { TradeEvent } from '@x2f/trade';
import { ApiError } from '../errors.js';

export type TeamRole = 'offers' | 'trades';
export const TEAM_ROLES: readonly TeamRole[] = ['offers', 'trades'];

/** At most this many live members (open invites included) per account (owner, 2026-10-29c). */
export const MAX_TEAM_MEMBERS = 3;

/** What a route lets members do: `any` (a read every member may make) or one role. */
export type MemberAccess = 'any' | TeamRole;

/** True when `roles` grants `need`. */
export function hasRole(roles: readonly string[], need: MemberAccess): boolean {
  return need === 'any' || roles.includes(need);
}

/**
 * Trade events a member may never send: each one starts a step that needs the trade's party key
 * (signing the release), so it stays on the account owner's device until the per-member key
 * scheme exists (R44). The buyer's cancel, a refund request and the mutual cancel only record a
 * choice; the signing they lead to is done by the owner's device (Plan 3 Task 42).
 */
export const MEMBER_SIGNING_EVENTS: ReadonlySet<TradeEvent['type']> = new Set<TradeEvent['type']>(['release-started']);

/** 403 `member-cannot-sign` for a member session sending a signing event. */
export function assertMemberMaySend(memberId: string | null, event: TradeEvent['type']): void {
  if (memberId !== null && MEMBER_SIGNING_EVENTS.has(event)) throw new ApiError(403, 'member-cannot-sign');
}

/** Parses a roles list from a request body: a non-empty set of known roles, in a fixed order. */
export function parseRoles(raw: unknown): TeamRole[] {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > TEAM_ROLES.length) throw new ApiError(400, 'bad-request');
  const set = new Set<string>();
  for (const r of raw) {
    if (typeof r !== 'string' || !(TEAM_ROLES as readonly string[]).includes(r) || set.has(r)) throw new ApiError(400, 'bad-request');
    set.add(r);
  }
  return TEAM_ROLES.filter((r) => set.has(r));
}
