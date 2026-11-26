// @vitest-environment happy-dom
// Task 28 units: the Welcome summary, the password checklist, the fingerprint grouping, the
// register-error mapping, the step paths (returnTo always through safeReturnTo), and the Terms text
// and copy rules.
import { describe, expect, it } from 'vitest';
import { AuthApiError, type Wallet } from '@x2f/auth-client';
import { ApiCallError } from '../src/api/client.js';
import * as BackupStep from '../src/screens/setup/Backup.js';
import { stepPath } from '../src/screens/setup/kit.js';
import { groupFingerprint } from '../src/screens/setup/PgpKey.js';
import { KEY_UNAVAILABLE } from '../src/screens/auth/refusals.js';
import { KEY_IN_USE, nameError, setupError, termsChanged } from '../src/screens/setup/register.js';
import { TERMS_TEXT_VERSION } from '../src/screens/setup/termsText.js';
import { KEY_POINTS, paragraphText, TERMS } from '../src/screens/setup/termsText.js';
import { FEE_SENTENCE } from '../src/screens/post/offerForm.js';
import { startTradingPath } from '../src/screens/setup/Welcome.js';

const wallet = (over: Partial<Wallet> = {}): Wallet => ({
  id: 'w1',
  app: 'cake',
  label: 'Wallet 1',
  address: `4${'9'.repeat(90)}k3Fz`,
  addressEnd: 'k3Fz',
  usableFrom: '2026-10-25T00:00:00.000Z',
  usable: true,
  ...over,
});

const fresh = { registered: false, method: 'pgp' as const, backup: null };

describe('Start trading (owner G25: after sign-up, log in again)', () => {
  it('right after sign-up the sign-up session ends and Log in comes next, carrying where Start trading goes', () => {
    expect(startTradingPath({ registered: true, usable: true, returnTo: '/post' })).toEqual({ logOut: true, to: '/login?returnTo=%2Fpost' });
    // No usable wallet: Add a wallet still comes first, after the login.
    expect(startTradingPath({ registered: true, usable: false, returnTo: '/post' })).toEqual({
      logOut: true,
      to: `/login?returnTo=${encodeURIComponent('/wallets?add=1&returnTo=%2Fpost')}`,
    });
  });

  it('someone already logged in (setup opened only for a wallet) stays logged in', () => {
    expect(startTradingPath({ registered: false, usable: true, returnTo: '/post' })).toEqual({ logOut: false, to: '/post' });
    expect(startTradingPath({ registered: false, usable: false, returnTo: '/post' })).toEqual({ logOut: false, to: '/wallets?add=1&returnTo=%2Fpost' });
  });
});

describe('setup backups', () => {
  it('setup offers no authenticator app as a backup; lead call (12 Nov 2026): it offers no backup but the recovery code', () => {
    // The list of optional backups is gone with its step (signupV2.test.tsx renders the step and finds no other backup).
    expect('BACKUPS' in BackupStep).toBe(false);
  });
});

// The Welcome rows became the owner's checklist (12 Nov 2026): ownerCopy1.test.tsx.

describe('groupFingerprint', () => {
  it('groups of four with a wider gap half way, upper case', () => {
    expect(groupFingerprint('3f2a9c417b0ed5a261c80e4b92d71f6ac3b80d15')).toBe('3F2A 9C41 7B0E D5A2 61C8  0E4B 92D7 1F6A C3B8 0D15');
  });
});

describe('register errors', () => {
  it("maps FU-A's name refusals from the typed client and nothing else", () => {
    // Owner Q54: the private login name is the "username", the public one the "display name".
    expect(nameError(new AuthApiError(409, 'display-name-taken'))).toBe('That display name is taken. Pick another.');
    expect(nameError(new AuthApiError(400, 'login-name-invalid'))).toBe('That username cannot be used. Pick another.');
    expect(nameError(new AuthApiError(400, 'names-same'))).toBe('Your display name must be different from your username.');
    expect(nameError(new AuthApiError(409, 'names-unavailable'))).toBe('Those names cannot be used. Pick others.');
    expect(nameError(new ApiCallError(409, 'username-taken'))).toBeNull();
    expect(nameError(new ApiCallError(400, 'password-weak'))).toBeNull();
    expect(nameError(new TypeError('network'))).toBeNull();
    expect(nameError(new ApiCallError(400, 'constructor'))).toBeNull();
  });

  it('spots Terms that changed during setup', () => {
    expect(termsChanged(new ApiCallError(400, 'terms-not-accepted', { version: 'v2' }))).toBe(true);
    expect(termsChanged(new ApiCallError(400, 'bad-request'))).toBe(false);
  });
});

