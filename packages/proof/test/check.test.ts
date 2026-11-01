import { describe, expect, it } from 'vitest';
import { type CardTrade, type HiddenKind, type OcrWord, type ProofCheck, checkProof, proofCardLines } from '../src/index.js';
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

function check(words: OcrWord[], hidden: HiddenKind[] = ['name'], expected: Partial<typeof EXPECTED> = {}): ProofCheck {
  return checkProof(words, { ...EXPECTED, ...expected }, hidden);
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

  it('formats a mismatch in the trade currency and exponent', () => {
    const eur = check(receipt({ amount: '400,00 €' }), ['name'], { currency: 'EUR' });
    expect(eur.amount).toEqual({ status: 'mismatch', seen: 40000n });
    expect(proofCardLines(eur, { ...TRADE, total: '€412.50', currency: 'EUR' })[0]).toEqual({ tone: 'caution', text: 'Shows €400.00, not €412.50' });
    const jpy = check(ocr('¥40,000', 'a b c'), ['name'], { currency: 'JPY', exponent: 0, fiatCents: 41250n });
    expect(proofCardLines(jpy, { ...TRADE, total: '¥41,250', currency: 'JPY', exponent: 0 })[0]).toEqual({ tone: 'caution', text: 'Shows ¥40,000, not ¥41,250' });
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

  it('the day before securedAt is in range in every time zone; two days before is not', () => {
    expect(check(receipt({ date: 'Oct 15, 2026' })).date).toBe('in-range');
    expect(check(receipt({ date: 'Oct 14, 2026' })).date).toBe('in-range');
    expect(check(receipt({ date: 'Oct 13, 2026' })).date).toBe('out-of-range');
  });

  it('a date that is not a calendar day is not a date', () => {
    expect(check(receipt({ date: '2026-02-30' })).date).toBe('not-found');
  });

  // PENDING LEAD (copy): the plan gives no date line; the card shows none for any status.
  it('shows no date line', () => {
    const lines = proofCardLines(check(receipt({ date: 'Oct 2, 2026' })), TRADE);
    expect(lines).toEqual(proofCardLines(check(receipt()), TRADE));
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

describe('readable', () => {
  const low = (words: OcrWord[], conf: number): OcrWord[] => words.map((w) => ({ ...w, conf }));

  it('unreadable OCR → one "couldn\'t read" line plus the closing line', () => {
    const c = check(low(receipt(), 59));
    expect(c.readable).toBe(false);
    expect(proofCardLines(c, TRADE)).toEqual([{ tone: 'caution', text: "We couldn't read this screenshot" }, CLOSING]);
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
                if (!readable) expect(lines).toHaveLength(2);
                cases++;
              }
    expect(cases).toBe(2 * 4 * 2 * 3 * 3 * 53);
  });
});
