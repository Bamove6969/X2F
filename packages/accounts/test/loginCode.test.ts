import { describe, expect, test } from 'vitest';
import { newLoginCode, newRecoveryCode, normalizeLoginCode, normalizeRecoveryCode } from '@x2f/accounts';

const LOGIN_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){2}$/;
const RECOVERY_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

describe('login codes', () => {
  test('newLoginCode format', () => {
    for (let i = 0; i < 100; i++) expect(newLoginCode()).toMatch(LOGIN_RE);
  });

  test('newLoginCode codes are distinct and already normalized', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const c = newLoginCode();
      expect(normalizeLoginCode(c)).toBe(c);
      seen.add(c);
    }
    expect(seen.size).toBe(1000);
  });

  test('all 32 symbols occur over 2,000 codes', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) for (const ch of newLoginCode().replaceAll('-', '')) seen.add(ch);
    expect([...seen].sort().join('')).toBe(ALPHABET);
  });

  test('normalizeLoginCode maps like trade codes', () => {
    expect(normalizeLoginCode(' k7m2 9qxa-4ftr ')).toBe('K7M2-9QXA-4FTR');
    expect(normalizeLoginCode('o1il-0000-0000')).toBe('0111-0000-0000');
  });

  test('normalizeLoginCode rejects wrong length and bad characters', () => {
    expect(normalizeLoginCode('K7M29QXA4FT')).toBeNull();
    expect(normalizeLoginCode('K7M29QXA4FTRX')).toBeNull();
    expect(normalizeLoginCode('')).toBeNull();
    expect(normalizeLoginCode('K7M2-9QXA-4FTU')).toBeNull();
    expect(normalizeLoginCode('K7M2-9QXA-4FTß')).toBeNull();
    expect(normalizeLoginCode('K7M2-9QXA-4FTK')).toBeNull();
    expect(normalizeLoginCode('x'.repeat(65))).toBeNull();
  });
});

describe('recovery codes', () => {
  test('newRecoveryCode format', () => {
    expect(newRecoveryCode()).toMatch(RECOVERY_RE);
  });

  test('normalizeRecoveryCode', () => {
    expect(normalizeRecoveryCode('k7m29qxa4ftr8wpn')).toBe('K7M2-9QXA-4FTR-8WPN');
    expect(normalizeRecoveryCode('k7m29qxa4ftr')).toBeNull();
  });
});
