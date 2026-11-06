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
  if (err.status === 401 && err.code === 'outside-login-hours') sessionEnded?.('hours');
  throw err;
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
export const keyLoginFinish = (b: { challengeId: string; response: AuthenticationResponseJSON }) =>
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

export const setupState = () => staffApi<{ state: SetupState }>('/staff/v1/setup');
export const setupCode = (code: string) => staffApi<{ ok: true; expiresAt: string }>('/staff/v1/setup/code', { method: 'POST', body: { code } });
export const setupAccount = (b: { username: string; loginName: string }) => staffApi<{ ok: true }>('/staff/v1/setup/account', { method: 'POST', body: b });
export const setupKeyStart = () =>
  staffApi<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }>('/staff/v1/setup/key/start', { method: 'POST', body: { kind: 'security-key' } });
export const setupKeyFinish = (b: { challengeId: string; response: RegistrationResponseJSON; label?: string }) =>
  staffApi<{ keys: number }>('/staff/v1/setup/key/finish', { method: 'POST', body: b });
export const setupPgpStart = (publicKey: string) => staffApi<PgpChallenge>('/staff/v1/setup/pgp/start', { method: 'POST', body: { publicKey } });
export const setupPgpFinish = (b: { challengeId: string; code: string }) => staffApi<{ fingerprint: string }>('/staff/v1/setup/pgp/finish', { method: 'POST', body: b });
export const setupFinish = () => staffApi<{ keyCheckCodes: string[] }>('/staff/v1/setup/finish', { method: 'POST', body: { deviceLabel: deviceLabel() } });

// ---------------------------------------------------------------------------------------------
// Invite acceptance (Task 7; any invalid, used, cancelled or expired token is 404 `invite-invalid`)

export type InviteRole = 'senior' | 'mod' | 'helper';
export interface InviteView {
  role: InviteRole;
  hours: LoginHours;
  expiresAt: string;
}

const invitePath = (token: string, rest = '') => `/staff/v1/invites/accept/${encodeURIComponent(token)}${rest}`;

export const inviteRead = (token: string) => staffApi<InviteView>(invitePath(token));
export const inviteAccount = (token: string, b: { username: string; loginName: string }) =>
  staffApi<{ ok: true }>(invitePath(token, '/account'), { method: 'POST', body: b });
export const inviteKeyStart = (token: string, kind: 'security-key' | 'passkey') =>
  staffApi<{ options: PublicKeyCredentialCreationOptionsJSON }>(invitePath(token, '/key/start'), { method: 'POST', body: { kind } });
export const inviteKeyFinish = (token: string, b: { kind: 'security-key' | 'passkey'; response: RegistrationResponseJSON }) =>
  staffApi<{ kind: string; keyCheckCode: string | null }>(invitePath(token, '/key/finish'), { method: 'POST', body: b });
export const invitePgpStart = (token: string, publicKey: string) => staffApi<PgpChallenge>(invitePath(token, '/pgp/start'), { method: 'POST', body: { publicKey } });
export const invitePgpFinish = (token: string, b: { challengeId: string; code: string }) =>
  staffApi<{ ok: true }>(invitePath(token, '/pgp/finish'), { method: 'POST', body: b });
export const inviteFinish = (token: string) => staffApi<{ keyCheckCode: string | null }>(invitePath(token, '/finish'), { method: 'POST', body: {} });
