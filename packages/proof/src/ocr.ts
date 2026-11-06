// OCR words and the lines they form (Plan 5 Task 7).

/** One word as the OCR engine reports it: its text, its box in image pixels, its line and confidence. */
export interface OcrWord {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  line: number;
  conf: number;
}

/** A line of OCR words joined by single spaces, with each word's character range in `text`. */
export interface OcrLine {
  line: number;
  text: string;
  words: Array<{ word: OcrWord; start: number; end: number }>;
}

/**
 * Group words into lines by `line`, in line-number order, each line's words left to right. Words
 * with no visible text are left out.
 */
export function linesOf(words: readonly OcrWord[]): OcrLine[] {
  const byLine = new Map<number, OcrWord[]>();
  for (const w of words) {
    if (w.text.trim().length === 0) continue;
    const list = byLine.get(w.line);
    if (list) list.push(w);
    else byLine.set(w.line, [w]);
  }
  return [...byLine.entries()]
    .sort(([a], [b]) => a - b)
    .map(([line, ws]) => {
      ws.sort((a, b) => a.x0 - b.x0);
      let text = '';
      const placed = ws.map((word) => {
        if (text.length > 0) text += ' ';
        const start = text.length;
        text += word.text.trim();
        return { word, start, end: text.length };
      });
      return { line, text, words: placed };
    });
}
