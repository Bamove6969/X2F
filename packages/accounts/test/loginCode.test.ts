import { describe, expect, test } from 'vitest';
import { formatRecoveryInput, newLoginCode, newRecoveryCode, normalizeLoginCode, normalizeRecoveryCode } from '@x2f/accounts';

// Owner demo notes, 12 Nov 2026: the PGP login code is 4 times as long (48 symbols, 12 groups;
// it was 12) and the recovery code about 4 times as long (64 symbols, 16 groups; it was 16).
const LOGIN_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){11}$/;
const RECOVERY_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){15}$/;
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

  test('a code issued before 12 Nov (12 symbols) still normalizes in its own form', () => {
    expect(normalizeLoginCode(' k7m2 9qxa-4ftr ')).toBe('K7M2-9QXA-4FTR');
  });

  test('a 48-symbol code normalizes from any spacing and case', () => {
    const c = newLoginCode();
    expect(normalizeLoginCode(c.toLowerCase().replaceAll('-', ' '))).toBe(c);
    expect(normalizeLoginCode(c.replaceAll('-', ''))).toBe(c);
    // One symbol short or long of either length is refused.
    expect(normalizeLoginCode(c.replaceAll('-', '').slice(1))).toBeNull();
    expect(normalizeLoginCode(`${c}X`)).toBeNull();
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
    expect(normalizeLoginCode('0'.repeat(201))).toBeNull();
  });
});

describe('recovery codes', () => {
  test('newRecoveryCode format', () => {
    expect(newRecoveryCode()).toMatch(RECOVERY_RE);
  });

  test('newRecoveryCode codes are 320 bits, distinct and already normalized', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const c = newRecoveryCode();
      expect(c.replaceAll('-', '')).toHaveLength(64);
      expect(normalizeRecoveryCode(c)).toBe(c);
      seen.add(c);
    }
    expect(seen.size).toBe(200);
  });

  test('normalizeRecoveryCode', () => {
    // A code of the old 16-symbol format keeps working in its old form.
    expect(normalizeRecoveryCode('k7m29qxa4ftr8wpn')).toBe('K7M2-9QXA-4FTR-8WPN');
    expect(normalizeRecoveryCode('k7m29qxa4ftr')).toBeNull();
    const c = newRecoveryCode();
    expect(normalizeRecoveryCode(c.toLowerCase().replaceAll('-', ''))).toBe(c);
    expect(normalizeRecoveryCode(c.replaceAll('-', ' '))).toBe(c);
    expect(normalizeRecoveryCode(c.replaceAll('-', '').slice(1))).toBeNull();
    expect(normalizeRecoveryCode(`${c}0`)).toBeNull();
    expect(normalizeRecoveryCode(`${c.slice(0, -1)}U`)).toBeNull();
  });

  test('formatRecoveryInput puts the dashes in as the code is typed or pasted', () => {
    expect(formatRecoveryInput('')).toBe('');
    expect(formatRecoveryInput('k7m')).toBe('K7M');
    expect(formatRecoveryInput('k7m2')).toBe('K7M2');
    expect(formatRecoveryInput('k7m29')).toBe('K7M2-9');
    // Typed dashes and spaces are the user's; the box puts its own in the right places.
    expect(formatRecoveryInput('K7M2-9QX A4-FT')).toBe('K7M2-9QXA-4FT');
    // A pasted code comes out exactly as shown, and nothing past 64 symbols is kept.
    const c = newRecoveryCode();
    expect(formatRecoveryInput(c.toLowerCase().replaceAll('-', ''))).toBe(c);
    expect(formatRecoveryInput(` ${c} `)).toBe(c);
    expect(formatRecoveryInput(`${c}ABCD`)).toBe(c);
    // Characters outside the code's alphabet are dropped (U, punctuation, non-ASCII).
    expect(formatRecoveryInput('k7u!m2é')).toBe('K7M2');
  });
});
