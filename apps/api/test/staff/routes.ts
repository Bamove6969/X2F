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
  // Plan 4 Task 28: News, written by the owner.
  { method: 'POST', url: '/staff/v1/news', perm: 'site.control', allowed: OWNER, body: { title: 'Matrix', body: 'A message.' } },
  { method: 'PUT', url: '/staff/v1/news/:id', perm: 'site.control', allowed: OWNER, body: { title: 'Matrix', body: 'Edited.' } },
  { method: 'DELETE', url: '/staff/v1/news/:id', perm: 'site.control', allowed: OWNER },
  // Plan 5 Tasks 4 and 21: platform feedback and the feedback form, read by the owner.
  { method: 'GET', url: '/staff/v1/feedback', perm: 'feedback.read', allowed: OWNER },
  { method: 'GET', url: '/staff/v1/feedback/form', perm: 'feedback.read', allowed: OWNER },
];
