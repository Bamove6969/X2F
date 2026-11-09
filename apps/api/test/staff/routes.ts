// Plan 4 Task 4: every route of the staff API, the table the privilege matrix (matrix.test.ts)
// walks. Each later staff task appends its routes here; the matrix test fails while a registered
// route is missing from this table, or a listed one no longer exists.
import type { StaffRole } from '@x2f/staff';
import type { StaffRoutePerm } from '../../src/staff/guard.js';

const EVERY_ROLE = ['owner', 'senior', 'mod', 'helper'] as const satisfies readonly StaffRole[];
const OWNER = ['owner'] as const satisfies readonly StaffRole[];

export interface StaffRouteRow {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  perm: StaffRoutePerm;
  /**
   * The roles that reach the handler, written out by hand (RV5 m4): the matrix checks the app
   * against this column, never against `can()`, so a wrong grant in `@x2f/staff`'s table fails here
   * too. 'public' for the public routes. A route of a grantable perm (`GRANTABLE_PERMS`) also sets
   * `grantable`: a member holding it as a grant then reaches the handler whatever the role.
   */
  allowed: readonly StaffRole[] | 'public';
  grantable?: true;
  /** The request body (a valid one where the route needs it, so allowed roles reach the handler). */
  body?: unknown;
  /**
   * Plan 4 Task 8: what an allowed caller gets instead of a 2xx, for a route whose own check answers
   * 401 or 403 past the guard (a tapped action without a valid tap: 403 `tap-invalid`). The allowed
   * roles must get exactly this, the others the guard's refusal.
   */
  allowedAnswer?: { status: number; error: string };
}

