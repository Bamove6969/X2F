// Plan 4 Task 4: every route of the staff API, the table the privilege matrix (matrix.test.ts)
// walks. Each later staff task appends its routes here; the matrix test fails while a registered
// route is missing from this table, or a listed one no longer exists.
import type { StaffRoutePerm } from '../../src/staff/guard.js';

export interface StaffRouteRow {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  url: string;
  perm: StaffRoutePerm;
  /** The request body (a valid one where the route needs it, so allowed roles reach the handler). */
  body?: unknown;
  /** A `self` route for the owner only (Task 7's owner keys): every other role gets 403 `forbidden`. */
  ownerOnly?: true;
  /**
   * Plan 4 Task 8: what an allowed caller gets instead of a 2xx, for a route whose own check answers
   * 401 or 403 past the guard (a tapped action without a valid tap: 403 `tap-invalid`). The allowed
   * roles must get exactly this, the others the guard's refusal.
   */
  allowedAnswer?: { status: number; error: string };
}

export const STAFF_ROUTE_ROWS: readonly StaffRouteRow[] = [
  // Task 4: the shell, staff login, logout and me.
  { method: 'GET', url: '/healthz', perm: 'public-login' },
  { method: 'POST', url: '/staff/v1/login/security-key/start', perm: 'public-login', body: {} },
  { method: 'POST', url: '/staff/v1/login/security-key/finish', perm: 'public-login', body: {} },
  { method: 'POST', url: '/staff/v1/login/pgp/start', perm: 'public-login', body: {} },
  { method: 'POST', url: '/staff/v1/login/pgp/finish', perm: 'public-login', body: {} },
  { method: 'POST', url: '/staff/v1/logout', perm: 'public-login', body: {} },
  { method: 'GET', url: '/staff/v1/me', perm: 'self' },
  // Plan 4 Task 5: security-key taps (the body is the intent; a sample tap id finishes nothing).
  { method: 'POST', url: '/staff/v1/taps/start', perm: 'self', body: { kind: 'emergency-stop' }, allowedAnswer: { status: 403, error: 'method-not-allowed' } },
  { method: 'POST', url: '/staff/v1/taps/:id/finish', perm: 'self', body: { response: {} }, allowedAnswer: { status: 403, error: 'tap-invalid' } },
  // Task 7: staff management (staff.manage), invite acceptance (public-invite), owner keys.
  { method: 'GET', url: '/staff/v1/members', perm: 'staff.manage' },
  { method: 'POST', url: '/staff/v1/invites', perm: 'staff.manage', body: { role: 'mod', hours: 'any' } },
  { method: 'DELETE', url: '/staff/v1/invites/:id', perm: 'staff.manage' },
  { method: 'POST', url: '/staff/v1/members/:id/switch-off', perm: 'staff.manage', body: {} },
  { method: 'POST', url: '/staff/v1/members/:id/switch-on', perm: 'staff.manage', body: {} },
  { method: 'PUT', url: '/staff/v1/members/:id/hours', perm: 'staff.manage', body: { hours: 'any' } },
  { method: 'PUT', url: '/staff/v1/members/:id/role', perm: 'staff.manage', body: { role: 'mod' } },
  { method: 'DELETE', url: '/staff/v1/members/:id', perm: 'staff.manage' },
  { method: 'GET', url: '/staff/v1/invites/accept/:token', perm: 'public-invite' },
  { method: 'POST', url: '/staff/v1/invites/accept/:token/account', perm: 'public-invite', body: { username: 'Matrix1', loginName: 'matrix1' } },
  { method: 'POST', url: '/staff/v1/invites/accept/:token/key/start', perm: 'public-invite', body: {} },
  { method: 'POST', url: '/staff/v1/invites/accept/:token/key/finish', perm: 'public-invite', body: {} },
  { method: 'POST', url: '/staff/v1/invites/accept/:token/pgp/start', perm: 'public-invite', body: {} },
  { method: 'POST', url: '/staff/v1/invites/accept/:token/pgp/finish', perm: 'public-invite', body: {} },
  { method: 'POST', url: '/staff/v1/invites/accept/:token/finish', perm: 'public-invite', body: {} },
  { method: 'GET', url: '/staff/v1/owner/keys', perm: 'self', ownerOnly: true },
  { method: 'POST', url: '/staff/v1/owner/keys/start', perm: 'self', ownerOnly: true, body: {} },
  { method: 'POST', url: '/staff/v1/owner/keys/finish', perm: 'self', ownerOnly: true, body: {} },
  { method: 'DELETE', url: '/staff/v1/owner/keys/:id', perm: 'self', ownerOnly: true },
  // Plan 4 Task 6: owner first-run setup (public; 404 setup-locked once locked, and here: an owner exists).
  { method: 'POST', url: '/staff/v1/setup/code', perm: 'public-setup', body: { code: 'AAAA-AAAA-AAAA' } },
  { method: 'POST', url: '/staff/v1/setup/account', perm: 'public-setup', body: { username: 'matrix.owner', loginName: 'matrix-login' } },
  { method: 'POST', url: '/staff/v1/setup/key/start', perm: 'public-setup', body: {} },
  { method: 'POST', url: '/staff/v1/setup/key/finish', perm: 'public-setup', body: {} },
  { method: 'POST', url: '/staff/v1/setup/pgp/start', perm: 'public-setup', body: {} },
  { method: 'POST', url: '/staff/v1/setup/pgp/finish', perm: 'public-setup', body: {} },
  { method: 'POST', url: '/staff/v1/setup/finish', perm: 'public-setup', body: {} },
  // Plan 4 Task 8: the owner's settings and the site controls (a sample tap id is never valid).
  { method: 'GET', url: '/staff/v1/settings', perm: 'settings.write' },
  { method: 'PUT', url: '/staff/v1/settings', perm: 'settings.write', body: { firstResponseH: 5 } },
  { method: 'GET', url: '/staff/v1/site', perm: 'site.control' },
  { method: 'POST', url: '/staff/v1/site/stop', perm: 'site.control', body: { tapId: '00000000-0000-4000-8000-000000000000' }, allowedAnswer: { status: 403, error: 'tap-invalid' } },
  { method: 'POST', url: '/staff/v1/site/resume', perm: 'site.control', body: { tapId: '00000000-0000-4000-8000-000000000000' }, allowedAnswer: { status: 403, error: 'tap-invalid' } },
  { method: 'PUT', url: '/staff/v1/site/banner', perm: 'site.control', body: { text: 'Matrix is down for an hour.', kind: 'info' } },
  { method: 'DELETE', url: '/staff/v1/site/banner', perm: 'site.control' },
  { method: 'PUT', url: '/staff/v1/site/maintenance', perm: 'site.control', body: { on: false } },
  // Plan 4 Task 28: News, written by the owner.
  { method: 'POST', url: '/staff/v1/news', perm: 'site.control', body: { title: 'Matrix', body: 'A message.' } },
  { method: 'PUT', url: '/staff/v1/news/:id', perm: 'site.control', body: { title: 'Matrix', body: 'Edited.' } },
  { method: 'DELETE', url: '/staff/v1/news/:id', perm: 'site.control' },
  // Plan 5 Tasks 4 and 21: platform feedback and the feedback form, read by the owner.
  { method: 'GET', url: '/staff/v1/feedback', perm: 'feedback.read' },
  { method: 'GET', url: '/staff/v1/feedback/form', perm: 'feedback.read' },
];
