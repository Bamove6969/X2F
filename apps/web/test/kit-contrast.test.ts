// Contrast claims the tokens make, computed from tokens.json (WCAG 2.x, AA 4.5:1 for text).
import { describe, expect, it } from 'vitest';
import { contrast, mix, token, usage, type Theme } from './contrast.js';

const THEMES: Theme[] = ['night', 'day'];
const GROUNDS = ['ground', 'surface', 'surface-raised'] as const;

describe('token contrast', () => {
  it('monero-ink reads 4.5:1+ on ground, surface and surface-raised, as tokens.json says (review 9)', () => {
    expect(usage('monero-ink')).toContain('Reads 4.5:1+ on ground, surface and surface-raised');
    for (const theme of THEMES) {
      for (const bg of GROUNDS) {
        expect(contrast(token('monero-ink', theme), token(bg, theme)), `${theme} on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
