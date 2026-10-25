/**
 * The sign-up calls of Getting started (spec 6.1, Plan 2 register routes). Every register call
 * carries the Terms version the person accepted on the first screen (`acceptedTerms`, Plan 2 R10).
 *
 * FU-A shapes (owner, 2026-10-23; the lead's wip/lead-p2-fua, not on the main line yet): sign-up
 * takes the public `displayName` and the private `loginName`, and answers `{ displayName }`. The
 * starts go through the raw client with those shapes until FU-A's typed client lands;
 * `task28-tripwires.test.ts` fails then, the signal to switch them to `authApi`. The finishes have
 * the same request shape on both, so they already use the typed client.
 */
import { startRegistration } from '@simplewebauthn/browser';
import { AuthApiError, type PgpChallenge, type RegistrationChallenge, type WebAuthnKind } from '@x2f/auth-client';
import { ApiCallError, api } from '../../api/client.js';
import { authApi, deviceLabel } from '../auth/authApi.js';

export interface Names {
  displayName: string;
  loginName: string;
}

export type RegisterPgpStart = PgpChallenge & { fingerprint: string };

export function registerPassword(names: Names, password: string, acceptedTerms: string): Promise<{ displayName: string }> {
  return api('/v1/register/password', {
    method: 'POST',
    body: { displayName: names.displayName, loginName: names.loginName, password, deviceLabel: deviceLabel(), acceptedTerms },
  });
}

export function registerPgpStart(names: Names, publicKey: string): Promise<RegisterPgpStart> {
  return api('/v1/register/pgp/start', { method: 'POST', body: { displayName: names.displayName, loginName: names.loginName, publicKey } });
}

export async function registerPgpFinish(challengeId: string, code: string, acceptedTerms: string): Promise<void> {
  await authApi.registerPgpFinish({ challengeId, code, deviceLabel: deviceLabel(), acceptedTerms });
}

/** A passkey or security key: the browser's ceremony between the start and the finish. */
export async function registerWebAuthn(names: Names, kind: WebAuthnKind, acceptedTerms: string): Promise<void> {
  const { challengeId, options } = await api<RegistrationChallenge>('/v1/register/webauthn/start', {
    method: 'POST',
    body: { displayName: names.displayName, loginName: names.loginName, kind },
  });
  const response = await startRegistration({ optionsJSON: options });
  await authApi.registerWebAuthnFinish({ challengeId, response, deviceLabel: deviceLabel(), acceptedTerms });
}

/** The API's error code from either client, or `null` for anything else (a network failure, a cancelled ceremony). */
export function errorCode(e: unknown): string | null {
  if (e instanceof ApiCallError || e instanceof AuthApiError) return e.code;
  return null;
}

/** Codes that mean the names must change: the person goes back to the names screen. */
const NAME_ERRORS: Record<string, string> = {
  'display-name-taken': 'That username is taken. Pick another.',
  'username-taken': 'That username is taken. Pick another.',
  'display-name-reserved': 'That username is kept for X2F. Pick another.',
  'username-reserved': 'That username is kept for X2F. Pick another.',
  'display-name-invalid': 'That username cannot be used. Pick another.',
  'username-invalid': 'That username cannot be used. Pick another.',
  'login-name-invalid': 'That login name cannot be used. Pick another.',
  'names-unavailable': 'Those names cannot be used. Pick others.',
  'names-same': 'Your login name must be different from your username.',
};

/** The sentence for a refused name, or `null` when the error is not about the names. */
export function nameError(e: unknown): string | null {
  const code = errorCode(e);
  return code !== null && Object.hasOwn(NAME_ERRORS, code) ? NAME_ERRORS[code]! : null;
}

/** True when the Terms changed during setup (`terms-not-accepted`): the person reads them again. */
export function termsChanged(e: unknown): boolean {
  return errorCode(e) === 'terms-not-accepted';
}
