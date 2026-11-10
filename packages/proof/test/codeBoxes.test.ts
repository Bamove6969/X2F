// The boxes of the trade code in OCR words (owner 2026-11-02 08:17: warn the uploader when their own
// blur covers the amount or the memo; the memo is where the trade code is). Like `amountBoxes`.
import { describe, expect, it } from 'vitest';
import { codeBoxes } from '../src/index.js';
import { ocr } from './ocr.js';

const CODE = 'K7M2-9QXA-4FTR-8WPN';

describe('codeBoxes', () => {
  it('boxes the trade code word, not the amount, dates or other words', () => {
    const w = ocr('Oct 16, 2026', 'Note K7M2-9QXA-4FTR-8WPN', 'Amount $412.50');
    expect(codeBoxes(w, CODE)).toEqual([{ x0: 50, y0: 20, x1: 240, y1: 36 }]);
  });

  it('finds it in any case and grouping, with Crockford look-alikes', () => {
    expect(codeBoxes(ocr('memo k7m29qxa4ftr8wpn'), CODE)).toEqual([{ x0: 50, y0: 0, x1: 210, y1: 16 }]);
    expect(codeBoxes(ocr('memo K7M2-9QXA-4FTR-8WPN'.replace('0', 'O')), CODE)).toHaveLength(1);
  });

  it('boxes only the part of a word that holds the code', () => {
    const [box] = codeBoxes(ocr('Note:K7M2-9QXA-4FTR-8WPN'), CODE);
    expect(box).toEqual({ x0: 50, y0: 0, x1: 240, y1: 16 });
  });

  it('nothing when the code is not there, and a bad code is a RangeError', () => {
    expect(codeBoxes(ocr('Note rent', 'Amount $412.50'), CODE)).toEqual([]);
    expect(() => codeBoxes(ocr('x'), 'not a code')).toThrow(RangeError);
  });
});
