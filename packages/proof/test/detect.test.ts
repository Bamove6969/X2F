import { describe, expect, it } from 'vitest';
import { detectSensitive, detectSensitiveText, type HiddenKind, type OcrWord, type Region } from '../src/index.js';
import { type DetectOptions, UPI_IDS } from '../src/detect.js';
import { covered, ocr } from './ocr.js';

const KEEP = { tradeCode: 'K7M2-9QXA-4FTR-8WPN', fiatCents: 41250n, exponent: 2 };

/** Every masked word, with the kind of the region that covers it. */
function masked(words: OcrWord[], keep = KEEP, opts?: DetectOptions): Array<[string, HiddenKind]> {
  const rs: Region[] = detectSensitive(words, keep, opts);
  return rs.flatMap((r) => covered(words, r).map((t): [string, HiddenKind] => [t, r.kind]));
}

function maskedTexts(words: OcrWord[], keep = KEEP, opts?: DetectOptions): string[] {
  return masked(words, keep, opts).map(([t]) => t);
}

describe('detectSensitive: card numbers (spec 4.2)', () => {
  it('masks a Luhn-valid card as card', () => {
    const w = ocr('Card 4111 1111 1111 1111');
    expect(masked(w)).toEqual([
      ['4111', 'card'],
      ['1111', 'card'],
      ['1111', 'card'],
      ['1111', 'card'],
    ]);
  });

  it('still masks a Luhn-invalid card (one OCR misread), as account', () => {
    const w = ocr('Card 4111 1111 1111 1112');
    expect(masked(w)).toEqual([
      ['4111', 'account'],
      ['1111', 'account'],
      ['1111', 'account'],
      ['1112', 'account'],
    ]);
  });

  it('accepts dashes between groups', () => {
    expect(masked(ocr('5500-0000-0000-0004'))).toEqual([['5500-0000-0000-0004', 'card']]);
  });

  it('one region covers the whole number', () => {
    const rs = detectSensitive(ocr('Card 4111 1111 1111 1111'), KEEP);
    expect(rs).toEqual([{ x0: 50, y0: 0, x1: 240, y1: 16, kind: 'card' }]);
  });
});

describe('detectSensitive: IBANs', () => {
  it('masks a mod-97-valid IBAN as iban', () => {
    const w = ocr('IBAN DE89 3704 0044 0532 0130 00');
    expect(masked(w)).toEqual(['DE89', '3704', '0044', '0532', '0130', '00'].map((t) => [t, 'iban']));
  });

  it('masks an IBAN with one wrong character as account', () => {
    const w = ocr('IBAN DE89 3704 0044 0532 0130 01');
    expect(masked(w)).toEqual(['DE89', '3704', '0044', '0532', '0130', '01'].map((t) => [t, 'account']));
  });

  it('masks an IBAN written without spaces', () => {
    expect(masked(ocr('GB82WEST12345698765432'))).toEqual([['GB82WEST12345698765432', 'iban']]);
  });
});

describe('detectSensitive: account numbers', () => {
  it('masks a digit run of 6 or more', () => {
    expect(masked(ocr('Account 12345678'))).toEqual([['12345678', 'account']]);
  });

  it('joins space- or dash-separated digit groups before the 6-digit rule', () => {
    expect(maskedTexts(ocr('Acct 123 456'))).toEqual(['123', '456']);
    expect(maskedTexts(ocr('Acct 12-34-56'))).toEqual(['12-34-56']);
  });

  it('leaves a short number alone', () => {
    expect(maskedTexts(ocr('Order 1234'))).toEqual([]);
  });

  it('masks masked tails like ••••1234 and ****1234', () => {
    expect(masked(ocr('Visa ••••1234'))).toEqual([['••••1234', 'account']]);
    expect(masked(ocr('From account ****1234'))).toContainEqual(['****1234', 'account']);
  });

  it('masks a long transaction ID too (there is no keep rule for it)', () => {
    expect(maskedTexts(ocr('Transaction ID 8392017465512'))).toEqual(['8392017465512']);
  });

  it('masks a Monero address', () => {
    const addr = '4' + 'A'.repeat(1) + '1'.repeat(93);
    expect(masked(ocr(`Wallet ${addr}`))).toEqual([[addr, 'account']]);
  });
});

