/** Staff roles (spec 6.6). The owner is one account; the others are invited. */
export const STAFF_ROLES = ['owner', 'senior', 'mod', 'helper'] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/**
 * Every permission a staff route can declare (Plan 4 Task 4: one per route). Added by later
 * revisions of Plan 4: `stats.read` (Revision 2026-10-28), `accounts.ban` (Task 27),
 * `reputation.review` (Revision 2026-10-29b, Plan 5 Task 19), `tickets.handle` (Task 30) and
 * `feedback.read` (Plan 5 Task 4; the owner and senior moderators by role, moderators and helpers by
 * grant, owner Q60) and `reputation.verify` (senior moderators and the
 * owner, owner 2026-11-02: entering a past-reputation claim's verified dollar figure).
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
  'reputation.review',
  'reputation.verify',
  'tickets.handle',
  'feedback.read',
  'training.read',
  'training.write',
  'self',
] as const;
export type Perm = (typeof PERMS)[number];

/**
 * Perms the owner may grant to one staff member on top of their role (Task 30: ticket access is
 * "granted per staff member by the owner, not by role alone"). No other perm can be granted.
 */
// `feedback.read`: owner Q60 (6 Nov 2026), whether a moderator or a helper reads feedback is a
// checkbox the owner ticks per person (senior moderators always do).
export const GRANTABLE_PERMS = ['tickets.handle', 'feedback.read'] as const satisfies readonly Perm[];
export type GrantablePerm = (typeof GRANTABLE_PERMS)[number];

const MOD_PERMS: readonly Perm[] = ['disputes.handle', 'log.read.cases', 'reputation.review', 'training.read', 'self'];

const ROLE_PERMS: Readonly<Record<StaffRole, ReadonlySet<Perm>>> = {
  owner: new Set(PERMS),
  // `accounts.ban`: a ban, including a permanent one, is a senior-moderator or owner action (Task 27).
  // `feedback.read`: owner Q60, "the senior moderator will automatically have access to feedback".
  senior: new Set<Perm>([...MOD_PERMS, 'rulings.approve', 'accounts.freeze', 'accounts.ban', 'reputation.verify', 'feedback.read']),
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
  return (GRANTABLE_PERMS as readonly Perm[]).includes(perm) && grants.includes(perm);
}

export type NavItem = 'overview' | 'disputes' | 'staff' | 'performance' | 'prices' | 'training' | 'log' | 'feedback' | 'tickets' | 'compromised' | 'settings';

/**
 * The perm each menu item's page reads with (the API refuses the page's data without it, whatever
 * the menu shows). `prices`: the price-health data (`GET /staff/v1/price-health`, owner Q13).
 * `tickets` and `compromised` (J-14, Plan 4 Task 31): the ticket queues' own perms.
 */
export const NAV_PERM: Readonly<Record<NavItem, Perm>> = {
  overview: 'site.control',
  disputes: 'disputes.handle',
  staff: 'staff.manage',
  performance: 'perf.read',
  prices: 'stats.read',
  training: 'training.read',
  log: 'log.read.cases',
  feedback: 'feedback.read',
  tickets: 'tickets.handle',
  compromised: 'accounts.freeze',
  settings: 'settings.write',
};

/** The staff app's side menu per role, in the boards' order (StaffOverview). */
export const NAV: Readonly<Record<StaffRole, readonly NavItem[]>> = {
  // 'feedback' (Plan 5 Task 4): no board places it yet; before settings is a landing default.
  // 'prices' (owner Q13, 6 Nov: the price-health page moves to the staff site; J-21): no board
  // draws it yet (DESIGN: not drawn); after Performance, the other figures page, is a lead default.
  owner: ['overview', 'disputes', 'staff', 'performance', 'prices', 'training', 'log', 'feedback', 'settings'],
  senior: ['disputes', 'training', 'log', 'feedback'],
  mod: ['disputes', 'training', 'log'],
  helper: [],
};

/**
 * The menu for one person: their role's, plus Feedback when the owner granted it (owner Q60), plus
 * (J-14, Plan 4 Task 31) Tickets for whoever holds `tickets.handle` and Compromised accounts for
 * `accounts.freeze` (senior moderators and the owner). No board places the two yet: after the rest,
 * and before Settings on the owner's menu (DESIGNER-REVIEW).
 */
export function navFor(role: StaffRole, grants: readonly Perm[] = []): readonly NavItem[] {
  const base: NavItem[] = [...(NAV[role] ?? [])];
  if (!base.includes('feedback') && can(role, 'feedback.read', grants)) base.push('feedback');
  const extra: NavItem[] = [];
  if (can(role, 'tickets.handle', grants)) extra.push('tickets');
  if (can(role, 'accounts.freeze', grants)) extra.push('compromised');
  const at = base.indexOf('settings');
  if (at === -1) return [...base, ...extra];
  return [...base.slice(0, at), ...extra, ...base.slice(at)];
}
