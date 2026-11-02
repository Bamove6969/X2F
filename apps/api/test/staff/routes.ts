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
];