describe('detectSensitive: contact details', () => {
  it('masks an email', () => {
    expect(masked(ocr('Contact jane.doe@example.com today'))).toEqual([['jane.doe@example.com', 'email']]);
  });

  it('masks a phone number', () => {
    expect(masked(ocr('Call +1 (415) 555-0134'))).toEqual([
      ['+1', 'phone'],
      ['(415)', 'phone'],
      ['555-0134', 'phone'],
    ]);
    expect(masked(ocr('Tel 415-555-0134'))).toEqual([['415-555-0134', 'phone']]);
    expect(masked(ocr('Tel +44 20 7946 0958'))).toEqual(['+44', '20', '7946', '0958'].map((t) => [t, 'phone']));
  });

  it('masks $cashtags and @handles', () => {
    expect(masked(ocr('Paid $janedoe via Cash App'))).toEqual([['$janedoe', 'handle']]);
    expect(masked(ocr('Venmo @jane-doe'))).toEqual([['@jane-doe', 'handle']]);
  });
});

describe('detectSensitive: names', () => {
  it('From: Jane Doe masks Jane Doe and not From:', () => {
    expect(masked(ocr('From: Jane Doe'))).toEqual([
      ['Jane', 'name'],
      ['Doe', 'name'],
    ]);
  });

  it('each label masks the rest of its line', () => {
    for (const label of ['To', 'Sender:', 'Recipient', 'Name:', 'Paid to', 'Sent to:', 'Payee', 'Payer:', 'Beneficiary', 'Account holder:']) {
      expect(maskedTexts(ocr(`${label} Mira Kowalski`)), label).toEqual(['Mira', 'Kowalski']);
    }
  });

  it('a label alone on its line masks the next line', () => {
    const w = ocr('Sent to', 'Jane Doe', 'Zelle');
    expect(masked(w)).toEqual([
      ['Jane', 'name'],
      ['Doe', 'name'],
    ]);
  });

  it('a label inside a word is not a label', () => {
    expect(maskedTexts(ocr('Total $412.50'))).toEqual([]);
    expect(maskedTexts(ocr('Tomorrow is fine'))).toEqual([]);
  });

  it('the next line follows OCR line numbers, not array order', () => {
    const [a, b, c, d] = ocr('Payee:', 'Jane Doe');
    expect(maskedTexts([c, a, d, b].filter((x): x is OcrWord => x !== undefined)).sort()).toEqual(['Doe', 'Jane']);
  });
});

describe('detectSensitive: addresses', () => {
  it('masks a line with a house number and a street word', () => {
    expect(masked(ocr('221B Baker Street'))).toEqual(['221B', 'Baker', 'Street'].map((t) => [t, 'address']));
    expect(maskedTexts(ocr('10 rue de Rivoli'))).toEqual(['10', 'rue', 'de', 'Rivoli']);
    expect(maskedTexts(ocr('Hauptstraße 5'))).toEqual(['Hauptstraße', '5']);
  });

  it('masks postcode lines (UK, US, CA, DE, NL)', () => {
    expect(masked(ocr('London SW1A 1AA'))).toEqual(['London', 'SW1A', '1AA'].map((t) => [t, 'address']));
    expect(maskedTexts(ocr('San Francisco, CA 94103-1234'))).toEqual(['San', 'Francisco,', 'CA', '94103-1234']);
    expect(maskedTexts(ocr('Toronto ON M5V 3L9'))).toEqual(['Toronto', 'ON', 'M5V', '3L9']);
    expect(maskedTexts(ocr('10115 Berlin'))).toEqual(['10115', 'Berlin']);
    expect(maskedTexts(ocr('1012 AB Amsterdam'))).toEqual(['1012', 'AB', 'Amsterdam']);
  });

  it('masks postcode lines (FR, ES, IT)', () => {
    expect(maskedTexts(ocr('75001 Paris'))).toEqual(['75001', 'Paris']);
    expect(maskedTexts(ocr('28013 Madrid'))).toEqual(['28013', 'Madrid']);
    expect(maskedTexts(ocr('00184 Roma RM'))).toEqual(['00184', 'Roma', 'RM']);
  });

  it('a street word with no number is not an address', () => {
    expect(maskedTexts(ocr('Wall Street Bank'))).toEqual([]);
  });
});

