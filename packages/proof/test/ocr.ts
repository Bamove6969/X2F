import type { OcrWord } from '../src/index.js';

/**
 * Synthetic OCR output: each string is one line, split on spaces into words. A character is 10 px
 * wide and a line 20 px tall (line n spans y = 20n .. 20n + 16), so a word's box follows its column.
 */
export function ocr(...lines: string[]): OcrWord[] {
  const out: OcrWord[] = [];
  lines.forEach((text, line) => {
    let col = 0;
    for (const part of text.split(' ')) {
      if (part.length > 0) {
        out.push({ text: part, x0: col * 10, y0: line * 20, x1: (col + part.length) * 10, y1: line * 20 + 16, line, conf: 90 });
      }
      col += part.length + 1;
    }
  });
  return out;
}

/** The texts of the words a region covers (words whose box lies inside it). */
export function covered(words: OcrWord[], r: { x0: number; y0: number; x1: number; y1: number }): string[] {
  return words.filter((w) => w.x0 >= r.x0 && w.x1 <= r.x1 && w.y0 >= r.y0 && w.y1 <= r.y1).map((w) => w.text);
}
