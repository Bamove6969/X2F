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

  // Signup round 3, lead call (13 Nov 2026): printable Unicode letters, digits, spaces and common
  // punctuation and symbols; NFC, trimmed, runs of spaces collapsed; the same 5-20 length.
  test.each(['bob smith', 'bób12', 'Cash$King', 'R&B Trader', 'Hi! Is it?', "O'Brien, J.", 'name@home', '#1 fan', '100% Legit', 'a*b+c (x): y', 'Ölaf_Ünal', 'Привет мир', 'Ἀθηνᾶ', '東京の取引者', 'Zoë-Ann'])(
    'allowed: %s',
    (name) => {
      expect(checkDisplayName(name)).toEqual({ ok: true, name: name.normalize('NFC'), key: name.normalize('NFC').toLowerCase() });
    },
  );

  test('normalised: NFC, trimmed, runs of spaces collapsed; the length is counted after that', () => {
    expect(checkDisplayName('  Bob   Smith  ')).toEqual({ ok: true, name: 'Bob Smith', key: 'bob smith' });
    // "o" + combining diaeresis becomes one precomposed letter.
    expect(checkDisplayName('Zoe\u0308.k')).toEqual({ ok: true, name: 'Zo\u00eb.k', key: 'zo\u00eb.k' });
    expect(checkDisplayName('   abcd   ')).toEqual({ ok: false, reason: 'length' });
  });

  test.each([
    ['a control character', 'bob\u0007smith'],
    ['a tab', 'bob\tsmith'],
    ['a newline', 'bob\nsmith'],
    ['a zero-width space', 'bob\u200bsmith'],
    ['a zero-width joiner', 'bob\u200dsmith'],
    ['a byte-order mark', '\ufeffbobsmith'],
    ['a right-to-left override', 'bob\u202esmith'],
    ['a right-to-left isolate', 'bob\u2067smith'],
    ['a right-to-left mark', 'bob\u200fsmith'],
    ['Hebrew letters (they change the text direction)', 'שלום עולם'],
    ['Arabic letters (they change the text direction)', 'مرحبا بكم'],
    ['a symbol outside the list', 'bob<smith>'],
    ['a backslash', 'bob\\smith'],
    ['a slash', 'bob/smith'],
    ['a quote mark', 'bob"smith'],
    ['an emoji', 'bob\u{1F600}smith'],
    ['a non-breaking space', 'bob\u00a0smith'],
    ['a private-use character', 'bob\ue000smith'],
    ['a lone combining mark first', '\u0301bobsmith'],
    ['stacked combining marks', 'bo\u0301\u0302\u0303\u0304b'],
    ['symbols only', '$$$$$'],
  ])('refused, %s', (_what, name) => {
    expect(checkDisplayName(name)).toEqual({ ok: false, reason: 'characters' });
  });

  test('look-alike scripts mixed in one name are refused (Cyrillic or Greek with Latin)', () => {
    expect(checkDisplayName('аlice')).toEqual({ ok: false, reason: 'characters' });
    expect(checkDisplayName('Alicе Bob')).toEqual({ ok: false, reason: 'characters' });
    expect(checkDisplayName('bοb.smith')).toEqual({ ok: false, reason: 'characters' });
    // Latin with a script that does not look like it is fine.
    expect(checkDisplayName('Tokyo東京')).toMatchObject({ ok: true });
  });

  test.each(['X2F Support', 'the admin', '@admin', 'Admin$', 'Ａｄｍｉｎ.bob', 'ádmin', 'support!', 'Staff #1', 'x2f (official)'])(
    'reserved, with the new characters and look-alikes: %s',
    (name) => {
      expect(checkDisplayName(name)).toEqual({ ok: false, reason: 'reserved' });
    },
  );

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
  // Signup round 3: the username keeps the strict set (ASCII letters, digits, ".", "-", "_").
  test.each(['bob smith', 'cash$king', 'bób12', 'name@home', 'Привет.мир', 'bob\u200bsmith'])('the strict set refuses %s', (name) => {
    expect(checkLoginName(name)).toEqual({ ok: false, reason: 'characters' });
  });

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

  test('signup round 3: also folds accents, full-width forms and Cyrillic or Greek look-alikes', () => {
    expect(lookAlikeKey('Ålice')).toBe(lookAlikeKey('alice'));
    expect(lookAlikeKey('Ａｌｉｃｅ')).toBe(lookAlikeKey('alice'));
    expect(lookAlikeKey('аlicе')).toBe(lookAlikeKey('alice'));
    expect(lookAlikeKey('ροκο')).toBe(lookAlikeKey('poko'));
  });
});
