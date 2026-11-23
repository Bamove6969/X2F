/**
 * WebAuthn ceremonies (passkeys and security keys) around the auth API. The browser part is
 * @simplewebauthn/browser's `startRegistration` / `startAuthentication` by default; tests pass a
 * software authenticator instead. The private key never leaves the authenticator.
 */
import {
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser';
import type { ConfirmAction } from '@x2f/accounts';
import type { AuthApi, LoginResult, Staged, TermsSignature, WebAuthnKind } from './api.js';

export interface RegistrationCeremony {
  startRegistration(o: { optionsJSON: PublicKeyCredentialCreationOptionsJSON }): Promise<RegistrationResponseJSON>;
}

export interface AuthenticationCeremony {
  startAuthentication(o: { optionsJSON: PublicKeyCredentialRequestOptionsJSON }): Promise<AuthenticationResponseJSON>;
}

const BROWSER_REGISTRATION: RegistrationCeremony = { startRegistration };
const BROWSER_AUTHENTICATION: AuthenticationCeremony = { startAuthentication };

/**
 * Sign-up with a passkey or a security key (traders). `acceptedTerms` is the Terms version the
 * person accepted on the Terms screen (R10), with the signature they gave there (`termsSignature`);
 * neither is ever fetched or made up on their behalf.
 * Starts a session on success.
 */
export async function registerWithWebAuthn(
  api: AuthApi,
  names: { displayName: string; loginName: string },
  kind: WebAuthnKind,
  deviceLabel: string,
  acceptedTerms: string,
  termsSignature: TermsSignature,
  ceremony: RegistrationCeremony = BROWSER_REGISTRATION,
  o: { label?: string } = {},
): Promise<{ displayName: string }> {
  const { challengeId, options } = await api.registerWebAuthnStart({ displayName: names.displayName, loginName: names.loginName, kind });
  const response = await ceremony.startRegistration({ optionsJSON: options });
  return api.registerWebAuthnFinish({
    challengeId, response, deviceLabel, acceptedTerms, termsSignature, ...(o.label !== undefined ? { label: o.label } : {}),
  });
}

/** Passkey login without a name: the authenticator picks the account (traders). */
export async function loginWithPasskey(
  api: AuthApi,
  deviceLabel: string,
  ceremony: AuthenticationCeremony = BROWSER_AUTHENTICATION,
): Promise<LoginResult> {
  const { challengeId, options } = await api.loginWebAuthnStart({});
  const response = await ceremony.startAuthentication({ optionsJSON: options });
  return api.loginWebAuthnFinish({ challengeId, response, deviceLabel });
}

/**
 * Security-key login by the private login name. Staff and the owner get `second-factor` with a `pendingId`
 * (R1); the second step (PGP, or after PGP a security key) passes it back in `o.pendingId`.
 */
export async function loginWithSecurityKey(
  api: AuthApi,
  loginName: string,
  deviceLabel: string,
  ceremony: AuthenticationCeremony = BROWSER_AUTHENTICATION,
  o: { pendingId?: string } = {},
): Promise<LoginResult> {
  const pending = o.pendingId !== undefined ? { pendingId: o.pendingId } : {};
  const { challengeId, options } = await api.loginWebAuthnStart({ loginName, ...pending });
  const response = await ceremony.startAuthentication({ optionsJSON: options });
  return api.loginWebAuthnFinish({ challengeId, response, deviceLabel, ...pending });
}

/** Confirm it's you with a passkey or security key: a single-use token for exactly `action`. */
export async function confirmWithWebAuthn(
  api: AuthApi,
  action: ConfirmAction,
  ceremony: AuthenticationCeremony = BROWSER_AUTHENTICATION,
): Promise<string> {
  const { challengeId, options } = await api.confirmWebAuthnStart({ action });
  const response = await ceremony.startAuthentication({ optionsJSON: options });
  return (await api.confirmWebAuthnFinish({ challengeId, response })).confirmToken;
}

/**
 * Adds a passkey or security key to the signed-in account. Outside the sign-up window the API asks
 * for a confirm token for `{ kind: 'add-method', method: kind }`: wrap the call in `withConfirm`.
 * Answers `Staged` when the key is staged for review (hold model v3: a username-and-password login), else undefined.
 */
export async function addWebAuthnKey(
  api: AuthApi,
  kind: WebAuthnKind,
  o: { label?: string; confirmToken?: string | undefined } = {},
  ceremony: RegistrationCeremony = BROWSER_REGISTRATION,
): Promise<Staged | undefined> {
  return (await addWebAuthnKeyWithId(api, kind, o, ceremony)).staged;
}

/**
 * `addWebAuthnKey`, also answering the new credential's id (the registration response's `id`, the
 * base64url credential ID the authenticator made), so the key can be tested at once
 * (`testWebAuthnKey`, owner demo note #94).
 */
export async function addWebAuthnKeyWithId(
  api: AuthApi,
  kind: WebAuthnKind,
  o: { label?: string; confirmToken?: string | undefined } = {},
  ceremony: RegistrationCeremony = BROWSER_REGISTRATION,
): Promise<{ staged: Staged | undefined; credentialId: string }> {
  const { challengeId, options } = await api.addWebAuthnStart({
    kind, ...(o.confirmToken !== undefined ? { confirmToken: o.confirmToken } : {}),
  });
  const response = await ceremony.startRegistration({ optionsJSON: options });
  // Hold model v3: `Staged` when the new key is a draft to review and submit.
  const staged = await api.addWebAuthnFinish({ challengeId, response, ...(o.label !== undefined ? { label: o.label } : {}) });
  return { staged, credentialId: response.id };
}

/**
 * The confirm action a key test asks for (owner demo note #94; security review of
 * wip/lead-notes-all, L1): its own `key-test`, which only a passkey or security key confirms and for
 * which the server issues no token. The test reuses the confirm ceremony
 * (`/v1/confirm/webauthn/start|finish`, the server's own assertion check, bound to this session).
 */
export const KEY_TEST_ACTION: ConfirmAction = { kind: 'key-test' };

/** Why a key test did not pass, besides the browser's and the server's own errors. */
export class KeyTestError extends Error {
  constructor(
    /** `not-listed`: the server did not offer the new key for a confirm; `other-key`: another credential answered. */
    readonly code: 'not-listed' | 'other-key',
  ) {
    super(code);
    this.name = 'KeyTestError';
  }
}

/**
 * Tests a key just added (owner demo note #94: "it should even have you test it after adding it to
 * make sure it functions correctly"): a real WebAuthn assertion by exactly `credentialId`, checked
 * by the server. The confirm options are narrowed to that one credential (the server listed it;
 * nothing is added), the browser is asked for it alone, an answer from any other credential is
 * refused here, and the server verifies the answer against the stored public key (signature,
 * challenge, origin, user verification and counter, `verifyAssertion`) and that it was listed.
 * Resolves when the key works; throws the ceremony's or the API's error, or a `KeyTestError`.
 */
export async function testWebAuthnKey(
  api: AuthApi,
  credentialId: string,
  ceremony: AuthenticationCeremony = BROWSER_AUTHENTICATION,
): Promise<void> {
  const { challengeId, options } = await api.confirmWebAuthnStart({ action: KEY_TEST_ACTION });
  const listed = (options.allowCredentials ?? []).filter((c) => c.id === credentialId);
  if (listed.length === 0) throw new KeyTestError('not-listed');
  const response = await ceremony.startAuthentication({ optionsJSON: { ...options, allowCredentials: listed } });
  if (response.id !== credentialId || response.rawId !== credentialId) throw new KeyTestError('other-key');
  // The server's check; it answers `{ tested: true }` and issues no token (review L1).
  const done = await api.keyTestWebAuthnFinish({ challengeId, response });
  if (done.tested !== true) throw new KeyTestError('not-listed');
}
