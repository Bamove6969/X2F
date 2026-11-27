import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrast, token, type Theme } from './contrast.js';

const WEB_SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');

function readSrc(relPath: string): string {
  return readFileSync(join(WEB_SRC, relPath), 'utf8');
}

describe('a11y pass - Job 8', () => {
  describe('contrast AA across themes', () => {
    const THEMES: Theme[] = ['night', 'day'];
    const GROUNDS = ['ground', 'surface', 'surface-raised'] as const;
    const TEXT_TOKENS = ['ink', 'ink-muted', 'monero-ink', 'escrow', 'good', 'caution', 'danger'] as const;

    for (const theme of THEMES) {
      for (const bg of GROUNDS) {
        for (const fg of TEXT_TOKENS) {
          it(`${theme}: ${fg} on ${bg} meets AA text contrast (>= 4.5:1)`, () => {
            const ratio = contrast(token(fg, theme), token(bg, theme));
            expect(ratio).toBeGreaterThanOrEqual(4.5);
          });
        }

        it(`${theme}: line on ${bg} meets non-text contrast (>= 3:1)`, () => {
          const ratio = contrast(token('line', theme), token(bg, theme));
          expect(ratio).toBeGreaterThanOrEqual(3.0);
        });
      }
    }
  });

  describe('focus visible styling', () => {
    it('base.css specifies 2px ink outline on :focus-visible', () => {
      const css = readSrc('theme/base.css');
      expect(css).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--x2f-ink\)/);
    });

    // .x2f-text-button moved to the kit's ui.css (owner 17 Nov black+orange rule: every screen's retry).
    it('.x2f-text-button in ui.css has explicit focus-visible outline', () => {
      const css = readSrc('ui/ui.css');
      expect(css).toMatch(/\.x2f-text-button:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--x2f-ink\)/);
    });
  });
});
