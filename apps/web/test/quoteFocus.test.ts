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
    expect(body('.x2f-quote__box:has(input:focus-visible)')).toMatch(/border-color:\s*var\(--x2f-ink\)/);
  });

  // The 1 px inner ring is an outline at -2px, not an inset box-shadow (ea617d2f): kit 1.5 keeps
  // box-shadow for the two nav-current lines only (kit-tokens.test). With the 1 px danger border it
  // reads as a 2 px danger ring, as the box-shadow did.
  it('a field in error keeps the danger border and still shows focus', () => {
    const bad = body('.x2f-quote__box[data-bad]:has(input:focus-visible)');
    expect(bad).toMatch(/outline:\s*1px solid var\(--x2f-danger\)/);
    expect(bad).toMatch(/outline-offset:\s*-2px/);
    expect(bad).not.toMatch(/box-shadow/);
  });

  it('Max and the unit switch do not light the field border (:has(input:focus-visible), not :focus-within)', () => {
    expect(CSS.match(/\.x2f-quote__box(\[data-bad\])?:focus-within/g)).toHaveLength(1); // only the forced-colors rule
  });

  it('forced colors (High Contrast): the box draws a Highlight outline, since borders and shadows are replaced', () => {
    const m = CSS.match(/@media \(forced-colors: active\)\s*\{[^@]*?\.x2f-quote__box:focus-within\s*\{([^{}]*)\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/outline:\s*2px solid Highlight/);
    expect(m![1]).toMatch(/outline-offset:\s*2px/);
  });

  // The error-focus rule above is an outline too and outranks `.x2f-quote__box:focus-within`
  // ((0,4,1) against (0,2,0)), so without its own forced-colors rule an error field in focus would
  // draw the 1 px inner ring instead of the Highlight outline.
  it('forced colors: a field in error with focus draws the same Highlight outline', () => {
    const m = CSS.match(/@media \(forced-colors: active\)\s*\{[^@]*?\.x2f-quote__box\[data-bad\]:has\(input:focus-visible\)\s*\{([^{}]*)\}/);
    expect(m).not.toBeNull();
    expect(m![1]).toMatch(/outline:\s*2px solid Highlight/);
    expect(m![1]).toMatch(/outline-offset:\s*2px/);
  });
});
