/**
 * The staff app's API client (Plan 4 Task 16). Every call goes to the staff API on this same
 * origin with `credentials: 'same-origin'` (the `__Host-x2f_staff` cookie never leaves it), sends
 * JSON and throws `StaffApiError` with the API's error code on any refusal.
 *
 * A 401 `outside-login-hours` from any call means the staff member's login window has closed and
 * the API has ended the session (Task 4's `requireStaff`): the listener set by the app shell shows
 * "Your login hours have ended." and returns to Login. A 401 `not-authenticated` from a call made
 * behind the shell goes to Login too (the session ran out).
 */
import { defaultDeviceLabel, type TermsSignature } from '@x2f/auth-client';
import type { CompromisedMethod, GrantablePerm, KeyTapIntent, LoginHours, NavItem, Perm, StaffRole, StarterSettings, TicketCategory, TicketStatus } from '@x2f/staff';
import type {
  AuthenticationResponseJSON,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import type { NewsItem } from './ui/kit.js';

export class StaffApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly extra: Record<string, unknown>;
  constructor(status: number, code: string, extra: Record<string, unknown> = {}) {
    super(code);
    this.name = 'StaffApiError';
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

/** The error code of a refused call, or null for anything else (a network fault, a cancelled key tap). */
export function codeOf(e: unknown): string | null {
  return e instanceof StaffApiError ? e.code : null;
}

type SessionEnd = 'hours' | 'expired';
let sessionEnded: ((why: SessionEnd) => void) | null = null;

/** The shell listens for a session that the API ended (login hours over, or the session gone). */
export function setSessionEndListener(fn: ((why: SessionEnd) => void) | null): void {
  sessionEnded = fn;
}

export interface CallInit {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
}

export async function staffApi<T = unknown>(path: string, init: CallInit = {}): Promise<T> {
  const headers: Record<string, string> = { accept: 'application/json' };
  const req: RequestInit = { method: init.method ?? 'GET', credentials: 'same-origin', headers };
  if (init.body !== undefined) {
    headers['content-type'] = 'application/json';
    req.body = JSON.stringify(init.body);
  }
  const res = await fetch(path, req);
  noteServerDate(res.headers.get('date'));
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (res.ok) return data as T;
  const rec = data !== null && typeof data === 'object' && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const { error, ...extra } = rec;
  const err = new StaffApiError(res.status, typeof error === 'string' ? error : 'internal', extra);
  // not-a-refusal: routes the code to the shell's session-ended handling, shows no text.
  if (err.status === 401 && err.code === 'outside-login-hours') sessionEnded?.('hours');
  else if (err.status === 401 && err.code === 'not-authenticated') sessionEnded?.('expired');
  throw err;
}

// The server's clock, from each answer's Date header (whole seconds), so the session countdown
// follows the server and never the device's own time of day.
let offsetMs = 0;
function noteServerDate(h: string | null): void {
  const at = h === null ? Number.NaN : Date.parse(h);
  if (Number.isFinite(at)) offsetMs = at - Date.now();
}
/** Now, by the staff API's clock (the device clock until the first answer). */
export function serverNow(): Date {
  return new Date(Date.now() + offsetMs);
}

/** This browser's coarse label for the session list (never the raw user-agent string). */
export function deviceLabel(): string {
  const nav = typeof navigator === 'undefined' ? {} : (navigator as { userAgentData?: { platform?: string } });
  return defaultDeviceLabel(nav);
}

// ---------------------------------------------------------------------------------------------
// The signed-in staff member (Task 4)

export interface Me {
  /** Owner Q54: the public name (the API's `tradeTag`; the boards call it the username). */
  tradeTag: string;
  role: StaffRole;
  nav: NavItem[];
  /** The per-person boxes the owner ticked (older answers may lack it: none). */
  grants?: Perm[];
  /** The earliest of the idle limit, the absolute limit and the end of the login window. */
  sessionEndsAt: string;
}

export const me = () => staffApi<Me>('/staff/v1/me');
export const logout = () => staffApi<unknown>('/staff/v1/logout', { method: 'POST', body: {} });

// ---------------------------------------------------------------------------------------------
// Staff login (Task 4): always two factors. The first step names the account (a login name for a
// security key, the pasted public key for PGP); the second step is bound to its `pendingId`.

export type StaffMethod = 'pgp' | 'security-key' | 'passkey';
export type LoginResult = { status: 'ok' } | { status: 'second-factor'; pendingId: string; needs: StaffMethod[] };

export interface PgpChallenge {
  challengeId: string;
  encryptedMessage: string;
  expiresAt: string;
}

export const keyLoginStart = (b: { loginName: string } | { pendingId: string }) =>
  staffApi<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON; loginNonce?: string }>('/staff/v1/login/security-key/start', { method: 'POST', body: b });
export const keyLoginFinish = (b: { challengeId: string; response: AuthenticationResponseJSON; pendingId?: string }) =>
  staffApi<LoginResult>('/staff/v1/login/security-key/finish', { method: 'POST', body: { ...b, deviceLabel: deviceLabel() } });
export const pgpLoginStart = (b: { key: string; pendingId?: string }) => staffApi<PgpChallenge>('/staff/v1/login/pgp/start', { method: 'POST', body: b });
export const pgpLoginFinish = (b: { challengeId: string; code: string }) =>
  staffApi<LoginResult>('/staff/v1/login/pgp/finish', { method: 'POST', body: { ...b, deviceLabel: deviceLabel() } });

// ---------------------------------------------------------------------------------------------
// Key taps (Task 5): every tapped action first proves a security-key tap bound to its intent.

export const tapStart = (intent: KeyTapIntent) =>
  staffApi<{ tapId: string; options: PublicKeyCredentialRequestOptionsJSON; nonce: string; issuedAt: string | null }>('/staff/v1/taps/start', { method: 'POST', body: intent });
export const tapFinish = (tapId: string, response: AuthenticationResponseJSON) =>
  staffApi<{ tapId: string }>(`/staff/v1/taps/${encodeURIComponent(tapId)}/finish`, { method: 'POST', body: { response } });

// ---------------------------------------------------------------------------------------------
// Owner first-run setup (Task 6; 404 `setup-locked` once it has finished)

export type SetupState = 'open' | 'locked';

/**
 * Task 6 has no status route: `finish` without the setup cookie answers 404 `setup-locked` once
 * setup is over and 401 `not-authenticated` while it is open, and costs no try of the code.
 */
export async function setupState(): Promise<SetupState> {
  try {
    await fetchProbe();
  } catch (e) {
    if (codeOf(e) === 'setup-locked') return 'locked';
    if (codeOf(e) === 'not-authenticated') return 'open';
    throw e;
  }
  // A 2xx without the cookie cannot happen; treat it as open so the page still works.
  return 'open';
}
const fetchProbe = () => staffApi<unknown>('/staff/v1/setup/finish', { method: 'POST', body: {} });
export const setupCode = (code: string) => staffApi<{ ok: true; expiresAt: string }>('/staff/v1/setup/code', { method: 'POST', body: { code } });
export const setupAccount = (b: { tradeTag: string; loginName: string }) => staffApi<{ ok: true }>('/staff/v1/setup/account', { method: 'POST', body: b });
export const setupKeyStart = () =>
  staffApi<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON; setupNonce?: string }>('/staff/v1/setup/key/start', { method: 'POST', body: { kind: 'security-key' } });
export const setupKeyFinish = (b: { challengeId: string; response: RegistrationResponseJSON; label?: string }) =>
  staffApi<{ keys: number }>('/staff/v1/setup/key/finish', { method: 'POST', body: b });