describe('detectSensitive: what is always kept', () => {
  it('keeps the trade code with or without dashes', () => {
    expect(maskedTexts(ocr('Memo K7M2-9QXA-4FTR-8WPN'))).toEqual([]);
    expect(maskedTexts(ocr('Memo K7M29QXA4FTR8WPN'))).toEqual([]);
    expect(maskedTexts(ocr('Memo K7M2 9QXA 4FTR 8WPN'))).toEqual([]);
    expect(maskedTexts(ocr('Memo k7m2-9qxa-4ftr-8wpn'))).toEqual([]);
  });

  it('keeps the trade code after look-alike normalisation (O for 0, I or L for 1)', () => {
    const keep = { ...KEEP, tradeCode: 'K7M2-9QXA-4FTR-8W01' };
    expect(maskedTexts(ocr('Memo K7M2-9QXA-4FTR-8WOI'), keep)).toEqual([]);
  });

  it('keeps the trade code even under a name label', () => {
    expect(maskedTexts(ocr('To: K7M2-9QXA-4FTR-8WPN'))).toEqual([]);
  });

  it('keeps the trade amount', () => {
    expect(maskedTexts(ocr('Amount $412.50'))).toEqual([]);
    expect(maskedTexts(ocr('412,50 €'), { ...KEEP })).toEqual([]);
  });

  it('keeps the trade amount when it looks like an account number', () => {
    const keep = { ...KEEP, fiatCents: 12345678n };
    expect(maskedTexts(ocr('Total 123456.78'), keep)).toEqual([]);
    expect(maskedTexts(ocr('Total 123456.78'))).toEqual(['123456.78']);
  });

  it('keeps dates', () => {
    expect(maskedTexts(ocr('Oct 16, 2026'))).toEqual([]);
    expect(maskedTexts(ocr('Sent 2026-10-16 14:32'))).toEqual([]);
    expect(maskedTexts(ocr('Sent 16-10-2026'))).toEqual([]);
    expect(maskedTexts(ocr('Sent 16 October 2026'))).toEqual([]);
  });

  it('a kept code next to a sensitive detail still masks the detail', () => {
    const w = ocr('K7M2-9QXA-4FTR-8WPN 12345678');
    expect(masked(w)).toEqual([['12345678', 'account']]);
  });

  it('never returns a region over a kept word, on a receipt with everything', () => {
    const w = ocr(
      'Zelle payment sent',
      'Oct 16, 2026 at 14:32',
      'To',
      'Mira Kowalski',
      'Amount $412.50',
      'Memo K7M2-9QXA-4FTR-8WPN',
      'Account ****1234',
      'Ref 8392017465',
    );
    const m = maskedTexts(w);
    expect(m).toEqual(['Mira', 'Kowalski', '****1234', '8392017465']);
    for (const kept of ['Oct', '16,', '2026', '$412.50', 'K7M2-9QXA-4FTR-8WPN']) expect(m).not.toContain(kept);
  });
});

describe('detectSensitive: region shape', () => {
  it('splits a match into one region per line and per kind', () => {
    const rs = detectSensitive(ocr('jane@example.com 12345678'), KEEP);
    expect(rs.map((r) => r.kind)).toEqual(['email', 'account']);
  });

  it('returns nothing for no words', () => {
    expect(detectSensitive([], KEEP)).toEqual([]);
  });

  it('refuses a keep with a bad trade code', () => {
    expect(() => detectSensitive(ocr('x'), { ...KEEP, tradeCode: 'nope' })).toThrow(RangeError);
  });
});

describe('detectSensitiveText (review notes, P5-A6)', () => {
  it('flags each personal-details class of P5-A6', () => {
    expect(detectSensitiveText('mail me at jane.doe@example.com')).toEqual(['email']);
    expect(detectSensitiveText('call +1 (415) 555-0134')).toEqual(['phone']);
    expect(detectSensitiveText('card 4111 1111 1111 1111')).toEqual(['card']);
    expect(detectSensitiveText('IBAN DE89 3704 0044 0532 0130 00')).toEqual(['iban']);
    expect(detectSensitiveText('acct 12345678')).toEqual(['account']);
    expect(detectSensitiveText(`send to 8${'B'.repeat(94)}`)).toEqual(['account']);
  });

  it('passes ordinary notes', () => {
    for (const s of [
      'Smooth trade, would trade again',
      'Paid within 5 minutes',
      'Fast release on Oct 16, 2026',
      'Traded on 2026-10-16, all good',
      'From start to finish easy',
      'Sent to the right memo',
      '221B Baker Street was a good book',
      '$412.50 by Zelle, quick',
      'Code K7M2-9QXA-4FTR-8WPN',
      '',
    ]) {
      expect(detectSensitiveText(s), s).toEqual([]);
    }
  });

  it('returns each kind once, in a fixed order', () => {
    expect(detectSensitiveText('12345678 jane@x.io 87654321 bob@y.io')).toEqual(['email', 'account']);
  });

  it('checks every line of a multi-line string', () => {
    expect(detectSensitiveText('fine\nacct 12345678')).toEqual(['account']);
  });
});

