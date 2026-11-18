import { inviteRegistrationChallenge, inviteTokenHash, ownerSetupChallenge, staffLoginChallenge } from '@x2f/staff';

/**
 * Re-verify round 3, X2 (lead call): every WebAuthn ceremony on the staff site signs a challenge
 * this code derives itself, in its own domain (@x2f/staff), never the one the server sent. A
 * compromised API can then never get a login or a setup assertion that is also a tap: those are
 * `x2f-keytap-v1` and checked by KeyTapDialog. The webauthnTripwire test pins every call site.
 */
const NONCE = /^[0-9a-f]{64}$/;

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const x of bytes) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function nonceOf(n: unknown): string {
  if (typeof n !== 'string' || !NONCE.test(n)) throw new Error('The server did not send a usable login nonce.');
  return n;
}

/** The login's options with the challenge replaced by `staffLoginChallenge(loginNonce)`. */
export function loginOptions<T extends { challenge: string }>(options: T, loginNonce: unknown): T {
  return { ...options, challenge: b64url(staffLoginChallenge(nonceOf(loginNonce))) };
}

/** The owner setup's options with the challenge replaced by `ownerSetupChallenge(setupNonce)`. */
export function setupOptions<T extends { challenge: string }>(options: T, setupNonce: unknown): T {
  return { ...options, challenge: b64url(ownerSetupChallenge(nonceOf(setupNonce))) };
}

/** An invite key's options with the challenge replaced by `inviteRegistrationChallenge(sha256(token))`, from the token in the link. */
export function inviteOptions<T extends { challenge: string }>(options: T, token: string): T {
  return { ...options, challenge: b64url(inviteRegistrationChallenge(inviteTokenHash(token))) };
}
