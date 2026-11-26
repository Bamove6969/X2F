// Plan 4 Task 19: the training library's anonymizer (Review Focus 5). Every mask kind, the names
// case-insensitively and through zero-width characters, never inside a longer word, and nothing of
// the fixture's sensitive strings left in the scrubbed output.
import { describe, expect, it } from 'vitest';
import { MANUAL_MASK, MAX_TEXT, TRADE_CODE_MASK, anonymizeCase, anonymizeText, applyManualMasks, offsetLabel, type AnonymizeNames } from '../src/index.js';

const NAMES: AnonymizeNames = { buyer: ['mira.k'], seller: ['quietfox', 'qf-login'], staff: ['dmitri_k', 'lumen.k'] };
const BASE58 = '123456789ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
/** A made-up address-shaped string (never a real key): `len` base58 characters starting with `first`. */
function addressLike(first: '4' | '8', len: number, seed = 7): string {
  let s = first;
  let x = seed;
  for (let i = 1; i < len; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    s += BASE58[x % BASE58.length];
  }
  return s;
}
const ADDR = addressLike('4', 95);
const SUB = addressLike('8', 95, 11);
const INTEGRATED = addressLike('4', 106, 13);
const TX = 'a3'.repeat(32);
const CARD = '4111 1111 1111 1111';
const IBAN = 'DE89 3704 0044 0532 0130 00';
const CODE = 'K7M2-9QXA-4FTR-8WPN';

const scrub = (t: string) => anonymizeText(t, NAMES, [CODE]);

describe('anonymizeText', () => {
  it('replaces the usernames case-insensitively and through zero-width characters', () => {
    expect(scrub('MiRa.K paid, said mira.k.').text).toBe('Buyer paid, said Buyer.');
    expect(scrub('mi​ra.k and quiet﻿fox').text).toBe('Buyer and Seller');
    expect(scrub('qf-login wrote to dmitri_k and LUMEN.K').text).toBe('Seller wrote to Moderator and Moderator');
  });

  it('never masks a username inside a longer word', () => {
    expect(scrub('admira.kx is someone else').text).toBe('admira.kx is someone else');
    // (mira.kxyz would now read as a host name, re-review M2; the 3-letter suffix is checked with `_`.)
    expect(scrub('xmira.k and mira_kxyz').text).toBe('xmira.k and mira_kxyz');
  });

  it('replaces the trade code, with or without dashes, and any other grouped code', () => {
    expect(scrub(`Trade ${CODE} and k7m29qxa4ftr8wpn`).text).toBe(`Trade ${TRADE_CODE_MASK} and ${TRADE_CODE_MASK}`);
    expect(scrub('Also 3HW8-ZD2N-RT6K-Q9VB.').text).toBe(`Also ${TRADE_CODE_MASK}.`);
    // A long ordinary word is not a code.
    expect(scrub('responsibilities').text).toBe('responsibilities');
  });

  it('masks a Monero address, a subaddress and an integrated address', () => {
    for (const a of [ADDR, SUB, INTEGRATED]) {
      const s = scrub(`send to ${a} please`);
      expect(s.text).toBe('send to [address] please');
      expect(s.masks).toEqual([{ start: 8, end: 17, kind: 'address' }]);
    }
  });

  it('masks an address split by spaces or a line break', () => {
    const split = `${ADDR.slice(0, 40)}\n${ADDR.slice(40, 70)} ${ADDR.slice(70)}`;
    const s = scrub(`it was ${split}, thanks`);
    expect(s.text).toBe('it was [address], thanks');
    expect(s.text).not.toContain(ADDR.slice(70));
  });

  it('does not take a base58 run of the wrong length for an address (re-review: any long random word is an [id])', () => {
    const short = ADDR.slice(0, 94);
    expect(scrub(short).text).toBe('[id]');
  });

  it('masks an IBAN, a Luhn-valid card, an email, a phone number and a tx id', () => {
    expect(scrub(`IBAN ${IBAN} please`).text).toBe('IBAN [account] please');
    expect(scrub(`Card ${CARD} ok`).text).toBe('Card [card] ok');
    expect(scrub('Card 4111-1111-1111-1111.').text).toBe('Card [card].');
    expect(scrub('mail me at mira.k@example.com now').text).toBe('mail me at [email] now');
    expect(scrub('call +1 (555) 123-4567 today').text).toBe('call [phone] today');
    expect(scrub('or 0171 234 5678').text).toBe('or [phone]');
    expect(scrub(`tx ${TX} done`).text).toBe('tx [tx] done');
    const s = scrub(`Card ${CARD} ok`);
    expect(s.masks).toEqual([{ start: 5, end: 11, kind: 'card' }]);
  });

  it('does not mask a Luhn-invalid 16-digit number, an amount or a date', () => {
    expect(scrub('ref 4111 1111 1111 1112').text).toBe('ref 4111 1111 1111 1112');
    // Re-review m1: the exact XMR amount is masked; the fiat amount and the day stay.
    expect(scrub('paid 1,320.00 USD for 1.25 XMR on 2026-11-02').text).toBe('paid 1,320.00 USD for [amount] XMR on 2026-11-02');
  });
});

