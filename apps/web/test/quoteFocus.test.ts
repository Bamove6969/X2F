// Design review 8 Nov 2026, item 4: the amount field's focus was the global 2 px ink outline drawn
// around the bare input, a hard white box inside the field. The boards show a soft 1 px focus border
// on the field itself. The field must still show focus (WCAG 2.4.7): the outline goes only where the
// box draws its own border instead.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const CSS = readFileSync(fileURLToPath(new URL('../src/screens/quote/quote.css', import.meta.url)), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

function body(selector: string): string | null {
  for (const m of CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (m[1]!.trim().replace(/\s+/g, ' ') === selector) return m[2]!;
  }
  return null;
}

describe('quote amount field focus', () => {
  it('drops the outline on the bare input', () => {
    expect(body('.x2f-quote__box input:focus-visible')).toMatch(/outline:\s*none/);
  });

  it('the box takes a 1 px ink border while its input has focus', () => {
    expect(body('.x2f-quote__box:focus-within')).toMatch(/border-color:\s*var\(--x2f-ink\)/);
  });

  it('a field in error keeps the danger border and still shows focus', () => {
    expect(body('.x2f-quote__box[data-bad]:focus-within')).toMatch(/box-shadow:[^;]*var\(--x2f-danger\)/);
  });
});
