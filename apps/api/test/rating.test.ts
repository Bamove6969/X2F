import { describe, expect, it } from 'vitest';
import { accountRating } from '../src/auth/rating.js';
import type { MethodCounts } from '../src/routes/account.js';

// Owner demo note #6 (16 Nov 2026) and his answers of 17 Nov (docs/trade-wallet-note6.md), with no
// passwords since 26 Nov 2026: "high" is a passkey, PGP key or security key; anything less is "weak"
// ("medium" was a password with the authenticator app and is never given now).

const none: MethodCounts = { pgp: 0, passkey: 0, securityKey: 0, totp: false, recoveryCodes: 0 };
const counts = (c: Partial<MethodCounts>): MethodCounts => ({ ...none, ...c });

describe('accountRating (owner demo note #6)', () => {
  it.each<[string, Partial<MethodCounts>, 'weak' | 'high']>([
    ['a PGP key alone (it stands alone, owner Q81)', { pgp: 1 }, 'high'],
    ['a passkey alone', { passkey: 1 }, 'high'],
    ['a security key alone', { securityKey: 2 }, 'high'],
    ['every method', { totp: true, pgp: 2, passkey: 1, securityKey: 1, recoveryCodes: 1 }, 'high'],
    ['an authenticator app alone (it logs in with the login name, owner 27 Nov 2026, but never confirms)', { totp: true }, 'weak'],
    ['recovery codes alone', { recoveryCodes: 1 }, 'weak'],
    ['no method at all (fails closed)', {}, 'weak'],
  ])('%s is %s', (_name, c, rating) => {
    expect(accountRating(counts(c))).toBe(rating);
  });
});
