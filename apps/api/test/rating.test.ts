import { describe, expect, it } from 'vitest';
import { accountRating } from '../src/auth/rating.js';
import type { MethodCounts } from '../src/routes/account.js';

// Owner demo note #6 (16 Nov 2026) and his answers of 17 Nov (docs/trade-wallet-note6.md): three
// levels. "weak": login name, display name and password only (a recovery code is a backup way in and
// does not count, Q6). "medium": a password with the authenticator app ("User/pass/display name/otp is
// kinda like medium security"); the app is only ever a password's second factor (16 Nov), so without a
// password it counts for nothing. "high": a passkey, PGP key or security key, with or without a
// password ("as long as they have a username, a display name, and either a passkey, PGP key, or
// security key, then their account is rated as highly secure").

const none: MethodCounts = { pgp: 0, passkey: 0, securityKey: 0, password: false, totp: false, recoveryCodes: 0 };
const counts = (c: Partial<MethodCounts>): MethodCounts => ({ ...none, ...c });

describe('accountRating (owner demo note #6)', () => {
  it.each<[string, Partial<MethodCounts>, 'weak' | 'medium' | 'high']>([
    ['a password alone', { password: true }, 'weak'],
    ['a password and recovery codes', { password: true, recoveryCodes: 1 }, 'weak'],
    ['a password and an authenticator app', { password: true, totp: true }, 'medium'],
    ['a password and a passkey', { password: true, passkey: 1 }, 'high'],
    ['a password and a security key', { password: true, securityKey: 1 }, 'high'],
    ['a password and a PGP key', { password: true, pgp: 1 }, 'high'],
    ['a password, an authenticator app and recovery codes', { password: true, totp: true, recoveryCodes: 1 }, 'medium'],
    ['a PGP key alone (it stands alone, owner Q81)', { pgp: 1 }, 'high'],
    ['a passkey alone', { passkey: 1 }, 'high'],
    ['a security key alone', { securityKey: 2 }, 'high'],
    ['every method', { password: true, totp: true, pgp: 2, passkey: 1, securityKey: 1, recoveryCodes: 1 }, 'high'],
    ['an authenticator app without a password (never used to log in)', { totp: true }, 'weak'],
    ['recovery codes alone', { recoveryCodes: 1 }, 'weak'],
    ['no method at all (fails closed)', {}, 'weak'],
  ])('%s is %s', (_name, c, rating) => {
    expect(accountRating(counts(c))).toBe(rating);
  });
});