export const STAFF_ROUTE_ROWS: readonly StaffRouteRow[] = [
  // Task 4: the shell, staff login, logout and me.
  { method: 'GET', url: '/healthz', perm: 'public-login', allowed: 'public' },
  { method: 'POST', url: '/staff/v1/login/security-key/start', perm: 'public-login', allowed: 'public', body: {} },
  { method: 'POST', url: '/staff/v1/login/security-key/finish', perm: 'public-login', allowed: 'public', body: {} },
  { method: 'POST', url: '/staff/v1/login/pgp/start', perm: 'public-login', allowed: 'public', body: {} },
  { method: 'POST', url: '/staff/v1/login/pgp/finish', perm: 'public-login', allowed: 'public', body: {} },
  { method: 'POST', url: '/staff/v1/logout', perm: 'public-login', allowed: 'public', body: {} },
  { method: 'GET', url: '/staff/v1/me', perm: 'self', allowed: EVERY_ROLE },
  // Lead re-review 6 Nov items 1-2: one's own methods, sessions, alerts and push (bodies stop at
  // validation or name nothing, so the matrix checks the guard alone).
  { method: 'GET', url: '/staff/v1/account/methods', perm: 'self', allowed: EVERY_ROLE },
  { method: 'POST', url: '/staff/v1/account/pgp/start', perm: 'self', allowed: EVERY_ROLE, body: {} },
  { method: 'POST', url: '/staff/v1/account/pgp/finish', perm: 'self', allowed: EVERY_ROLE, body: {} },
  { method: 'DELETE', url: '/staff/v1/account/methods/:type/:id', perm: 'self', allowed: EVERY_ROLE },
  { method: 'GET', url: '/staff/v1/account/sessions', perm: 'self', allowed: EVERY_ROLE },
  { method: 'DELETE', url: '/staff/v1/account/sessions/:id', perm: 'self', allowed: EVERY_ROLE },
  { method: 'GET', url: '/staff/v1/account/alerts', perm: 'self', allowed: EVERY_ROLE },
  { method: 'POST', url: '/staff/v1/account/alerts/:id/seen', perm: 'self', allowed: EVERY_ROLE, body: {} },
  { method: 'GET', url: '/staff/v1/account/push', perm: 'self', allowed: EVERY_ROLE },
  { method: 'POST', url: '/staff/v1/account/push', perm: 'self', allowed: EVERY_ROLE, body: {} },
  { method: 'DELETE', url: '/staff/v1/account/push', perm: 'self', allowed: EVERY_ROLE, body: { endpoint: 'https://push.example/none' } },
  // Task 5: security-key taps. The bodies stop at validation (400), so the matrix checks the guard
  // alone; which intents each role may start (RV5 m7) is keyTap.test.ts's.
  { method: 'POST', url: '/staff/v1/taps/start', perm: 'self', allowed: EVERY_ROLE, body: { kind: 'matrix' } },
  { method: 'POST', url: '/staff/v1/taps/:id/finish', perm: 'self', allowed: EVERY_ROLE, body: {} },
  // Task 7: staff management (staff.manage), invite acceptance (public-invite), owner keys.
  { method: 'GET', url: '/staff/v1/members', perm: 'staff.manage', allowed: OWNER },
  { method: 'POST', url: '/staff/v1/invites', perm: 'staff.manage', allowed: OWNER, body: { role: 'mod', hours: 'any' } },
  { method: 'DELETE', url: '/staff/v1/invites/:id', perm: 'staff.manage', allowed: OWNER },
  { method: 'POST', url: '/staff/v1/members/:id/switch-off', perm: 'staff.manage', allowed: OWNER, body: {} },
  { method: 'POST', url: '/staff/v1/members/:id/switch-on', perm: 'staff.manage', allowed: OWNER, body: {} },
  { method: 'PUT', url: '/staff/v1/members/:id/hours', perm: 'staff.manage', allowed: OWNER, body: { hours: 'any' } },
  { method: 'PUT', url: '/staff/v1/members/:id/grants', perm: 'staff.manage', allowed: OWNER, body: { grants: [] } },
  { method: 'PUT', url: '/staff/v1/members/:id/role', perm: 'staff.manage', allowed: OWNER, body: { role: 'mod' } },
  { method: 'DELETE', url: '/staff/v1/members/:id', perm: 'staff.manage', allowed: OWNER },
  { method: 'GET', url: '/staff/v1/invites/accept/:token', perm: 'public-invite', allowed: 'public' },
  { method: 'POST', url: '/staff/v1/invites/accept/:token/account', perm: 'public-invite', allowed: 'public', body: { displayName: 'Matrix1', loginName: 'matrix1' } },
  { method: 'POST', url: '/staff/v1/invites/accept/:token/key/start', perm: 'public-invite', allowed: 'public', body: {} },
  { method: 'POST', url: '/staff/v1/invites/accept/:token/key/finish', perm: 'public-invite', allowed: 'public', body: {} },
  { method: 'POST', url: '/staff/v1/invites/accept/:token/pgp/start', perm: 'public-invite', allowed: 'public', body: {} },
  { method: 'POST', url: '/staff/v1/invites/accept/:token/pgp/finish', perm: 'public-invite', allowed: 'public', body: {} },
  { method: 'POST', url: '/staff/v1/invites/accept/:token/finish', perm: 'public-invite', allowed: 'public', body: {} },
  { method: 'GET', url: '/staff/v1/owner/keys', perm: 'self', allowed: OWNER },
  { method: 'POST', url: '/staff/v1/owner/keys/start', perm: 'self', allowed: OWNER, body: {} },
  { method: 'POST', url: '/staff/v1/owner/keys/finish', perm: 'self', allowed: OWNER, body: {} },
  // Plan 4 Task 8: the owner's settings and the site controls (a sample tap id is never valid).
  { method: 'GET', url: '/staff/v1/settings', perm: 'settings.write', allowed: OWNER },
  { method: 'PUT', url: '/staff/v1/settings', perm: 'settings.write', allowed: OWNER, body: { firstResponseH: 5 } },
  { method: 'GET', url: '/staff/v1/site', perm: 'site.control', allowed: OWNER },
  { method: 'POST', url: '/staff/v1/site/stop', perm: 'site.control', allowed: OWNER, body: { tapId: '00000000-0000-4000-8000-000000000000' }, allowedAnswer: { status: 403, error: 'tap-invalid' } },
  { method: 'POST', url: '/staff/v1/site/resume', perm: 'site.control', allowed: OWNER, body: { tapId: '00000000-0000-4000-8000-000000000000' }, allowedAnswer: { status: 403, error: 'tap-invalid' } },
  { method: 'PUT', url: '/staff/v1/site/banner', perm: 'site.control', allowed: OWNER, body: { text: 'Matrix is down for an hour.', kind: 'info' } },
  { method: 'DELETE', url: '/staff/v1/site/banner', perm: 'site.control', allowed: OWNER },
  { method: 'PUT', url: '/staff/v1/site/maintenance', perm: 'site.control', allowed: OWNER, body: { on: false } },
  // J-04 (owner G19): a planned maintenance announced ahead.
  { method: 'PUT', url: '/staff/v1/site/maintenance/planned', perm: 'site.control', allowed: OWNER, body: { startsAt: '2099-01-01T00:00:00.000Z', endsAt: '2099-01-01T02:00:00.000Z' } },
  { method: 'DELETE', url: '/staff/v1/site/maintenance/planned', perm: 'site.control', allowed: OWNER },
  { method: 'POST', url: '/staff/v1/site/auto-close/resume', perm: 'site.control', allowed: OWNER, body: {} },
  // Plan 4 Task 28: News, written by the owner.
  { method: 'POST', url: '/staff/v1/news', perm: 'site.control', allowed: OWNER, body: { title: 'Matrix', body: 'A message.' } },
  { method: 'PUT', url: '/staff/v1/news/:id', perm: 'site.control', allowed: OWNER, body: { title: 'Matrix', body: 'Edited.' } },
  { method: 'DELETE', url: '/staff/v1/news/:id', perm: 'site.control', allowed: OWNER },
  // Owner Q13 (6 Nov): the owner's Price health, moved from the trader API.
  { method: 'GET', url: '/staff/v1/price-health', perm: 'stats.read', allowed: OWNER },
  // Plan 5 Task 10 (owner 2026-11-02): a past-rep claim's verified dollar figure.
  { method: 'PUT', url: '/staff/v1/past-rep/:id/verified-usd', perm: 'reputation.verify', allowed: ['owner', 'senior'], body: { usdCents: 100 } },
  // Plan 5 Tasks 4 and 21: platform feedback and the feedback form, read by the owner.
  // Owner Q60: senior moderators by role, moderators and helpers by grant.
  { method: 'GET', url: '/staff/v1/feedback', perm: 'feedback.read', allowed: ['owner', 'senior'], grantable: true },
  { method: 'GET', url: '/staff/v1/feedback/form', perm: 'feedback.read', allowed: ['owner', 'senior'], grantable: true },
];
