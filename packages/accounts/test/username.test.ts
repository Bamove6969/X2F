import { describe, expect, test } from 'vitest';
import { checkUsername } from '@x2f/accounts';

describe('checkUsername', () => {
  test('accepts a valid name, keeps it as typed, lower-cases the key', () => {
    expect(checkUsername('Satoshi.N')).toEqual({ ok: true, username: 'Satoshi.N', key: 'satoshi.n' });
  });

  test('length: under 5 or over 20', () => {
    expect(checkUsername('abcd')).toEqual({ ok: false, reason: 'length' });
    expect(checkUsername('a'.repeat(21))).toEqual({ ok: false, reason: 'length' });
    expect(checkUsername('a'.repeat(20))).toMatchObject({ ok: true });
    expect(checkUsername('abcde')).toMatchObject({ ok: true });
  });

  test('characters: spaces, accents, look-alike Cyrillic', () => {
    expect(checkUsername('bob smith')).toEqual({ ok: false, reason: 'characters' });
    expect(checkUsername('bób12')).toEqual({ ok: false, reason: 'characters' });
    expect(checkUsername('аlice')).toEqual({ ok: false, reason: 'characters' });
  });

  test.each(['X2F.Support', 'the_admin', 'Moder-ator', 'adminbob', 'staff_42', 'livesupport', 'owner'])(
    'reserved: %s',
    (name) => {
      expect(checkUsername(name)).toEqual({ ok: false, reason: 'reserved' });
    },
  );

  test.each(['badminton', 'Sadmina', 'helper99', 'rootbeer', 'modular'])('not reserved: %s', (name) => {
    expect(checkUsername(name)).toEqual({ ok: true, username: name, key: name.toLowerCase() });
  });

  test('Alice and alice share one key', () => {
    const a = checkUsername('alice');
    const b = checkUsername('Alice');
    expect(a.ok && b.ok && a.key === b.key).toBe(true);
  });
});
