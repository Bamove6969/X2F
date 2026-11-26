// Task 30 re-review (items 2 and 3): one wording for a wait after too many
// tries, a refused PGP key and an expired step, whichever client the error came from.
import { describe, expect, it } from 'vitest';
import { AuthApiError } from '@x2f/auth-client';
import { ApiCallError } from '../src/api/client.js';
import { KEY_EXPIRED, KEY_REVOKED, LOGIN_NAME_SET, SECURITY_KEY_LIMIT, STEP_EXPIRED, isExpired, momentText, refusalText, waitSentence } from '../src/screens/auth/refusals.js';

const NOW = new Date('2026-10-26T15:00:00Z');
const FALLBACK = 'Could not do that. Try again.';

describe('waitSentence', () => {
  it('counts minutes up to an hour, rounding up, at least one', () => {
    expect(waitSentence(1)).toBe('Too many tries. Try again in 1 minute.');
    expect(waitSentence(61)).toBe('Too many tries. Try again in 2 minutes.');
    expect(waitSentence(3600)).toBe('Too many tries. Try again in 60 minutes.');
  });

  it('gives a clock time for a longer wait (the TOTP backup daily cap)', () => {
    expect(waitSentence(9 * 3600, NOW)).toBe(`Too many tries. Try again after ${momentText(new Date('2026-10-27T00:00:00Z'))}.`);
  });

  it('a missing wait reads as a minute, never "in NaN"', () => {
    expect(waitSentence(undefined)).toBe('Too many tries. Try again in 1 minute.');
  });
});

describe('refusalText', () => {
  for (const [name, make] of [
    ['AuthApiError', (status: number, code: string, extra: Record<string, unknown> = {}) => new AuthApiError(status, code as never, extra)],
    ['ApiCallError', (status: number, code: string, extra: Record<string, unknown> = {}) => new ApiCallError(status, code, extra)],
  ] as const) {
    it(`reads a ${name} the same way`, () => {
      expect(refusalText(make(429, 'slow-down', { retryAfterSeconds: 300 }), FALLBACK)).toBe('Too many tries. Try again in 5 minutes.');
      expect(refusalText(make(429, 'locked', { retryAfterSeconds: 120 }), FALLBACK)).toBe('Too many tries. Try again in 2 minutes.');
      expect(refusalText(make(400, 'key-expired'), FALLBACK)).toBe(KEY_EXPIRED);
      expect(refusalText(make(400, 'key-revoked'), FALLBACK)).toBe(KEY_REVOKED);
      expect(refusalText(make(400, 'key-weak', { detail: 'That key is RSA 2048; X2F needs RSA 4096 or Ed25519.' }), FALLBACK)).toBe('That key is RSA 2048; X2F needs RSA 4096 or Ed25519.');
      expect(refusalText(make(400, 'challenge-expired'), FALLBACK)).toBe(STEP_EXPIRED);
      expect(refusalText(make(400, 'challenge-expired'), FALLBACK, { expired: 'That message has expired.' })).toBe('That message has expired.');
      expect(refusalText(make(401, 'code-invalid'), FALLBACK)).toBe(FALLBACK);
      // FU-A: the security-key cap (Security settings, add a key) and a login name already chosen.
      expect(refusalText(make(409, 'security-key-limit'), FALLBACK)).toBe(SECURITY_KEY_LIMIT);
      expect(refusalText(make(409, 'login-name-set'), FALLBACK)).toBe(LOGIN_NAME_SET);
      expect(isExpired(make(400, 'challenge-expired'))).toBe(true);
      expect(isExpired(make(401, 'code-invalid'))).toBe(false);
    });
  }

  it('a network failure gets the fallback', () => {
    expect(refusalText(new TypeError('Failed to fetch'), FALLBACK)).toBe(FALLBACK);
  });
});

describe('isOnlyLogin (item 7: refused before any confirm)', () => {
  const e = (type: string, id = type) => ({ type, id, label: type, createdAt: null, lastUsedAt: null }) as never;
  it('a sole login method is refused; a backup method never counts as one', async () => {
    const { isOnlyLogin } = await import('../src/screens/settings/Methods.js');
    expect(isOnlyLogin(e('passkey'), [e('passkey'), e('totp'), e('recovery-codes')])).toBe(true);
    expect(isOnlyLogin(e('passkey'), [e('passkey'), e('security-key')])).toBe(false);
    expect(isOnlyLogin(e('totp'), [e('passkey'), e('totp')])).toBe(false);
    expect(isOnlyLogin(e('pgp', 'a'), [e('pgp', 'a'), e('pgp', 'b')])).toBe(false);
    // A cold import of the Methods screen takes 4-8 s under a full parallel run.
  }, 30_000);
});
