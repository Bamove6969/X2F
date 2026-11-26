/**
 * The sign-up calls of Getting started (spec 6.1, Plan 2 register routes with FU-A's names). Every
 * register call takes the public `tradeTag` and the private `loginName` (they must differ) and
 * carries the Terms version the person accepted on the first screen (`acceptedTerms`, Plan 2 R10).
 * No signature: a trader agrees with the tick alone (owner demo note #187, 25 Nov 2026).
 * All of them go through the typed client (`authApi`).
 */
import { AuthApiError, registerWithWebAuthn, type PgpChallenge, type WebAuthnKind } from '@x2f/auth-client';
import { ApiCallError } from '../../api/client.js';
import { authApi, deviceLabel } from '../auth/authApi.js';
import { KEY_UNAVAILABLE, refusalText } from '../auth/refusals.js';

export interface Names {
  tradeTag: string;
  loginName: string;
}

export type RegisterPgpStart = PgpChallenge & { fingerprint: string };

/** What the Terms screen hands on: the version accepted with the tick (owner demo note #187: no signature). */
export interface TermsAcceptance {
  version: string;
}

export function registerPgpStart(names: Names, publicKey: string): Promise<RegisterPgpStart> {
  return authApi.registerPgpStart({ tradeTag: names.tradeTag, loginName: names.loginName, publicKey });
}

export async function registerPgpFinish(challengeId: string, code: string, terms: TermsAcceptance): Promise<void> {
  await authApi.registerPgpFinish({ challengeId, code, deviceLabel: deviceLabel(), acceptedTerms: terms.version });
}

/** A passkey or security key: the browser's ceremony between the start and the finish. Answers the new credential's id (to name it). */
export async function registerWebAuthn(names: Names, kind: WebAuthnKind, terms: TermsAcceptance): Promise<{ credentialId: string }> {
  const { credentialId } = await registerWithWebAuthn(authApi, { tradeTag: names.tradeTag, loginName: names.loginName }, kind, deviceLabel(), terms.version);
  return { credentialId };
}

/** The API's error code from either client, or `null` for anything else (a network failure, a cancelled ceremony). */
export function errorCode(e: unknown): string | null {
  if (e instanceof ApiCallError || e instanceof AuthApiError) return e.code;
  return null;
}

/** Codes that mean the names must change (FU-A's register refusals): back to the names screen. */
// Owner Q54: the private login name is the "username"; the public one is the "Trade Tag".
const NAME_ERRORS: Record<string, string> = {
  'trade-tag-taken': 'That Trade Tag is taken. Pick another.',
  'trade-tag-reserved': 'That Trade Tag is kept for X2F. Pick another.',
  // not-a-refusal: an input check on the names typed
  'trade-tag-invalid': 'That Trade Tag cannot be used. Pick another.',
  'login-name-invalid': 'That username cannot be used. Pick another.', // not-a-refusal: an input check
  'names-unavailable': 'Those names cannot be used. Pick others.', // not-a-refusal: an input check
  'names-same': 'Your Trade Tag must be different from your username.',
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
  /** The step whose name to change: the Trade Tag's own screen, or the username's (review F8). */
  names?: 'name' | 'trade-tag';
  keyInUse?: true;
  /** 409 `key-unavailable` at the finish (a key on the ban list, never named as such): link to the key screen only. */
  keyRefused?: true;
}

function minutes(seconds: number | undefined): string {
  const s = seconds !== undefined && Number.isFinite(seconds) && seconds > 0 ? seconds : 60;
  const min = Math.max(1, Math.ceil(s / 60));
  return `${min} ${min === 1 ? 'minute' : 'minutes'}`;
}

/**
 * What a setup screen says for a refused call (review fix round M1, M2): the names refusals (with
 * the link back to the names), a key already on another account, 503 `busy` with its wait, then Task 30's `refusalText` (429 waits, a refused key's
 * reason or the server's own sentence about the key, an expired step), else `fallback`.
 */
export function setupError(e: unknown, fallback: string, o: { expired?: string } = {}): SetupError {
  const names = nameError(e);
  const code = errorCode(e);
  if (names !== null) return { text: names, names: code !== null && code.startsWith('trade-tag-') ? 'trade-tag' : 'name' };
  if (code === 'key-in-use') return { text: KEY_IN_USE, keyInUse: true };
  if (code === 'key-unavailable') return { text: KEY_UNAVAILABLE, keyRefused: true };
  if (e instanceof AuthApiError || e instanceof ApiCallError) {
    if (e.status === 503 && code === 'busy') return { text: `X2F is busy right now. Try again in ${minutes(e.retryAfterSeconds)}.` };
  }
  return { text: refusalText(e, fallback, o.expired !== undefined ? { expired: o.expired } : {}) };
}
