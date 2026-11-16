/**
 * Why a security key or passkey was not added, in words the person can act on (owner demo 13 Nov:
 * "Unable to add security key. I've tried both USB and nfc" got one sentence for every cause).
 *
 * The browser's own refusals come from @simplewebauthn/browser as a `WebAuthnError` (`name` =
 * the DOMException's name, `code` = its ERROR_* code); the server's from `refusalText`.
 */
import { refusalText } from './refusals.js';

export type KeyKind = 'security-key' | 'passkey';

// COPY-UNSIGNED: every sentence below.
export const KEY_ERROR = {
  /** 403 method-not-allowed at finish: the server refused this key's model (staff and owner allowlists). */
  notAccepted: "This key model isn't accepted yet. Use a different security key.",
  /** NotAllowedError / AbortError: no tap in time, the browser's sheet was closed, or no key answered. */
  noAnswer: (k: KeyKind) =>
    k === 'passkey'
      ? "Your device didn't make the passkey: the request was cancelled or timed out. Try again."
      : "The key didn't respond: the request was cancelled or timed out. Plug it in or hold it to the back of your phone, tap it when it lights up, and try again.",
  /** NotAllowedError inside a frame: the page that holds this one did not let it use keys. */
  // not-a-refusal: why a key step failed, shown in the key step's own error line
  framed: "Security keys and passkeys can't be used inside this window. Open this page in its own browser tab and try again.",
  /** SecurityError: the page's address is not one the site's keys are made for. */
  // not-a-refusal: why a key step failed, shown in the key step's own error line
  wrongAddress: "Security keys and passkeys can't be used at this page's address. Open X2F at its usual address and try again.",
  /** InvalidStateError: this authenticator already holds a credential for this account. */
  already: (k: KeyKind) => (k === 'passkey' ? 'That passkey is already on your account.' : 'That security key is already on your account. Use a different one.'),
  /** NotSupportedError: none of Ed25519, ES256, RS256. */
  // not-a-refusal: why a key step failed, shown in the key step's own error line
  noAlgorithm: "This key can't make the kind of key X2F needs. Use a different security key.",
  /** ConstraintError: a passkey needs a PIN, fingerprint or face check the device can't do yet. */
  needsPin: 'Your device needs a screen lock, PIN or fingerprint set up first. Set one up, then try again.',
  /** No WebAuthn at all. */
  // not-a-refusal: why a key step failed, shown in the key step's own error line
  unsupported: "This browser can't use security keys or passkeys. Try an up-to-date Chrome, Firefox, Safari or Edge.",
  /** 401 webauthn-failed: the key answered, but its answer did not check out. */
  checkFailed: (k: KeyKind) => (k === 'passkey' ? "Your passkey's answer couldn't be checked. Try again." : "The key's answer couldn't be checked. Try again, or use a different key."),
  fallback: (k: KeyKind) => (k === 'passkey' ? 'That passkey was not added. Try again.' : 'That security key was not added. Try again.'),
} as const;

/** True when this page is inside a frame that did not let it make keys (Permissions Policy). */
function blockedByFrame(e: Error): boolean {
  if (typeof window === 'undefined') return false;
  let framed: boolean;
  try {
    framed = window.self !== window.top;
  } catch {
    framed = true;
  }
  if (!framed) return false;
  const policy = typeof document === 'undefined' ? undefined : (document as { featurePolicy?: { allowsFeature(f: string): boolean } }).featurePolicy;
  if (policy !== undefined && !policy.allowsFeature('publickey-credentials-create')) return true;
  return /permissions? policy|feature is not enabled|cross-origin|insecure/i.test(e.message);
}

/** The sentence for a failed add of a `kind` credential; `fallback` when nothing more is known. */
export function keyErrorText(e: unknown, kind: KeyKind, fallback: string = KEY_ERROR.fallback(kind)): string {
  const name = e instanceof Error ? e.name : '';
  const code = typeof (e as { code?: unknown })?.code === 'string' ? (e as { code: string }).code : '';
  // not-a-refusal: why a key step failed, shown in the key step's own error line
  if (code === 'method-not-allowed') return KEY_ERROR.notAccepted;
  if (code === 'webauthn-failed') return KEY_ERROR.checkFailed(kind);
  if (name === 'SecurityError' || code === 'ERROR_INVALID_RP_ID' || code === 'ERROR_INVALID_DOMAIN') return KEY_ERROR.wrongAddress;
  if (name === 'InvalidStateError' || code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') return KEY_ERROR.already(kind);
  if (name === 'NotSupportedError') return KEY_ERROR.noAlgorithm;
  if (name === 'ConstraintError') return KEY_ERROR.needsPin;
  if (name === 'NotAllowedError' || name === 'AbortError') return blockedByFrame(e as Error) ? KEY_ERROR.framed : KEY_ERROR.noAnswer(kind);
  if (e instanceof Error && /not supported in this browser/.test(e.message)) return KEY_ERROR.unsupported;
  return refusalText(e, fallback);
}
