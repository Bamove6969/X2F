// Owner demo 13 Nov: "Unable to add security key. I've tried both USB and nfc" got one sentence for
// every cause. Each cause now says why.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthApiError } from '@x2f/auth-client';
import { readFileSync } from 'node:fs';
import { lintSource } from '../../../tools/copy-lint.js';
import { KEY_ERROR, keyErrorText } from '../src/screens/auth/keyErrors.js';
import { KEY_MODEL_REFUSED_TEXT } from '../src/ui/cantDoCodes.js';

/** What @simplewebauthn/browser throws: the DOMException's name, an ERROR_* code. */
const browserError = (name: string, code = 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', message = 'x') => Object.assign(new Error(message), { name, code });
const refusal = (status: number, code: string) => new AuthApiError(status, code as never);

afterEach(() => vi.unstubAllGlobals());

describe('why a security key or passkey was not added', () => {
  it('a key model the server refuses, apart from a key that did not answer', () => {
    expect(keyErrorText(refusal(403, 'method-not-allowed'), 'security-key')).toBe("This key model isn't accepted yet. Use a different security key.");
    expect(keyErrorText(browserError('NotAllowedError'), 'security-key')).toBe(KEY_ERROR.noAnswer('security-key'));
    expect(KEY_ERROR.noAnswer('security-key')).toMatch(/^The key didn't respond/);
    expect(keyErrorText(browserError('AbortError', 'ERROR_CEREMONY_ABORTED'), 'passkey')).toBe(KEY_ERROR.noAnswer('passkey'));
  });

  it("the page's address, a key already added, no usable algorithm, a missing PIN, an unchecked answer", () => {
    expect(keyErrorText(browserError('SecurityError', 'ERROR_INVALID_RP_ID'), 'security-key')).toBe(KEY_ERROR.wrongAddress);
    expect(keyErrorText(browserError('InvalidStateError', 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED'), 'security-key')).toBe(KEY_ERROR.already('security-key'));
    expect(keyErrorText(browserError('NotSupportedError', 'ERROR_AUTHENTICATOR_NO_SUPPORTED_PUBKEYCREDPARAMS_ALG'), 'security-key')).toBe(KEY_ERROR.noAlgorithm);
    expect(keyErrorText(browserError('ConstraintError', 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT'), 'passkey')).toBe(KEY_ERROR.needsPin);
    expect(keyErrorText(refusal(401, 'webauthn-failed'), 'security-key')).toBe(KEY_ERROR.checkFailed('security-key'));
    expect(keyErrorText(new Error('WebAuthn is not supported in this browser'), 'security-key')).toBe(KEY_ERROR.unsupported);
  });

  it('owner 25 Nov security-key report: a security key without a PIN says to set one (browser or API), a passkey keeps its device sentence', () => {
    const noPin = new AuthApiError(401, 'webauthn-failed', { reason: 'needs-pin' });
    expect(keyErrorText(noPin, 'security-key')).toBe(KEY_ERROR.keyNeedsPin);
    expect(KEY_ERROR.keyNeedsPin).toMatch(/^Your security key needs a PIN/);
    expect(keyErrorText(noPin, 'passkey')).toBe(KEY_ERROR.needsPin);
    expect(keyErrorText(browserError('ConstraintError'), 'security-key')).toBe(KEY_ERROR.keyNeedsPin);
    // Any other 401 stays the plain sentence.
    expect(keyErrorText(new AuthApiError(401, 'webauthn-failed', { reason: 'other' }), 'security-key')).toBe(KEY_ERROR.checkFailed('security-key'));
  });

  it('inside a frame that may not use keys, says to open its own tab', () => {
    vi.stubGlobal('window', { self: 1, top: 2 });
    expect(keyErrorText(browserError('NotAllowedError', undefined, "The 'publickey-credentials-create' feature is not enabled in this document."), 'security-key')).toBe(KEY_ERROR.framed);
    expect(keyErrorText(browserError('NotAllowedError', undefined, 'The operation either timed out or was not allowed.'), 'security-key')).toBe(KEY_ERROR.noAnswer('security-key'));
  });

  it('anything else: the server refusal sentence, else the fallback', () => {
    expect(keyErrorText(refusal(409, 'security-key-limit'), 'security-key')).toMatch(/5 security keys/);
    expect(keyErrorText(new TypeError('Failed to fetch'), 'security-key')).toBe('That security key was not added. Try again.');
    expect(keyErrorText(new TypeError('Failed to fetch'), 'passkey', 'That did not finish.')).toBe('That did not finish.');
  });

  it('review B1: passes copy-lint; the refused-model sentence comes from the refusal text map', () => {
    const file = 'apps/web/src/screens/auth/keyErrors.ts';
    expect(lintSource(readFileSync(new URL('../src/screens/auth/keyErrors.ts', import.meta.url), 'utf8'), file)).toEqual([]);
    expect(KEY_ERROR.notAccepted).toBe(KEY_MODEL_REFUSED_TEXT);
  });
});
