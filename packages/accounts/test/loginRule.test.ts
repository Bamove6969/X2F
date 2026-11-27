import { describe, expect, it } from 'vitest';
import { enoughMethods } from '../src/loginRule.js';

describe('login rule (owner, 26 Nov 2026)', () => {
  it('needs two different kinds, one of them a key', () => {
    expect(enoughMethods(['passkey'])).toBe(false);
    expect(enoughMethods(['totp'])).toBe(false);
    expect(enoughMethods(['passkey', 'passkey'])).toBe(false);
    expect(enoughMethods(['passkey', 'totp'])).toBe(true);
    expect(enoughMethods(['pgp', 'security-key'])).toBe(true);
    expect(enoughMethods(['pgp', 'passkey', 'security-key', 'totp'])).toBe(true);
  });
  it('never counts recovery codes', () => {
    expect(enoughMethods(['passkey', 'recovery-codes'])).toBe(false);
    expect(enoughMethods(['totp', 'recovery-codes'])).toBe(false);
  });
});