describe('review round 1 (2026-10-30)', () => {
  it('I1: masks dotted or dashed phone numbers that start like a date', () => {
    expect(masked(ocr('Phone 06.12.34.56.78'))).toEqual([['06.12.34.56.78', 'phone']]);
    expect(masked(ocr('Phone +33 6.12.34.56.78'))).toEqual([
      ['+33', 'phone'],
      ['6.12.34.56.78', 'phone'],
    ]);
    expect(masked(ocr('Tel 06-12-34-56-78'))).toEqual([['06-12-34-56-78', 'phone']]);
    expect(masked(ocr('412.50 sent on 16.10.26 to 06.12.34.56.78'))).toEqual([['06.12.34.56.78', 'phone']]);
    expect(masked(ocr('Tel 415.555.0134'))).toEqual([['415.555.0134', 'phone']]);
    expect(masked(ocr('Tel 415-555-0134'))).toEqual([['415-555-0134', 'phone']]);
    expect(detectSensitiveText('call me 06.12.34.56.78')).toEqual(['phone']);
    expect(detectSensitiveText('call me 415.555.0134')).toEqual(['phone']);
  });

  it('I1: a date or time inside a longer separator run is not kept', () => {
    expect(maskedTexts(ocr('Ref 2026-10-16-4471'))).toEqual(['2026-10-16-4471']);
    expect(maskedTexts(ocr('Ref 12:30.555.0134'))).toEqual(['12:30.555.0134']);
  });

  it('I1: real dates are still kept', () => {
    for (const s of ['Sent 16.10.2026', 'Sent 16.10.26', 'Sent 10/16/26', 'Sent 16-10-2026 14:32', 'Sent 2026-10-16', 'At 14:32:05']) {
      expect(maskedTexts(ocr(s)), s).toEqual([]);
    }
    expect(detectSensitiveText('Paid on 16.10.26 at 14:32')).toEqual([]);
  });

  it('M1: masked tails with dots, an ellipsis, degree signs or "ending in"', () => {
    expect(masked(ocr('Card ending ...1234'))).toEqual([['...1234', 'account']]);
    expect(masked(ocr('Card ending …1234'))).toEqual([['…1234', 'account']]);
    expect(masked(ocr('Card °°°°1234'))).toEqual([['°°°°1234', 'account']]);
    expect(masked(ocr('Account ending in 1234'))).toEqual([['1234', 'account']]);
    expect(masked(ocr('Card ending 1234'))).toEqual([['1234', 'account']]);
  });

  it('M2: one OCR look-alike inside a digit run does not leave its group visible', () => {
    expect(masked(ocr('Card 4111 1111 1111 l111'))).toEqual(['4111', '1111', '1111', 'l111'].map((t) => [t, 'account']));
    expect(masked(ocr('Account 1234O678'))).toEqual([['1234O678', 'account']]);
    expect(maskedTexts(ocr('SOS BOB 12'))).toEqual([]);
  });

  it('M3: Monero addresses misread, wrapped, or on stagenet and testnet', () => {
    const addr = '4A' + 'x9Yz'.repeat(23) + 'q';
    expect(addr).toHaveLength(95);
    const misread = addr.slice(0, 40) + '0' + addr.slice(41);
    expect(masked(ocr(`Wallet ${misread}`))).toEqual([[misread, 'account']]);
    const first = addr.slice(0, 50);
    const second = addr.slice(50);
    expect(masked(ocr(first, second))).toEqual([
      [first, 'account'],
      [second, 'account'],
    ]);
    for (const p of ['5', '7', '9', 'A', 'B']) {
      const a = p + 'b'.repeat(94);
      expect(masked(ocr(`Wallet ${a}`)), p).toEqual([[a, 'account']]);
    }
    expect(detectSensitiveText(`send to 5${'B'.repeat(40)}`)).toEqual(['account']);
  });

  it('M4: emails with a non-ASCII domain, and emails split by OCR', () => {
    expect(masked(ocr('Contact jane@exämple.com'))).toEqual([['jane@exämple.com', 'email']]);
    expect(detectSensitiveText('mail jane@exämple.com')).toEqual(['email']);
    expect(masked(ocr('Contact jane.doe @example.com'))).toEqual([
      ['jane.doe', 'email'],
      ['@example.com', 'email'],
    ]);
    expect(masked(ocr('Venmo @jane-doe'))).toEqual([['@jane-doe', 'handle']]);
  });

  it('M5: a UK sort code shaped like a date is masked', () => {
    expect(masked(ocr('Sort code 12-05-26'))).toEqual([['12-05-26', 'account']]);
    expect(masked(ocr('Sort code 20-32-06'))).toEqual([['20-32-06', 'account']]);
    expect(maskedTexts(ocr('Sent 12-05-26'))).toEqual([]);
  });

  it('M6: decimal parts and year or time ranges in notes are not details', () => {
    for (const s of ['Great trade, got 0.12345678 XMR fast', 'Traded with them 2023 - 2026', 'Traded with them 2023-2026', 'Met at 10.00-12.00', 'Paid 0,123456 BTC']) {
      expect(detectSensitiveText(s), s).toEqual([]);
    }
    // The whole number before a decimal point still counts.
    expect(detectSensitiveText('acct 12345678.5')).toEqual(['account']);
  });

  it('M8: a detected part inside a word with a kept part is padded by one character toward the kept part', () => {
    const w = ocr('K7M2-9QXA-4FTR-8WPN/jane@x.io');
    const rs = detectSensitive(w, KEEP);
    expect(rs).toHaveLength(1);
    // The word is 29 characters at 10 px each; the email starts at character 20 (x = 200).
    expect(rs[0]).toEqual({ x0: 190, y0: 0, x1: 290, y1: 16, kind: 'email' });
  });
});