export const setupPgpStart = (publicKey: string) => staffApi<PgpChallenge>('/staff/v1/setup/pgp/start', { method: 'POST', body: { publicKey } });
export const setupPgpFinish = (b: { challengeId: string; code: string }) => staffApi<{ fingerprint: string }>('/staff/v1/setup/pgp/finish', { method: 'POST', body: b });
/** The owner's attested security keys with their key check codes (Task 7; the owner's session only). */
export const ownerKeys = () =>
  staffApi<{ keys: { id: string; label: string; createdAt: string; lastUsedAt: string | null; keyCheckCode: string }[] }>('/staff/v1/owner/keys');
export const setupFinish = () => staffApi<{ keyCheckCodes: string[] }>('/staff/v1/setup/finish', { method: 'POST', body: { deviceLabel: deviceLabel() } });

// ---------------------------------------------------------------------------------------------
// Invite acceptance (Task 7; any invalid, used, cancelled or expired token is 404 `invite-invalid`)

export type InviteRole = 'senior' | 'mod' | 'helper';
export interface InviteView {
  role: InviteRole;
  hours: LoginHours;
  expiresAt: string;
  /** A return visit: the account is made; what was added so far (null before the names). */
  resume: { keys: number; passkeys: number; pgp: number; keyCheckCode: string | null } | null;
}

const invitePath = (token: string, rest = '') => `/staff/v1/invites/accept/${encodeURIComponent(token)}${rest}`;

/** `GET /staff/v1/terms`: the Terms version an invitee accepts (the trader API's `GET /v1/terms`, the same value). */
export const staffTerms = () => staffApi<{ version: string }>('/staff/v1/terms');
export const inviteRead = (token: string) => staffApi<InviteView>(invitePath(token));
/**
 * Owner Q54: the public name is `tradeTag` (the API refuses a field named username). Owner 9 Nov
 * 2026 (p11-14): everyone who gets a login signs the Terms, so the version accepted and the
 * signature given on the Terms step go with the names (400 `terms-not-accepted` when the version
 * changed meanwhile: the page shows the Terms again).
 */
export const inviteAccount = (token: string, b: { tradeTag: string; loginName: string; acceptedTerms: string; termsSignature: TermsSignature }) =>
  staffApi<{ ok: true }>(invitePath(token, '/account'), { method: 'POST', body: b });
export const inviteKeyStart = (token: string, kind: 'security-key' | 'passkey') =>
  staffApi<{ options: PublicKeyCredentialCreationOptionsJSON }>(invitePath(token, '/key/start'), { method: 'POST', body: { kind } });
export const inviteKeyFinish = (token: string, b: { kind: 'security-key' | 'passkey'; response: RegistrationResponseJSON }) =>
  staffApi<{ kind: string; keyCheckCode: string | null }>(invitePath(token, '/key/finish'), { method: 'POST', body: b });
export const invitePgpStart = (token: string, publicKey: string) => staffApi<PgpChallenge>(invitePath(token, '/pgp/start'), { method: 'POST', body: { publicKey } });
export const invitePgpFinish = (token: string, b: { challengeId: string; code: string }) =>
  staffApi<{ ok: true }>(invitePath(token, '/pgp/finish'), { method: 'POST', body: b });
export const inviteFinish = (token: string) => staffApi<{ keyCheckCode: string | null }>(invitePath(token, '/finish'), { method: 'POST', body: {} });

// ---------------------------------------------------------------------------------------------
// Feedback from traders (Plan 5 Task 4 and Task 21; perm feedback.read, the owner only)

export type FeedbackMood = 'great' | 'ok' | 'needs-work';
export interface MoodItem {
  id: string;
  mood: FeedbackMood;
  note: string | null;
  createdOn: string;
}
export interface FormItem {
  id: string;
  kind: 'complaint' | 'feedback' | 'recommendation';
  text: string;
  /**
   * D-058: the sender's public Trade Tag (never the login name); null for an anonymous row. The
   * API sends no raw account id (review m1, lead 12 Nov).
   */
  accountName: string | null;
  from: string | null;
  createdOn: string;
}
const page = (path: string, before?: string) => (before === undefined ? path : `${path}?before=${encodeURIComponent(before)}`);

export const moodFeedback = (before?: string) =>
  staffApi<{ items: MoodItem[]; counts: { great: number; ok: number; needsWork: number }; next: string | null }>(page('/staff/v1/feedback', before));
export const formFeedback = (before?: string) => staffApi<{ items: FormItem[]; next: string | null }>(page('/staff/v1/feedback/form', before));

// ---------------------------------------------------------------------------------------------
// Support tickets (Plan 4 Tasks 30-31 on the staff API; perm tickets.handle: the owner, and anyone
// the owner granted it). The queue carries no text and no trader; a case opens only to its taker.

export interface TicketQueueItem {
  id: string;
  category: TicketCategory;
  status: 'open' | 'answered';
  createdAt: string;
  updatedAt: string;
  /** Whose turn it is. */
  waiting: 'staff' | 'trader';
  /** Who holds it: the reader, someone else, or nobody. */
  taken: 'me' | 'other' | null;
}

export interface TicketCase {
  id: string;
  category: TicketCategory;
  status: TicketStatus;
  tradeCode: string | null;
  createdAt: string;
  updatedAt: string;
  messages: Array<{ from: 'trader' | 'staff'; body: string; at: string; mine: boolean }>;
}

const ticketUrl = (id: string, tail = '') => `/staff/v1/tickets/${encodeURIComponent(id)}${tail}`;
export const ticketQueue = (category?: TicketCategory) =>
  staffApi<{ items: TicketQueueItem[] }>(category === undefined ? '/staff/v1/tickets' : `/staff/v1/tickets?category=${encodeURIComponent(category)}`);
export const ticketCase = (id: string) => staffApi<TicketCase>(ticketUrl(id));
export const takeTicket = (id: string) => staffApi<TicketCase>(ticketUrl(id, '/take'), { method: 'POST', body: {} });
export const replyToTicket = (id: string, body: string) => staffApi<TicketCase>(ticketUrl(id, '/messages'), { method: 'POST', body: { body } });
export const closeStaffTicket = (id: string) => staffApi<TicketCase>(ticketUrl(id, '/close'), { method: 'POST', body: {} });
export const releaseTicket = (id: string) => staffApi<{ released: true }>(ticketUrl(id, '/release'), { method: 'POST', body: {} });

// ---------------------------------------------------------------------------------------------
// "My account has been compromised" reports (owner D-059; J-14 ported; perm accounts.freeze: senior
// moderators and the owner). API: apps/api/src/tickets/compromisedRoutes.ts. The list carries no
// comment; opening a report is written to the activity log before its comment is read.

export type LockSkip = 'recent-unlock' | 'legacy-login-name' | 'lock-cap';

export interface CompromisedItem {
  id: string;
  /** The number the sender was shown (CT-<number>). */
  number: number;
  status: 'open' | 'closed';
  methodsLeft: CompromisedMethod[];
  /** Why a report on a lockable account locked nothing (review of feat/lockout items 1, 3, 4); null when it locked or matched none. */
  lockSkipped: LockSkip | null;
  createdAt: string;
  closedAt: string | null;
  /** Whether the typed name matched a lockable account. */
  matched: boolean;
  /** The matched account's public name; null for no match or a team member's login. */
  tradeTag: string | null;
  locked: boolean;
}

export interface CompromisedCase {
  id: string;
  number: number;
  status: 'open' | 'closed';
  methodsLeft: CompromisedMethod[];
  /** Why a report on a lockable account locked nothing (review of feat/lockout items 1, 3, 4); null when it locked or matched none. */
  lockSkipped: LockSkip | null;
  createdAt: string;
  closedAt: string | null;
  comment: string | null;
  account: {
    id: string;
    tradeTag: string | null;
    kind: string;
    team: string | null;
    createdAt: string;
    lockedAt: string | null;
    openTrades: Array<{ code: string; state: string; side: 'seller' | 'buyer'; paused: boolean }>;
  } | null;
}

