import { describe, expect, it } from 'vitest';
import { type MethodType, METHOD_PARTNERS, partnerMissing, partnerNeededBy } from '@x2f/accounts';

// Owner decision, 16 Nov 2026 (to-lead.log 17:38): the authenticator app (TOTP) is the password
// login's second factor, so an account has it only together with a password. It reverses signup
// round 3 behaviour 1 (TOTP with a PGP key, passkey or security key and no password).
describe('methods that go only with another (owner, 16 Nov 2026)', () => {
  it('TOTP goes with a password, and nothing else goes with anything', () => {
    expect(METHOD_PARTNERS).toEqual({ totp: 'password' });
  });

  it('partnerMissing: TOTP without a password is missing it; with one, or any other method, nothing is', () => {
    expect(partnerMissing('totp', [])).toBe('password');
    expect(partnerMissing('totp', ['pgp', 'passkey', 'security-key', 'recovery-codes'])).toBe('password');
    expect(partnerMissing('totp', ['password'])).toBeNull();
    for (const m of ['pgp', 'passkey', 'security-key', 'password', 'recovery-codes'] as MethodType[]) expect(partnerMissing(m, [])).toBeNull();
  });

  it('partnerNeededBy: the password cannot go while TOTP is on; without TOTP it can, and nothing else is held', () => {
    expect(partnerNeededBy('password', ['password', 'totp'])).toBe('totp');
    expect(partnerNeededBy('password', ['password', 'pgp'])).toBeNull();
    expect(partnerNeededBy('totp', ['password', 'totp'])).toBeNull();
    expect(partnerNeededBy('pgp', ['pgp', 'password', 'totp'])).toBeNull();
  });
});
