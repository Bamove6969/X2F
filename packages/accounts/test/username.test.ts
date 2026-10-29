import { describe, expect, test } from 'vitest';
import { checkDisplayName, checkLoginName, checkNames, lookAlikeKey } from '@x2f/accounts';

describe('checkDisplayName', () => {
  test('accepts a valid name, keeps it as typed, lower-cases the key', () => {
    expect(checkDisplayName('Satoshi.N')).toEqual({ ok: true, name: 'Satoshi.N', key: 'satoshi.n' });
  });

  test('length: under 5 or over 20', () => {
    expect(checkDisplayName('abcd')).toEqual({ ok: false, reason: 'length' });
    expect(checkDisplayName('a'.repeat(21))).toEqual({ ok: false, reason: 'length' });
    expect(checkDisplayName('a'.repeat(20))).toMatchObject({ ok: true });
    expect(checkDisplayName('abcde')).toMatchObject({ ok: true });
  });

  test('characters: spaces, accents, look-alike Cyrillic', () => {
    expect(checkDisplayName('bob smith')).toEqual({ ok: false, reason: 'characters' });
    expect(checkDisplayName('bób12')).toEqual({ ok: false, reason: 'characters' });
    expect(checkDisplayName('аlice')).toEqual({ ok: false, reason: 'characters' });
  });

  test('very long raw input is refused as length before any other work', () => {
    expect(checkDisplayName('a'.repeat(65))).toEqual({ ok: false, reason: 'length' });
    expect(checkDisplayName('а'.repeat(100_000))).toEqual({ ok: false, reason: 'length' });
  });

  test.each(['X2F.Support', 'the_admin', 'Moder-ator', 'adminbob', 'staff_42', 'livesupport', 'owner', 'staffer1', 'x2fbob'])(
    'reserved: %s',
    (name) => {
      expect(checkDisplayName(name)).toEqual({ ok: false, reason: 'reserved' });
    },
  );

  // F4 (owner, 2026-10-23): 0/o, 1/l/i and rn/m count as the same letters against reserved names.
  test.each(['adm1n.team', 'Moderat0r', 'supp0rt', 'ADMlN.bob', 'x2f.0fficial', '0fficial', 'the_rnod', 'Adrnin.k', 'sysTern', 'r00t.user', 'he1p.desk', '0wner'])(
    'reserved look-alike: %s',
    (name) => {
      expect(checkDisplayName(name)).toEqual({ ok: false, reason: 'reserved' });
    },
  );

  test.each(['badminton', 'Sadmina', 'helper99', 'rootbeer', 'modular', 'm0nero.fan', 'Ilya.k', 'llya.k', 'A1ice.b', 'Jo1ly'])(
    'not reserved: %s',
    (name) => {
      expect(checkDisplayName(name)).toEqual({ ok: true, name, key: name.toLowerCase() });
    },
  );

  test('Alice and alice share one key', () => {
    const a = checkDisplayName('alice');
    const b = checkDisplayName('Alice');
    expect(a.ok && b.ok && a.key === b.key).toBe(true);
  });

  test('not a string reads as characters', () => {
    expect(checkDisplayName(42 as unknown as string)).toEqual({ ok: false, reason: 'characters' });
  });
});

describe('checkLoginName', () => {
  test('the same character and length rules', () => {
    expect(checkLoginName('Quiet.Fox_7')).toEqual({ ok: true, name: 'Quiet.Fox_7', key: 'quiet.fox_7' });
    expect(checkLoginName('abcd')).toEqual({ ok: false, reason: 'length' });
    expect(checkLoginName('a'.repeat(21))).toEqual({ ok: false, reason: 'length' });
    expect(checkLoginName('bob smith')).toEqual({ ok: false, reason: 'characters' });
    expect(checkLoginName('a'.repeat(65))).toEqual({ ok: false, reason: 'length' });
  });

  test('reserved words are not refused: the login name is never shown to anyone', () => {
    expect(checkLoginName('my.admin.name')).toMatchObject({ ok: true });
  });
});

describe('checkNames', () => {
  test('two valid names that differ', () => {
    expect(checkNames('Satoshi.N', 'quiet.fox')).toEqual({
      ok: true, display: { name: 'Satoshi.N', key: 'satoshi.n' }, login: { name: 'quiet.fox', key: 'quiet.fox' },
    });
  });

  test('the same name in any case is refused', () => {
    expect(checkNames('Satoshi.N', 'satoshi.n')).toEqual({ ok: false, field: 'loginName', reason: 'same' });
    expect(checkNames('Satoshi.N', 'Satoshi.N')).toEqual({ ok: false, field: 'loginName', reason: 'same' });
  });

  test('look-alikes of each other are allowed (folding is only against staff and reserved names)', () => {
    expect(checkNames('Alice.b', 'A1ice.b')).toMatchObject({ ok: true });
  });

  test('the display name is checked first, then the login name', () => {
    expect(checkNames('abc', 'quiet.fox')).toEqual({ ok: false, field: 'displayName', reason: 'length' });
    expect(checkNames('the_admin', 'quiet.fox')).toEqual({ ok: false, field: 'displayName', reason: 'reserved' });
    expect(checkNames('Satoshi.N', 'bad name')).toEqual({ ok: false, field: 'loginName', reason: 'characters' });
  });
});

describe('lookAlikeKey', () => {
  test('folds case, 0/o, 1/l/i and rn/m', () => {
    expect(lookAlikeKey('Adm1n')).toBe('admln');
    expect(lookAlikeKey('ADMIN')).toBe('admln');
    expect(lookAlikeKey('Moderat0r')).toBe('moderator');
    expect(lookAlikeKey('Kim.Lorn')).toBe('klm.lom');
    expect(lookAlikeKey('kim.l0m')).toBe('klm.lom');
    expect(lookAlikeKey('x2f')).toBe('x2f');
  });
});
