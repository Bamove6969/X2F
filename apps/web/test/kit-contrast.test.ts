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

  // Review 2 (lead default 8 Nov): a status chip or role tag is tone text on a tone wash (kit 4.2,
  // 2.2) and must read AA 4.5:1 (13/11 px caps are not large text) on every background it sits on.
  // The day tone tokens are darkened until it holds; design may adjust them later.
  it('status chips and role tags read 4.5:1 on ground, surface and surface-raised, every tone, both themes', () => {
    const cases: { what: string; text: string; wash: string; p: number }[] = [
      ...['caution', 'escrow', 'danger', 'team'].map((t) => ({ what: `chip ${t}`, text: t, wash: t, p: 0.14 })),
      { what: 'chip mod', text: 'mod', wash: 'mod', p: 0.16 },
      { what: 'chip neutral', text: 'ink', wash: 'ink-muted', p: 0.16 },
      ...['team', 'mod', 'escrow'].map((t) => ({ what: `tag ${t}`, text: t, wash: t, p: 0.14 })),
      { what: 'tag vendor', text: 'ink-muted', wash: 'ink', p: 0.08 },
    ];
    const low: string[] = [];
    for (const theme of THEMES) {
      for (const bg of GROUNDS) {
        for (const c of cases) {
          const r = contrast(token(c.text, theme), mix(token(c.wash, theme), c.p, token(bg, theme)));
          if (r < 4.5) low.push(`${theme} ${c.what} on ${bg}: ${r.toFixed(2)}`);
        }
      }
    }
    expect(low).toEqual([]);
  });
});
