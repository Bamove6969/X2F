import { describe, expect, it } from 'vitest';
import { accountRating } from '../src/auth/rating.js';
import type { MethodCounts } from '../src/routes/account.js';

// Owner demo note #6 (16 Nov 2026): an account is "weak" when it logs in with only its login name,
// display name and password, and "secure" with those and at least one other way. The owner's 16 Nov
// TOTP decision: the authenticator app is only ever a password's second factor, so it counts only
// together with a password. A recovery code is a backup way in, never a second factor: it does not
// count (docs/trade-wallet-note6.md, Q6).

const none: MethodCounts = { pgp: 0, passkey: 0, securityKey: 0, password: false, totp: false, recoveryCodes: 0 };
const counts = (c: Partial<MethodCounts>): MethodCounts => ({ ...none, ...c });

describe('accountRating (owner demo note #6)', () => {
  it.each<[string, Partial<MethodCounts>, 'weak' | 'secure']>([
    ['a password alone', { password: true }, 'weak'],
    ['a password and recovery codes', { password: true, recoveryCodes: 1 }, 'weak'],
    ['a password and an authenticator app', { password: true, totp: true }, 'secure'],
    ['a password and a passkey', { password: true, passkey: 1 }, 'secure'],
    ['a password and a security key', { password: true, securityKey: 1 }, 'secure'],
    ['a password and a PGP key', { password: true, pgp: 1 }, 'secure'],
    ['a password, an authenticator app and recovery codes', { password: true, totp: true, recoveryCodes: 1 }, 'secure'],
    ['a PGP key alone (it stands alone, owner Q81)', { pgp: 1 }, 'secure'],
    ['a passkey alone', { passkey: 1 }, 'secure'],
    ['a security key alone', { securityKey: 2 }, 'secure'],
    ['every method', { password: true, totp: true, pgp: 2, passkey: 1, securityKey: 1, recoveryCodes: 1 }, 'secure'],
    ['an authenticator app without a password (never used to log in)', { totp: true }, 'weak'],
    ['recovery codes alone', { recoveryCodes: 1 }, 'weak'],
    ['no method at all (fails closed)', {}, 'weak'],
  ])('%s is %s', (_name, c, rating) => {
    expect(accountRating(counts(c))).toBe(rating);
  });
});
