/**
 * The sign-up calls of Getting started (spec 6.1, Plan 2 register routes with FU-A's names). Every
 * register call takes the public `displayName` and the private `loginName` (they must differ) and
 * carries the Terms version the person accepted on the first screen (`acceptedTerms`, Plan 2 R10).
 * All of them go through the typed client (`authApi`).
 */
import { AuthApiError, registerWithWebAuthn, type PgpChallenge, type WebAuthnKind } from '@x2f/auth-client';
import { ApiCallError } from '../../api/client.js';
import { authApi, deviceLabel } from '../auth/authApi.js';
import { KEY_UNAVAILABLE, refusalText } from '../auth/refusals.js';

export interface Names {
  displayName: string;
  loginName: string;
}

export type RegisterPgpStart = PgpChallenge & { fingerprint: string };

export function registerPassword(names: Names, password: string, acceptedTerms: string): Promise<{ displayName: string }> {
  return authApi.registerPassword({ displayName: names.displayName, loginName: names.loginName, password, deviceLabel: deviceLabel(), acceptedTerms });
}

export function registerPgpStart(names: Names, publicKey: string): Promise<RegisterPgpStart> {
  return authApi.registerPgpStart({ displayName: names.displayName, loginName: names.loginName, publicKey });
}

export async function registerPgpFinish(challengeId: string, code: string, acceptedTerms: string): Promise<void> {
  await authApi.registerPgpFinish({ challengeId, code, deviceLabel: deviceLabel(), acceptedTerms });
}

/** A passkey or security key: the browser's ceremony between the start and the finish. */
export async function registerWebAuthn(names: Names, kind: WebAuthnKind, acceptedTerms: string): Promise<void> {
  await registerWithWebAuthn(authApi, { displayName: names.displayName, loginName: names.loginName }, kind, deviceLabel(), acceptedTerms);
}

/** The API's error code from either client, or `null` for anything else (a network failure, a cancelled ceremony). */
export function errorCode(e: unknown): string | null {
  if (e instanceof ApiCallError || e instanceof AuthApiError) return e.code;
  return null;
}

/** Codes that mean the names must change (FU-A's register refusals): back to the names screen. */
// Owner Q54: the private login name is the "username"; the public one is the "display name".
const NAME_ERRORS: Record<string, string> = {
  'display-name-taken': 'That display name is taken. Pick another.',
  'display-name-reserved': 'That display name is kept for X2F. Pick another.',
  // not-a-refusal: an input check on the names typed
  'display-name-invalid': 'That display name cannot be used. Pick another.',
  'login-name-invalid': 'That username cannot be used. Pick another.', // not-a-refusal: an input check
  'names-unavailable': 'Those names cannot be used. Pick others.', // not-a-refusal: an input check
  'names-same': 'Your display name must be different from your username.',
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

/** 409 `key-in-use` at the PGP finish: the key proved to be the person's, but another account holds it. */
export const KEY_IN_USE = 'That key is already used by another X2F account. Use a different key, or log in instead.';

/** A refused setup call as the screen shows it; `names` and `keyInUse` add their links (RegisterError). */
export interface SetupError {
  text: string;
  names?: true;
  keyInUse?: true;
  /** 409 `key-unavailable` at the finish (a key on the ban list, never named as such): link to the key screen only. */
  keyRefused?: true;
}

/** The password rules in the board's words, for a 400 `password-weak` `{ missing }`. */
const PASSWORD_RULES: Record<string, string> = {
  length: '10 characters or more',
  // not-a-refusal: an input check on a typed password
  'too-long': 'at most 256 characters',
  upper: 'an upper case letter',
  lower: 'a lower case letter',
  number: 'a number',
  symbol: 'a symbol',
};

function minutes(seconds: number | undefined): string {
  const s = seconds !== undefined && Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
  const min = Math.max(1, Math.ceil(s / 60));
  return `${min} ${min === 1 ? 'minute' : 'minutes'}`;
}

/**
 * What a setup screen says for a refused call (review fix round M1, M2): the names refusals (with
 * the link back to the names), a key already on another account, 503 `busy` with its wait, the
 * rules a weak password still misses, then Task 30's `refusalText` (429 waits, a refused key's
 * reason or the server's own sentence about the key, an expired step), else `fallback`.
 */
export function setupError(e: unknown, fallback: string, o: { expired?: string } = {}): SetupError {
  const names = nameError(e);
  if (names !== null) return { text: names, names: true };
  const code = errorCode(e);
  if (code === 'key-in-use') return { text: KEY_IN_USE, keyInUse: true };
  if (code === 'key-unavailable') return { text: KEY_UNAVAILABLE, keyRefused: true };
  if (e instanceof AuthApiError || e instanceof ApiCallError) {
    if (e.status === 503 && code === 'busy') return { text: `X2F is busy right now. Try again in ${minutes(e.retryAfterSeconds)}.` };
    if (code === 'password-weak' && e instanceof AuthApiError && e.missing !== undefined && e.missing.length > 0) {
      const needs = e.missing.map((m) => PASSWORD_RULES[m]).filter((m): m is string => m !== undefined);
      if (needs.length > 0) return { text: `That password still needs: ${needs.join(', ')}.` };
    }
  }
  return { text: refusalText(e, fallback, o.expired !== undefined ? { expired: o.expired } : {}) };
}