describe('review round 2 (2026-10-30)', () => {
  it('R2-I1: single-dot phone numbers in notes are still refused', () => {
    for (const s of ['chiamami 347.1234567', 'call 02.12345678', 'call 0612.345678']) expect(detectSensitiveText(s), s).toEqual(['phone']);
  });

  it('R2-I1: long decimals next to a currency or crypto code still pass', () => {
    for (const s of ['Great trade, got 0.12345678 XMR fast', 'got 12.3456789012 XMR', 'Rate 1.0234 EUR/XMR', 'Paid 0,123456 BTC']) expect(detectSensitiveText(s), s).toEqual([]);
  });

  it('R2-I2: Belgian slash and space forms are masked', () => {
    expect(maskedTexts(ocr('Tel 0470/12.34.56'))).toEqual(['0470/12.34.56']);
    expect(maskedTexts(ocr('Tel +32 470/12.34.56'))).toEqual(['+32', '470/12.34.56']);
    expect(detectSensitiveText('call 0470/12.34.56')).toEqual(['phone']);
    expect(masked(ocr('Tel 0470 01.02.03'))).toEqual([
      ['0470', 'phone'],
      ['01.02.03', 'phone'],
    ]);
    expect(maskedTexts(ocr('Tel +32 470 01.02.03'))).toEqual(['+32', '470', '01.02.03']);
    expect(detectSensitiveText('call me 0470 01.02.03')).toEqual(['phone']);
  });

  it('R2-I2: dates are still kept', () => {
    expect(maskedTexts(ocr('Sent 16.10.26'))).toEqual([]);
    expect(maskedTexts(ocr('412.50 sent on 16.10.26'))).toEqual([]);
    expect(maskedTexts(ocr('Sent 16/10/2026'))).toEqual([]);
    expect(detectSensitiveText('Sent 16.10.26')).toEqual([]);
  });

  it('R2-M1: dot and ellipsis tails and "ending" need exactly 4 digits', () => {
    for (const s of ['Waited ... 15 minutes', 'Waited.... 15 minutes', 'ok … 20 min', 'trade ending in 10 minutes']) expect(detectSensitiveText(s), s).toEqual([]);
    expect(detectSensitiveText('card ending in 1234')).toEqual(['account']);
    expect(detectSensitiveText('card ...1234')).toEqual(['account']);
    expect(detectSensitiveText('card …1234')).toEqual(['account']);
  });

  it('R2-M2: the look-alike pass is not shifted by an emoji', () => {
    expect(masked(ocr('😀 Card 4111 1111 1111 l111'))).toEqual(['4111', '1111', '1111', 'l111'].map((t) => [t, 'account']));
    expect(detectSensitiveText('👍 Card 4111 1111 1111 l111')).toEqual(['account']);
    expect(maskedTexts(ocr('😀 1S😀 4111 1111 1111 1111'))).toEqual(['4111', '1111', '1111', '1111']);
  });

  it('R2-M3: an email split after the @', () => {
    expect(masked(ocr('Contact jane.doe@ example.com'))).toEqual([
      ['jane.doe@', 'email'],
      ['example.com', 'email'],
    ]);
    expect(maskedTexts(ocr('Contact jane.doe @ example.com'))).toEqual(['jane.doe', '@', 'example.com']);
  });

  it('R2-M4: truncated Monero addresses and the short second half of a wrapped one', () => {
    expect(masked(ocr('To 44AFFq...QBEP3A'))).toContainEqual(['44AFFq...QBEP3A', 'account']);
    expect(masked(ocr('Wallet 44AFFq…QBEP3A'))).toEqual([['44AFFq…QBEP3A', 'account']]);
    expect(detectSensitiveText('send to 44AFFq…QBEP3A')).toEqual(['account']);
    const addr = '4A' + 'x9Yz'.repeat(23) + 'q';
    const first = addr.slice(0, 70);
    const second = addr.slice(70);
    expect(masked(ocr(first, second))).toEqual([
      [first, 'account'],
      [second, 'account'],
    ]);
    for (const s of ['Anyway...thanks', '41st...street', 'Bye...see you']) expect(detectSensitiveText(s), s).toEqual([]);
  });
});

