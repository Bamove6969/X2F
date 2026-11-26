/** Staff roles (spec 6.6). The owner is one account; the others are invited. */
export const STAFF_ROLES = ['owner', 'senior', 'mod', 'helper'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * Every permission a staff route can declare (Plan 4 Task 4: one per route). Added by later
 * revisions of Plan 4: `stats.read` (Revision 2026-10-28), `accounts.ban` (Task 27),
 * `reputation.review` (Revision 2026-10-29b, Plan 5 Task 19), `tickets.handle` (Task 30) and
 * `feedback.read` (Plan 5 Task 4; the owner and senior moderators by role, moderators and helpers by
 * grant, owner Q60) and `reputation.verify` (senior moderators and the
 * owner, owner 2026-11-02: entering a past-reputation claim's verified dollar figure) and
 * `reputation.revoke` (Plan 5 Task 11: revoking an approved past-reputation claim, senior moderators
 * and the owner only).
 */
export const PERMS = [
  'staff.manage',
  'settings.write',
  'site.control',
  'earnings.read',
  'perf.read',
  'stats.read',
  'log.read.all',
  'log.read.cases',
  'disputes.handle',
  'rulings.approve',
  'accounts.freeze',
  'accounts.ban',
  // Owner 26 Nov 2026: lifting a ban is its own box, apart from placing one.
  'accounts.unban',
  'reputation.review',
  'reputation.verify',
  'reputation.revoke',
  'tickets.handle',
  'feedback.read',
  'training.read',
  'training.write',
  // Lead call 18 Nov 2026 (re-review of Task 19): mark a closed case as a training case, with the
  // masks the curator reviewed, or unmark it. The owner by role (not grantable).
  'training.curate',
  'self',
] as const;
export type Perm = (typeof PERMS)[number];

/**
 * Perms the owner may grant to one staff member on top of their role (Task 30: ticket access is
 * "granted per staff member by the owner, not by role alone"). No other perm can be granted.
 */
// `feedback.read`: owner Q60 (6 Nov 2026), whether a moderator or a helper reads feedback is a
// checkbox the owner ticks per person (senior moderators always do).
// `accounts.ban`, `accounts.unban`: owner 26 Nov 2026, "I want the ability to choose if a senior
// moderator can ban or not or lift bans": two boxes per senior moderator, off unless ticked. They
// count for a senior moderator only (`SENIOR_ONLY_GRANTS`); a stored one on anyone else is ignored.
export const GRANTABLE_PERMS = ['tickets.handle', 'feedback.read', 'accounts.ban', 'accounts.unban'] as const satisfies readonly Perm[];
export const SENIOR_ONLY_GRANTS = ['accounts.ban', 'accounts.unban'] as const satisfies readonly Perm[];
export type GrantablePerm = (typeof GRANTABLE_PERMS)[number];

const MOD_PERMS: readonly Perm[] = ['disputes.handle', 'log.read.cases', 'reputation.review', 'training.read', 'self'];

const ROLE_PERMS: Readonly<Record<StaffRole, ReadonlySet<Perm>>> = {
  owner: new Set(PERMS),
  // `accounts.ban` / `accounts.unban`: owner-only by role since 26 Nov 2026; a senior by grant.
  // `feedback.read`: owner Q60, "the senior moderator will automatically have access to feedback".
  senior: new Set<Perm>([...MOD_PERMS, 'rulings.approve', 'accounts.freeze', 'reputation.verify', 'reputation.revoke', 'feedback.read']),
  // `reputation.review` for moderators is a lead default (Revision 2026-10-29b); the owner may change it.
  mod: new Set<Perm>(MOD_PERMS),
  helper: new Set<Perm>(['self']),
};

/**
 * Whether `role` holds `perm`. `grants` are the staff member's own extra perms as stored by the
 * owner; only `GRANTABLE_PERMS` in it count, so a stored list can never widen a role otherwise.
 * An unknown role or perm is refused.
 */
export function can(role: StaffRole, perm: Perm, grants: readonly Perm[] = []): boolean {
  if (!Object.hasOwn(ROLE_PERMS, role)) return false;
  if (ROLE_PERMS[role].has(perm)) return true;
  if (!(GRANTABLE_PERMS as readonly Perm[]).includes(perm) || !grants.includes(perm)) return false;
  return role === 'senior' || !(SENIOR_ONLY_GRANTS as readonly Perm[]).includes(perm);
}

/** Whether `role` may hold `perm` as a per-person box at all (a senior-only box on a senior). */
export function grantableTo(role: StaffRole, perm: Perm): boolean {
  if (!(GRANTABLE_PERMS as readonly Perm[]).includes(perm)) return false;
  return role === 'senior' || !(SENIOR_ONLY_GRANTS as readonly Perm[]).includes(perm);
}

export type NavItem = 'overview' | 'disputes' | 'past-reputation' | 'accounts' | 'staff' | 'performance' | 'prices' | 'training' | 'log' | 'feedback' | 'tickets' | 'settings';

/**
 * The perm each menu item's page reads with (the API refuses the page's data without it, whatever
 * the menu shows). `prices`: the price-health data (`GET /staff/v1/price-health`, owner Q13).
 */
export const NAV_PERM: Readonly<Record<NavItem, Perm>> = {
  overview: 'site.control',
  disputes: 'disputes.handle',
  // Plan 5 Task 11: the past-reputation claims waiting for a moderator (`GET /staff/v1/past-rep`).
  'past-reputation': 'reputation.review',
  // Spec 6.6 "Account actions": find a trader and ban, lift or work a hold outside a case
  // (`GET /staff/v1/accounts/lookup`, accounts.freeze: senior moderators and the owner; ban and
  // lift are boxes per senior since 26 Nov 2026).
  accounts: 'accounts.freeze',
  staff: 'staff.manage',
  performance: 'perf.read',
  prices: 'stats.read',
  training: 'training.read',
  log: 'log.read.cases',
  feedback: 'feedback.read',
  // Plan 4 Task 31: the support-ticket queue and its cases (`GET /staff/v1/tickets`).
  tickets: 'tickets.handle',
  settings: 'settings.write',
};

/** The staff app's side menu per role, in the boards' order (StaffOverview). */
export const NAV: Readonly<Record<StaffRole, readonly NavItem[]>> = {
  // 'feedback' (Plan 5 Task 4): no board places it yet; before settings is a landing default.
  // 'prices' (owner Q13, 6 Nov: the price-health page moves to the staff site; J-21): no board
  // draws it yet (DESIGN: not drawn); after Performance, the other figures page, is a lead default.
  // 'past-reputation' (Plan 5 Task 11): no board places it (DESIGN: not drawn); after Disputes, the
  // other moderator queue, is a lead default.
  // 'accounts' (spec 6.6): no board places it (DESIGN: not drawn); after the queues is a lead default.
  // 'tickets' (Plan 4 Task 31): no board places it (DESIGN: not drawn); after Feedback, the other
  // page of what traders write, is a lead default.
  owner: ['overview', 'disputes', 'past-reputation', 'accounts', 'staff', 'performance', 'prices', 'training', 'log', 'feedback', 'tickets', 'settings'],
  senior: ['disputes', 'past-reputation', 'accounts', 'training', 'log', 'feedback'],
  mod: ['disputes', 'past-reputation', 'training', 'log'],
  // A helper's pages come from grants only (Task 30: ticket access is granted per person).
  helper: [],
};

/**
 * The menu for one person: their role's, plus Feedback (owner Q60) and Tickets (Plan 4 Tasks 30-31)
 * when the owner granted them, in that order at the end.
 */
export function navFor(role: StaffRole, grants: readonly Perm[] = []): readonly NavItem[] {
  const base = NAV[role] ?? [];
  const extra = (['feedback', 'tickets'] as const).filter((item) => !base.includes(item) && can(role, NAV_PERM[item], grants));
  return extra.length === 0 ? base : [...base, ...extra];
}