// Review 2026-11-18 (M1-M3): every bypass the review found, one test each. Over-masking is fine;
// under-masking is not.
describe('anonymizeText: the review\'s bypasses', () => {
  const FULL: AnonymizeNames = { buyer: ['mira.k', 'Mira Kowal', 'Mira'], seller: ['quietfox', 'José'], staff: ['dmitri_k', 'Jo'] };
  const s = (t: string, codes: readonly string[] = []) => anonymizeText(t, FULL, codes).text;
  const OWN = 'FTYB-J3ZD-7MCZ-WKRA';

  it('M1: a soft hyphen inside a name', () => {
    expect(s('mi­ra.k never paid')).toBe('Buyer never paid');
  });

  it('M1: a word joiner (and any other default-ignorable character) inside a name', () => {
    expect(s('mi⁠ra.k paid')).toBe('Buyer paid');
    expect(s('quiet᠎fox and dmi͏tri_k')).toBe('Seller and Moderator');
  });

  it('M1: a name typed in another Unicode form (NFD against NFC)', () => {
    expect(s('José paid')).toBe('Seller paid');
    expect(s('josé paid')).toBe('Seller paid');
  });

  it('M1: a name in fullwidth forms', () => {
    expect(s('ｍｉｒａ.ｋ paid')).toBe('Buyer paid');
  });

  it('M1: a name with Cyrillic or Greek look-alike letters', () => {
    expect(s('mirа.k paid')).toBe('Buyer paid');
    expect(s('quietfοx paid')).toBe('Seller paid');
    expect(s('Мira Kowal paid')).toBe('Buyer paid');
  });

  it('M1: a Trade Tag with a run of spaces or a line break', () => {
    expect(s('Mira  Kowal paid')).toBe('Buyer paid');
    expect(s('Mira\nKowal paid')).toBe('Buyer paid');
    expect(s('Mira\t \nKowal paid')).toBe('Buyer paid');
  });

  it('M1: a login with another separator (. _ - or space)', () => {
    for (const v of ['mira_k', 'mira-k', 'mira k', 'MIRA.K', 'mira__k']) expect(s(`${v} paid`), v).toBe('Buyer paid');
    expect(s('dmitri.k and dmitri-k')).toBe('Moderator and Moderator');
  });

  it('M1: a name of 4 or more characters with a short letter suffix', () => {
    expect(s('Miras payment came late')).toBe('Buyer payment came late');
    expect(s('quietfoxs bank says')).toBe('Seller bank says');
    expect(s('mira.kx wrote')).toBe('Buyer wrote');
    // Up to 2 letters; a short name takes no suffix.
    expect(s('quietfoxing')).toBe('quietfoxing');
    expect(s('Jo and Jos')).toBe('Moderator and Jos');
  });

  it('M2: the case\'s own trade code with any separator', () => {
    for (const v of ['FTYB.J3ZD.7MCZ.WKRA', 'FTYB_J3ZD_7MCZ_WKRA', 'FTYBJ3ZD/7MCZWKRA', 'ftyb j3zd 7mcz wkra', 'FTYB-J3ZD.7MCZ_WKRA', 'FTYB:J3ZD:7MCZ:WKRA']) {
      const out = s(`Trade ${v} was late`, [OWN]);
      expect(out, v).toBe(`Trade ${TRADE_CODE_MASK} was late`);
    }
  });

  it('M2: an address split by dashes', () => {
    const v = `${ADDR.slice(0, 30)}-${ADDR.slice(30, 60)}-${ADDR.slice(60)}`;
    expect(s(`send to ${v} now`)).toBe('send to [address] now');
  });

  it('M2: an address split by a soft hyphen', () => {
    expect(s(`send to ${ADDR.slice(0, 50)}\u00ad${ADDR.slice(50)} now`)).toBe('send to [address] now');
  });

  it('M2: an address split across a quoted line', () => {
    expect(s(`> ${ADDR.slice(0, 50)}\n> ${ADDR.slice(50)}\nok`)).not.toContain(ADDR.slice(50, 70));
    expect(s(`> ${ADDR.slice(0, 50)}\n> ${ADDR.slice(50)}\nok`)).toContain('[address]');
  });

  it('M2: an address glued to a word', () => {
    for (const v of [`to${ADDR}`, `${ADDR}paid`, `Pay:${SUB}.`]) {
      const out = s(`send ${v} now`);
      expect(out, v).toContain('[address]');
      for (let i = 0; i + 12 <= 95; i += 6) expect(out, v).not.toContain((v.includes(SUB) ? SUB : ADDR).slice(i, i + 12));
    }
  });

  it('M2: a tx id written with 0x', () => {
    expect(s(`tx 0x${TX} done`)).toBe('tx [tx] done');
  });

  it('M2: a tx id split in two', () => {
    expect(s(`tx ${TX.slice(0, 32)} ${TX.slice(32)} done`)).toBe('tx [tx] done');
    expect(s(`tx ${TX.slice(0, 32)}\n${TX.slice(32)} done`)).toBe('tx [tx] done');
  });

  it('M2: a 16-hex payment id', () => {
    expect(s('payment id 1f2e3d4c5b6a7980 please')).toBe('payment id [payment id] please');
    expect(s('pid 0x1F2E3D4C5B6A7980.')).toBe('pid [payment id].');
  });

  it('M3: a PGP fingerprint, spaced or not', () => {
    const fp = '0123456789ABCDEF0123456789ABCDEF01234567';
    const spaced = fp.match(/.{4}/g)!.join(' ').replace(/^((?:\S{4} ){4}\S{4}) /, '$1  ');
    for (const v of [fp, spaced, fp.toLowerCase(), `0x${fp}`]) expect(s(`key ${v} ok`), v).toBe('key [fingerprint] ok');
  });

  it('M3: a URL, with or without a scheme', () => {
    for (const v of ['https://t.me/mira_real', 'http://example.org/x?y=1', 'example.com/u/quietfox99', 't.me/someone', 'www.example.net', 'mirareal.onion']) {
      expect(s(`see ${v} now`), v).toBe('see [link] now');
    }
    expect(s('see https://t.me/someone.')).toBe('see [link].');
  });

  it('M3: an @handle', () => {
    expect(s('ask @mira_real or @some.one now')).toBe('ask [handle] or [handle] now');
  });

  it('M3: an IPv4 address, short forms too', () => {
    for (const v of ['10.1.2.3', '127.0.0.1:8080', '203.0.113.77', '10.1.2']) expect(s(`from ${v} today`), v).toBe('from [ip] today');
  });

  it('M3: an IPv6 address', () => {
    for (const v of ['2001:db8::1', 'fe80::1ff:fe23:4567:890a', '2001:0db8:85a3:0000:0000:8a2e:0370:7334', '::1', '[2001:db8::2]']) {
      expect(s(`from ${v} today`), v).not.toContain(v.replace(/[[\]]/g, ''));
    }
    expect(s('from 2001:db8::1 today')).toBe('from [ip] today');
  });

  it('M3: an obfuscated email or Jabber id', () => {
    for (const v of ['someone at jabber dot ccc dot de', 'someone [at] jabber [dot] de', 'someone(at)jabber.de', 'someone @ jabber . de', 'someone AT jabber DOT de', 'someone{at}jabber{dot}de']) {
      expect(s(`write ${v} today`), v).toBe('write [email] today');
    }
  });

  it('M3: a Jabber id with a resource is masked whole', () => {
    expect(s('jid someone@jabber.de/phone ok')).toBe('jid [email] ok');
  });

  it('M3: a phone number split with slashes or dots', () => {
    for (const v of ['0171/234/5678', '030/1234567', '0171.234.5678', '+49.171.234.5678']) expect(s(`call ${v} now`), v).toBe('call [phone] now');
  });

  it('M3: a card number written with dots', () => {
    expect(s('card 4111.1111.1111.1111 ok')).toBe('card [card] ok');
  });

  it('still leaves amounts, a date and an offset alone', () => {
    expect(s('paid 1,320.00 USD on 2026-11-02 at T+0:42')).toBe('paid 1,320.00 USD on 2026-11-02 at T+0:42');
  });
});

