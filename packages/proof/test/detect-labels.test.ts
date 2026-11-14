import { describe, expect, it } from 'vitest';
import { REVIEW_NOTE_NUMBER_LABELS, amountBoxes, checkProof, detectSensitive, detectSensitiveText, type HiddenKind, type OcrWord } from '../src/index.js';
import { covered, ocr } from './ocr.js';

// Owner G17 (2026-11-07) and F15 (2026-11-06): read the field label before a number to decide what
// to blur. After a personal label (phone, account, acct, card, IBAN, ...) the number is blurred,
// even when short or equal to the trade amount; the trade code, the trade amount and the time stay
// clear (Q50); other numbers that look personal are still blurred.

const CODE = 'K7M2-9QXA-4FTR-8WPN';
/** A trade of $4,125.00: its whole part is a likely card ending. */
const KEEP = { tradeCode: CODE, fiatCents: 412500n, exponent: 2 };

function masked(words: OcrWord[], keep = KEEP): Array<[string, HiddenKind]> {
  return detectSensitive(words, keep).flatMap((r) => covered(words, r).map((t): [string, HiddenKind] => [t, r.kind]));
}

const texts = (words: OcrWord[], keep = KEEP): string[] => masked(words, keep).map(([t]) => t);

describe('a personal label before a number blurs it (G17)', () => {
  it('short account numbers after an account label', () => {
    expect(masked(ocr('Acct 4821'))).toEqual([['4821', 'account']]);
    expect(masked(ocr('Account no. 48213'))).toEqual([['48213', 'account']]);
    expect(masked(ocr('Account number: 4821 993'))).toEqual([
      ['4821', 'account'],
      ['993', 'account'],
    ]);
    expect(masked(ocr('A/C 70221'))).toEqual([['70221', 'account']]);
    expect(masked(ocr('Paid from account 4821'))).toEqual([['4821', 'account']]);
    expect(masked(ocr('Card ...4821'))).toEqual([['...4821', 'card']]);
    expect(masked(ocr('Routing # 0210 0002 1'))).toEqual(['0210', '0002', '1'].map((t): [string, HiddenKind] => [t, 'account']));
  });

  it('a phone label names the kind of a number with no separators', () => {
    expect(masked(ocr('Mobile 5550134'))).toEqual([['5550134', 'phone']]);
    expect(masked(ocr('Phone: 0134 22'))).toEqual([
      ['0134', 'phone'],
      ['22', 'phone'],
    ]);
    expect(masked(ocr('WhatsApp +52 1234'))).toEqual([
      ['+52', 'phone'],
      ['1234', 'phone'],
    ]);
  });

  it('card endings, masked or not, after a card label', () => {
    expect(masked(ocr('Visa •••• 7731'))).toEqual([
      ['••••', 'card'],
      ['7731', 'card'],
    ]);
    expect(masked(ocr('Debit card ending in 7731'))).toEqual([['7731', 'card']]);
    expect(masked(ocr('Card xx7731'))).toEqual([['xx7731', 'card']]);
  });

  it('a label alone on its line labels the number on the next line', () => {
    expect(masked(ocr('Card number', '7731'))).toEqual([['7731', 'card']]);
    expect(masked(ocr('Phone:', '555 0134'))).toEqual([
      ['555', 'phone'],
      ['0134', 'phone'],
    ]);
  });

  it('OCR look-alikes and accents in the label or the digits', () => {
    expect(masked(ocr('Acct 48l3'))).toEqual([['48l3', 'account']]);
    expect(masked(ocr('Teléfono 5550134'))).toEqual([['5550134', 'phone']]);
    expect(masked(ocr('Telefono 5550134'))).toEqual([['5550134', 'phone']]);
    expect(masked(ocr('Número de cuenta 48213'))).toEqual([['48213', 'account']]);
  });

  it('F15: a card ending equal to the trade amount is the card, not the amount', () => {
    // $4,125.00: "4125" stands alone, so Q17 alone would keep it clear.
    expect(texts(ocr('Card ending in 4125'))).toEqual(['4125']);
    expect(texts(ocr('Visa •••• 4125'))).toEqual(['••••', '4125']);
    expect(texts(ocr('Acct 4125'))).toEqual(['4125']);
    expect(amountBoxes(ocr('Card ending in 4125'), KEEP)).toEqual([]);
    // The amount itself is still clear on the same receipt.
    const w = ocr('Card ending in 4125', 'Amount $4,125.00', 'Total 4125');
    expect(texts(w)).toEqual(['4125']);
    expect(amountBoxes(w, KEEP)).toHaveLength(2);
  });

  it('the smart check does not read a card ending as the amount (F15)', () => {
    const expected = { ...KEEP, currency: 'USD', earliest: new Date('2026-10-15T00:00:00Z'), latest: new Date('2026-10-17T00:00:00Z') };
    const c = checkProof(ocr('Payment sent', 'Card ending in 4125', `Memo ${CODE}`, 'Oct 16, 2026'), expected, []);
    expect(c.amount).toEqual({ status: 'not-found', seen: null });
    expect(checkProof(ocr('Payment sent', 'Total 4125', `Memo ${CODE}`), expected, []).amount.status).toBe('match');
  });

  it('a label with no number after it, or a word that only contains one, changes nothing', () => {
    expect(masked(ocr('Account name: Jane Doe'))).toEqual([
      ['Jane', 'name'],
      ['Doe', 'name'],
    ]);
    expect(texts(ocr('Hotel 12 nights'))).toEqual([]);
    expect(texts(ocr('Card payment 4 items'))).toEqual([]);
    expect(texts(ocr('Account 2 of 3'))).toEqual([]);
  });

  it('a date or time after a personal label stays clear', () => {
    expect(texts(ocr('Card 16 Oct 2026 14:32'))).toEqual([]);
  });
});

