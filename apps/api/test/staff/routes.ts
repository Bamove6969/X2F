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
  // Plan 4 Task 28: News, written by the owner.
  { method: 'POST', url: '/staff/v1/news', perm: 'site.control', body: { title: 'Matrix', body: 'A message.' } },
  { method: 'PUT', url: '/staff/v1/news/:id', perm: 'site.control', body: { title: 'Matrix', body: 'Edited.' } },
  { method: 'DELETE', url: '/staff/v1/news/:id', perm: 'site.control' },
  // Plan 5 Tasks 4 and 21: platform feedback and the feedback form, read by the owner.
  { method: 'GET', url: '/staff/v1/feedback', perm: 'feedback.read' },
  { method: 'GET', url: '/staff/v1/feedback/form', perm: 'feedback.read' },
];
