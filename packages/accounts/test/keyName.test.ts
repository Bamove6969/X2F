// Owner 25 Nov security-key report: a security key (or passkey) is named after it is saved. The
// web and the API check the name with the same rule (checkKeyName).
import { describe, expect, test } from 'vitest';
import { KEY_NAME_MAX, checkKeyName, defaultKeyName } from '@x2f/accounts';

describe('checkKeyName', () => {
  test('trims, folds runs of spaces and NFC-normalises', () => {
    expect(checkKeyName('  Blue   YubiKey 5 ')).toEqual({ ok: true, name: 'Blue YubiKey 5' });
    expect(checkKeyName('Clé USB-C')).toEqual({ ok: true, name: 'Clé USB-C' });
    expect(checkKeyName("Bob's (NFC) #2, a/b: A&B+C_d.e’")).toEqual({ ok: true, name: "Bob's (NFC) #2, a/b: A&B+C_d.e’" });
    expect(checkKeyName('Ключ 1')).toEqual({ ok: true, name: 'Ключ 1' });
  });

  test('1 to 32 code points', () => {
    expect(checkKeyName('')).toEqual({ ok: false, problem: 'empty' });
    expect(checkKeyName('   ')).toEqual({ ok: false, problem: 'empty' });
    expect(checkKeyName('a')).toEqual({ ok: true, name: 'a' });
    expect(KEY_NAME_MAX).toBe(32);
    expect(checkKeyName('x'.repeat(32))).toEqual({ ok: true, name: 'x'.repeat(32) });
    expect(checkKeyName('x'.repeat(33))).toEqual({ ok: false, problem: 'too-long' });
    // Counted in code points, not UTF-16 units.
    expect(checkKeyName('𝒳'.repeat(32)).ok).toBe(true);
    expect(checkKeyName('𝒳'.repeat(33))).toEqual({ ok: false, problem: 'too-long' });
  });

  test('control, format and other characters are refused', () => {
    for (const bad of ['a\nb', 'a\tb', 'a\u0000', 'a‮b', 'a​b', '<script>', 'key!', 'a"b', 'a;b', 'a b', 'key\u{1F511}', 'a=b', 'a@b']) {
      expect(checkKeyName(bad), JSON.stringify(bad)).toEqual({ ok: false, problem: 'characters' });
    }
  });
});

describe('defaultKeyName', () => {
  test('"Security key N" and "Passkey N", from 1', () => {
    expect(defaultKeyName('security-key', 1)).toBe('Security key 1');
    expect(defaultKeyName('security-key', 3)).toBe('Security key 3');
    expect(defaultKeyName('passkey', 2)).toBe('Passkey 2');
    expect(defaultKeyName('passkey', 0)).toBe('Passkey 1');
    expect(defaultKeyName('security-key', Number.NaN)).toBe('Security key 1');
  });
});
