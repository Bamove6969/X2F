import { describe, expect, it } from 'vitest';
import { stepOf, totpCode } from '../demo/totp.js';

describe('demo authenticator codes', () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890", last 6 of the 8-digit codes.
  const SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches the RFC vector at t=%i', (t, code) => {
    expect(totpCode(SECRET, stepOf(t * 1000))).toBe(code);
  });
});
