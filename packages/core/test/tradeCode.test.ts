import { describe, expect, test } from 'vitest';
import { newTradeCode, normalizeTradeCode } from '../src/index.ts';

const CODE = /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}$/;

describe('newTradeCode', () => {
  test('is 16 Crockford base32 characters in four groups', () => {
    expect(newTradeCode()).toMatch(CODE);
  });

  test('10,000 calls give 10,000 distinct codes', () => {
    const codes = new Set(Array.from({ length: 10_000 }, newTradeCode));
    expect(codes.size).toBe(10_000);
  });
});

describe('normalizeTradeCode', () => {
  test('accepts lower case, spaces and missing dashes', () => {
    expect(normalizeTradeCode('k7m2 9qxa-4ftr8wpn')).toBe('K7M2-9QXA-4FTR-8WPN');
  });

  test('maps look-alikes O to 0 and I, L to 1', () => {
    expect(normalizeTradeCode('O1L0-0000-0000-0000')).toBe('0110-0000-0000-0000');
    expect(normalizeTradeCode('i000-0000-0000-0000')).toBe('1000-0000-0000-0000');
  });

  test('refuses the wrong length', () => {
    expect(normalizeTradeCode('K7M2-9QXA-4FTR')).toBeNull();
    expect(normalizeTradeCode('K7M2-9QXA-4FTR-8WPNX')).toBeNull();
  });

  test('refuses U and other invalid characters', () => {
    expect(normalizeTradeCode('U7M2-9QXA-4FTR-8WPN')).toBeNull();
    expect(normalizeTradeCode('K7M2-9QXA-4FTR-8WP!')).toBeNull();
  });
});
