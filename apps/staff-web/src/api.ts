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
import type { GrantablePerm, KeyTapIntent, LoginHours, NavItem, StaffRole } from '@x2f/staff';
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
  /** Owner Q54: the public name (the API's `displayName`; the boards call it the username). */
  displayName: string;
  role: StaffRole;
  nav: NavItem[];
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
export const setupAccount = (b: { displayName: string; loginName: string }) => staffApi<{ ok: true }>('/staff/v1/setup/account', { method: 'POST', body: b });
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
 * Owner Q54: the public name is `displayName` (the API refuses a field named username). Owner 9 Nov
 * 2026 (p11-14): everyone who gets a login signs the Terms, so the version accepted and the
 * signature given on the Terms step go with the names (400 `terms-not-accepted` when the version
 * changed meanwhile: the page shows the Terms again).
 */
export const inviteAccount = (token: string, b: { displayName: string; loginName: string; acceptedTerms: string; termsSignature: TermsSignature }) =>
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
   * D-058: the sender's public display name (never the login name); null for an anonymous row. The
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
// News for traders (Plan 4 Task 28 on the staff API; perm site.control, the owner only)


export const newsList = () => staffApi<{ items: NewsItem[] }>('/staff/v1/news');
export const newsAdd = (d: { title: string; body: string }) => staffApi<NewsItem>('/staff/v1/news', { method: 'POST', body: d });
export const newsEdit = (id: number, d: { title: string; body: string }) => staffApi<NewsItem>(`/staff/v1/news/${id}`, { method: 'PUT', body: d });
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
// Staff members (Plan 4 Task 7; perm staff.manage, the owner only) and their per-person
// checkboxes (owner Q60, J-21: PUT …/grants with a `set-grants` tap bound to the exact sorted list).

export interface Member {
  accountId: string | null;
  inviteId: string | null;
  displayName: string | null;
  role: StaffRole;
  status: 'active' | 'switched-off' | 'waiting';
  grants: GrantablePerm[];
}
export const members = () => staffApi<{ members: Member[] }>('/staff/v1/members');
export const setGrants = (accountId: string, grants: GrantablePerm[], tapId: string) =>
  staffApi<{ grants: GrantablePerm[] }>(`/staff/v1/members/${encodeURIComponent(accountId)}/grants`, { method: 'PUT', body: { grants, tapId } });

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
}
export interface Queue {
  rows: QueueRow[];
  counts: { open: number; overdue: number; unassigned: number; needApproval: number };
  settings: { firstResponseH: number; largeTradeLimitUsd: number };
}

export interface CaseTrader {
  displayName: string;
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
export const messageTraders = (code: string, text: string) => staffApi<{ id: string }>(casePath(code, '/messages'), { method: 'POST', body: { text } });
export const requestProof = (code: string, side: Side) => staffApi<unknown>(casePath(code, '/proof-request'), { method: 'POST', body: { side } });
export const setFreeze = (code: string, b: { side: Side; on: true; reason: 'no-reply' | 'ignored-ruling' } | { side: Side; on: false }) =>
  staffApi<{ freezes: { buyer: boolean; seller: boolean } }>(casePath(code, '/freeze'), { method: 'POST', body: b });
export const proposeRuling = (
  code: string,
  b: { rulingId: string; outcome: import('@x2f/staff').RulingOutcome; reason: string; evidence: string[]; tapId: string },
) => staffApi<{ code: string; ruling: CaseRuling }>(casePath(code, '/rulings'), { method: 'POST', body: { ...b, accountAction: { kind: 'none' } } });
export const approveRuling = (code: string, rulingId: string, tapId: string) =>
  staffApi<unknown>(casePath(code, `/rulings/${encodeURIComponent(rulingId)}/approve`), { method: 'POST', body: { tapId } });
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
export const activeDisputes = () => staffApi<{ items: ActiveDispute[] }>('/staff/v1/log/active-disputes');
export interface LogIntegrity {
  checkedAt: string;
  chain: { ok: true; headId: string | null } | { ok: false; brokenAt: string };
  entries: number;
  /** When the moderation process's own check of the log failed (`site_flags.log_alarm`), or null. */
  alarm: string | null;
}
export const logIntegrity = () => staffApi<LogIntegrity>('/staff/v1/log/integrity');

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
}
export const trainingReviewList = () => staffApi<{ items: TrainingReviewItem[] }>('/staff/v1/training/review');
export const trainingReviewCase = (id: string) => staffApi<TrainingReviewCase>(`/staff/v1/training/review/${encodeURIComponent(id)}`);
export const markTrainingCase = (id: string, masks: ManualMask[]) =>
  staffApi<{ id: string; status: 'marked' }>(`/staff/v1/training/review/${encodeURIComponent(id)}`, { method: 'PUT', body: { masks } });
export const unmarkTrainingCase = (id: string) =>
  staffApi<{ id: string; status: 'unmarked' }>(`/staff/v1/training/review/${encodeURIComponent(id)}`, { method: 'DELETE' });