describe('stepPath', () => {
  it('keeps returnTo, encoded, on every step', () => {
    expect(stepPath('', '/sell/zelle?take=offer-42')).toBe('/setup?returnTo=%2Fsell%2Fzelle%3Ftake%3Doffer-42');
    expect(stepPath('wallet', '/post')).toBe('/setup/wallet?returnTo=%2Fpost');
  });
});

describe('copy', () => {
  // The one PostOffer shows (review 12 Nov, C3: Welcome's copy of it is gone).
  it('the fee sentence is OD-7 word for word', () => {
    expect(FEE_SENTENCE).toBe('You pay X2F 1% of each completed trade from your own ads. Taking an offer is free.');
  });

  // 2026-11-12: the Terms' fee paragraph is the owner's own wording (his /setup comment 10475770);
  // 2026-11-14: reworded again by his demo notes of 13 Nov (setup-terms). It states the same rule
  // (OD-7, p10-1): the ad's poster pays 1%, responding to an ad is free.
  it('the Terms draft states the fee rule (poster pays 1%, responding is free) and has no exclamation marks', () => {
    const all = TERMS.flatMap((s) => [s.heading, ...s.paragraphs.flatMap((p) => (typeof p === 'string' ? [p] : [p.text, ...p.bullets]))]).join('\n');
    const fees = TERMS.find((s) => s.heading === '4. Fees')!.paragraphs.map(paragraphText).join('\n');
    expect(fees).toContain('X2F charges a 1% fee in XMR on completed trades. Whoever posts the ad pays the fee');
    expect(fees).toContain("responding to someone else's ad is always free");
    expect(all).not.toContain('!');
  });
});

describe('setupError (review fix round M1, M2, I1)', () => {
  const fallback = 'Try again.';
  it("shows the server's sentence about a refused key from the typed client", () => {
    expect(setupError(new AuthApiError(400, 'key-unreadable', { detail: 'That key has no signing subkey.' }), fallback)).toEqual({ text: 'That key has no signing subkey.' });
  });
  it('names a key already on another account, with the key-in-use links', () => {
    expect(setupError(new AuthApiError(409, 'key-in-use'), fallback)).toEqual({ text: KEY_IN_USE, keyInUse: true });
    // Lead review 2026-11-06 item 1: a banned key is refused only at the finish now, so the screen
    // offers a different key, never a new message (it would end the same way) nor Log in.
    expect(setupError(new AuthApiError(409, 'key-unavailable'), fallback)).toEqual({ text: KEY_UNAVAILABLE, keyRefused: true });
  });
  it('gives honest waits for slow-down and busy', () => {
    expect(setupError(new AuthApiError(429, 'slow-down', { retryAfterSeconds: 120 }), fallback).text).toBe('Too many tries. Try again in 2 minutes.');
    expect(setupError(new AuthApiError(503, 'busy', { retryAfterSeconds: 30 }), fallback).text).toBe('X2F is busy right now. Try again in 1 minute.');
    expect(setupError(new AuthApiError(503, 'busy'), fallback).text).toBe('X2F is busy right now. Try again in 1 minute.');
  });
  it('names refusals link back to the names screen; anything else is the fallback', () => {
    expect(setupError(new AuthApiError(409, 'display-name-taken'), fallback)).toEqual({ text: 'That display name is taken. Pick another.', names: 'display-name' });
    expect(setupError(new TypeError('network'), fallback)).toEqual({ text: fallback });
  });
});

describe('SetupTerms key points (build spec j33a section 1, S-043)', () => {
  it('ends with the 60-day line', () => {
    // Owner demo note #189 (25 Nov): the draft one-liners (awaiting his OK); the 60-day rule stays last.
    expect(KEY_POINTS.at(-1)).toBe('An account not signed into for 60 days or longer is closed automatically.');
  });

  it('are the six one-liners drafted for owner demo note #189', () => {
    expect(KEY_POINTS).toHaveLength(6);
    for (const k of KEY_POINTS) expect(k.length, k).toBeLessThanOrEqual(140);
    expect(KEY_POINTS[0]).toMatch(/2-of-3 multisig escrow/);
    expect(KEY_POINTS[1]).toBe('Whoever posts the ad pays a 1% fee when the trade completes. Taking an ad is free.');
  });
});

describe('Terms text version (review fix round M4)', () => {
  it('the bundled text names its version, a valid X2F_TERMS_VERSION (non-empty, at most 32 characters)', () => {
    expect(TERMS_TEXT_VERSION).toMatch(/^\S{1,32}$/);
  });
});
