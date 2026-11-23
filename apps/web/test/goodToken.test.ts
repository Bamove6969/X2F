// Lead call (12 Nov 2026) on the owner's demo note ("the words strong in green letters"): a green
// colour token, `good`, that reads as text at 4.5:1 or more on ground, surface and surface-raised in
// both themes; the login step's "Strong" uses it (not the teal escrow colour).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOKENS_JSON, type Tokens } from '../../../tools/tokens-to-css.js';
import { contrast, hex } from './contrast.js';

const json = JSON.parse(readFileSync(TOKENS_JSON, 'utf8')) as Tokens;
const colour = Object.fromEntries(json.color.tokens.map((t) => [t.name, t.value]));

describe('the good (green) token', () => {
  it('exists in both themes and is a green, not the escrow teal', () => {
    const good = colour['good']!;
    expect(good).toBeDefined();
    for (const theme of ['night', 'day'] as const) {
      const [r, g, b] = hex(good[theme]);
      expect(g).toBeGreaterThan(r);
      expect(g).toBeGreaterThan(b);
      expect(good[theme]).not.toBe(colour['escrow']![theme]);
    }
  });

  it('reads 4.5:1 or more on ground, surface and surface-raised in both themes', () => {
    for (const theme of ['night', 'day'] as const) {
      for (const bg of ['ground', 'surface', 'surface-raised']) {
        expect(contrast(hex(colour['good']![theme]), hex(colour[bg]![theme])), `${theme} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("the login step's Strong uses it", () => {
    const css = readFileSync(new URL('../src/screens/setup/setup.css', import.meta.url), 'utf8');
    const rule = /\.x2f-start__strength\[data-strength='strong'\]\s*\{([^}]*)\}/.exec(css)![1]!;
    expect(rule).toContain('color: var(--x2f-good)');
  });
});