/** Real-world phone formats per supported country (round 2): each must be masked as a phone. */
const PHONES: Record<string, string[]> = {
  US: ['(415) 555-0134', '415-555-0134', '415.555.0134', '+1 415 555 0134', '+1 (415) 555-0134'],
  UK: ['07700 900123', '+44 7700 900123', '020 7946 0958', '(020) 7946 0958'],
  CA: ['(416) 555-0199', '+1 416-555-0199', '416.555.0199'],
  DE: ['030 1234567', '+49 30 1234567', '0171/1234567', '0171 1234567', '+49 (0)171 1234567', '030/12345678'],
  FR: ['06 12 34 56 78', '06.12.34.56.78', '+33 6 12 34 56 78', '01-02-03-04-05', '+33 6.12.34.56.78'],
  NL: ['06-12345678', '+31 6 12345678', '020 123 4567', '020-1234567'],
  ES: ['612 34 56 78', '+34 612 345 678', '91 123 45 67', '612 345 678'],
  IT: ['347 123 4567', '347.1234567', '+39 06 1234 5678', '02.12345678', '+39 347 1234567'],
  BE: ['0470/12.34.56', '0470 12 34 56', '+32 470 12 34 56', '0470 01.02.03', '+32 470 01.02.03', '02/123.45.67', '0470.12.34.56', '+32 (0)470 01.02.03', '+32(0)470 01.02.03'],
  // Round 3 (review 2026-10-30): the reviewer's extra countries.
  PT: ['912 345 678', '+351 21 123 4567'],
  PL: ['22 123 45 67', '(22) 123 45 67'],
  SE: ['070-123 45 67', '08-12 34 56'],
  CH: ['079 123 45 67', '079/123.45.67', '+41 (0)79 123 45 67'],
  AT: ['0664/123 45 67', '+43 (0)1 1234567', '0664/12.34.567'],
  IE: ['(01) 234 5678'],
  MX: ['+52 1 55 1234 5678', '(55) 1234-5678'],
  BR: ['(11) 91234-5678', '(11)91234-5678', '+55 (11) 9 1234-5678'],
  AU: ['(02) 9876 5432', '+61 (0)412 345 678'],
  IN: ['98765 43210', '+91-98765-43210'],
  NG: ['+234 (0) 803 123 4567'],
  // Round 3: Unicode dashes and spaces inside one OCR word, and OCR look-alikes.
  'Unicode separators': ['415–555–0134', '415—555—0134', '06–12–34–56–78', '415‐555‐0134', '415−555−0134', '06\u202f12\u202f34\u202f56\u202f78', '06\u00a012\u00a034\u00a056\u00a078'],
  'OCR look-alikes': ['O6 12 34 56 78', '+44 77OO 9OO123', '0612 3456 7B', '(4l5) 555-Ol34', '+49 l7l l234567'],
};

describe('phone formats per country', () => {
  for (const [country, phones] of Object.entries(PHONES)) {
    it(`${country}: masked in OCR words, refused in notes, dates and amounts nearby kept`, () => {
      for (const p of phones) {
        const words = p.split(' ');
        expect(masked(ocr(`Tel ${p}`)), p).toEqual(words.map((t) => [t, 'phone']));
        expect(masked(ocr(`412.50 on 16.10.26 to ${p}`)), p).toEqual(words.map((t) => [t, 'phone']));
        expect(masked(ocr(`Oct 16, 2026 14:32 ${p}`)), p).toEqual(words.map((t) => [t, 'phone']));
        expect(detectSensitiveText(`call me ${p}`), p).toEqual(['phone']);
        expect(detectSensitiveText(`Paid on 16.10.26 at 14:32, call me ${p}`), p).toEqual(['phone']);
      }
    });
  }
});

