import { describe, expect, test } from 'vitest';
import { checkPassword, normalizePassword } from '@x2f/accounts';

describe('checkPassword', () => {
  test('accepts a strong password', () => {
    expect(checkPassword('Correct-Horse-9')).toEqual({ ok: true });
  });

  test('reports each missing rule', () => {
    expect(checkPassword('short1!A')).toEqual({ ok: false, missing: ['length'] });
    expect(checkPassword('alllowercase1!')).toEqual({ ok: false, missing: ['upper'] });
    expect(checkPassword('NoNumbers!!xx')).toEqual({ ok: false, missing: ['number'] });
    expect(checkPassword('NoSymbols123x')).toEqual({ ok: false, missing: ['symbol'] });
  });

  test('over 256 characters is too-long', () => {
    const r = checkPassword('Aa1!' + 'x'.repeat(253));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.missing).toContain('too-long');
    expect(checkPassword('Aa1!' + 'x'.repeat(252))).toEqual({ ok: true });
  });

  test('raw input over 1024 code units is refused early as too-long only', () => {
    expect(checkPassword('Aa1!'.repeat(257))).toEqual({ ok: false, missing: ['too-long'] });
    expect(checkPassword('x'.repeat(1_000_000))).toEqual({ ok: false, missing: ['too-long'] });
  });

  test('accepts Unicode letters', () => {
    expect(checkPassword('Ünïcödé-Pass1')).toEqual({ ok: true });
  });

  test('counts code points after NFC, not UTF-16 units', () => {
    // 'e' + combining acute composes to one code point, leaving 9.
    expect(checkPassword('Ab1!éxxxx')).toEqual({ ok: false, missing: ['length'] });
    // An astral symbol is one code point (two UTF-16 units): 9 code points.
    expect(checkPassword('Ab1\u{1F600}xxxxx')).toEqual({ ok: false, missing: ['length'] });
    expect(checkPassword('Ab1\u{1F600}xxxxxx')).toEqual({ ok: true });
  });

  test('whitespace is not a symbol', () => {
    expect(checkPassword('No Symbols 123x')).toEqual({ ok: false, missing: ['symbol'] });
  });
});

describe('normalizePassword', () => {
  test('NFC', () => {
    expect(normalizePassword('é')).toBe('é');
  });
});
