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
  // Plan 4 Task 6: owner first-run setup (public; 404 setup-locked once locked, and here: an owner exists).
  { method: 'POST', url: '/staff/v1/setup/code', perm: 'public-setup', body: { code: 'AAAA-AAAA-AAAA' } },
  { method: 'POST', url: '/staff/v1/setup/account', perm: 'public-setup', body: { username: 'matrix.owner', loginName: 'matrix-login' } },
  { method: 'POST', url: '/staff/v1/setup/key/start', perm: 'public-setup', body: {} },
  { method: 'POST', url: '/staff/v1/setup/key/finish', perm: 'public-setup', body: {} },
  { method: 'POST', url: '/staff/v1/setup/pgp/start', perm: 'public-setup', body: {} },
  { method: 'POST', url: '/staff/v1/setup/pgp/finish', perm: 'public-setup', body: {} },
  { method: 'POST', url: '/staff/v1/setup/finish', perm: 'public-setup', body: {} },
  // Plan 4 Task 28: News, written by the owner.
  { method: 'POST', url: '/staff/v1/news', perm: 'site.control', body: { title: 'Matrix', body: 'A message.' } },
  { method: 'PUT', url: '/staff/v1/news/:id', perm: 'site.control', body: { title: 'Matrix', body: 'Edited.' } },
  { method: 'DELETE', url: '/staff/v1/news/:id', perm: 'site.control' },
  // Plan 5 Tasks 4 and 21: platform feedback and the feedback form, read by the owner.
  { method: 'GET', url: '/staff/v1/feedback', perm: 'feedback.read' },
  { method: 'GET', url: '/staff/v1/feedback/form', perm: 'feedback.read' },
];
