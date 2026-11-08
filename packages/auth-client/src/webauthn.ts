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
import type { AuthApi, Held, LoginResult, TermsSignature, WebAuthnKind } from './api.js';

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
 * Answers `Held` when the key waits out the 24-hour hold (Plan 2 Task 17), else undefined.
 */
export async function addWebAuthnKey(
  api: AuthApi,
  kind: WebAuthnKind,
  o: { label?: string; confirmToken?: string | undefined } = {},
  ceremony: RegistrationCeremony = BROWSER_REGISTRATION,
): Promise<Held | undefined> {
  const { challengeId, options } = await api.addWebAuthnStart({
    kind, ...(o.confirmToken !== undefined ? { confirmToken: o.confirmToken } : {}),
  });
  const response = await ceremony.startRegistration({ optionsJSON: options });
  // Task 17: `Held` when the new key waits out the 24-hour hold.
  return api.addWebAuthnFinish({ challengeId, response, ...(o.label !== undefined ? { label: o.label } : {}) });
}
