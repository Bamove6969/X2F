// The staff stylesheet's block structure (disputes-stack review 2026-11-16: merge 3c63c18e left the
// ModCase `@media (max-width: 900px)` block unclosed, so every rule after it, the owner's unread
// badge (O-040) first, applied only below 900 px). Braces must balance, and each top-level rule the
// file means for every width must sit outside any at-rule.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/ui/staff.css', import.meta.url), 'utf8');

/** The selector heads of the rules nested inside an at-rule (depth > 0), comments and strings removed. */
function blocks(src: string): { balanced: boolean; nested: string[] } {
  const text = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/'[^']*'|"[^"]*"/g, '""');
  let depth = 0;
  let head = '';
  let balanced = true;
  const nested: string[] = [];
  for (const ch of text) {
    if (ch === '{') {
      if (depth > 0 && !head.trim().startsWith('@')) nested.push(head.trim());
      depth += 1;
      head = '';
    } else if (ch === '}') {
      depth -= 1;
      if (depth < 0) balanced = false;
      head = '';
    } else if (ch === ';') {
      head = '';
    } else {
      head += ch;
    }
  }
  return { balanced: balanced && depth === 0, nested };
}

describe('staff.css', () => {
  it('every block is closed, and the owner\'s unread badge is styled at every width (outside any @media)', () => {
    const { balanced, nested } = blocks(css);
    expect(balanced).toBe(true);
    expect(nested.some((s) => s.includes('.x2f-staff__badge'))).toBe(false);
    // The ModCase stack below 900 px stays inside its @media.
    expect(nested).toContain('.x2f-staff-case');
  });
});