// Re-review 2026-11-18 (B1, M1, M2, m1, m2): one test each, red first.
describe('anonymizeText: the re-review', () => {
  const FULL: AnonymizeNames = { buyer: ['mira.k', 'Mira Kowal'], seller: ['quietfox', 'José', 'Strauß'], staff: ['dmitri_k'] };
  const s = (t: string, codes: readonly string[] = []) => anonymizeText(t, FULL, codes).text;
  const OWN = 'FTYB-J3ZD-7MCZ-WKRA';

  it('B1: a ruling reason with names, a card, a trade code and an address keeps its words', () => {
    // The shape that failed half the time: a fixed buyer, seller and code with no 0 in them.
    const names: AnonymizeNames = { buyer: ['Dmira7ab3f9c', 'mira7ab3f9c'], seller: ['Dquietfox8cd2e4', 'quietfox8cd2e4'], staff: ['Ddmitrimod'] };
    const reason = `REASON-SENTINEL: Dmira7ab3f9c's payment from card ${CARD} shows in Dquietfox8cd2e4's bank. Trade ${OWN}. Refund address ${ADDR}.`;
    expect(anonymizeText(reason, names, [OWN]).text).toBe(
      `REASON-SENTINEL: Buyer's payment from card [card] shows in Seller's bank. Trade ${TRADE_CODE_MASK}. Refund address [address].`,
    );
  });

  it('B1: never looks for an address across words, however mixed the prose', () => {
    const prose = 'A Buyer SENT 4 BTC via Zen Bank on Tuesday, Ref ABC123 and Ref XYZ789, then Buyer WAS ANGRY 3 days after the Bank TRANSFER, Ref QRS456';
    expect(s(prose)).toBe(prose);
    const words = 'A Buyer and A Seller met at Bank 7 then Bank 8 then Bank 9 to check the Payment Status of Trade KTXR and Trade WQPV';
    expect(s(words)).toBe(words);
  });

  it('M1: combining marks inside a name', () => {
    expect(s('m̀ira.k paid')).toBe('Buyer paid');
    expect(s('quietföx paid')).toBe('Seller paid');
  });

  it('M1: a name typed without its accent, or ß as ss', () => {
    expect(s('Jose paid')).toBe('Seller paid');
    expect(s('Strauss paid and STRAUSS too')).toBe('Seller paid and Seller too');
  });

  it('M1: a dotted capital I (Turkish)', () => {
    expect(s('MİRA.K paid')).toBe('Buyer paid');
  });

  it('M1: Armenian and small-capital look-alikes', () => {
    expect(s('quietfօx paid')).toBe('Seller paid');
    expect(s('ᴍira.k paid')).toBe('Buyer paid');
  });

  it('M1: 0 for o and 1 for i or l inside a name', () => {
    expect(s('quietf0x paid')).toBe('Seller paid');
    expect(s('m1ra.k paid')).toBe('Buyer paid');
    expect(s('dm1tr1_k here')).toBe('Moderator here');
  });

  it('M1: separators between letters and , · / between parts', () => {
    for (const v of ['m.i.r.a.k', 'm i r a k', 'mira,k', 'mira·k', 'mira/k', 'q-u-i-e-t-f-o-x']) expect(s(`${v} paid`), v).not.toMatch(/m.?i.?r.?a|q.?u.?i.?e/i);
    expect(s('mira,k paid')).toBe('Buyer paid');
  });

  it('M1: a digit or underscore suffix', () => {
    expect(s('quietfox_real on Telegram')).toBe('Seller on Telegram');
    expect(s('quietfox99 again')).toBe('Seller again');
    expect(s('mira.k_2 again')).toBe('Buyer again');
  });

  it('M2: another trade\'s code in lower case, with spaces, dots or slashes', () => {
    for (const v of ['rvgf4pmgr9cmeza9', 'rvgf 4pmg r9cm eza9', 'RVGF.4PMG.R9CM.EZA9', 'rvgf/4pmg/r9cm/eza9', 'RVGF_4PMG_R9CM_EZA9']) {
      expect(s(`see ${v} too`), v).toBe(`see ${TRADE_CODE_MASK} too`);
    }
  });

  it('M2: an address split by a wider gap, or with a non-base58 character inserted', () => {
    expect(s(`to ${ADDR.slice(0, 47)} -- ${ADDR.slice(47)} ok`)).toBe('to [address] ok');
    expect(s(`to ${ADDR.slice(0, 40)}0${ADDR.slice(40)} ok`)).toBe('to [address] ok');
    expect(s(`to ${ADDR.slice(0, 40)}l${ADDR.slice(40)} ok`)).toBe('to [address] ok');
  });

  it('M2: a tx id in two halves with a word between, or with O for 0', () => {
    const out = s(`tx ${TX.slice(0, 32)} and ${TX.slice(32)} done`);
    expect(out).not.toContain(TX.slice(0, 12));
    expect(out).not.toContain(TX.slice(40, 52));
    const tx0 = '0a'.repeat(32);
    expect(s(`tx ${tx0.replaceAll('0', 'O')} done`)).toBe('tx [tx] done');
  });

  it('M2: an IBAN with dashes or dots', () => {
    expect(s('IBAN DE89-3704-0044-0532-0130-00 ok')).toBe('IBAN [account] ok');
    expect(s('IBAN DE89.3704.0044.0532.0130.00 ok')).toBe('IBAN [account] ok');
  });

  it('M2: a card with " - " or slashes', () => {
    expect(s('card 4111 - 1111 - 1111 - 1111 ok')).toBe('card [card] ok');
    expect(s('card 4111/1111/1111/1111 ok')).toBe('card [card] ok');
  });

  it('M2: Bitcoin addresses (base58 and bech32)', () => {
    for (const v of ['1BvBMSEYstWetqTFn5Au4m4GFg7xJaNVN2', '3J98t1WpEZ73CNmQviecrnyiWrnqRhWNLy', 'bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq', 'BC1QW508D6QEJXTDG4Y5R3ZARVARY0C5XW7KV8F3T4']) {
      expect(s(`btc ${v} ok`), v).toBe('btc [address] ok');
    }
  });

  it('M2: a Session id', () => {
    const sid = `05${'3f'.repeat(32)}`;
    expect(s(`session ${sid} ok`)).toBe('session [session id] ok');
  });

  it('M2: a bare host with any top-level domain', () => {
    for (const v of ['quietfox-store.shop', 'mira.example.travel', 'pay.something.xn--p1ai']) expect(s(`see ${v} now`), v).toBe('see [link] now');
  });

  it('m1: clock times and exact XMR amounts are masked; fiat amounts and days are kept', () => {
    expect(s('paid on 12 Nov 2026 at 14:32, then 9:05 pm and 7am')).toBe('paid on 12 Nov 2026 at [time], then [time] and [time]');
    expect(s('412.37 EUR for 1.2345 XMR, or XMR 0.5, or 2 monero')).toBe('412.37 EUR for [amount] XMR, or XMR [amount], or [amount] monero');
    expect(s('opened at T+0:42')).toBe('opened at T+0:42');
  });

  it('m2: past 20 000 characters (after normalizing) the rest is one [long text] mask', () => {
    const long = `${'word '.repeat(4100)}${ADDR} tail mira.k`;
    const out = anonymizeText(long, FULL);
    expect(out.text.endsWith('[long text]')).toBe(true);
    expect(out.text.length).toBeLessThanOrEqual(20_000 + '[long text]'.length);
    expect(out.text).not.toContain('mira.k');
    expect(out.masks[out.masks.length - 1]!.kind).toBe('long');
    // NFKC can make a text longer: the cap is on the normalized text.
    const grown = anonymizeText('㏂'.repeat(6000), FULL);
    expect(grown.text.endsWith('[long text]')).toBe(true);
    expect(anonymizeText('short', FULL).text).toBe('short');
  });
});

