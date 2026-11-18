// Names with no label (lead, 2026-11-12, after the Task 13 recall run): payment apps show the payee
// as a big line at the top (Zelle, Cash App, Venmo) or as the caption under an avatar's initials
// (Wise, Revolut). The detector reads that from the OCR word heights and positions.
import { describe, expect, it } from 'vitest';
import { detectSensitive, type HiddenKind, type OcrWord } from '../src/index.js';
import { covered } from './ocr.js';

const KEEP = { tradeCode: 'K7M2-9QXA-4FTR-8WPN', fiatCents: 41250n, exponent: 2 };

/**
 * Synthetic OCR with sizes: each entry is [text, glyph height]. Lines stack top to bottom with a
 * gap of half their height; a character is 0.55 × the height wide.
 */
function sized(...lines: Array<[string, number]>): OcrWord[] {
  const out: OcrWord[] = [];
  let y = 0;
  lines.forEach(([text, h], line) => {
    let x = 0;
    const cw = Math.round(h * 0.55);
    for (const part of text.split(' ')) {
      if (part.length > 0) out.push({ text: part, x0: x, y0: y, x1: x + part.length * cw, y1: y + h, line, conf: 90 });
      x += (part.length + 1) * cw;
    }
    y += Math.round(h * 1.5);
  });
  return out;
}

function masked(words: OcrWord[]): Array<[string, HiddenKind]> {
  return detectSensitive(words, KEEP).flatMap((r) => covered(words, r).map((t): [string, HiddenKind] => [t, r.kind]));
}
const names = (words: OcrWord[]) => masked(words).filter(([, k]) => k === 'name').map(([t]) => t);

describe('a big name near the top (Zelle, Cash App, Venmo)', () => {
  it('Zelle style: the large line under "You sent money to" is the payee; the amount and code stay', () => {
    const w = sized(['You sent money to', 18], ['Rowan Ellis', 34], ['$412.50', 44], ['Memo K7M2-9QXA-4FTR-8WPN', 18], ['Today 10:42', 18]);
    expect(names(w)).toEqual(['Rowan', 'Ellis']);
    const all = masked(w).map(([t]) => t);
    expect(all).not.toContain('$412.50');
    expect(all).not.toContain('K7M2-9QXA-4FTR-8WPN');
  });

  it('Venmo style: the name at the very top, the handle under it', () => {
    const w = sized(['Jordan Pike', 32], ['@jordan-pike', 18], ['$412.50', 40], ['Pizza K7M2-9QXA-4FTR-8WPN', 18], ['Paid with Venmo balance', 16]);
    expect(names(w)).toEqual(['Jordan', 'Pike']);
    expect(masked(w)).toContainEqual(['@jordan-pike', 'handle']);
  });

  it('a non-Latin name is a name too (scripts without case)', () => {
    for (const n of ['Анна Петрова', 'Νίκος Παπαδόπουλος', '李 小明']) {
      const w = sized(['Payment sent', 18], [n, 34], ['$412.50', 40], ['K7M2-9QXA-4FTR-8WPN', 18]);
      expect(names(w), n).toEqual(n.split(' '));
    }
  });

  it('a big heading is not a name: app words, status words, the brand', () => {
    for (const heading of ['Payment sent', 'Transfer complete', 'Money Sent', 'Cash App', 'Payment Details', 'You Paid']) {
      const w = sized([heading, 34], ['Total $412.50', 18], ['Ref K7M2-9QXA-4FTR-8WPN', 18], ['Thanks for using us', 18]);
      expect(names(w), heading).toEqual([]);
    }
  });

  it('a big line is not a name when it has digits, symbols, one word or more than four words', () => {
    for (const big of ['$412.50', 'K7M2-9QXA-4FTR-8WPN', 'Order 1234', 'Zelle', 'Rowan', 'Thank you so much again friend', 'rowan.ellis@example.net']) {
      const w = sized([big, 34], ['Sent 10:42', 18], ['Paid with Zelle', 18], ['Details below', 18]);
      expect(names(w), big).toEqual([]);
    }
  });

  it('only near the top: the same big name at the bottom of the receipt is left (no label, no avatar)', () => {
    const w = sized(['Payment sent', 18], ['Amount $412.50', 18], ['Ref K7M2-9QXA-4FTR-8WPN', 18], ['Status done', 18], ['Fee none', 18], ['Note none', 18], ['Rowan Ellis', 34]);
    expect(names(w)).toEqual([]);
  });

  it('when every line is the same size nothing stands out, so nothing new is masked', () => {
    const w = sized(['Rowan Ellis', 18], ['$412.50', 18], ['K7M2-9QXA-4FTR-8WPN', 18], ['Thanks', 18]);
    expect(names(w)).toEqual([]);
  });

  it('lower-case words are not a name (a sentence, not a payee)', () => {
    const w = sized(['all done here', 34], ['$412.50', 18], ['K7M2-9QXA-4FTR-8WPN', 18], ['Thanks', 18]);
    expect(names(w)).toEqual([]);
  });
});

describe('an avatar caption (Wise, Revolut)', () => {
  it("the initials and the line under them that they abbreviate are the payee's", () => {
    const w = sized(['DM', 30], ['Devon Marsh', 20], ['You sent $412.50', 20], ['Reference K7M2-9QXA-4FTR-8WPN', 20]);
    expect(names(w)).toEqual(['DM', 'Devon', 'Marsh']);
  });

  it('three initials, a three-word name; a hyphenated or apostrophe name', () => {
    expect(names(sized(['MJO', 30], ['Mary Jane Ortiz', 20], ['$412.50', 20], ['x', 20]))).toEqual(['MJO', 'Mary', 'Jane', 'Ortiz']);
    expect(names(sized(['SO', 30], ["Sean O'Neil-Park", 20], ['$412.50', 20], ['x', 20]))).toEqual(['SO', 'Sean', "O'Neil-Park"]);
  });

  it('initials that do not match the next line are not an avatar', () => {
    expect(names(sized(['OK', 30], ['Thank You', 20], ['$412.50', 20], ['x', 20]))).toEqual([]);
    expect(names(sized(['DM', 30], ['Direct Message', 20], ['$412.50', 20], ['x', 20]))).toEqual([]);
  });

  it('an avatar whose initials the OCR did not read: the first line, name-shaped and a little larger, is the caption', () => {
    // Measured on e2e/fixtures/proofs/avatar-caption.jpg: white initials on a coloured circle are not read.
    const w = sized(['Devon Marsh', 24], ['You sent $412.50', 20], ['Account GB82 WEST 1234 5698 7654 32', 20], ['Reference K7M2-9QXA-4FTR-8WPN', 22]);
    expect(names(w)).toEqual(['Devon', 'Marsh']);
  });

  it('the first line as large as the rest, or a heading, is not taken for a caption', () => {
    expect(names(sized(['Devon Marsh', 20], ['You sent $412.50', 20], ['Reference K7M2-9QXA-4FTR-8WPN', 20], ['x', 20]))).toEqual([]);
    expect(names(sized(['Payment Received', 24], ['You got $412.50', 20], ['Reference K7M2-9QXA-4FTR-8WPN', 20], ['x', 20]))).toEqual([]);
  });

  it('a currency code over its amount is not an avatar', () => {
    expect(names(sized(['USD', 30], ['412.50', 20], ['K7M2-9QXA-4FTR-8WPN', 20], ['x', 20]))).toEqual([]);
  });
});
