import { describe, expect, test } from 'vitest';
import { LOOK_ALIKE_LETTERS, NAME_MAX, NAME_MIN, NEW_NAME_MIN, checkDisplayName, checkLoginName, checkNames, checkNewDisplayName, checkNewLoginName, displayKeyOf, lookAlikeKey, staffNameKey } from '@x2f/accounts';

describe('checkDisplayName', () => {
  test('accepts a valid name, keeps it as typed, lower-cases the key', () => {
    expect(checkDisplayName('Satoshi.N')).toEqual({ ok: true, name: 'Satoshi.N', key: 'satoshi.n' });
  });

  test('length (a stored name): under 5 or over 20', () => {
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

  // Review of third-signup-r3 (16 Nov 2026), B1: invisible characters (Unicode
  // Default_Ignorable_Code_Point) are refused, whatever their category: the Hangul fillers are
  // letters (Lo), the variation selectors and joiners are combining marks (Mn).
  test.each([
    ['Hangul fillers only (renders blank)', '\u3164\u3164\u3164\u3164\u3164'],
    ['a Hangul filler standing in for a space', 'Bob\u3164Smith'],
    ['a half-width Hangul filler', 'Bob\uffa0Smith'],
    ['a Hangul choseong filler', 'Bob\u115fSmith'],
    ['a Hangul jungseong filler', 'Bob\u1160Smith'],
    ['choseong and jungseong fillers only (renders blank)', '\u115f\u1160\u115f\u1160\u115f'],
    ['a variation selector after a letter (looks exactly like "alice")', 'alice\ufe0f'],
    ['a variation selector supplement', 'alice\u{e0100}'],
    ['a combining grapheme joiner', 'alic\u034fe.k'],
    ['a Mongolian free variation selector', 'alice\u180b'],
    ['a word joiner', 'bob\u2060smith'],
    ['a soft hyphen', 'bob\u00adsmith'],
  ])('refused, invisible: %s', (_what, name) => {
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

  // Review of third-signup-r3, M1: Latin look-alikes that NFKD leaves alone (dotless i, small
  // capitals, Latin alpha) are folded too, so a reserved word written with them is still reserved.
  test.each(['admın.bob', 'ᴀᴅᴍɪɴ bob', 'ɑdmin bob', 'Admın Desk', 'ꜱᴜᴘᴘᴏʀᴛ', 'ꜱᴛᴀꜰꜰ #1', 'x2ꜰ team', 'ʀᴏᴏᴛ.user', 'ɢuest ʜelp'])(
    'reserved, with a Latin look-alike NFKD does not fold: %s',
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

  // Lead, 12 Nov 2026 (review of the first-trade tour, B1): the tour's example traders are named
  // example_seller and example_buyer, so no real account may take those names or a look-alike.
  test.each(['example_seller', 'example_buyer', 'Example_Seller', 'EXAMPLE.BUYER', 'example-seller', 'exampleseller', 'examp1e_se11er', 'exarnple_buyer'])(
    'reserved example name: %s',
    (name) => {
      expect(checkDisplayName(name)).toEqual({ ok: false, reason: 'reserved' });
    },
  );

  test.each(['example_sellers', 'my_example', 'example.k', 'buyer_one', 'seller_42'])('not reserved: %s (only the two example names)', (name) => {
    expect(checkDisplayName(name)).toEqual({ ok: true, name, key: name.toLowerCase() });
  });

  test('Alice and alice share one key', () => {
    const a = checkDisplayName('alice');
    const b = checkDisplayName('Alice');
    expect(a.ok && b.ok && a.key === b.key).toBe(true);
  });

  test('not a string reads as characters', () => {
    expect(checkDisplayName(42 as unknown as string)).toEqual({ ok: false, reason: 'characters' });
  });
});

// Owner demo note #108 (17 Nov 2026): "Do not allow spaces in username or passwords or display
// names". New and changed display names only; checkDisplayName (finding and showing a stored name)
// still takes one, so an account named before the rule keeps working.
describe('checkNewDisplayName', () => {
  test.each([
    ['a space', 'Bob Smith'],
    ['runs of spaces (collapsed, still one inside)', 'Bob   Smith'],
    ['a space in another script', 'Привет мир'],
    ['a space beside symbols', 'R&B Trader'],
  ])('refuses %s inside the name', (_what, name) => {
    expect(checkNewDisplayName(name)).toEqual({ ok: false, reason: 'spaces' });
  });

  test('other white space stays a refused character, as before', () => {
    for (const name of ['Bob\tSmith', 'Bob\nSmith', 'Bob\u00a0Smith', 'Bob\u3000Smith']) expect(checkNewDisplayName(name), JSON.stringify(name)).toEqual({ ok: false, reason: 'characters' });
  });

  test('trims spaces at the ends, as before, and otherwise follows checkDisplayName', () => {
    expect(checkNewDisplayName('  Satoshi.N  ')).toEqual({ ok: true, name: 'Satoshi.N', key: 'satoshi.n' });
    expect(checkNewDisplayName('abcd')).toEqual({ ok: false, reason: 'length' });
    expect(checkNewDisplayName('the_admin')).toEqual({ ok: false, reason: 'reserved' });
    // A reserved name keeps its own reason even with a space in it.
    expect(checkNewDisplayName('X2F Support')).toEqual({ ok: false, reason: 'reserved' });
    expect(checkNewDisplayName('bob<smith>')).toEqual({ ok: false, reason: 'characters' });
  });

  test('a stored name with a space is still a valid name to look up (checkDisplayName is unchanged)', () => {
    expect(checkDisplayName('Bob Smith')).toEqual({ ok: true, name: 'Bob Smith', key: 'bob smith' });
  });

  test('owner demo note #127: a new display name is 8 to 20 characters; a stored 5-7 one still looks up', () => {
    expect(NEW_NAME_MIN).toBe(8);
    expect(checkNewDisplayName('abcdefg')).toEqual({ ok: false, reason: 'length' });
    expect(checkNewDisplayName('mira.k')).toEqual({ ok: false, reason: 'length' });
    expect(checkNewDisplayName('abcdefgh')).toEqual({ ok: true, name: 'abcdefgh', key: 'abcdefgh' });
    expect(checkNewDisplayName('a'.repeat(20))).toMatchObject({ ok: true });
    expect(checkNewDisplayName('a'.repeat(21))).toEqual({ ok: false, reason: 'length' });
    // Counted in code points after NFC and trimming, as the stored rule.
    expect(checkNewDisplayName('  abcdefg  ')).toEqual({ ok: false, reason: 'length' });
    expect(checkNewDisplayName('東京の取引者です')).toMatchObject({ ok: true });
    expect(checkNewDisplayName('Zoe\u0308.kim')).toEqual({ ok: false, reason: 'length' });
    // A stored 5-7 character name (before #127) is still a valid name to look up and show.
    for (const name of ['mira.k', 'demo_cy', 'abcde']) expect(checkDisplayName(name), name).toMatchObject({ ok: true });
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

  test('owner demo note #126: a stored 5-7 character login name still parses, so its account logs in', () => {
    expect(NAME_MIN).toBe(5);
    expect(NAME_MAX).toBe(20);
    for (const name of ['abcde', 'cy-demo', 'ana.k1']) expect(checkLoginName(name), name).toMatchObject({ ok: true });
  });
});

describe('checkNewLoginName (owner demo note #126: "minimum of 8 characters")', () => {
  test('8 to 20 characters', () => {
    expect(checkNewLoginName('abcdefg')).toEqual({ ok: false, reason: 'length' });
    expect(checkNewLoginName('cy-demo')).toEqual({ ok: false, reason: 'length' });
    expect(checkNewLoginName('ana-demo')).toEqual({ ok: true, name: 'ana-demo', key: 'ana-demo' });
    expect(checkNewLoginName('a'.repeat(20))).toMatchObject({ ok: true });
    expect(checkNewLoginName('a'.repeat(21))).toEqual({ ok: false, reason: 'length' });
    expect(checkNewLoginName('a'.repeat(65))).toEqual({ ok: false, reason: 'length' });
  });

  test('the same characters as checkLoginName', () => {
    expect(checkNewLoginName('bob smith')).toEqual({ ok: false, reason: 'characters' });
    expect(checkNewLoginName('cash$king')).toEqual({ ok: false, reason: 'characters' });
    expect(checkNewLoginName('Quiet.Fox_7')).toEqual({ ok: true, name: 'Quiet.Fox_7', key: 'quiet.fox_7' });
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
    expect(checkNames('Alice.bb', 'A1ice.bb')).toMatchObject({ ok: true });
  });

  test('note #108: a new account\'s display name holds no spaces', () => {
    expect(checkNames('Bob Smith', 'quiet.fox')).toEqual({ ok: false, field: 'displayName', reason: 'spaces' });
    expect(checkNames('  BobSmith  ', 'quiet.fox')).toMatchObject({ ok: true, display: { name: 'BobSmith' } });
  });

  test('the display name is checked first, then the login name', () => {
    expect(checkNames('abc', 'quiet.fox')).toEqual({ ok: false, field: 'displayName', reason: 'length' });
    expect(checkNames('the_admin', 'quiet.fox')).toEqual({ ok: false, field: 'displayName', reason: 'reserved' });
    expect(checkNames('Satoshi.N', 'bad name')).toEqual({ ok: false, field: 'loginName', reason: 'characters' });
  });

  test('owner demo notes #126 and #127: both new names are at least 8 characters', () => {
    expect(checkNames('mira.k.7', 'quiet.fo')).toMatchObject({ ok: true });
    expect(checkNames('Satoshi', 'quiet.fox')).toEqual({ ok: false, field: 'displayName', reason: 'length' });
    expect(checkNames('Satoshi.N', 'quiet.f')).toEqual({ ok: false, field: 'loginName', reason: 'length' });
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

// Review of third-signup-r3, M1: the extra fold table. Every entry is one lower-case Latin letter
// that NFKD leaves alone, mapped to the plain a-z letter it is drawn like.
describe('LOOK_ALIKE_LETTERS (the reviewed fold table)', () => {
  const entries = Object.entries(LOOK_ALIKE_LETTERS);

  test('every entry maps one lower-case letter to one of a-z, and NFKD does not already fold it', () => {
    expect(entries.length).toBeGreaterThan(40);
    for (const [from, to] of entries) {
      expect([...from], from).toHaveLength(1);
      expect(to, from).toMatch(/^[a-z]$/);
      expect(from.toLowerCase(), from).toBe(from);
      expect(from.normalize('NFKD').replace(/\p{M}/gu, ''), from).toBe(from);
    }
  });

  test.each([
    ['ı', 'i'], ['ȷ', 'j'], ['ɑ', 'a'], ['ɡ', 'g'], ['ɩ', 'i'], ['ɪ', 'i'], ['ʟ', 'l'], ['ɴ', 'n'], ['ʀ', 'r'], ['ʏ', 'y'],
    ['ᴀ', 'a'], ['ʙ', 'b'], ['ᴄ', 'c'], ['ᴅ', 'd'], ['ᴇ', 'e'], ['ꜰ', 'f'], ['ɢ', 'g'], ['ʜ', 'h'], ['ᴊ', 'j'], ['ᴋ', 'k'],
    ['ᴍ', 'm'], ['ᴏ', 'o'], ['ᴘ', 'p'], ['ꞯ', 'q'], ['ꜱ', 's'], ['ᴛ', 't'], ['ᴜ', 'u'], ['ᴠ', 'v'], ['ᴡ', 'w'], ['ᴢ', 'z'],
    ['ꞵ', 'b'], ['ł', 'l'], ['đ', 'd'], ['ø', 'o'], ['ħ', 'h'], ['ŧ', 't'], ['ƀ', 'b'], ['ɨ', 'i'], ['ɛ', 'e'],
  ])('%s folds like %s', (from, to) => {
    expect(lookAlikeKey(`x${from}x`)).toBe(lookAlikeKey(`x${to}x`));
  });

  test('capitals fold through their lower case (Ɑ, Ɡ, Ɪ, Ł)', () => {
    expect(lookAlikeKey('Ɑdmin')).toBe(lookAlikeKey('admin'));
    expect(lookAlikeKey('Ɡuest')).toBe(lookAlikeKey('guest'));
    expect(lookAlikeKey('Ɪlya')).toBe(lookAlikeKey('ilya'));
    expect(lookAlikeKey('Łuke')).toBe(lookAlikeKey('luke'));
  });

  test('invisible characters are dropped from the fold (defence in depth for B1)', () => {
    expect(lookAlikeKey('ali\u034fce\ufe0f')).toBe(lookAlikeKey('alice'));
  });
});

// Review of third-signup-r3, M2: the staff and owner comparison ignores punctuation and spaces,
// like the reserved-word check does.
describe('staffNameKey', () => {
  test.each(['Mira,K', 'Mira K', 'Mira_K', 'Mira-K', 'Mira:K', "Mira'K", 'MiraK', 'Mıra.K', 'M1ra (K)', 'ᴍɪʀᴀ.ᴋ'])(
    '%s compares equal to the staff name Mira.K',
    (name) => {
      expect(staffNameKey(name)).toBe(staffNameKey('Mira.K'));
    },
  );

  test('different letters still differ', () => {
    expect(staffNameKey('Mira.Kay')).not.toBe(staffNameKey('Mira.K'));
    expect(staffNameKey('Myra.K')).not.toBe(staffNameKey('Mira.K'));
  });
});

// Port of the review of second-signup-r3 (B1, M1, M2; 8eaeff43 and 98df26e1) to main's ASCII
// display names (lead call 18 Nov): main's checkDisplayName stays, so every invisible character
// and every non-ASCII look-alike is refused as `characters`; the fold and staffNameKey below are
// what the API compares staff and owner names by.
describe('review B1 and M1 on main: invisible and look-alike characters in a display name', () => {
  test.each([
    ['Hangul fillers only (renders blank)', '\u3164\u3164\u3164\u3164\u3164'],
    ['a Hangul filler standing in for a space', 'Bob\u3164Smith'],
    ['a half-width Hangul filler', 'Bob\uffa0Smith'],
    ['a Hangul choseong filler', 'Bob\u115fSmith'],
    ['a Hangul jungseong filler', 'Bob\u1160Smith'],
    ['choseong and jungseong fillers only (renders blank)', '\u115f\u1160\u115f\u1160\u115f'],
    ['a variation selector after a letter (looks exactly like "alice")', 'alice\ufe0f'],
    ['a variation selector supplement', 'alice\u{e0100}'],
    ['a combining grapheme joiner', 'alic\u034fe.k'],
    ['a Mongolian free variation selector', 'alice\u180b'],
    ['a word joiner', 'bob\u2060smith'],
    ['a soft hyphen', 'bob\u00adsmith'],
  ])('refused, invisible: %s', (_what, name) => {
    expect(checkDisplayName(name)).toEqual({ ok: false, reason: 'characters' });
  });

  test.each(['admın.bob', 'ᴀᴅᴍɪɴ_bob', 'ɑdmin.bob', 'Admın_Desk', 'ꜱᴜᴘᴘᴏʀᴛ', 'ꜱᴛᴀꜰꜰ_1', 'x2ꜰ.team', 'ʀᴏᴏᴛ.user', 'ɢuest.ʜelp'])(
    'refused, a Latin look-alike NFKD does not fold: %s',
    (name) => {
      // Since signup round 3 (merged onto main, notes-integ) these are Latin letters a display name
      // may hold, so the refusal is the reserved-word fold (LOOK_ALIKE_LETTERS), no longer the ASCII rule.
      expect(checkDisplayName(name)).toEqual({ ok: false, reason: 'reserved' });
    },
  );
});

// Review M1: the extra fold table. Every entry is one lower-case Latin letter that NFKD leaves
// alone, mapped to the plain a-z letter it is drawn like.
describe('LOOK_ALIKE_LETTERS (the reviewed fold table)', () => {
  const entries = Object.entries(LOOK_ALIKE_LETTERS);

  test('every entry maps one lower-case letter to one of a-z, and NFKD does not already fold it', () => {
    expect(entries.length).toBeGreaterThan(40);
    for (const [from, to] of entries) {
      expect([...from], from).toHaveLength(1);
      expect(to, from).toMatch(/^[a-z]$/);
      expect(from.toLowerCase(), from).toBe(from);
      expect(from.normalize('NFKD').replace(/\p{M}/gu, ''), from).toBe(from);
    }
  });

  test.each([
    ['ı', 'i'], ['ȷ', 'j'], ['ɑ', 'a'], ['ɡ', 'g'], ['ɩ', 'i'], ['ɪ', 'i'], ['ʟ', 'l'], ['ɴ', 'n'], ['ʀ', 'r'], ['ʏ', 'y'],
    ['ᴀ', 'a'], ['ʙ', 'b'], ['ᴄ', 'c'], ['ᴅ', 'd'], ['ᴇ', 'e'], ['ꜰ', 'f'], ['ɢ', 'g'], ['ʜ', 'h'], ['ᴊ', 'j'], ['ᴋ', 'k'],
    ['ᴍ', 'm'], ['ᴏ', 'o'], ['ᴘ', 'p'], ['ꞯ', 'q'], ['ꜱ', 's'], ['ᴛ', 't'], ['ᴜ', 'u'], ['ᴠ', 'v'], ['ᴡ', 'w'], ['ᴢ', 'z'],
    ['ꞵ', 'b'], ['ł', 'l'], ['đ', 'd'], ['ø', 'o'], ['ħ', 'h'], ['ŧ', 't'], ['ƀ', 'b'], ['ɨ', 'i'], ['ɛ', 'e'],
  ])('%s folds like %s', (from, to) => {
    expect(lookAlikeKey(`x${from}x`)).toBe(lookAlikeKey(`x${to}x`));
  });

  test('capitals fold through their lower case (Ɑ, Ɡ, Ɪ, Ł)', () => {
    expect(lookAlikeKey('Ɑdmin')).toBe(lookAlikeKey('admin'));
    expect(lookAlikeKey('Ɡuest')).toBe(lookAlikeKey('guest'));
    expect(lookAlikeKey('Ɪlya')).toBe(lookAlikeKey('ilya'));
    expect(lookAlikeKey('Łuke')).toBe(lookAlikeKey('luke'));
  });

  test('invisible characters are dropped from the fold (defence in depth for B1)', () => {
    expect(lookAlikeKey('ali\u034fce\ufe0f')).toBe(lookAlikeKey('alice'));
    expect(lookAlikeKey('bob\u3164smith')).toBe(lookAlikeKey('bobsmith'));
  });
});

// Review M2: the staff and owner comparison ignores punctuation and spaces, like the reserved-word
// check does.
describe('staffNameKey', () => {
  test.each(['Mira,K', 'Mira K', 'Mira_K', 'Mira-K', 'Mira:K', "Mira'K", 'MiraK', 'Mıra.K', 'M1ra (K)', 'ᴍɪʀᴀ.ᴋ'])(
    '%s compares equal to the staff name Mira.K',
    (name) => {
      expect(staffNameKey(name)).toBe(staffNameKey('Mira.K'));
    },
  );

  test('different letters still differ', () => {
    expect(staffNameKey('Mira.Kay')).not.toBe(staffNameKey('Mira.K'));
    expect(staffNameKey('Myra.K')).not.toBe(staffNameKey('Mira.K'));
  });
});

// Security review of wip/lead-notes-all (23 Nov 2026), M1: look-alikes from scripts the old fold did
// not know (Lisu, Cherokee, Armenian, Coptic, Canadian syllabics). Reserved words and staff names
// are compared by the UTS #39 confusables skeleton (confusables.ts, Unicode 16.0.0), and a name
// mixes scripts only as UTS #39's "highly restrictive" level allows (Latin with Han, Hiragana,
// Katakana, Hangul or Bopomofo; every other script stands alone).
describe('review M1: the UTS #39 skeleton and the highly restrictive script rule', () => {
  test.each([
    ['all-Lisu ADMIN', 'ꓮꓓꓟꓲꓠ'],
    ['Lisu S in support', 'ꓢupport'],
    ['Lisu SUPPORT alone', 'ꓢꓴꓑꓑꓳꓣꓔ'],
    ['Cherokee S in support', 'Ꮪupport'],
    ['Armenian o in moderator', 'mօderator'],
    ['Armenian o in support', 'suppօrt'],
    ['Coptic alfa in admin', 'ⲁdmin'],
    ['Coptic o in support', 'suppⲟrt'],
    ['Canadian syllabics in admin', 'adᐅin'],
    ['a Devanagari digit in x2f', 'x२f_team'],
    ['Cherokee look-alike of the staff name Mira.K', 'Ꮇira.Ꮶ'],
  ])('refused: %s', (_what, name) => {
    const r = checkNewDisplayName(name);
    expect(r.ok, name).toBe(false);
    expect(['reserved', 'characters']).toContain((r as { reason: string }).reason);
  });

  test('the skeleton finds reserved words spelt wholly in another script', () => {
    expect(checkDisplayName('ꓮꓓꓟꓲꓠ')).toEqual({ ok: false, reason: 'reserved' });
    expect(checkDisplayName('ꓢꓴꓑꓑꓳꓣꓔ')).toEqual({ ok: false, reason: 'reserved' });
  });

  test('staff names: a Cherokee look-alike folds to the same key as the Latin one', () => {
    expect(staffNameKey('ᎷᎥᏒᎪ.Ꮶ')).toBe(staffNameKey('MIRA.K'));
    expect(staffNameKey('Ꮇira.Ꮶ')).toBe(staffNameKey('Mira.K'));
    // The API compares stored keys (lower case): a small Cherokee letter folds like its capital.
    expect(staffNameKey('Ꮇira.Ꮶ'.toLowerCase())).toBe(staffNameKey('mira.k'));
  });

  test.each(['Tokyo東京', 'Sakuraさくら', 'Kimチム', 'Lee이민호', 'Wangㄅㄆ', '東京の取引者', 'Привет мир', 'Ἀθηνᾶ', 'Ölaf_Ünal', 'Ꮳ Ꮻ Ꭿ Ꮭ', 'Աննա_Սարգսյան'])(
    'still allowed (one script, or Latin with the CJK scripts): %s',
    (name) => {
      expect(checkDisplayName(name)).toMatchObject({ ok: true });
    },
  );

  test.each([
    ['Latin with Armenian', 'Anna Սարգսյան'],
    ['Latin with Cherokee', 'Mira Ꮶ'],
    ['Cyrillic with Han', 'Иван東京'],
    ['Hangul with Hiragana', '이민호さくら'],
  ])('refused, scripts mixed beyond the highly restrictive level: %s', (_what, name) => {
    expect(checkDisplayName(name)).toEqual({ ok: false, reason: 'characters' });
  });
});

// Security review of wip/lead-notes-all, L3 and L4: a display name's key is a full case fold
// (NFKC_Casefold's effect: NFKC, upper then lower case, final sigma as sigma), so names that differ
// only by case or a compatibility form are one name; displayKeyOf (a stored name looked up as is)
// trims and collapses spaces as checkDisplayName does.
describe('review L3/L4: the display key is a full case fold', () => {
  test.each([
    ['ΑΒΓΔΣ', 'αβγδσ'],
    ['αβγδς', 'αβγδσ'],
    ['ﬀabcd', 'ffabcd'],
    ['Straße', 'STRASSE'],
    ['Ǆabcd', 'ǆabcd'],
    ['ǅabcd', 'DŽABCD'],
  ])('%s and %s have one key', (a, b) => {
    const ka = checkDisplayName(a);
    const kb = checkDisplayName(b);
    expect(ka.ok && kb.ok).toBe(true);
    expect((ka as { key: string }).key).toBe((kb as { key: string }).key);
    expect(displayKeyOf(a)).toBe((ka as { key: string }).key);
  });

  test('the key is NFKC, upper then lower case, with final sigma as sigma', () => {
    expect(displayKeyOf('ΑΒΓΔΣ')).toBe('αβγδσ');
    expect(displayKeyOf('ﬀabcd')).toBe('ffabcd');
    expect(displayKeyOf('Straße')).toBe('strasse');
  });

  test('displayKeyOf trims and collapses spaces as checkDisplayName does (L4)', () => {
    expect(displayKeyOf('  Bob   Smith ')).toBe('bob smith');
    expect(displayKeyOf('  Bob   Smith ')).toBe((checkDisplayName('Bob Smith') as { key: string }).key);
  });
});