const reportUrl = (id: string, tail = '') => `/staff/v1/compromised/${encodeURIComponent(id)}${tail}`;
export const compromisedReports = (status: 'open' | 'closed' = 'open') => staffApi<{ items: CompromisedItem[] }>(`/staff/v1/compromised?status=${status}`);
export const compromisedReport = (id: string) => staffApi<CompromisedCase>(reportUrl(id));
export const unlockAccount = (id: string, tapId: string) => staffApi<{ status: 'unlocked' }>(reportUrl(id, '/unlock'), { method: 'POST', body: { tapId } });
export const closeCompromised = (id: string) => staffApi<Omit<CompromisedCase, 'comment' | 'account'>>(reportUrl(id, '/close'), { method: 'POST', body: {} });

// ---------------------------------------------------------------------------------------------
// Review disputes (Plan 5 Task 19 on the staff API; perm reputation.review: moderators and up)

export type ReviewDisputeOutcome = 'stands' | 'comments-removed' | 'removed';

/** An open review dispute: the review and the subject's reason, never either trader's name. */
export interface ReviewDisputeItem {
  id: string;
  openedAt: string;
  reason: string;
  review: {
    neutral: boolean;
    stars: number | null;
    phrases: string[];
    tradeBadges: string[];
    note: string | null;
    method: string;
    age: string;
    reviewerRole: 'buyer' | 'seller';
  };
  /** While the trade still exists; null once it was deleted (30 days after it ended). */
  tradeCode: string | null;
}

export const reviewDisputes = (after?: string) =>
  staffApi<{ items: ReviewDisputeItem[]; next: string | null }>(after === undefined ? '/staff/v1/review-disputes' : `/staff/v1/review-disputes?after=${encodeURIComponent(after)}`);

export const decideReviewDispute = (
  id: string,
  body: { outcome: ReviewDisputeOutcome; reason: string; remove?: { note: boolean; phrases: string[]; tradeBadges: string[] } },
) => staffApi<{ ok: true }>(`/staff/v1/review-disputes/${encodeURIComponent(id)}/decide`, { method: 'POST', body });

// ---------------------------------------------------------------------------------------------
// Past reputation (Plan 5 Task 11; perm reputation.review: the owner, senior moderators and
// moderators; revoking reputation.revoke and the dollar figure reputation.verify: senior moderators
// and the owner)

export interface PastRepClaim {
  id: string;
  site: string;
  /** The archived old profile (an https archive link, checked by the API; never fetched by X2F). */
  url: string;
  claimedTrades: number;
  verifiedTrades: number | null;
  verifiedUsdCents: number | null;
  status: 'signed' | 'approved';
  /** Upper case, in groups of 4. */
  fingerprint: string;
  keyId: string;
  signatureValid: true;
  tradeTag: string;
  createdAt: string;
  /** Review M2: the host of the page the archive copied, from the link itself; null when it does not say. */
  originalHost: string | null;
}

/** One page of claims (review M1): `next` is the cursor of the following page, null after the last. */
export interface PastRepPage {
  items: PastRepClaim[];
  next: string | null;
}

export const pastRepList = (status: 'signed' | 'approved', o: { cursor?: string; name?: string } = {}) => {
  const q = [`status=${status}`];
  if (o.cursor !== undefined) q.push(`cursor=${encodeURIComponent(o.cursor)}`);
  if (o.name !== undefined && o.name.trim() !== '') q.push(`name=${encodeURIComponent(o.name.trim())}`);
  return staffApi<PastRepPage>(`/staff/v1/past-rep?${q.join('&')}`);
};
export const pastRepApprove = (id: string, tradesSeen: number) =>
  staffApi<{ id: string; status: 'approved'; verifiedTrades: number }>(`/staff/v1/past-rep/${encodeURIComponent(id)}/approve`, { method: 'POST', body: { fingerprintSeen: true, profileSeen: true, tradesSeen } });
export const pastRepReject = (id: string, reason: string) =>
  staffApi<{ id: string; status: 'rejected' }>(`/staff/v1/past-rep/${encodeURIComponent(id)}/reject`, { method: 'POST', body: { reason } });
export const pastRepRevoke = (id: string, reason: string) =>
  staffApi<{ id: string; status: 'revoked' }>(`/staff/v1/past-rep/${encodeURIComponent(id)}/revoke`, { method: 'POST', body: { reason } });
export const pastRepSetUsd = (id: string, usdCents: number | null) =>
  staffApi<{ ok: true }>(`/staff/v1/past-rep/${encodeURIComponent(id)}/verified-usd`, { method: 'PUT', body: { usdCents } });

// ---------------------------------------------------------------------------------------------
// News for traders (Plan 4 Task 28 on the staff API; perm site.control, the owner only)


