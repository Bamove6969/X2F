// HKDF-SHA-256 against RFC 5869's test vectors; libsignal's HKDFv3 is RFC 5869 with a 32-zero-byte salt when none is given.
import { describe, expect, it } from 'vitest';
import { hkdf, hmac, ZERO_SALT } from '../src/kdf.js';

describe('hkdf', () => {
  it('RFC 5869 test case 1', () => {
    const okm = hkdf(Buffer.alloc(22, 0x0b), Buffer.from('f0f1f2f3f4f5f6f7f8f9', 'hex'), 42, Buffer.from('000102030405060708090a0b0c', 'hex'));
    expect(okm.toString('hex')).toBe('3cb25f25faacd57a90434f64d0362f2a2d2d0a90cf1a5a4c5db02d56ecc4c5bf34007208d5b887185865');
  });

  it('RFC 5869 test case 3 (no salt, no info) equals a 32-zero-byte salt (HMAC pads a short key with zeros)', () => {
    const expected = '8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d9d201395faa4b61a96c8';
    expect(hkdf(Buffer.alloc(22, 0x0b), '', 42).toString('hex')).toBe(expected);
    expect(hkdf(Buffer.alloc(22, 0x0b), '', 42, ZERO_SALT).toString('hex')).toBe(expected);
    expect(hkdf(Buffer.alloc(22, 0x0b), '', 42, Buffer.alloc(0)).toString('hex')).toBe(expected);
  });

  it('hmac is HMAC-SHA-256 (RFC 4231 test case 2) over the concatenation of its parts', () => {
    const key = Buffer.from('Jefe');
    const expected = '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843';
    expect(hmac(key, Buffer.from('what do ya want for nothing?')).toString('hex')).toBe(expected);
    expect(hmac(key, Buffer.from('what do ya want '), Buffer.from('for nothing?')).toString('hex')).toBe(expected);
  });
});