// Re-review 3 (m2, m4, m5): one test each, red first.
describe('anonymizeText: re-review 3', () => {
  const FULL: AnonymizeNames = { buyer: ['mira.k', 'Mira Kowal'], seller: ['quietfox', 'Anna Maria Nowak'], staff: ['dmitri_k'] };
  const s = (t: string, codes: readonly string[] = []) => anonymizeText(t, FULL, codes).text;

  it('m2: a span starting inside the source character that ended the last one is clamped, not dropped (ß)', () => {
    const own = 'S123-4567-89AB-CDES';
    const out = s('S123456789ABCDEß123456789ABCDES', [own]);
    expect(out).toBe(`${TRADE_CODE_MASK}${TRADE_CODE_MASK}`);
    expect(out).not.toContain('123456789');
  });

  it('m4: each part of a multi-part Trade Tag on its own, in any order', () => {
    expect(s('Mira paid late')).toBe('Buyer paid late');
    expect(s('Kowal never answered')).toBe('Buyer never answered');
    expect(s('Kowal Mira wrote')).toBe('Buyer Buyer wrote');
    expect(s('Nowak and Anna and Maria')).toBe('Seller and Seller and Seller');
    // Initials are not masked (lead call): "M." is not a name part of 3 or more letters.
    expect(s('M. said hi')).toBe('M. said hi');
  });

  it('m4: times written 1432h or 14.32 CET', () => {
    expect(s('at 1432h and 14.32 CET, or 9.05 UTC')).toBe('at [time] and [time] CET, or [time] UTC');
    // A fiat amount with a currency stays.
    expect(s('paid 14.32 EUR')).toBe('paid 14.32 EUR');
  });

  it('m4: an XMR amount with spaces around its point', () => {
    expect(s('sent 1 . 2345 XMR and 0 , 5 xmr')).toBe('sent [amount] XMR and [amount] xmr');
  });

  it('m5: the cut at 20 000 characters never leaves part of an identifier showing', () => {
    const pad = (n: number) => 'w'.repeat(n - 1) + ' ';
    // `before` characters of the identifier fall before the cut, the rest after it.
    const straddle = (id: string, before: number) => `${pad(MAX_TEXT - before)}${id}${' tail'.repeat(100)}`;
    const iban = 'DE89 3704 0044 0532 0130 00';
    const split = `${ADDR.slice(0, 47)} ${ADDR.slice(47)}`;
    for (const [id, check] of [[iban, 'DE89'], [split, ADDR.slice(0, 20)], ['Mira | Kowal', 'Mira'], [`x ${ADDR.slice(0, 60)}`, ADDR.slice(0, 20)]] as const) {
      for (const before of [2, Math.floor(id.length / 2), id.length - 1]) {
        const out = anonymizeText(straddle(id, before), FULL).text;
        expect(out.endsWith('[long text]'), `${check} ${before}`).toBe(true);
        expect(out, `${check} ${before}`).not.toContain(check);
      }
    }
  });
});