describe('"Trade code", "Amount" and the time stay clear (F15, Q50)', () => {
  it('the trade amount after an amount label, and this trade\'s code after a "Trade code" label', () => {
    expect(texts(ocr('Amount 4125', 'Total: 4,125.00', `Trade code ${CODE}`))).toEqual([]);
  });

  it('a number after an amount label that is not the trade amount is still blurred when it looks personal (fail-safe)', () => {
    expect(texts(ocr('Amount 12500000'))).toEqual(['12500000']);
    expect(texts(ocr('Total 555-201-3344'))).toEqual(['555-201-3344']);
    expect(texts(ocr('Amount 4111 1111 1111 1111'))).toEqual(['4111', '1111', '1111', '1111']);
  });

  it('times stay clear', () => {
    expect(texts(ocr('Time 14:32', 'Sent at 2:14 PM', 'Phone 06.12.34.56.78'))).toEqual(['06.12.34.56.78']);
  });

  it('numbers that look personal with no label are still blurred', () => {
    expect(texts(ocr('Ref 4821 9930 1102'))).toEqual(['4821', '9930', '1102']);
    expect(texts(ocr('Transaction 482199301102'))).toEqual(['482199301102']);
  });
});

describe('review notes read the label too (G17)', () => {
  it('a short or grouped number after a personal label is a personal detail', () => {
    expect(detectSensitiveText('my phone 612 345 678')).toEqual(['phone']);
    expect(detectSensitiveText('Acct 4821 if you want to pay again')).toEqual(['account']);
    expect(detectSensitiveText('card ending 7731')).toEqual(['card']);
    expect(detectSensitiveText('IBAN: 1234 5678')).toEqual(['iban']);
  });

  it('without a label, the item-29 rule stands', () => {
    expect(detectSensitiveText('paid 612 345 678 COP, smooth')).toEqual([]);
    expect(detectSensitiveText('Took 2 days, account 3 years old')).toEqual([]);
    expect(detectSensitiveText('fast trade, 10/10')).toEqual([]);
  });

  it('a date after a label is not a detail', () => {
    expect(detectSensitiveText('card 16/10/2026')).toEqual([]);
  });
});

// Review 2026-11-10 finding 5, lead default pending owner p11-142: review notes read only the account
// and IBAN labels; proofs keep every label (F15: a number after `Card` is the card).
describe('review notes: no card or phone field labels (REVIEW_NOTE_NUMBER_LABELS)', () => {
  const notes = { numberLabels: REVIEW_NOTE_NUMBER_LABELS };
  it('a payment method and an amount is feedback in a note, a detail by default', () => {
    expect(REVIEW_NOTE_NUMBER_LABELS).toEqual(['iban', 'account']);
    for (const s of ['Paid with Visa 1500 EUR', 'Sent via mobile 2500 MXN', 'Paid by card 1000', 'card 2024 trade went smoothly']) {
      expect(detectSensitiveText(s, notes), s).toEqual([]);
      expect(detectSensitiveText(s), s).not.toEqual([]);
    }
  });

  it('account and IBAN labels, and details by their own shape, still count in notes', () => {
    expect(detectSensitiveText('Acct 4821 if you want to pay again', notes)).toEqual(['account']);
    expect(detectSensitiveText('IBAN: 1234 5678', notes)).toEqual(['iban']);
    expect(detectSensitiveText('card 4111 1111 1111 1111', notes)).toEqual(['card']);
    expect(detectSensitiveText('call +34 612 345 678', notes)).toEqual(['phone']);
  });

  it('proofs keep the strict labels', () => {
    expect(masked(ocr('Visa 1500'))).toEqual([['1500', 'card']]);
    expect(masked(ocr('Mobile 2500'))).toEqual([['2500', 'phone']]);
  });
});

describe('P-014: Russian and Turkish number labels', () => {
  it('a Russian label names the kind of the number after it', () => {
    expect(masked(ocr('Телефон: 5550134'))).toEqual([['5550134', 'phone']]);
    expect(masked(ocr('Карта •• 4821'))).toEqual([['••', 'card'], ['4821', 'card']]);
    expect(masked(ocr('Номер карты 4821'))).toEqual([['4821', 'card']]);
    // Review m1: the inflected "телефона" (genitive, as in "Номер телефона") is a phone label too, so a
    // short number after it is blurred; "Номер телефона" names the phone, not a generic number.
    expect(masked(ocr('Номер телефона: 5550'))).toEqual([['5550', 'phone']]);
    expect(masked(ocr('НОМЕР ТЕЛЕФОНА 5550'))).toEqual([['5550', 'phone']]);
    expect(masked(ocr('Телефона 5550'))).toEqual([['5550', 'phone']]);
    expect(masked(ocr('Номер телефона', '5550', 'СБП'))).toEqual([['5550', 'phone']]);
    expect(masked(ocr('Счёт № 70221'))).toEqual([['70221', 'account']]);
    expect(masked(ocr('Счет: 70221'))).toEqual([['70221', 'account']]);
  });

  it('a Turkish label names the kind of the number after it', () => {
    expect(masked(ocr('Cep telefonu: 5550134'))).toEqual([['5550134', 'phone']]);
    expect(masked(ocr('Kart no: 4821'))).toEqual([['4821', 'card']]);
    expect(masked(ocr('Kart numarası 4821'))).toEqual([['4821', 'card']]);
    expect(masked(ocr('Hesap no: 70221'))).toEqual([['70221', 'account']]);
    expect(masked(ocr('HESAP NUMARASI 70221'))).toEqual([['70221', 'account']]);
  });
});