export const newsList = () => staffApi<{ items: NewsItem[] }>('/staff/v1/news');
/** Review p4t22 m2: publishing or editing News is tapped (`news-publish`). */
export const newsAdd = (d: { title: string; body: string }, tapId: string) => staffApi<NewsItem>('/staff/v1/news', { method: 'POST', body: { ...d, tapId } });
export const newsEdit = (id: number, d: { title: string; body: string }, tapId: string) => staffApi<NewsItem>(`/staff/v1/news/${id}`, { method: 'PUT', body: { ...d, tapId } });
export const newsDelete = (id: number) => staffApi<unknown>(`/staff/v1/news/${id}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------------------------
// Price health (owner Q13, J-21; perm stats.read, the owner only): apps/api/src/price/routes.ts
// `priceHealthBody`, served at GET /staff/v1/price-health.

export interface PriceHealth {
  xmr: { name: string; lastGoodAt: string | null; consecutiveFailures: number; inUse: boolean }[];
  fx: { name: string; rank: number; lastGoodAt: string | null; consecutiveFailures: number; stale: boolean; inUse: boolean; usedFor: string[] }[];
  rejected: { source: string; currency: string; at: string }[];
  paused: string[];
  settings: { staleAfterMinutes: number; sanityPercent: number };
}
export const priceHealth = () => staffApi<PriceHealth>('/staff/v1/price-health');

// ---------------------------------------------------------------------------------------------
// Moderator performance (Plan 4 Task 20; perm perf.read, the owner only, spec 6.6), from
// apps/api/src/staff/performance.ts. Staff names, roles and numbers only: no trader data.

export type PerformancePeriod = '30d' | '90d' | 'all';

export interface PerformanceFigures {
  cases: number;
  firstReplyMin: number | null;
  rulingMin: number | null;
  overturned: number;
  withinDeadlinePct: number | null;
  open: number;
  payableCases: number;
  settledWithinGoalPct: number | null;
  settledWithinDeadlinePct: number | null;
  appeals: number;
  appealsWithinGoalPct: number | null;
}

export interface PerformancePerson extends PerformanceFigures {
  id: string;
  name: string;
  role: StaffRole;
}

export interface Performance {
  period: PerformancePeriod;
  firstResponseH: number;
  people: PerformancePerson[];
}

export interface PerformanceWeeks {
  id: string;
  name: string;
  role: StaffRole;
  firstResponseH: number;
  from: string;
  summary: PerformanceFigures;
  weeks: { weekOf: string; start: string; cases: number; firstReplyMin: number | null }[];
}

export const getPerformance = (period: PerformancePeriod) => staffApi<Performance>(`/staff/v1/performance?period=${period}`);
export const getPerformanceWeeks = (id: string) => staffApi<PerformanceWeeks>(`/staff/v1/performance/${encodeURIComponent(id)}/weeks`);

// ---------------------------------------------------------------------------------------------
// Staff members (Plan 4 Task 7; perm staff.manage, the owner only) and their per-person
// checkboxes (owner Q60, J-21: PUT …/grants with a `set-grants` tap bound to the exact sorted list).

export interface Member {
  accountId: string | null;
  inviteId: string | null;
  tradeTag: string | null;
  role: StaffRole;
  status: 'active' | 'switched-off' | 'waiting';
  grants: GrantablePerm[];
  hours: LoginHours;
  joinedAt: string | null;
  lastActiveAt: string | null;
  openCases: number;
  /** An invite's expiry (null for a member). */
  expiresAt: string | null;
  /** The login methods a moderator or senior moderator still lacks (owner G3, as D-070 changed it). */
  missingMethods: Array<'security-key' | 'pgp' | 'passkey'>;
}
const memberPath = (accountId: string, rest = '') => `/staff/v1/members/${encodeURIComponent(accountId)}${rest}`;
export const members = () => staffApi<{ members: Member[] }>('/staff/v1/members');
export const setGrants = (accountId: string, grants: GrantablePerm[], tapId: string) =>
  staffApi<{ grants: GrantablePerm[] }>(memberPath(accountId, '/grants'), { method: 'PUT', body: { grants, tapId } });
/** Plan 4 Task 7: at once, no tap (it only removes power); the API ends their sessions. */
export const switchOff = (accountId: string) => staffApi<{ status: 'switched-off' }>(memberPath(accountId, '/switch-off'), { method: 'POST', body: {} });
/** A `switch-on` tap bound to the person and their current role. */
export const switchOn = (accountId: string, tapId: string) => staffApi<{ status: 'active' }>(memberPath(accountId, '/switch-on'), { method: 'POST', body: { tapId } });
export const setHours = (accountId: string, hours: LoginHours) => staffApi<{ hours: LoginHours }>(memberPath(accountId, '/hours'), { method: 'PUT', body: { hours } });
/** A `set-role` tap bound to the person and the new role. */
export const setRole = (accountId: string, role: InviteRole, tapId: string) => staffApi<{ role: InviteRole }>(memberPath(accountId, '/role'), { method: 'PUT', body: { role, tapId } });
/** A `remove-staff` tap bound to the person (owner G4). */
export const removeMember = (accountId: string, tapId: string) => staffApi<unknown>(memberPath(accountId, ''), { method: 'DELETE', body: { tapId } });
/**
 * A new invite (Task 7): this browser makes the invite id, the token (32 random bytes, base64url)
 * and the expiry, because the owner's `create-invite` tap is bound to the token's hash before the
 * invite exists. The link is shown once; the token is never stored by the API.
 */
export const createInvite = (b: { role: InviteRole; hours: LoginHours; inviteId: string; token: string; expiresAt: string; tapId: string }) =>
  staffApi<{ inviteId: string; link: string; expiresAt: string }>('/staff/v1/invites', { method: 'POST', body: b });
/**
 * D-032 (owner G60): the owner resets a staff member's security. As for an invite, this browser
 * makes the link's id, token and expiry, bound by the owner's `reset-staff-security` tap; the link
 * is shown once.
 */
export const resetSecurity = (accountId: string, b: { inviteId: string; token: string; expiresAt: string; tapId: string }) =>
  staffApi<{ inviteId: string; link: string; expiresAt: string }>(memberPath(accountId, '/reset-security'), { method: 'POST', body: b });
export const cancelInvite = (inviteId: string) => staffApi<unknown>(`/staff/v1/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' });

// ---------------------------------------------------------------------------------------------
// Settings (Plan 4 Task 8; perm settings.write) and pay settings (Task 33; tap `pay-settings`)

export interface RulingSettings {
  largeTradeLimitUsd: number;
  firstResponseH: number;
  appealWindowH: number;
}
export const settings = () => staffApi<RulingSettings & Record<string, unknown>>('/staff/v1/settings');
/** `tapId` is required when the limit or the appeal window changes (a `settings` tap of the values after it). */
export const putSettings = (change: Partial<RulingSettings>, tapId?: string) =>
  staffApi<RulingSettings>('/staff/v1/settings', { method: 'PUT', body: tapId === undefined ? change : { ...change, tapId } });

export interface PaySettings {
  modDisputeUsdCents: number | null;
  seniorDisputeUsdCents: number | null;
  seniorLargeTradeBp: number | null;
  largeTradeThresholdUsd: number | null;
  /** Owner 26 Nov 2026: each role's default share of X2F's 1% fee per dispute, basis points of the fee. */
  modFeeBp: number | null;
  seniorFeeBp: number | null;
  /** Owner 26 Nov 2026: a flat amount per dispute on top of the share, US cents. */
  modFlatUsdCents: number | null;
  seniorFlatUsdCents: number | null;
}
export const paySettings = () => staffApi<PaySettings>('/staff/v1/pay/settings');
export const putPaySettings = (next: PaySettings, tapId: string) => staffApi<PaySettings>('/staff/v1/pay/settings', { method: 'PUT', body: { ...next, tapId } });

/** The links of `GET /staff/v1/settings` (Task 8 Revision 2026-10-29, Task 29; null = not set). */
export interface LinkSettings {
  moderatorContactUrl: string | null;
  communityMatrixUrl: string | null;
  communityTelegramUrl: string | null;
}
/** The links need no tap (apps/api/src/staff/settings.ts TAPPED). */
export const putLinks = (change: Partial<LinkSettings>) => staffApi<RulingSettings & LinkSettings>('/staff/v1/settings', { method: 'PUT', body: change });

/** Spec 6.6 "Settings" / 2.3: the starter limits (`apps/api/src/staff/starterLimits.ts`; tap `starter-limits`). */
export type StarterLimitsView = StarterSettings & { updatedAt: string | null };
export const starterLimits = () => staffApi<StarterLimitsView>('/staff/v1/starter-limits');
export const putStarterLimits = (next: StarterSettings, tapId: string) => staffApi<StarterLimitsView>('/staff/v1/starter-limits', { method: 'PUT', body: { ...next, tapId } });

/** B-006 / Task 9: the fee wallet's sweep (`apps/api/src/staff/feeSweep.ts` FeeSweepView; tap `fee-sweep`). */
export interface FeeSweepView {
  thresholdAtomic: string | null;
  floatAtomic: string | null;
  coldAddress: string | null;
  on: boolean;
  walletWired: boolean;
  lastSweep: { at: string; amountAtomic: string; keepAtomic: string; outcome: 'pending' | 'sent' | 'failed'; txHash: string | null } | null;
}
export interface FeeSweepChange {
  thresholdAtomic: string | null;
  floatAtomic: string | null;
  coldAddress: string | null;
}
export const feeSweep = () => staffApi<FeeSweepView>('/staff/v1/fee-sweep');
export const putFeeSweep = (next: FeeSweepChange, tapId: string) => staffApi<FeeSweepView>('/staff/v1/fee-sweep', { method: 'PUT', body: { ...next, tapId } });

/** Task 33: each member's unpaid net (`GET /staff/v1/pay/staff`, earnings.read: the owner). */
export interface StaffPayRow {
  staffId: string;
  tradeTag: string;
  role: StaffRole;
  switchedOff: boolean;
  unpaidUsdCents: string;
  unpaidAtomic: string;
  owed: boolean;
  /** The person's own share of the fee (basis points of the fee); null = their role's default. */
  feeBp: number | null;
  /** The share that applies to them now (their own, else their role's); null = none set. */
  effectiveFeeBp: number | null;
}
export const staffPay = () => staffApi<{ members: StaffPayRow[] }>('/staff/v1/pay/staff');
/** Owner 26 Nov 2026: every trade not deleted yet, by status (`GET /staff/v1/trades/status`, the owner). */
export type TradeAuditStatus = 'lien' | 'uncollectible' | 'disputed' | 'open' | 'completed' | 'closed';
export interface TradeAuditRow {
  code: string;
  state: string;
  status: TradeAuditStatus;
  takenAt: string;
  closedAt: string | null;
  amountAtomic: string;
  deleteAt: string | null;
  liens: Array<{ id: string; status: string; amountAtomic: string; recoveredAtomic: string; endedAt: string | null }>;
}
export interface TradeStatusPage {
  counts: Record<TradeAuditStatus, number>;
  trades: TradeAuditRow[];
  next: string | null;
}
export const tradeStatus = (status: TradeAuditStatus | null, before: string | null) => {
  const q = new URLSearchParams();
  if (status !== null) q.set('status', status);
  if (before !== null) q.set('before', before);
  const s = q.toString();
  return staffApi<TradeStatusPage>(`/staff/v1/trades/status${s ? `?${s}` : ''}`);
};
/** Owner 26 Nov 2026: write a lien off as uncollectible (tap `lien-uncollectible` bound to the lien). */
export const writeOffLien = (lienId: string, tapId: string) =>
  staffApi<{ status: 'uncollectible' }>(`/staff/v1/liens/${encodeURIComponent(lienId)}/uncollectible`, { method: 'POST', body: { tapId } });

/** Owner 26 Nov 2026: one staff member's work and hours (`GET /staff/v1/pay/staff/:id/audit`, the owner). */
export interface StaffAuditItem {
  kind: string;
  code: string | null;
  seq: number | null;
  round: number;
  usdCents: string | null;
  atomic: string | null;
  earnedAt: string;
  status: 'unpaid' | 'waiting-send' | 'paid' | 'failed';
  paidAt: string | null;
}
export interface StaffAudit {
  staffId: string;
  tradeTag: string;
  role: StaffRole;
  switchedOff: boolean;
  feeBp: number | null;
  days: number;
  totals: {
    minutes: number; shifts: number; clockOuts: number; disputes: number; appeals: number;
    earnedUsdCents: string; earnedAtomic: string; clawedBackUsdCents: string; clawedBackAtomic: string;
  };
  shifts: Array<{ clockedInAt: string; endedAt: string | null; ended: string | null; minutes: number }>;
  items: StaffAuditItem[];
  payouts: Array<{ at: string; amountAtomic: string; status: string }>;
}
export const staffAudit = (staffId: string, days: number) =>
  staffApi<StaffAudit>(`/staff/v1/pay/staff/${encodeURIComponent(staffId)}/audit?days=${days}`);
/** Owner 26 Nov 2026: one person's share of the fee (tap `staff-pay` bound to the person and value). */
export const putStaffPay = (staffId: string, feeBp: number | null, tapId: string) =>
  staffApi<{ feeBp: number | null }>(`/staff/v1/pay/staff/${encodeURIComponent(staffId)}`, { method: 'PUT', body: { feeBp, tapId } });

// ---------------------------------------------------------------------------------------------
// One's own security (apps/api/src/staff/account.ts; perm self, every role, one's own account)

export type MethodType = 'pgp' | 'security-key' | 'passkey' | 'totp' | 'recovery-codes';
export interface MethodEntry {
  type: MethodType;
  id: string;
  label: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}
export interface MySession {
  id: string;
  deviceLabel: string;
  /** Which site the session is on (`sessions.app`). */
  site: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}
export interface MyAlert {
  id: string;
  kind: string;
  detail: unknown;
  createdAt: string;
  seenAt: string | null;
}
export const myMethods = () => staffApi<MethodEntry[]>('/staff/v1/account/methods');
/** The owner sends `secondTapId` too: a tap for the same intent by his other key (owner G4). */
export type Taps = { tapId: string; secondTapId?: string };
export const addPgpStart = (publicKey: string) => staffApi<PgpChallenge & { fingerprint: string }>('/staff/v1/account/pgp/start', { method: 'POST', body: { publicKey } });
export const addPgpFinish = (b: { challengeId: string; code: string } & Taps) => staffApi<{ fingerprint: string }>('/staff/v1/account/pgp/finish', { method: 'POST', body: b });
export const removeMethod = (type: 'pgp' | 'security-key' | 'passkey', id: string, taps: Taps) =>
  staffApi<unknown>(`/staff/v1/account/methods/${type}/${encodeURIComponent(id)}`, { method: 'DELETE', body: taps });
export const mySessions = () => staffApi<MySession[]>('/staff/v1/account/sessions');
export const endMySession = (id: string) => staffApi<unknown>(`/staff/v1/account/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const myAlerts = () => staffApi<MyAlert[]>('/staff/v1/account/alerts');
export const markMyAlertSeen = (id: string) => staffApi<unknown>(`/staff/v1/account/alerts/${encodeURIComponent(id)}/seen`, { method: 'POST', body: {} });

// ---------------------------------------------------------------------------------------------
// Site controls (Plan 4 Task 8; perm site.control) and the owner's revenue (Task 32; earnings.read)

export type MaintenanceKind = 'planned' | 'unplanned';
export interface StaffSite {
  tradingPaused: boolean;
  stoppedAt: string | null;
  banner: { text: string; kind: 'info' | 'warning' } | null;
  maintenance: { since: string; message: string | null; kind: MaintenanceKind; backBy: string | null } | null;
  planned: { startsAt: string; endsAt: string; message: string | null } | null;
  /** When the moderation process's daily activity-log check first failed (Task 14), or null. */
  logAlarm: string | null;
}
export const site = () => staffApi<StaffSite>('/staff/v1/site');
export const stopTrading = (tapId: string) => staffApi<StaffSite>('/staff/v1/site/stop', { method: 'POST', body: { tapId } });
export const resumeTrading = (tapId: string) => staffApi<StaffSite>('/staff/v1/site/resume', { method: 'POST', body: { tapId } });
/** Review p4t22 m2: showing the banner is tapped (`banner-publish`). */
export const setBanner = (text: string, kind: 'info' | 'warning', tapId: string) => staffApi<StaffSite>('/staff/v1/site/banner', { method: 'PUT', body: { text, kind, tapId } });
export const removeBanner = () => staffApi<unknown>('/staff/v1/site/banner', { method: 'DELETE' });
/** Review p4t22 m2: switching maintenance on is tapped (`maintenance-on`); off is not. */
export const setMaintenance = (b: { on: true; kind: MaintenanceKind; message: string | null; tapId: string } | { on: false }) =>
  staffApi<StaffSite>('/staff/v1/site/maintenance', { method: 'PUT', body: b });
/** Review p4t22 N2: announcing a planned maintenance is tapped (`maintenance-planned`); removing it is not. */
export const announcePlannedMaintenance = (b: { startsAt: string; endsAt: string; message: string | null; tapId: string }) =>
  staffApi<StaffSite>('/staff/v1/site/maintenance/planned', { method: 'PUT', body: b });
export const removePlannedMaintenance = () => staffApi<unknown>('/staff/v1/site/maintenance/planned', { method: 'DELETE' });

/**
 * Mirrors apps/api `RevenueBucket` / `RevenueReport`. Owner 16 Nov: every bucket has the network
 * fees X2F's fee outputs paid and the total after them. Amounts are atomic units (decimal strings).
 */
export interface RevenueBucket {
  period: string;
  trades: number;
  feeAtomic: string;
  owedCollectedAtomic: string;
  owedCollections: number;
  totalAtomic: string;
  usdEstimateCents: string;
  networkFeeAtomic: string;
  netAtomic: string;
}
export interface RevenueReport {
  by: 'day' | 'month';
  from: string;
  to: string;
  buckets: RevenueBucket[];
  total: RevenueBucket;
  byCurrency: RevenueBucket[];
  /** Every day ever booked, whatever the range (`period` is `to-date`). */
  toDate: RevenueBucket;
  treasuryNetworkFeesRecorded: boolean;
  owedOutstandingAtomic: string | null;
}
/** Without a range, by month over the API's default range (the twelve months to today). */
export const revenue = (q?: { by: 'day' | 'month'; from: string; to: string }) =>
  staffApi<RevenueReport>(q === undefined ? '/staff/v1/revenue?by=month' : `/staff/v1/revenue?by=${q.by}&from=${q.from}&to=${q.to}`);

/**
 * Mirrors apps/api `EarningsReport` (Plan 4 Task 9, `GET /staff/v1/earnings`, earnings.read): what
 * arrived in X2F's fee wallet (read through its view-only key) and payroll wallet by UTC month,
 * beside the books. Amounts are atomic units (decimal strings); a wallet is null when this server
 * has none set up.
 */
export type EarningsWalletState = 'syncing' | 'ready' | 'stale' | 'unavailable';
export interface EarningsWallet {
  walletEnd: string;
  state: EarningsWalletState;
  syncedAt: string | null;
}
export interface EarningsMonth {
  month: string;
  feeWalletAtomic: string;
  sweptInAtomic: string;
  payrollWalletAtomic: string;
  earnedAtomic: string;
  usdEstimateCents: string | null;
  trades: number;
  bookedNetAtomic: string;
}
export interface EarningsReport {
  feeWallet: EarningsWallet | null;
  payrollWallet: EarningsWallet | null;
  usdCentsPerXmr: string | null;
  months: EarningsMonth[];
  allTime: EarningsMonth;
}
export const earnings = () => staffApi<EarningsReport>('/staff/v1/earnings');

// ---------------------------------------------------------------------------------------------
// Disputes (Plan 4 Tasks 11 and 12 on the staff API; perm disputes.handle, approvals rulings.approve)

export type DisputeStatus = 'open' | 'awaiting-approval' | 'published' | 'appealed' | 'final' | 'complying' | 'closed';
export interface QueueRow {
  code: string;
  incidentId: string;
  status: DisputeStatus;
  round: 1 | 2;
  /** The trade's XMR, atomic units. */
  xmr: string;
  /** Dollars, "412.50". */
  usd: string;
  method: string;
  /** The catalog's display name (data/payment-methods.json, sent by the staff API), never shown as the raw id. */
  methodName: string;
  openedBy: 'buyer' | 'seller' | 'system';
  waitingMs: number;
  replyDueAt: string;
  rulingDueAt: string;
  deadlineTone: 'due' | 'overdue' | 'replied';
  approval: 'not-needed' | 'needs-second' | { waitingFor: 'second-approval'; proposedBy: string | null };
  assignee: string | null;
  mine: boolean;
  /**
   * Plan 4 Task 12 (A6): the seller did not prove the payment a `seller-sends-xmr` ruling ordered in
   * time; listed for senior moderators and the owner, who decide the suspension. Absent from an older API.
   */
  complyLapsed?: boolean;
}
export interface Queue {
  rows: QueueRow[];
  counts: { open: number; overdue: number; unassigned: number; needApproval: number };
  settings: { firstResponseH: number; largeTradeLimitUsd: number };
}

export interface CaseTrader {
  tradeTag: string;
  completedTrades: number;
  positivePct: number | null;
}
export interface CaseRuling {
  proposal: { rulingId: string; reason: string; evidence: string[]; proposer: string; proposedAt: string } | null;
  sentBack: { rulingId: string; note: string | null; at: string } | null;
  draft: { id: string; outcome: import('@x2f/staff').RulingOutcome } | null;
  /** Round 1's ruling once there is an appeal (the API's `round1`): a round-2 tap names its id. */
  round1?: { id: string; outcome: import('@x2f/staff').RulingOutcome } | null;
  publishedAt: string | null;
  appealEndsAt: string | null;
  /**
   * Plan 4 Task 12 (A6): the seller's payment proof for a `seller-sends-xmr` ruling. `failedChecks`
   * (RC-4, lead default): proofs X2F's checker could not take (503), newest first. Absent from an older API.
   */
  compliance?: {
    lapsedAt: string | null;
    proof: { txHash: string; status: 'pending' | 'accepted' | 'refused'; confirmations: number | null; submittedAt: string } | null;
    failedChecks?: Array<{ at: string; reason: 'node-unavailable' | 'busy' }>;
  };
  /**
   * Ruling-winner reasons (lead 22 Nov): why the moderation process's payout of this ruling waits on
   * its winner, since when, while the trade is disputed; null when it does not. Absent from an older API.
   */
  payoutWait?: { reason: 'winner-committed' | 'winner-offline'; since: string } | null;
  /**
   * Review p4t22 M1 (d, e): the moderation ruling gate's latest refusal of a ruling of this dispute
   * (`reason`: its refusal code), since when; null when it does not refuse one. `secondApproval`: for
   * `needs-second` on round 1 before its payout ran, the published ruling a second approval taps
   * (the rescue). Absent from an older API.
   */
  gateRefusal?: {
    rulingId: string;
    reason: string;
    since: string;
    secondApproval: { rulingId: string; outcome: import('@x2f/staff').RulingOutcome; reason: string; evidence: string[]; proposedByYou: boolean } | null;
    /** Review p4t22 N1: set when a senior or the owner may propose a new round 1 in place of a ruling refused `revoked`. Absent from an older API. */
    rePropose?: { rulingId: string } | null;
  } | null;
}
export interface DisputeCase {
  code: string;
  incidentId: string;
  status: DisputeStatus;
  round: 1 | 2;
  openedBy: 'buyer' | 'seller' | 'system';
  reason: string;
  note: string;
  afterRefund: boolean;
  openedAt: string;
  replyDueAt: string;
  rulingDueAt: string;
  firstReplyAt: string | null;
  usd: string;
  overLimit: boolean;
  /**
   * Review p4t22 M1: why a second person is needed: `non-usd` (not priced in US dollars: lead default,
   * owner question OQ1) or `over-limit`; null when one person rules. Absent from an older API.
   */
  secondReason?: 'non-usd' | 'over-limit' | null;
  /** The large-trade limit the dispute snapshotted when it opened, whole dollars. */
  limitUsd: number;
  assignee: string | null;
  assignedToYou: boolean;
  proposedByYou: boolean;
  mayWork: boolean;
  traders: { buyer: CaseTrader | null; seller: CaseTrader | null };
  escrow: { state: string; amountAtomic: string; methodId: string; methodName: string; currency: string; centsPerXmr: string; fiatCents: string; confirmations: number };
  ruling: CaseRuling;
  freezes: { buyer: boolean; seller: boolean };
}
export type Side = 'buyer' | 'seller';

const casePath = (code: string, rest = '') => `/staff/v1/disputes/${encodeURIComponent(code)}${rest}`;

export const disputeQueue = () => staffApi<Queue>('/staff/v1/disputes?filter=all');
export const takeNext = () => staffApi<{ code: string | null }>('/staff/v1/disputes/next', { method: 'POST', body: {} });
export const takeCase = (code: string) => staffApi<{ code: string }>(casePath(code, '/take'), { method: 'POST', body: {} });
export const disputeCase = (code: string) => staffApi<DisputeCase>(casePath(code));
/**
 * Design build task 9: a moderator message, sealed under the chat key and countersigned by this
 * device in the chat key worker (keys/reader.ts `sealModMessage`); the API never sees its text.
 */
export const messageTraders = (code: string, sealed: import('./chat/types.js').SealedModMessage) => staffApi<{ id: string }>(casePath(code, '/messages'), { method: 'POST', body: sealed });
/** Design build task 9: the moderator's read: the chat key re-wrapped to this device, and the chat's ciphertext. Logged (`chat.read`). */
export const readCaseChat = (code: string, deviceKeyId: string) =>
  staffApi<import('./chat/types.js').CaseChatAnswer>(casePath(code, '/chat'), { method: 'POST', body: { deviceKeyId } });
export const requestProof = (code: string, side: Side) => staffApi<unknown>(casePath(code, '/proof-request'), { method: 'POST', body: { side } });
// Plan 4 Task 26: recommended account limits. A cap in whole US dollars or a stage, exactly one.
export type LimitWhat = { capUsd: number } | { stage: import('@x2f/staff').LimitStage };
export interface LimitRecommendation {
  id: string;
  accountId: string;
  tradeTag: string;
  capUsd: number | null;
  stage: import('@x2f/staff').LimitStage | null;
  /** Staff only: the trader never sees it. */
  reason: string;
  /** The case it came from, or null. */
  code: string | null;
  recommendedBy: string;
  /** The signed-in member recommended it, so may not decide it. */
  mine: boolean;
  createdAt: string;
  currentStage: 'starter' | 'building' | 'graduated';
  currentCapUsdCents: string | null;
}
export const recommendLimits = (code: string, b: { side: Side; reason: string } & LimitWhat) =>
  staffApi<{ id: string }>(casePath(code, '/limit-recommendations'), { method: 'POST', body: b });
export const limitRecommendations = () => staffApi<{ recommendations: LimitRecommendation[] }>('/staff/v1/limit-recommendations');
export const decideLimits = (accountId: string, recId: string, b: { approve: boolean; tapId: string }) =>
  staffApi<{ status: 'approved' | 'declined' }>(
    `/staff/v1/accounts/${encodeURIComponent(accountId)}/limit-recommendations/${encodeURIComponent(recId)}/decide`,
    { method: 'POST', body: b },
  );
// ---------------------------------------------------------------------------------------------
// Account actions (spec 6.6, Plan 4 Task 27; apps/api staff/accountLookup.ts, bans.ts):
// senior moderators and the owner (`accounts.ban`, `accounts.freeze`; the API checks every call).

export type BanKind = 'trade' | 'site';
export interface AccountStatus {
  bans: Array<{ id: string; kind: BanKind; reasonCode: import('@x2f/staff').BanReasonCode; until: string | null; permanent: boolean }>;
  frozen: boolean;
  lien: boolean;
}
export interface LookedUpAccount {
  accountId: string;
  tradeTag: string;
  matchedBy: 'name' | 'code';
  side: Side | null;
  completedTrades: number;
  positivePct: number | null;
  disputes: { won: number; lost: number };
  stage: string;
  status: AccountStatus;
}
export interface StaffBan {
  id: string;
  kind: BanKind;
  ruleId: string;
  reasonCode: import('@x2f/staff').BanReasonCode;
  until: string | null;
  permanent: boolean;
  note: string | null;
  createdAt: string;
  endedAt: string | null;
  liftedAt: string | null;
  active: boolean;
}
export interface AccountBans {
  priorOffences: number;
  bans: StaffBan[];
  rules: readonly import('@x2f/staff').BanRule[];
}

const accountPath = (id: string, rest: string) => `/staff/v1/accounts/${encodeURIComponent(id)}${rest}`;
/** A trader by public Trade Tag or trade code (exact matches only; each lookup is logged). */
export const lookupAccounts = (q: string) => staffApi<{ accounts: LookedUpAccount[] }>(`/staff/v1/accounts/lookup?q=${encodeURIComponent(q)}`);
export const accountBans = (id: string) => staffApi<AccountBans>(accountPath(id, '/bans'));
export const placeBan = (id: string, b: { banId: string; kind: BanKind; ruleId: string; until: string | null; note?: string; tapId: string }) =>
  staffApi<StaffBan>(accountPath(id, '/bans'), { method: 'POST', body: b });
export const liftBan = (id: string, banId: string, tapId: string) =>
  staffApi<StaffBan>(accountPath(id, `/bans/${encodeURIComponent(banId)}/lift`), { method: 'POST', body: { tapId } });

export const setFreeze = (code: string, b: { side: Side; on: true; reason: 'no-reply' | 'ignored-ruling' } | { side: Side; on: false }) =>
  staffApi<{ freezes: { buyer: boolean; seller: boolean } }>(casePath(code, '/freeze'), { method: 'POST', body: b });
export const proposeRuling = (
  code: string,
  b: { rulingId: string; outcome: import('@x2f/staff').RulingOutcome; reason: string; evidence: string[]; tapId: string },
) => staffApi<{ code: string; ruling: CaseRuling }>(casePath(code, '/rulings'), { method: 'POST', body: { ...b, accountAction: { kind: 'none' } } });
export const approveRuling = (code: string, rulingId: string, tapId: string) =>
  staffApi<unknown>(casePath(code, `/rulings/${encodeURIComponent(rulingId)}/approve`), { method: 'POST', body: { tapId } });
/** Review p4t22 M1 (e): a second approval for a ruling published on one tap that the gate refuses `needs-second`. */
export const secondApproveRuling = (code: string, rulingId: string, tapId: string) =>
  staffApi<unknown>(casePath(code, `/rulings/${encodeURIComponent(rulingId)}/second-approval`), { method: 'POST', body: { tapId } });
/** Review p4t22 N1: a senior's new round-1 ruling in place of one the gate refuses `revoked` (their own propose tap). */
export const reProposeRuling = (
  code: string,
  replaces: string,
  b: { rulingId: string; outcome: import('@x2f/staff').RulingOutcome; reason: string; evidence: string[]; tapId: string },
) => staffApi<unknown>(casePath(code, `/rulings/${encodeURIComponent(replaces)}/re-propose`), { method: 'POST', body: { ...b, accountAction: { kind: 'none' } } });
export const sendBackRuling = (code: string, rulingId: string, note: string) =>
  staffApi<unknown>(casePath(code, `/rulings/${encodeURIComponent(rulingId)}/send-back`), { method: 'POST', body: { note } });

// Pay at clock-out (Plan 4 Task 33, D-041..D-045; perm self: one's own pay only)

export interface PayoutAddress {
  id: string;
  address: string;
  addedAt: string;
}
/** What is due at a correct clock-out: `pay`, `nothing-due`, `owed` (a clawback debt) or `no-price`. */
export type ClockOutDue = 'pay' | 'nothing-due' | 'owed' | 'no-price';
export interface ClockOutSheet {
  /** The signed quote the POST must carry: it pays exactly these figures (security review S2). */
  quote: string;
  expiresAt: string;
  due: ClockOutDue;
  disputes: number;
  largeTrades: number;
  clawbacks: number;
  /** Decimal strings: the dollar part in US cents, the XMR part in atomic units, the net in atomic units (null with no price). */
  usdCents: string;
  atomic: string;
  usdCentsPerXmr: string | null;
  amountAtomic: string | null;
  addresses: PayoutAddress[];
}
export interface ClockOutResult {
  due: ClockOutDue;
  payout: { id: string; amountAtomic: string; addressId: string; status: 'waiting-send' } | null;
}

export const clockOutSheet = () => staffApi<ClockOutSheet>('/staff/v1/pay/clock-out');
/**
 * The correct clock-out: pays exactly the sheet's `quote` to `addressId` and ends the session. 409
 * `quote-changed` or `quote-expired`: the pay moved since the sheet was shown; show it again.
 */
export const clockOut = (quote: string, addressId: string | null) =>
  staffApi<ClockOutResult>('/staff/v1/pay/clock-out', { method: 'POST', body: addressId === null ? { quote } : { quote, addressId } });
/** Adds a payout address; `tapId` is a tap of intent `payout-address` for exactly this address. */
export const addPayoutAddress = (address: string, tapId: string) =>
  staffApi<PayoutAddress>('/staff/v1/pay/addresses', { method: 'POST', body: { address, tapId } });
// The owner's notifications (O-040, owner Q35; perm self, the owner only)

export interface OwnerAlert {
  id: string;
  kind: string;
  /** The alert's own sentence, when it has one. */
  message: string | null;
  detail: Record<string, unknown>;
  createdAt: string;
  seenAt: string | null;
}
export const ownerAlerts = (before?: string) =>
  staffApi<{ items: OwnerAlert[]; unread: number; next: string | null }>(page('/staff/v1/owner/alerts', before));
export const markOwnerAlertRead = (id: string) => staffApi<unknown>(`/staff/v1/owner/alerts/${encodeURIComponent(id)}/read`, { method: 'POST', body: {} });
export const markAllOwnerAlertsRead = () => staffApi<unknown>('/staff/v1/owner/alerts/read-all', { method: 'POST', body: {} });

// ---------------------------------------------------------------------------------------------
// Chat membership design task 8: one's own staff device keys (perm self)

export interface CertifiedDevice {
  deviceKeyId: string;
  signPublic: string;
  boxPublic: string;
  certifiedAt: string;
  expiresAt: string;
}
export const myDevices = () => staffApi<{ accountId: string; devices: CertifiedDevice[] }>('/staff/v1/devices');
/** Certifies this browser's device key; `tapId` is a tap of intent `certify-device` for exactly these keys. */
export const certifyDevice = (signPublic: string, boxPublic: string, tapId: string) =>
  staffApi<{ deviceKeyId: string; expiresAt: string }>('/staff/v1/devices', { method: 'POST', body: { signPublic, boxPublic, tapId } });
export const revokeDevice = (deviceKeyId: string, tapId: string) =>
  staffApi<unknown>(`/staff/v1/devices/${encodeURIComponent(deviceKeyId)}/revoke`, { method: 'POST', body: { tapId } });

// The Activity log (Plan 4 Task 19; perm log.read.cases, the chain check log.read.all)

export type LogKind = 'trade' | 'dispute' | 'chat' | 'ruling' | 'account' | 'staff' | 'owner' | 'site' | 'other';

export interface LogEntry {
  id: string;
  at: string;
  tradeCode: string | null;
  actor: { kind: 'staff' | 'trader' | 'system'; role: string | null; id: string | null; name: string | null };
  action: string;
  /** Ids, enums, amounts and setting numbers only, as the API re-checked them. */
  detail: Record<string, unknown>;
  /** The stored detail did not fit its action, so the API showed none of it. */
  withheld?: true;
}
export interface LogPage {
  scope: 'all' | 'cases';
  entries: LogEntry[];
  names: Record<string, string>;
  next: string | null;
}
export interface LogQuery {
  code?: string;
  actor?: string;
  kind?: LogKind | '';
  from?: string;
  to?: string;
  before?: string;
}
export const logPage = (q: LogQuery) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) if (typeof v === 'string' && v !== '') p.set(k, v);
  const s = p.toString();
  return staffApi<LogPage>(`/staff/v1/log${s ? `?${s}` : ''}`);
};
export const logFilters = () =>
  staffApi<{ scope: 'all' | 'cases'; actors: Array<{ id: string; name: string; role: string | null }>; kinds: LogKind[] }>('/staff/v1/log/filters');
export interface ActiveDispute {
  code: string;
  method: string;
  methodName: string;
  xmr: string;
  status: string;
}
/** Review m7: newest opened first, 100 a page; `before` is the last code of the page before. */
export const activeDisputes = (before?: string) => staffApi<{ items: ActiveDispute[]; next: string | null }>(page('/staff/v1/log/active-disputes', before));
/** Review m7: what the owner's page reads on load. No chain check (nothing is re-hashed). */
export interface LogStatus {
  entries: number;
  headId: string | null;
  /** When the moderation process's own check of the log failed (`site_flags.log_alarm`), or null. */
  alarm: string | null;
}
export interface LogIntegrity {
  checkedAt: string;
  chain: { ok: true; headId: string | null } | { ok: false; brokenAt: string };
  entries: number;
  alarm: string | null;
}
export const logStatus = () => staffApi<LogStatus>('/staff/v1/log/integrity');
/** Review m7: the whole chain re-hashed from its first entry, on the owner's "Check integrity" only. */
export const checkLogIntegrity = () => staffApi<LogIntegrity>('/staff/v1/log/integrity/check', { method: 'POST', body: {} });

// ---------------------------------------------------------------------------------------------
// The training library (Plan 4 Task 19; perm training.read): closed cases, read through the anonymizer

export interface ScrubbedText {
  text: string;
  masks: Array<{ start: number; end: number; kind: string }>;
}
export interface TrainingItem {
  id: string;
  /** The month the case closed, `YYYY-MM` (review m1: never the day). */
  closedMonth: string;
  method: string;
  methodName: string;
  /** Atomic units, rounded by the API to 2 significant figures (review m1). */
  xmr: string;
  outcome: string | null;
  overturned: boolean;
  afterRefund: boolean;
}
export interface TrainingCase extends TrainingItem {
  tradeCode: string;
  openedBy: string;
  reason: string;
  note: ScrubbedText | null;
  closedAt: string;
  rulings: Array<{ round: number; outcome: string; at: string; reason: ScrubbedText; evidence: ScrubbedText[] }>;
  appeal: { by: string; at: string; why: ScrubbedText } | null;
  timeline: Array<{ at: string; who: string; action: string }>;
  chat: 'not-available';
}
export const trainingList = (before?: string) =>
  staffApi<{ items: TrainingItem[]; next: string | null }>(`/staff/v1/training${before ? `?before=${encodeURIComponent(before)}` : ''}`);
export const trainingCase = (id: string) => staffApi<TrainingCase>(`/staff/v1/training/${encodeURIComponent(id)}`);

// Lead call 18 Nov (re-review): the review-first library. A curator (`training.curate`, the owner)
// reviews each closed case pre-masked and marks it with the manual masks they add.
/** A curator's mask: a range of a field's pre-masked text, or the whole field. */
export type ManualMask = { field: string; start: number; end: number } | { field: string; whole: true };
export type TrainingStatus = 'unmarked' | 'marked' | 'stale';
export interface TrainingReviewItem extends TrainingItem {
  status: TrainingStatus;
}
export interface TrainingReviewCase extends TrainingCase {
  status: TrainingStatus;
  /** Each text of the case pre-masked (automatic masks only), by field key, in reading order. */
  fields: Record<string, ScrubbedText>;
  /** The manual masks saved for the case. */
  manual: ManualMask[];
  /** Re-review 3 m1: the tag of the texts as loaded; the save sends it back (409 `case-changed` if they changed). */
  reviewTag: string;
}
/** Re-review m3: newest closed first, 50 a page; `before` is the last case's opaque id. */
export const trainingReviewList = (before?: string) => staffApi<{ items: TrainingReviewItem[]; next: string | null }>(page('/staff/v1/training/review', before));
export const trainingReviewCase = (id: string) => staffApi<TrainingReviewCase>(`/staff/v1/training/review/${encodeURIComponent(id)}`);
export const markTrainingCase = (id: string, masks: ManualMask[], reviewTag: string) =>
  staffApi<{ id: string; status: 'marked' }>(`/staff/v1/training/review/${encodeURIComponent(id)}`, { method: 'PUT', body: { masks, reviewTag } });
export const unmarkTrainingCase = (id: string) =>
  staffApi<{ id: string; status: 'unmarked' }>(`/staff/v1/training/review/${encodeURIComponent(id)}`, { method: 'DELETE' });