describe('applyManualMasks', () => {
  it('hides a stretch the owner selected, keeping the automatic masks in place', () => {
    const s = scrub(`Paid by Jane Doe, card ${CARD}.`);
    expect(s.text).toBe('Paid by Jane Doe, card [card].');
    const start = s.text.indexOf('Jane Doe');
    const m = applyManualMasks(s, [{ start, end: start + 'Jane Doe'.length }]);
    expect(m.text).toBe(`Paid by ${MANUAL_MASK}, card [card].`);
    expect(m.masks).toEqual([
      { start, end: start + MANUAL_MASK.length, kind: 'manual' },
      { start: m.text.indexOf('[card]'), end: m.text.indexOf('[card]') + 6, kind: 'card' },
    ]);
  });

  it('refuses masks out of range, overlapping, or cutting into an automatic one', () => {
    const s = scrub(`card ${CARD}`);
    expect(() => applyManualMasks(s, [{ start: 0, end: 99 }])).toThrow(RangeError);
    expect(() => applyManualMasks(s, [{ start: 0, end: 3 }, { start: 2, end: 4 }])).toThrow(RangeError);
    expect(() => applyManualMasks(s, [{ start: 6, end: 8 }])).toThrow(RangeError);
  });
});

describe('anonymizeCase', () => {
  const opened = new Date('2026-11-02T09:00:00.000Z');
  const SENSITIVE = ['mira.k', 'quietfox', 'dmitri_k', CODE, ADDR, CARD, IBAN, TX, 'mira.k@example.com', '2026-11-02T', '09:42'];
  const c = {
    buyer: 'mira.k',
    seller: 'quietfox',
    staff: ['dmitri_k'],
    tradeCode: CODE,
    openedAt: opened,
    method: 'Zelle',
    amountXmr: '1.25',
    messages: [
      { from: 'buyer' as const, at: new Date(opened.getTime() + 42 * 60_000), text: `Hi quietfox, I paid from mira.k@example.com, card ${CARD}. Trade ${CODE}.` },
      { from: 'seller' as const, at: new Date(opened.getTime() + 125 * 60_000), text: `Nothing came. Refund to ${ADDR} or IBAN ${IBAN}.` },
      { from: 'mod' as const, at: new Date(opened.getTime() + 26 * 3_600_000), text: `dmitri_k here, checking tx ${TX}.` },
    ],
    ruling: { outcome: 'release-to-buyer', reason: `mira.k's payment shows in quietfox's activity at 09:42.` },
  };

  it('times become offsets from the opening, and the code is the mask', () => {
    const { body } = anonymizeCase(c);
    expect(body.tradeCode).toBe(TRADE_CODE_MASK);
    expect(body.messages.map((m) => m.at)).toEqual(['T+0:42', 'T+2:05', 'T+26:00']);
    expect(offsetLabel(new Date(opened.getTime() - 1), opened)).toBe('T+0:00');
  });

  it('lists every mask by message, the reason as -1', () => {
    const { masks } = anonymizeCase(c);
    expect(masks.filter((m) => m.messageIndex === 0).map((m) => m.kind)).toEqual(['email', 'card']);
    expect(masks.filter((m) => m.messageIndex === 1).map((m) => m.kind)).toEqual(['address', 'account']);
    expect(masks.filter((m) => m.messageIndex === 2).map((m) => m.kind)).toEqual(['tx']);
  });

  it('the scrubbed body holds none of the fixture\'s sensitive strings', () => {
    const json = JSON.stringify(anonymizeCase(c).body);
    for (const s of SENSITIVE) expect(json, s).not.toContain(s);
    // Re-review m1: a clock time inside free text is masked too.
    expect(json).toContain('Buyer\'s payment shows in Seller\'s activity at [time]');
    expect(json).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });
});
