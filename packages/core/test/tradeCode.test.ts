import { describe, expect, test } from 'vitest';
import { newTradeCode, normalizeTradeCode } from '@x2f/core';

const TRADE_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

describe('newTradeCode', () => {
  test('matches Crockford base32 grouped format', () => {
    expect(newTradeCode()).toMatch(TRADE_CODE_RE);
  });

  test('10,000 calls give 10,000 distinct codes', () => {
    const codes = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      codes.add(newTradeCode());
    }
    expect(codes.size).toBe(10_000);
  });

  test('all 32 symbols occur over 2,000 codes', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2_000; i++) {
      for (const ch of newTradeCode().replaceAll('-', '')) seen.add(ch);
    }
    expect([...seen].sort().join('')).toBe(ALPHABET);
  });

  test('generated codes are already normalized (idempotent)', () => {
    for (let i = 0; i < 100; i++) {
      const code = newTradeCode();
      expect(normalizeTradeCode(code)).toBe(code);
    }
  });
});

describe('normalizeTradeCode', () => {
  test('uppercases and groups', () => {
    expect(normalizeTradeCode('k7m2 9qxa-4ftr8wpn')).toBe(
      'K7M2-9QXA-4FTR-8WPN',
    );
  });

  test('maps O to 0, I to 1, L to 1', () => {
    expect(normalizeTradeCode('O1L0-0000-0000-0000')).toBe(
      '0110-0000-0000-0000',
    );
    expect(normalizeTradeCode('olio-0000-0000-0000')).toBe(
      '0110-0000-0000-0000',
    );
  });

  test('returns null for too few characters', () => {
    expect(normalizeTradeCode('K7M2-9QXA-4FTR')).toBeNull();
  });

  test('returns null for 17 characters', () => {
    expect(normalizeTradeCode('K7M2-9QXA-4FTR-8WPNA')).toBeNull();
  });

  test('returns null for empty and separator-only input', () => {
    expect(normalizeTradeCode('')).toBeNull();
    expect(normalizeTradeCode(' - - ')).toBeNull();
  });

  test('returns null for input containing U (either case)', () => {
    expect(normalizeTradeCode('U7M2-9QXA-4FTR-8WPN')).toBeNull();
    expect(normalizeTradeCode('u7m2-9qxa-4ftr-8wpn')).toBeNull();
  });

  test('accepts tab and newline as separators', () => {
    expect(normalizeTradeCode('K7M2\t9QXA\n4FTR\r\n8WPN')).toBe(
      'K7M2-9QXA-4FTR-8WPN',
    );
  });

  test('returns null for other invalid characters', () => {
    expect(normalizeTradeCode('K7M2-9QXA-4FTR-8WP!')).toBeNull();
    expect(normalizeTradeCode('K7M2_9QXA_4FTR_8WPN')).toBeNull();
  });

  test('rejects non-ASCII input that would uppercase into valid chars', () => {
    expect(normalizeTradeCode('ßßßß-ßßßß-ßßßß-ßßßß')).toBeNull();
    // Kelvin sign (U+212A) uppercases/lowercases to K
    expect(normalizeTradeCode('K7M2-9QXA-4FTR-8WPN')).toBeNull();
    // non-ASCII whitespace is not a separator
    expect(normalizeTradeCode('K7M2 9QXA-4FTR-8WPN')).toBeNull();
    // dotless/dotted i variants
    expect(normalizeTradeCode('ı000-0000-0000-0000')).toBeNull();
  });

  test('is idempotent', () => {
    const once = normalizeTradeCode('k7m2 9qxa-4ftr8wpn');
    expect(once).not.toBeNull();
    expect(normalizeTradeCode(once as string)).toBe(once);
  });
});
