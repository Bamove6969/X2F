// @vitest-environment happy-dom
// Task 28 units: the Welcome summary, the password checklist, the fingerprint grouping, the
// register-error mapping, the step paths (returnTo always through safeReturnTo), and the Terms text
// and copy rules.
import { describe, expect, it } from 'vitest';
import type { Wallet } from '@x2f/auth-client';
import { ApiCallError } from '../src/api/client.js';
import { stepPath } from '../src/screens/setup/kit.js';
import { passwordRules } from '../src/screens/setup/Password.js';
import { groupFingerprint } from '../src/screens/setup/PgpKey.js';
import { nameError, termsChanged } from '../src/screens/setup/register.js';
import { TERMS } from '../src/screens/setup/termsText.js';
import { FEE_SENTENCE, summarize } from '../src/screens/setup/Welcome.js';

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

describe('summarize (Welcome rows)', () => {
  it('reads the flow first: the method just set up and the backup just added', () => {
    expect(summarize({ methods: ['password', 'totp'] }, [wallet()], { registered: true, method: 'password', backup: 'totp' })).toEqual({
      loginWith: 'Password',
      backup: 'Authenticator app',
      paidTo: { app: 'Cake Wallet', end: 'k3Fz' },
    });
    // A second PGP key is not visible in the methods list; the flow knows.
    expect(summarize({ methods: ['pgp'] }, [], { registered: true, method: 'pgp', backup: 'pgp' }).backup).toBe('Second PGP key');
  });

  it('without the flow (a reload), reads the account: PGP first, then the other methods as the backup', () => {
    expect(summarize({ methods: ['pgp', 'security-key'] }, [], fresh)).toMatchObject({ loginWith: 'PGP key', backup: 'Security key', paidTo: null });
    expect(summarize({ methods: ['security-key'] }, [], fresh)).toMatchObject({ loginWith: 'Security key', backup: 'None yet' });
    expect(summarize({ methods: ['password', 'recovery-codes'] }, [], fresh)).toMatchObject({ loginWith: 'Password', backup: 'Recovery codes' });
    expect(summarize({ methods: [] }, [], fresh)).toMatchObject({ loginWith: 'None yet', backup: 'None yet' });
  });

  it('"You get paid to" shows only a usable wallet, never one still waiting', () => {
    expect(summarize({ methods: ['pgp'] }, [wallet({ usable: false })], fresh).paidTo).toBeNull();
    expect(summarize({ methods: ['pgp'] }, [wallet({ usable: false }), wallet({ app: 'edge', addressEnd: 'Q9x2', usable: true })], fresh).paidTo).toEqual({
      app: 'Edge',
      end: 'Q9x2',
    });
  });
});

describe('passwordRules', () => {
  it('ticks each board line as it is met; ok only with every rule and a match', () => {
    expect(passwordRules('', '')).toEqual({ length: false, cases: false, numberSymbol: false, match: false, ok: false });
    expect(passwordRules('short', 'short')).toMatchObject({ length: false, match: true, ok: false });
    expect(passwordRules('alllowercase-1', 'alllowercase-1')).toMatchObject({ length: true, cases: false, numberSymbol: true, ok: false });
    expect(passwordRules('Orbit-lantern', 'Orbit-lantern')).toMatchObject({ cases: true, numberSymbol: false, ok: false });
    expect(passwordRules('Orbit-lantern-74', 'Orbit-lantern-7')).toMatchObject({ length: true, cases: true, numberSymbol: true, match: false, ok: false });
    expect(passwordRules('Orbit-lantern-74', 'Orbit-lantern-74').ok).toBe(true);
  });
});

describe('groupFingerprint', () => {
  it('groups of four with a wider gap half way, upper case', () => {
    expect(groupFingerprint('3f2a9c417b0ed5a261c80e4b92d71f6ac3b80d15')).toBe('3F2A 9C41 7B0E D5A2 61C8  0E4B 92D7 1F6A C3B8 0D15');
  });
});

describe('register errors', () => {
  it('maps the name refusals (FU-A and the main line) and nothing else', () => {
    expect(nameError(new ApiCallError(409, 'display-name-taken'))).toBe('That username is taken. Pick another.');
    expect(nameError(new ApiCallError(409, 'username-taken'))).toBe('That username is taken. Pick another.');
    expect(nameError(new ApiCallError(409, 'names-unavailable'))).toBe('Those names cannot be used. Pick others.');
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
  it('the fee sentence is OD-7 word for word', () => {
    expect(FEE_SENTENCE).toBe('You pay X2F 1% of each completed trade from your own ads. Taking an offer is free.');
  });

  it('the Terms draft carries the fee sentence and has no exclamation marks', () => {
    const all = TERMS.flatMap((s) => [s.heading, ...s.paragraphs]).join('\n');
    expect(all).toContain(FEE_SENTENCE);
    expect(all).not.toContain('!');
  });
});
