import { describe, expect, it } from 'vitest';
import { type CardTrade, DATE_OUT_OF_RANGE_IF_EITHER, type HiddenKind, type OcrWord, type ProofCheck, checkProof, posterDateLine, proofCardLines, proofDate } from '../src/index.js';
import { ocr } from './ocr.js';

// Plan 5 Task 9: the smart proof check and the lines of the seller's proof card (board SellerConfirm).

const CODE = 'K7M2-9QXA-4FTR-8WPN';
const SECURED_AT = new Date('2026-10-16T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
/** `earliest` = the day before `securedAt`; `latest` = now (the caller passes both). */
const EXPECTED = {
  fiatCents: 41250n,
  currency: 'USD',
  exponent: 2,
  tradeCode: CODE,
  earliest: new Date(SECURED_AT.getTime() - DAY),
  latest: new Date('2026-10-16T20:00:00Z'),
};
const TRADE: CardTrade = { buyer: 'mira.k', total: '$412.50', code: CODE, currency: 'USD', exponent: 2 };

/** The board's closing line, always last. */
const CLOSING = {
  tone: 'caution',
  text: 'Look for a $412.50 payment with the note K7M2-9QXA-4FTR-8WPN in your bank. Screenshot checks catch mistakes, but only your bank proves the money arrived.',
} as const;

/** A Zelle-style receipt; the sender line is blurred by the buyer, so OCR reads only its label. */
function receipt(o: { amount?: string; note?: string | null; date?: string | null; from?: string | null } = {}): OcrWord[] {
  const lines = ['Zelle', 'Payment sent', o.amount ?? '$412.50'];
  if (o.from !== null) lines.push(o.from ?? 'From:');
  if (o.note !== null) lines.push(`Memo ${o.note ?? CODE}`);
  if (o.date !== null) lines.push(o.date ?? 'Oct 16, 2026 at 2:14 PM');
  return ocr(...lines);
}

function check(words: OcrWord[], hidden: HiddenKind[] = ['name'], expected: Partial<typeof EXPECTED> = {}, takenAt: Date | null = null): ProofCheck {
  return checkProof(words, { ...EXPECTED, ...expected }, hidden, takenAt);
}

describe('checkProof and proofCardLines: the board example', () => {
  it('reads the board example as all good', () => {
    expect(check(receipt())).toEqual({
      readable: true,
      amount: { status: 'match', seen: 41250n },
      reference: 'match',
      date: 'in-range',
      name: 'hidden',
    });
  });

  it('yields exactly the three board lines plus the closing line', () => {
    expect(proofCardLines(check(receipt()), TRADE)).toEqual([
      { tone: 'escrow', text: 'Shows $412.50, the right amount' },
      { tone: 'escrow', text: "Note says K7M2-9QXA-4FTR-8WPN, this trade's code" },
      { tone: 'caution', text: 'Sender name hidden by mira.k' },
      CLOSING,
    ]);
  });
});

describe('amount', () => {
  it('$400.00 → mismatch, and the mismatch line in caution', () => {
    const c = check(receipt({ amount: '$400.00' }));
    expect(c.amount).toEqual({ status: 'mismatch', seen: 40000n });
    const lines = proofCardLines(c, TRADE);
    expect(lines[0]).toEqual({ tone: 'caution', text: 'Shows $400.00, not $412.50' });
    expect(lines.some((l) => l.text === 'Shows $412.50, the right amount')).toBe(false);
  });

  it('matches when any amount on the screenshot is the trade amount; reports the first one otherwise', () => {
    expect(check(receipt({ amount: 'Fee $0.00 Total $412.50' })).amount).toEqual({ status: 'match', seen: 41250n });
    expect(check(receipt({ amount: '$400.00 then $12.50' })).amount).toEqual({ status: 'mismatch', seen: 40000n });
  });

  it('no amount in the currency → not-found, seen null', () => {
    expect(check(receipt({ amount: 'Sent' })).amount).toEqual({ status: 'not-found', seen: null });
    expect(check(receipt({ amount: '412,50 €' })).amount).toEqual({ status: 'not-found', seen: null });
  });

  it('on a mismatch, seen is the amount closest to the trade amount, not a fee or $0.00 (review N2)', () => {
    expect(check(receipt({ amount: 'Fee $0.00 Amount $400.00' })).amount).toEqual({ status: 'mismatch', seen: 40000n });
    expect(check(ocr('Fee $0.00', 'Amount $400.00', 'Balance $9,000.00', 'a b c')).amount).toEqual({ status: 'mismatch', seen: 40000n });
    expect(check(ocr('Fee $0.00', 'a b c')).amount).toEqual({ status: 'mismatch', seen: 0n });
    // A tie goes to the first in reading order.
    expect(check(ocr('$412.00 $413.00', 'a b c')).amount).toEqual({ status: 'mismatch', seen: 41200n });
  });

  it('reads amounts written with Unicode digits, as the reference and date checks do (review N6)', () => {
    expect(check(receipt({ amount: '$４１２.５０' })).amount).toEqual({ status: 'match', seen: 41250n });
    expect(check(receipt({ amount: '$٤١٢.٥٠' })).amount).toEqual({ status: 'match', seen: 41250n });
  });

  it('formats a mismatch in the trade currency and exponent', () => {
    const eur = check(receipt({ amount: '400,00 €' }), ['name'], { currency: 'EUR' });
    expect(eur.amount).toEqual({ status: 'mismatch', seen: 40000n });
    expect(proofCardLines(eur, { ...TRADE, total: '€412.50', currency: 'EUR' })[0]).toEqual({ tone: 'caution', text: 'Shows €400.00, not €412.50' });
    const jpy = check(ocr('¥40,000', 'a b c'), ['name'], { currency: 'JPY', exponent: 0, fiatCents: 41250n });
    expect(proofCardLines(jpy, { ...TRADE, total: '¥41,250', currency: 'JPY', exponent: 0 })[0]).toEqual({ tone: 'caution', text: 'Shows ¥40,000, not ¥41,250' });
  });

  it('a whole amount with no marker that Task 7 keeps clear is the amount (review RV4-M4, owner Q17)', () => {
    const whole = { fiatCents: 25000000n };
    // After an amount label, or on its own: Task 7 leaves it visible, so it is the amount, not "not found".
    expect(check(ocr('Total 250000', `Ref ${CODE}`, 'Oct 16, 2026'), ['name'], whole).amount).toEqual({ status: 'match', seen: 25000000n });
    expect(check(ocr('Amount: 250,000', `Memo ${CODE}`, 'Oct 16, 2026'), ['name'], whole).amount).toEqual({ status: 'match', seen: 25000000n });
    expect(check(ocr('Payment sent', '250000', `Memo ${CODE}`), ['name'], whole).amount).toEqual({ status: 'match', seen: 25000000n });
    // The same number as a group of a card or phone is no amount (Task 7 masks it, review RV4-I1).
    expect(check(ocr('Card 4111 - 1000 - 1111 - 1111', `Memo ${CODE}`, 'Oct 16, 2026'), ['name'], { fiatCents: 100000n }).amount).toEqual({ status: 'not-found', seen: null });
    expect(check(ocr('Tel 555 - 201 - 3344', `Memo ${CODE}`, 'Oct 16, 2026'), ['name'], { fiatCents: 334400n }).amount).toEqual({ status: 'not-found', seen: null });
    // Not the trade amount, or not a whole trade amount: unchanged.
    expect(check(ocr('Total 249999', `Memo ${CODE}`, 'Oct 16, 2026'), ['name'], whole).amount).toEqual({ status: 'not-found', seen: null });
    expect(check(ocr('Total 41250', `Memo ${CODE}`, 'Oct 16, 2026')).amount).toEqual({ status: 'not-found', seen: null });
  });

  // PENDING LEAD (copy): the plan gives no line for an amount it could not find; none is shown.
  it('shows no amount line when the amount is not found', () => {
    const lines = proofCardLines(check(receipt({ amount: 'Sent' })), TRADE);
    expect(lines.some((l) => l.text.startsWith('Shows $'))).toBe(false);
  });
});

describe('reference', () => {
  it('no code in the note → not-found, and the not-found line in caution', () => {
    const c = check(receipt({ note: null }));
    expect(c.reference).toBe('not-found');
    expect(proofCardLines(c, TRADE)[1]).toEqual({ tone: 'caution', text: "This trade's code isn't in the note" });
  });

  it("another trade's code → not-found", () => {
    expect(check(receipt({ note: 'K7M2-9QXA-4FTR-8WPM' })).reference).toBe('not-found');
  });

  it('matches with or without dashes, spaced, in any case', () => {
    for (const note of ['K7M29QXA4FTR8WPN', 'K7M2 9QXA 4FTR 8WPN', 'k7m2-9qxa-4ftr-8wpn', 'for K7M2-9QXA-4FTR-8WPN thanks']) {
      expect(check(receipt({ note })).reference, note).toBe('match');
    }
  });

  it('matches with Crockford look-alikes (O for 0; I or L for 1)', () => {
    const code = 'A0B1-C2D3-E4F5-G6H7';
    for (const note of ['AOB1-C2D3-E4F5-G6H7', 'A0BI-C2D3-E4F5-G6H7', 'A0BL-C2D3-E4F5-G6H7', 'aoblc2d3e4f5g6h7', 'AOBIC2D3E4F5G6H7']) {
      expect(check(receipt({ note }), ['name'], { tradeCode: code }).reference, note).toBe('match');
    }
  });

  it('a code inside a longer run is not a match', () => {
    expect(check(receipt({ note: 'XK7M29QXA4FTR8WPN' })).reference).toBe('not-found');
    expect(check(receipt({ note: 'K7M29QXA4FTR8WPN7' })).reference).toBe('not-found');
  });

  it('finds a code wrapped onto the next line (review N1)', () => {
    expect(check(ocr('Memo K7M2-9QXA-', '4FTR-8WPN', 'a b c')).reference).toBe('match');
    expect(check(ocr('Memo K7M2-9QXA', '4FTR-8WPN', 'a b c')).reference).toBe('match');
    expect(check(ocr('Memo K7M29QXA', '4FTR8WPN', 'a b c')).reference).toBe('match');
    // Half a code on each of two lines that are not next to each other is not a match.
    expect(check(ocr('Memo K7M2-9QXA-', 'x y z', '4FTR-8WPN')).reference).toBe('not-found');
  });

  it('finds a code with spaces around its dashes (review N1)', () => {
    for (const note of ['K7M2 - 9QXA - 4FTR - 8WPN', 'K7M2- 9QXA -4FTR  -  8WPN']) {
      expect(check(receipt({ note })).reference, note).toBe('match');
    }
  });

  it('finds a code written with Unicode dashes or digits (normalizeText, review N4)', () => {
    for (const note of ['K7M2–9QXA–4FTR–8WPN', 'K7M2—9QXA—4FTR—8WPN', 'K７M２-9QXA-4FTR-8WPN']) {
      expect(check(receipt({ note })).reference, note).toBe('match');
    }
  });

  it('refuses an expected trade code that is not a trade code', () => {
    expect(() => check(receipt(), ['name'], { tradeCode: 'nope' })).toThrow(RangeError);
  });
});

describe('date', () => {
  it('a date two weeks before securedAt → out-of-range', () => {
    expect(check(receipt({ date: 'Oct 2, 2026 at 2:14 PM' })).date).toBe('out-of-range');
  });

  it('a date after now → out-of-range', () => {
    expect(check(receipt({ date: 'Oct 20, 2026' })).date).toBe('out-of-range');
  });

  it('no date → not-found', () => {
    expect(check(receipt({ date: null })).date).toBe('not-found');
    expect(check(receipt({ date: 'at 2:14 PM' })).date).toBe('not-found');
  });

  it('reads the date formats Task 7 keeps', () => {
    for (const date of ['16 Oct 2026', 'October 16th, 2026', '2026-10-16', '2026-10-16 14:32', '10/16/2026', '16.10.2026', '16/10/26', '16. 10. 2026', 'Oct 16']) {
      expect(check(receipt({ date })).date, date).toBe('in-range');
    }
    for (const date of ['2 Oct 2026', '2026-10-02', '10/02/2026', '02.10.2025', 'Sep 16']) {
      expect(check(receipt({ date })).date, date).toBe('out-of-range');
    }
  });

  it('the day before securedAt and two days before are in range in some time zone; three days before is not', () => {
    expect(check(receipt({ date: 'Oct 15, 2026' })).date).toBe('in-range');
    expect(check(receipt({ date: 'Oct 14, 2026' })).date).toBe('in-range');
    expect(check(receipt({ date: 'Oct 13, 2026' })).date).toBe('out-of-range');
  });

  it('a date with no year can be last year, near New Year (review N4)', () => {
    const newYear = { earliest: new Date('2026-12-30T20:00:00Z'), latest: new Date('2027-01-01T01:00:00Z') };
    expect(check(receipt({ date: 'Dec 31' }), ['name'], newYear).date).toBe('in-range');
    expect(check(receipt({ date: '31 Dec' }), ['name'], newYear).date).toBe('in-range');
  });

  it('a date with no year can be next year in time zones east of UTC (review N5)', () => {
    const eve = { earliest: new Date('2026-12-30T20:00:00Z'), latest: new Date('2026-12-31T20:00:00Z') };
    expect(check(receipt({ date: 'Jan 1' }), ['name'], eve).date).toBe('in-range');
    expect(check(receipt({ date: 'Jan 3' }), ['name'], eve).date).toBe('out-of-range');
  });

  it('reads a date written with Unicode digits or dashes (normalizeText, review N4)', () => {
    for (const date of ['２０２６-10-16', '2026–10–16', '١٦/١٠/٢٠٢٦']) {
      expect(check(receipt({ date })).date, date).toBe('in-range');
    }
  });

  it('a date that is not a calendar day is not a date', () => {
    expect(check(receipt({ date: '2026-02-30' })).date).toBe('not-found');
  });

  it('shows no date line for a date in range', () => {
    expect(proofCardLines(check(receipt()), TRADE).some((l) => /dated|when this proof/.test(l.text))).toBe(false);
  });
});

// Owner G16 (2026-11-07): the photo's own date and the screenshot's (out of range if either is, lead
// default pending owner p11-140); neither → warn both sides, posting stays allowed. Q42: a stale date
// asks for a fresh screenshot.
const NOT_CONFIRMED = {
  tone: 'caution',
  text: "We couldn't confirm when this proof was made. That doesn't make it invalid, but take extra care with this trade.",
} as const;
const STALE = { tone: 'caution', text: 'This proof is dated outside this trade. Ask mira.k for a fresh screenshot.' } as const;

describe('date: the photo\'s own time (owner G16)', () => {
  it('fills in a date the screenshot does not show, and a stale photo time makes the proof out of range', () => {
    expect(check(receipt({ date: null }), ['name'], {}, new Date('2026-10-16T14:14:00Z')).date).toBe('in-range');
    expect(check(receipt(), ['name'], {}, new Date('2026-10-01T14:14:00Z')).date).toBe('out-of-range');
  });

  // Review 2026-11-10 finding 2, lead default pending owner p11-140: out of range when EITHER date is.
  it('never clears a stale date on the screenshot: a fresh photo time of an old receipt is out of range', () => {
    expect(DATE_OUT_OF_RANGE_IF_EITHER).toBe(true);
    expect(check(receipt({ date: 'Oct 2, 2026' }), ['name'], {}, new Date('2026-10-16T14:14:00Z')).date).toBe('out-of-range');
    expect(check(receipt({ date: 'Oct 2, 2026' }), ['name'], {}, new Date('2026-10-01T14:14:00Z')).date).toBe('out-of-range');
    expect(check(receipt(), ['name'], {}, new Date('2026-10-16T14:14:00Z')).date).toBe('in-range');
    expect(check(receipt({ date: null }), ['name']).date).toBe('not-found');
  });

  it('checkProof and proofDate give one verdict for every combination', () => {
    const w = { earliest: EXPECTED.earliest, latest: EXPECTED.latest };
    const shots = [receipt(), receipt({ date: null }), receipt({ date: 'Oct 2, 2026' }), receipt().map((x) => ({ ...x, conf: 10 }))];
    const photos = [null, new Date('2026-10-16T14:14:00Z'), new Date('2026-10-01T14:14:00Z'), new Date(Number.NaN)];
    for (const [i, words] of shots.entries()) {
      for (const takenAt of photos) expect(check(words, ['name'], {}, takenAt).date, `${i} ${String(takenAt)}`).toBe(proofDate(words, takenAt, w));
    }
  });

  it('is in range within 14 hours of the window, either side', () => {
    const e = EXPECTED.earliest.getTime();
    const l = EXPECTED.latest.getTime();
    const h = 60 * 60 * 1000;
    expect(check(receipt({ date: null }), ['name'], {}, new Date(e - 14 * h)).date).toBe('in-range');
    expect(check(receipt({ date: null }), ['name'], {}, new Date(e - 14 * h - 1000)).date).toBe('out-of-range');
    expect(check(receipt({ date: null }), ['name'], {}, new Date(l + 14 * h)).date).toBe('in-range');
    expect(check(receipt({ date: null }), ['name'], {}, new Date(l + 14 * h + 1000)).date).toBe('out-of-range');
  });

  it('still gives the date when the screenshot cannot be read', () => {
    const low = receipt().map((w) => ({ ...w, conf: 10 }));
    expect(check(low, ['name'], {}, new Date('2026-10-16T14:14:00Z')).date).toBe('in-range');
    expect(check(low, ['name'], {}, new Date('2026-09-16T14:14:00Z')).date).toBe('out-of-range');
    expect(check(low, ['name']).date).toBe('not-found');
  });

  it('an invalid Date counts as no date', () => {
    expect(check(receipt({ date: null }), ['name'], {}, new Date(Number.NaN)).date).toBe('not-found');
  });
});

describe('date lines (owner G16, Q42)', () => {
  it('no date anywhere: the seller is told to take extra care, not that the proof is invalid', () => {
    const lines = proofCardLines(check(receipt({ date: null })), TRADE);
    expect(lines.at(-2)).toEqual(NOT_CONFIRMED);
    expect(lines).toHaveLength(5);
  });

  it('a stale date asks for a fresh screenshot', () => {
    expect(proofCardLines(check(receipt({ date: 'Oct 2, 2026' })), TRADE).at(-2)).toEqual(STALE);
    expect(proofCardLines(check(receipt(), ['name'], {}, new Date('2026-09-01T00:00:00Z')), TRADE).at(-2)).toEqual(STALE);
  });

  it('the poster: warned when no date is found, asked for a fresh screenshot when stale, nothing when in range', () => {
    const w = { earliest: EXPECTED.earliest, latest: EXPECTED.latest };
    expect(proofDate(receipt(), null, w)).toBe('in-range');
    expect(proofDate(receipt({ date: null }), new Date('2026-10-16T14:14:00Z'), w)).toBe('in-range');
    expect(proofDate(receipt({ date: null }), null, w)).toBe('not-found');
    expect(proofDate(receipt({ date: 'Oct 2, 2026' }), null, w)).toBe('out-of-range');
    expect(proofDate(receipt({ date: 'Oct 2, 2026' }), new Date('2026-10-16T14:14:00Z'), w)).toBe('out-of-range');
    expect(proofDate(receipt().map((x) => ({ ...x, conf: 10 })), null, w)).toBe('not-found');
    expect(() => proofDate(receipt(), null, { earliest: w.latest, latest: w.earliest })).toThrow(RangeError);
    expect(posterDateLine('in-range')).toBeNull();
    expect(posterDateLine('not-found')).toEqual({
      tone: 'caution',
      text: "We couldn't detect the date of this proof. You can still post it, and the seller will be told to take extra care.",
    });
    expect(posterDateLine('out-of-range')).toEqual({ tone: 'caution', text: 'This screenshot is dated outside this trade. Take a fresh screenshot of the payment.' });
  });

});

describe('name (P5-A28)', () => {
  it('hidden containing name → hidden even when a name label and a name are present', () => {
    expect(check(receipt({ from: 'From: Jane Doe' }), ['name']).name).toBe('hidden');
    expect(check(receipt({ from: 'From: Jane Doe' }), ['account', 'name']).name).toBe('hidden');
  });

  it('a visible sender name → visible, with the P5-A28 line in caution', () => {
    const c = check(receipt({ from: 'From: Jane Doe' }), []);
    expect(c.name).toBe('visible');
    expect(proofCardLines(c, TRADE)[2]).toEqual({ tone: 'caution', text: 'Shows a sender name. Check it matches the sender in your bank.' });
  });

  it('no name and nothing hidden as a name → not-found, and no name line', () => {
    const c = check(receipt({ from: null }), ['manual']);
    expect(c.name).toBe('not-found');
    expect(proofCardLines(c, TRADE).some((l) => l.text.includes('ender name'))).toBe(false);
  });
});

describe('name: sender labels only (review N3)', () => {
  it("a recipient label ('To:', 'Paid to', 'Recipient') is not a sender name", () => {
    for (const from of ['To: Bob Seller', 'Paid to Bob Seller', 'Recipient: Bob Seller', 'Sent to: Bob Seller']) {
      expect(check(receipt({ from }), []).name, from).toBe('not-found');
    }
  });

  it('each sender label counts, on its line or with the name on the next line', () => {
    for (const from of ['From: Jane Doe', 'from Jane Doe', 'Sender: Jane Doe', 'Payer: Jane Doe', 'Sent by Jane Doe', 'Status: done From: Jane Doe']) {
      expect(check(receipt({ from }), []).name, from).toBe('visible');
    }
    expect(check(ocr('Zelle', '$412.50', 'From', 'Jane Doe', `Memo ${CODE}`), []).name).toBe('visible');
  });

  it('a lone sender label whose next line holds the trade code, an amount or a date is not a name', () => {
    // The buyer blurred the name by hand: OCR reads only the label, then the memo line.
    expect(check(receipt(), ['manual']).name).toBe('not-found');
    expect(check(ocr('Zelle', 'From:', '$412.50', 'a b'), ['manual']).name).toBe('not-found');
    expect(check(ocr('Zelle $412.50', 'From:', 'Oct 16, 2026', 'a b'), ['manual']).name).toBe('not-found');
    expect(check(ocr('Zelle $412.50', 'From:'), ['manual']).name).toBe('not-found');
  });
});

describe('readable', () => {
  const low = (words: OcrWord[], conf: number): OcrWord[] => words.map((w) => ({ ...w, conf }));

  it('unreadable OCR → one "couldn\'t read" line plus the closing line', () => {
    const c = check(low(receipt(), 59));
    expect(c.readable).toBe(false);
    expect(proofCardLines(c, TRADE)).toEqual([{ tone: 'caution', text: "We couldn't read this screenshot" }, NOT_CONFIRMED, CLOSING]);
    // With the photo's own date in range, only the "couldn't read" line.
    const dated = check(low(receipt(), 59), ['name'], {}, new Date('2026-10-16T14:14:00Z'));
    expect(proofCardLines(dated, TRADE)).toEqual([{ tone: 'caution', text: "We couldn't read this screenshot" }, CLOSING]);
  });

  it('needs 3 words with conf >= 60', () => {
    const words = low(ocr('a b c d e'), 30);
    expect(check(words).readable).toBe(false);
    expect(check([]).readable).toBe(false);
    expect(check(words.map((w, i) => (i < 2 ? { ...w, conf: 60 } : w))).readable).toBe(false);
    expect(check(words.map((w, i) => (i < 3 ? { ...w, conf: 60 } : w))).readable).toBe(true);
  });

  it('an unreadable screenshot reports nothing found (name follows the hidden list)', () => {
    expect(check(low(receipt(), 10), ['name'])).toEqual({
      readable: false,
      amount: { status: 'not-found', seen: null },
      reference: 'not-found',
      date: 'not-found',
      name: 'hidden',
    });
    expect(check(low(receipt({ from: 'From: Jane Doe' }), 10), []).name).toBe('not-found');
  });
});

describe('the closing line (property)', () => {
  it('is present, last and exact in every case', () => {
    const amounts: ProofCheck['amount'][] = [
      { status: 'match', seen: 41250n },
      { status: 'mismatch', seen: 40000n },
      { status: 'mismatch', seen: 0n },
      { status: 'not-found', seen: null },
    ];
    const refs: ProofCheck['reference'][] = ['match', 'not-found'];
    const dates: ProofCheck['date'][] = ['in-range', 'out-of-range', 'not-found'];
    const names: ProofCheck['name'][] = ['hidden', 'visible', 'not-found'];
    const trades: CardTrade[] = [
      TRADE,
      { buyer: 'a', total: '€1.00', code: 'A0B1-C2D3-E4F5-G6H7', currency: 'EUR', exponent: 2 },
      { buyer: 'x'.repeat(40), total: '¥41,250', code: 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', currency: 'JPY', exponent: 0 },
    ];
    // Deterministic pseudo-random buyers, totals and codes on top of every combination.
    let seed = 1;
    const rnd = (n: number): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const ALPHA = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    for (let i = 0; i < 50; i++) {
      const code = Array.from({ length: 4 }, () => Array.from({ length: 4 }, () => ALPHA[rnd(32)]).join('')).join('-');
      trades.push({ buyer: `u${rnd(100000)}`, total: `$${rnd(100000)}.${String(rnd(100)).padStart(2, '0')}`, code, currency: 'USD', exponent: 2 });
    }
    let cases = 0;
    for (const readable of [true, false])
      for (const amount of amounts)
        for (const reference of refs)
          for (const date of dates)
            for (const name of names)
              for (const t of trades) {
                const lines = proofCardLines({ readable, amount, reference, date, name }, t);
                const closing = `Look for a ${t.total} payment with the note ${t.code} in your bank. Screenshot checks catch mistakes, but only your bank proves the money arrived.`;
                expect(lines.at(-1)).toEqual({ tone: 'caution', text: closing });
                expect(lines.filter((l) => l.text === closing)).toHaveLength(1);
                if (!readable) expect(lines).toHaveLength(date === 'in-range' ? 2 : 3);
                cases++;
              }
    expect(cases).toBe(2 * 4 * 2 * 3 * 3 * 53);
  });
});
