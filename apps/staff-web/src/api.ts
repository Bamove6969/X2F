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
import { defaultDeviceLabel } from '@x2f/auth-client';
import type { KeyTapIntent, LoginHours, NavItem, StaffRole } from '@x2f/staff';
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
  username: string;
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
  staffApi<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }>('/staff/v1/login/security-key/start', { method: 'POST', body: b });
export const keyLoginFinish = (b: { challengeId: string; response: AuthenticationResponseJSON; pendingId?: string }) =>
  staffApi<LoginResult>('/staff/v1/login/security-key/finish', { method: 'POST', body: { ...b, deviceLabel: deviceLabel() } });
export const pgpLoginStart = (b: { key: string; pendingId?: string }) => staffApi<PgpChallenge>('/staff/v1/login/pgp/start', { method: 'POST', body: b });
export const pgpLoginFinish = (b: { challengeId: string; code: string }) =>
  staffApi<LoginResult>('/staff/v1/login/pgp/finish', { method: 'POST', body: { ...b, deviceLabel: deviceLabel() } });

// ---------------------------------------------------------------------------------------------
// Key taps (Task 5): every tapped action first proves a security-key tap bound to its intent.

export const tapStart = (intent: KeyTapIntent) =>
  staffApi<{ tapId: string; options: PublicKeyCredentialRequestOptionsJSON }>('/staff/v1/taps/start', { method: 'POST', body: intent });
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
export const setupAccount = (b: { username: string; loginName: string }) => staffApi<{ ok: true }>('/staff/v1/setup/account', { method: 'POST', body: b });
export const setupKeyStart = () =>
  staffApi<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>('/staff/v1/setup/key/start', { method: 'POST', body: { kind: 'security-key' } });
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

export const inviteRead = (token: string) => staffApi<InviteView>(invitePath(token));
/** Owner Q54: the public name is `displayName` (the API refuses a field named username). */
export const inviteAccount = (token: string, b: { displayName: string; loginName: string }) =>
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
  accountId: string | null;
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
