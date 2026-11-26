// Plan 4 Task 4: every route of the staff API, the table the privilege matrix (matrix.test.ts)
// walks. Each later staff task appends its routes here; the matrix test fails while a registered
// route is missing from this table, or a listed one no longer exists.
import type { StaffRole } from '@x2f/staff';
import type { StaffRoutePerm } from '../../src/staff/guard.js';

const EVERY_ROLE = ['owner', 'senior', 'mod', 'helper'] as const satisfies readonly StaffRole[];
const OWNER = ['owner'] as const satisfies readonly StaffRole[];
const MODERATORS = ['owner', 'senior', 'mod'] as const satisfies readonly StaffRole[];

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
  // Chat membership design task 8: one's own staff device keys (a bad body stops at validation).
  { method: 'GET', url: '/staff/v1/devices', perm: 'self', allowed: EVERY_ROLE },
  { method: 'POST', url: '/staff/v1/devices', perm: 'self', allowed: EVERY_ROLE, body: {} },
  { method: 'POST', url: '/staff/v1/devices/:id/revoke', perm: 'self', allowed: EVERY_ROLE, body: {} },
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
  // D-032 (owner G60): the owner's tapped reset of a staff member's security.
  { method: 'POST', url: '/staff/v1/members/:id/reset-security', perm: 'staff.manage', allowed: OWNER, body: {} },
  // Plan 4 Task 27: bans (senior moderators and the owner).
  { method: 'GET', url: '/staff/v1/accounts/:id/bans', perm: 'accounts.ban', allowed: ['owner', 'senior'] },
  { method: 'POST', url: '/staff/v1/accounts/:id/bans', perm: 'accounts.ban', allowed: ['owner', 'senior'], body: {} },
  { method: 'POST', url: '/staff/v1/accounts/:id/bans/:banId/lift', perm: 'accounts.ban', allowed: ['owner', 'senior'], body: {} },
  { method: 'GET', url: '/staff/v1/terms', perm: 'public-invite', allowed: 'public' },
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
  // O-040 (owner Q35): the owner's notifications (perm self, the owner only).
  { method: 'GET', url: '/staff/v1/owner/alerts', perm: 'self', allowed: OWNER },
  { method: 'POST', url: '/staff/v1/owner/alerts/read-all', perm: 'self', allowed: OWNER, body: {} },
  { method: 'POST', url: '/staff/v1/owner/alerts/:id/read', perm: 'self', allowed: OWNER, body: {} },
  // Plan 4 Task 6: owner first-run setup (public; 404 setup-locked once locked, and here: an owner exists).
  { method: 'POST', url: '/staff/v1/setup/code', perm: 'public-setup', allowed: 'public', body: { code: 'AAAA-AAAA-AAAA' } },
  { method: 'POST', url: '/staff/v1/setup/account', perm: 'public-setup', allowed: 'public', body: { displayName: 'matrix.owner', loginName: 'matrix-login' } },
  { method: 'POST', url: '/staff/v1/setup/key/start', perm: 'public-setup', allowed: 'public', body: {} },
  { method: 'POST', url: '/staff/v1/setup/key/finish', perm: 'public-setup', allowed: 'public', body: {} },
  { method: 'POST', url: '/staff/v1/setup/pgp/start', perm: 'public-setup', allowed: 'public', body: {} },
  { method: 'POST', url: '/staff/v1/setup/pgp/finish', perm: 'public-setup', allowed: 'public', body: {} },
  { method: 'POST', url: '/staff/v1/setup/finish', perm: 'public-setup', allowed: 'public', body: {} },
  // Plan 4 Task 8: the owner's settings and the site controls (a sample tap id is never valid).
  { method: 'GET', url: '/staff/v1/settings', perm: 'settings.write', allowed: OWNER },
  { method: 'PUT', url: '/staff/v1/settings', perm: 'settings.write', allowed: OWNER, body: { firstResponseH: 5 } },
  { method: 'GET', url: '/staff/v1/site', perm: 'site.control', allowed: OWNER },
  { method: 'POST', url: '/staff/v1/site/stop', perm: 'site.control', allowed: OWNER, body: { tapId: '00000000-0000-4000-8000-000000000000' }, allowedAnswer: { status: 403, error: 'tap-invalid' } },
  { method: 'POST', url: '/staff/v1/site/resume', perm: 'site.control', allowed: OWNER, body: { tapId: '00000000-0000-4000-8000-000000000000' }, allowedAnswer: { status: 403, error: 'tap-invalid' } },
  // Review p4t22 m2: showing the banner, publishing or editing News are tapped.
  { method: 'PUT', url: '/staff/v1/site/banner', perm: 'site.control', allowed: OWNER, body: { text: 'Matrix is down for an hour.', kind: 'info', tapId: '00000000-0000-4000-8000-000000000000' }, allowedAnswer: { status: 403, error: 'tap-invalid' } },
  { method: 'DELETE', url: '/staff/v1/site/banner', perm: 'site.control', allowed: OWNER },
  { method: 'PUT', url: '/staff/v1/site/maintenance', perm: 'site.control', allowed: OWNER, body: { on: false } },
  // J-04 (owner G19): a planned maintenance announced ahead.
  // Review p4t22 N2: announcing it is tapped.
  { method: 'PUT', url: '/staff/v1/site/maintenance/planned', perm: 'site.control', allowed: OWNER, body: { startsAt: '2099-01-01T00:00:00.000Z', endsAt: '2099-01-01T02:00:00.000Z', tapId: '00000000-0000-4000-8000-000000000000' }, allowedAnswer: { status: 403, error: 'tap-invalid' } },
  { method: 'DELETE', url: '/staff/v1/site/maintenance/planned', perm: 'site.control', allowed: OWNER },
  { method: 'POST', url: '/staff/v1/site/auto-close/resume', perm: 'site.control', allowed: OWNER, body: {} },
  // Plan 4 Task 28: News, written by the owner (the list: Task 16's NewsEditor).
  { method: 'GET', url: '/staff/v1/news', perm: 'site.control', allowed: OWNER },
  { method: 'POST', url: '/staff/v1/news', perm: 'site.control', allowed: OWNER, body: { title: 'Matrix', body: 'A message.', tapId: '00000000-0000-4000-8000-000000000000' }, allowedAnswer: { status: 403, error: 'tap-invalid' } },
  { method: 'PUT', url: '/staff/v1/news/:id', perm: 'site.control', allowed: OWNER, body: { title: 'Matrix', body: 'Edited.', tapId: '00000000-0000-4000-8000-000000000000' } },
  { method: 'DELETE', url: '/staff/v1/news/:id', perm: 'site.control', allowed: OWNER },
  // Owner Q13 (6 Nov): the owner's Price health, moved from the trader API.
  { method: 'GET', url: '/staff/v1/price-health', perm: 'stats.read', allowed: OWNER },
  // Plan 4 Task 20: moderator performance (spec 6.6, owner only: a senior or a mod gets forbidden).
  { method: 'GET', url: '/staff/v1/performance', perm: 'perf.read', allowed: OWNER },
  { method: 'GET', url: '/staff/v1/performance/:id/weeks', perm: 'perf.read', allowed: OWNER },
  // Plan 5 Task 10 (owner 2026-11-02): a past-rep claim's verified dollar figure.
  { method: 'PUT', url: '/staff/v1/past-rep/:id/verified-usd', perm: 'reputation.verify', allowed: ['owner', 'senior'], body: { usdCents: 100 } },
  // Plan 5 Task 19: review disputes, moderators and up (a helper is refused).
  { method: 'GET', url: '/staff/v1/review-disputes', perm: 'reputation.review', allowed: MODERATORS },
  { method: 'POST', url: '/staff/v1/review-disputes/:id/decide', perm: 'reputation.review', allowed: MODERATORS, body: { outcome: 'stands', reason: 'The review is fair and on topic.' } },
  // Plan 5 Task 11: moderators review past-reputation claims; senior moderators and the owner revoke
  // (a sample uuid is no claim: 404 past the guard).
  { method: 'GET', url: '/staff/v1/past-rep', perm: 'reputation.review', allowed: MODERATORS },
  { method: 'POST', url: '/staff/v1/past-rep/:id/approve', perm: 'reputation.review', allowed: MODERATORS, body: { fingerprintSeen: true, profileSeen: true, tradesSeen: 1 } },
  { method: 'POST', url: '/staff/v1/past-rep/:id/reject', perm: 'reputation.review', allowed: MODERATORS, body: { reason: 'The archive shows another key.' } },
  { method: 'POST', url: '/staff/v1/past-rep/:id/revoke', perm: 'reputation.revoke', allowed: ['owner', 'senior'], body: { reason: 'The archive was edited later.' } },
  // Lead hold v3 review (owner G35): a recovery-code hold extended or ended by staff, logged.
  { method: 'POST', url: '/staff/v1/accounts/:id/hold/extend', perm: 'accounts.freeze', allowed: ['owner', 'senior'], body: {} },
  { method: 'POST', url: '/staff/v1/accounts/:id/hold/end', perm: 'accounts.freeze', allowed: ['owner', 'senior'], body: {} },
  // Plan 4 Task 26: recommended account limits (bodies valid in shape; an unknown account or case: 404).
  { method: 'POST', url: '/staff/v1/accounts/:id/limit-recommendations', perm: 'rulings.approve', allowed: ['owner', 'senior'], body: { capUsd: 300, reason: 'x'.repeat(40) } },
  { method: 'POST', url: '/staff/v1/disputes/:code/limit-recommendations', perm: 'disputes.handle', allowed: MODERATORS, body: { side: 'seller', capUsd: 300, reason: 'x'.repeat(40) } },
  { method: 'GET', url: '/staff/v1/limit-recommendations', perm: 'rulings.approve', allowed: ['owner', 'senior'] },
  { method: 'POST', url: '/staff/v1/accounts/:id/limit-recommendations/:recId/decide', perm: 'rulings.approve', allowed: ['owner', 'senior'], body: { approve: true, tapId: '7c3f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f' } },
  // Plan 5 Tasks 4 and 21: platform feedback and the feedback form, read by the owner.
  // Owner Q60: senior moderators by role, moderators and helpers by grant.
  { method: 'GET', url: '/staff/v1/feedback', perm: 'feedback.read', allowed: ['owner', 'senior'], grantable: true },
  { method: 'GET', url: '/staff/v1/feedback/form', perm: 'feedback.read', allowed: ['owner', 'senior'], grantable: true },
  // P-012/P-013: the blur-check answers, read by the feedback readers.
  { method: 'GET', url: '/staff/v1/feedback/blur-checks', perm: 'feedback.read', allowed: ['owner', 'senior'], grantable: true },
  // Plan 4 Task 30: support tickets (tickets.handle: the owner by role, anyone else by the owner's grant).
  // The sample id names no ticket: an allowed caller gets 404 (a body stops at validation first).
  { method: 'GET', url: '/staff/v1/tickets', perm: 'tickets.handle', allowed: OWNER, grantable: true },
  { method: 'GET', url: '/staff/v1/tickets/:id', perm: 'tickets.handle', allowed: OWNER, grantable: true },
  { method: 'POST', url: '/staff/v1/tickets/:id/take', perm: 'tickets.handle', allowed: OWNER, grantable: true, body: {} },
  { method: 'POST', url: '/staff/v1/tickets/:id/messages', perm: 'tickets.handle', allowed: OWNER, grantable: true, body: {} },
  { method: 'POST', url: '/staff/v1/tickets/:id/close', perm: 'tickets.handle', allowed: OWNER, grantable: true, body: {} },
  { method: 'POST', url: '/staff/v1/tickets/:id/release', perm: 'tickets.handle', allowed: OWNER, grantable: true, body: {} },
  // Plan 4 Task 11: the moderator's queue and case (a sample uuid is neither a trade code nor an
  // incident ID: 404 past the guard).
  { method: 'GET', url: '/staff/v1/disputes', perm: 'disputes.handle', allowed: MODERATORS },
  { method: 'POST', url: '/staff/v1/disputes/next', perm: 'disputes.handle', allowed: MODERATORS, body: {} },
  { method: 'POST', url: '/staff/v1/disputes/:code/take', perm: 'disputes.handle', allowed: MODERATORS, body: {} },
  { method: 'GET', url: '/staff/v1/disputes/:code', perm: 'disputes.handle', allowed: MODERATORS },
  { method: 'POST', url: '/staff/v1/disputes/:code/messages', perm: 'disputes.handle', allowed: MODERATORS, body: { text: 'Hello' } },
  // Design build task 9: the moderator's read (a re-wrap to the certified device; a bad body stops at validation).
  { method: 'POST', url: '/staff/v1/disputes/:code/chat', perm: 'disputes.handle', allowed: MODERATORS, body: {} },
  { method: 'POST', url: '/staff/v1/disputes/:code/proof-request', perm: 'disputes.handle', allowed: MODERATORS, body: { side: 'buyer' } },
  { method: 'POST', url: '/staff/v1/disputes/:code/freeze', perm: 'disputes.handle', allowed: MODERATORS, body: { side: 'seller', on: true, reason: 'no-reply' } },
  // Task 12: rulings. Bodies are valid in shape, so the allowed roles reach the handler (an unknown case: 404).
  { method: 'POST', url: '/staff/v1/disputes/:code/rulings', perm: 'disputes.handle', allowed: MODERATORS,
    body: { rulingId: '7c3f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f', outcome: 'release-to-buyer', accountAction: { kind: 'none' }, reason: 'x'.repeat(40), evidence: [], tapId: '7c3f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f' } },
  { method: 'POST', url: '/staff/v1/disputes/:code/rulings/:id/approve', perm: 'rulings.approve', allowed: ['owner', 'senior'], body: { tapId: '7c3f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f' } },
  // Review p4t22 M1 (e): the rescue's second approval of a ruling the gate refuses `needs-second`.
  { method: 'POST', url: '/staff/v1/disputes/:code/rulings/:id/second-approval', perm: 'rulings.approve', allowed: ['owner', 'senior'], body: { tapId: '7c3f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f' } },
  // Review p4t22 N1: a senior's new round 1 in place of one the gate refuses as revoked.
  { method: 'POST', url: '/staff/v1/disputes/:code/rulings/:id/re-propose', perm: 'rulings.approve', allowed: ['owner', 'senior'], body: { rulingId: '7c3f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f', outcome: 'release-to-buyer', accountAction: { kind: 'none' }, reason: 'A reason of at least forty characters for the new ruling.', evidence: [], tapId: '7c3f6a52-2f0e-4b8a-9d55-0a1b2c3d4e5f' } },
  { method: 'POST', url: '/staff/v1/disputes/:code/rulings/:id/send-back', perm: 'rulings.approve', allowed: ['owner', 'senior'], body: { note: 'Look again.' } },
  { method: 'POST', url: '/staff/v1/freezes/:id/lift', perm: 'disputes.handle', allowed: MODERATORS, body: {} },
  // Plan 4 Task 24 (D-011): who may review an appeal; the owner only (review M1, lead call 12 Nov).
  { method: 'GET', url: '/staff/v1/disputes/:code/appeal-reviewers', perm: 'staff.manage', allowed: OWNER },
  // Plan 4 Task 32: the owner's revenue totals (the internal revenue ledger).
  { method: 'GET', url: '/staff/v1/revenue', perm: 'earnings.read', allowed: OWNER },
  // B-006: the fee wallet's sweep settings (a body that changes nothing needs no tap).
  { method: 'GET', url: '/staff/v1/fee-sweep', perm: 'settings.write', allowed: OWNER },
  { method: 'PUT', url: '/staff/v1/fee-sweep', perm: 'settings.write', allowed: OWNER, body: { thresholdAtomic: null, floatAtomic: null, coldAddress: null, tapId: '00000000-0000-4000-8000-000000000000' } },
  // Plan 4 Task 33 (D-041..D-045): one's own pay page, the clock-out, payout addresses (a bad body
  // stops at validation); the owner's pay settings (a body that changes nothing needs no tap) and
  // every member's unpaid net.
  { method: 'GET', url: '/staff/v1/pay', perm: 'self', allowed: EVERY_ROLE },
  { method: 'GET', url: '/staff/v1/pay/clock-out', perm: 'self', allowed: EVERY_ROLE },
  { method: 'POST', url: '/staff/v1/pay/clock-out', perm: 'self', allowed: EVERY_ROLE, body: { quote: 'x', addressId: 'not-a-uuid' } },
  { method: 'POST', url: '/staff/v1/pay/addresses', perm: 'self', allowed: EVERY_ROLE, body: {} },
  { method: 'DELETE', url: '/staff/v1/pay/addresses/:id', perm: 'self', allowed: EVERY_ROLE },
  { method: 'GET', url: '/staff/v1/pay/settings', perm: 'settings.write', allowed: OWNER },
  { method: 'PUT', url: '/staff/v1/pay/settings', perm: 'settings.write', allowed: OWNER, body: { modDisputeUsdCents: null, seniorDisputeUsdCents: null, seniorLargeTradeBp: null, largeTradeThresholdUsd: null, tapId: '00000000-0000-4000-8000-000000000000' } },
  { method: 'GET', url: '/staff/v1/pay/staff', perm: 'earnings.read', allowed: OWNER },
  // Plan 4 Task 19: the Activity log page (the staff scope for moderators and senior moderators, all
  // for the owner; the chain check is the owner's) and the training library (closed cases, scrubbed).
  { method: 'GET', url: '/staff/v1/log', perm: 'log.read.cases', allowed: MODERATORS },
  { method: 'GET', url: '/staff/v1/log/filters', perm: 'log.read.cases', allowed: MODERATORS },
  { method: 'GET', url: '/staff/v1/log/active-disputes', perm: 'log.read.cases', allowed: MODERATORS },
  { method: 'GET', url: '/staff/v1/log/integrity', perm: 'log.read.all', allowed: OWNER },
  { method: 'GET', url: '/staff/v1/training', perm: 'training.read', allowed: MODERATORS },
  { method: 'GET', url: '/staff/v1/training/:id', perm: 'training.read', allowed: MODERATORS },
  // Lead call 18 Nov (re-review): the library is review-first; a curator marks each case.
  { method: 'GET', url: '/staff/v1/training/review', perm: 'training.curate', allowed: OWNER },
  { method: 'GET', url: '/staff/v1/training/review/:id', perm: 'training.curate', allowed: OWNER },
  { method: 'PUT', url: '/staff/v1/training/review/:id', perm: 'training.curate', allowed: OWNER, body: { masks: [] } },
  { method: 'DELETE', url: '/staff/v1/training/review/:id', perm: 'training.curate', allowed: OWNER },
];