describe('review round 3 (2026-10-30)', () => {
  it('R3-I3: Unicode dashes in OCR words are separators', () => {
    expect(masked(ocr('Card 4111–1111–1111–1111'))).toEqual([['4111–1111–1111–1111', 'card']]);
    expect(masked(ocr('Card 4111—1111—1111—1111'))).toEqual([['4111—1111—1111—1111', 'card']]);
    expect(masked(ocr('IBAN DE89–3704–0044–0532–0130–00'))).toEqual([['DE89–3704–0044–0532–0130–00', 'iban']]);
    expect(masked(ocr('Tel 415−555−0134'))).toEqual([['415−555−0134', 'phone']]);
  });

  it('R3-I3: Unicode dashes, spaces, tabs and digits in notes', () => {
    expect(detectSensitiveText('card 4111–1111–1111–1111')).toEqual(['card']);
    expect(detectSensitiveText('iban DE89–3704–0044–0532–0130–00')).toEqual(['iban']);
    expect(detectSensitiveText('card 4111\u00a01111\u00a01111\u00a01111')).toEqual(['card']);
    expect(detectSensitiveText('iban DE89\u00a03704\u00a00044\u00a00532\u00a00130\u00a000')).toEqual(['iban']);
    expect(detectSensitiveText('call 06\u202f12\u202f34\u202f56\u202f78')).toEqual(['phone']);
    expect(detectSensitiveText('call 06\t12\t34\t56\t78')).toEqual(['phone']);
    expect(detectSensitiveText('call ０６１２３４５６７８')).toEqual(['account']);
    expect(detectSensitiveText('call ٠٦١٢٣٤٥٦٧٨')).toEqual(['account']);
    expect(detectSensitiveText('call ۰۶۱۲۳۴۵۶۷۸')).toEqual(['account']);
    expect(detectSensitiveText('call ०६१२३४५६७८')).toEqual(['account']);
    expect(detectSensitiveText('call ٠٦ ١٢ ٣٤ ٥٦ ٧٨')).toEqual(['phone']);
    expect(detectSensitiveText('mail ｊａｎｅ＠ｅｘａｍｐｌｅ．ｃｏｍ')).toEqual(['email']);
    // Normalisation does not invent details.
    expect(detectSensitiveText('took 15 – 20 minutes, paid 15,50\u00a0€')).toEqual([]);
  });

  it('R3-I3: astral digits (two UTF-16 units each) keep the offsets in line', () => {
    expect(detectSensitiveText('call 𝟎𝟔 𝟏𝟐 𝟑𝟒 𝟓𝟔 𝟕𝟖')).toEqual(['phone']);
    const w = ocr('Tel 𝟎𝟔-𝟏𝟐-𝟑𝟒-𝟓𝟔-𝟕𝟖 ok jane@x.io ok');
    expect(masked(w)).toEqual([
      ['𝟎𝟔-𝟏𝟐-𝟑𝟒-𝟓𝟔-𝟕𝟖', 'phone'],
      ['jane@x.io', 'email'],
    ]);
    // A kept part in the same word as an astral-digit number: the region still starts after the code.
    const rs = detectSensitive(ocr('K7M2-9QXA-4FTR-8WPN/𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖'), KEEP);
    expect(rs).toEqual([{ x0: 190, y0: 0, x1: 360, y1: 16, kind: 'account' }]);
  });

  it('R3-I1: only real currency or crypto codes make a long decimal an amount', () => {
    for (const s of ['TEL 347.1234567', 'SMS 347.1234567', 'MOB 347.1234567', 'CEL 347.1234567', '347.1234567 SMS only', 'call 347.1234567 PLS', 'call 612.345678 SMS']) {
      expect(detectSensitiveText(s), s).toEqual(['phone']);
    }
    for (const s of ['got 0.12345678 XMR', 'got 0.12345678 xmr', 'got 0.12345678 Monero', 'Rate 1.0234 EUR/XMR', 'paid 0.0012345 btc', 'USDT 0.123456', '€ 1.2345']) {
      expect(detectSensitiveText(s), s).toEqual([]);
    }
  });

  it('R3-I2: the Belgian (0) form', () => {
    expect(maskedTexts(ocr('Tel +32 (0)470 01.02.03'))).toEqual(['+32', '(0)470', '01.02.03']);
    expect(maskedTexts(ocr('Tel +32(0)470 01.02.03'))).toEqual(['+32(0)470', '01.02.03']);
    expect(detectSensitiveText('call +32 (0)470 01.02.03')).toEqual(['phone']);
    expect(detectSensitiveText('Paid 412.50 16.10.26')).toEqual([]);
  });

  it('R3-M2: Monero addresses wrapped more than once, split by spaces, or shortened with spaces', () => {
    const lines = ['44AFFq5kSiGBoZ4NMDwYtN18', 'obc8AemS33DBLWs3H7otXft3', 'XjrpDtQGv7SqSsaBYBb98uNb', 'r2VBBEt7f2wfn3RVGQBEP3A'];
    expect(masked(ocr(...lines))).toEqual(lines.map((t) => [t, 'account']));
    const addr = lines.join('');
    const parts = [addr.slice(0, 30), addr.slice(30, 60), addr.slice(60)];
    expect(masked(ocr(parts.join(' ')))).toEqual(parts.map((t) => [t, 'account']));
    expect(masked(ocr('Wallet 44AFFq … QBEP3A')).map(([t]) => t)).toEqual(['44AFFq', '…', 'QBEP3A']);
    expect(detectSensitiveText(`send to ${lines[0]} ${lines[1]}`)).toEqual(['account']);
  });

  it('R3-M3: emails split around the TLD dot or misread, and UPI IDs', () => {
    expect(maskedTexts(ocr('Contact jane@example .com'))).toEqual(['jane@example', '.com']);
    expect(maskedTexts(ocr('Contact jane@example. com'))).toEqual(['jane@example.', 'com']);
    expect(maskedTexts(ocr('Contact jane @example .com'))).toEqual(['jane', '@example', '.com']);
    expect(masked(ocr('Contact jane@example.c0m'))).toEqual([['jane@example.c0m', 'email']]);
    expect(masked(ocr('UPI jane@okaxis'))).toEqual([['jane@okaxis', 'account']]);
    expect(masked(ocr('Mail jane.doe@gmail'))).toEqual([['jane.doe@gmail', 'account']]);
    expect(detectSensitiveText('pay jane@okaxis')).toEqual(['account']);
    expect(detectSensitiveText('mail jane@example.com')).toEqual(['email']);
  });

  it('R3-M3: the UPI rule follows its flag (PENDING OWNER, owner item 34)', () => {
    expect(UPI_IDS).toBe(true);
    expect(detectSensitiveText('pay jane@okaxis', { upiIds: false })).toEqual([]);
    expect(detectSensitiveText('pay jane@okaxis', { upiIds: true })).toEqual(['account']);
    expect(maskedTexts(ocr('UPI jane@okaxis'), KEEP, { upiIds: false })).toEqual([]);
    expect(maskedTexts(ocr('UPI jane@okaxis'), KEEP, { upiIds: true })).toEqual(['jane@okaxis']);
  });

  it('R3-M4: a look-alike in a bracketed area code or a short group is masked', () => {
    expect(masked(ocr('Tel (4l5) 555-Ol34'))).toEqual(['(4l5)', '555-Ol34'].map((t) => [t, 'phone']));
    expect(masked(ocr('Tel +49 l7l l234567'))).toEqual(['+49', 'l7l', 'l234567'].map((t) => [t, 'phone']));
  });

  it('R3-M5: spaced dates, date ranges, "ending in" a year, single-x tails', () => {
    for (const s of ['16. 10. 2026', 'from 16.10.2026-17.10.2026', 'from 16.10.2026 – 17.10.2026', 'contract ending in 2026']) expect(detectSensitiveText(s), s).toEqual([]);
    expect(maskedTexts(ocr('Sent 16. 10. 2026'))).toEqual([]);
    expect(detectSensitiveText('card ending in 1234')).toEqual(['account']);
    expect(maskedTexts(ocr('Card ending in 2026'))).toEqual(['2026']);
    expect(masked(ocr('Acc x1234'))).toEqual([['x1234', 'account']]);
  });

  it('other masked forms from the round-3 table', () => {
    expect(masked(ocr('Tel 08031234567'))).toEqual([['08031234567', 'account']]);
    expect(detectSensitiveText('call 08031234567')).toEqual(['account']);
  });
});
