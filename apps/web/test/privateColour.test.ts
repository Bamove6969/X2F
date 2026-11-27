// Private moderator lanes (owner 27 Nov): the private colour reads AA in both themes, and stays
// apart from escrow (secured), caution (securing), danger and the moderator's own violet.
import { describe, expect, it } from 'vitest';
import { contrast, token, type Rgb, type Theme } from './contrast.js';

const distance = (a: Rgb, b: Rgb): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

describe('the private colour tokens', () => {
  for (const theme of ['night', 'day'] as Theme[]) {
    it(`${theme}: private and ink read 4.5:1+ on private-bg; private reads 4.5:1+ on surface and surface-raised`, () => {
      const bg = token('private-bg', theme);
      expect(contrast(token('private', theme), bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token('ink', theme), bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(token('ink-muted', theme), bg)).toBeGreaterThanOrEqual(4.5);
      for (const s of ['surface', 'surface-raised']) expect(contrast(token('private', theme), token(s, theme))).toBeGreaterThanOrEqual(4.5);
      // A private line stands out from a shared one: its fill is not the surface's.
      expect(distance(bg, token('surface', theme))).toBeGreaterThan(10);
    });

    it(`${theme}: private is distinct from escrow, caution, danger and mod`, () => {
      for (const other of ['escrow', 'caution', 'danger', 'mod']) expect(distance(token('private', theme), token(other, theme)), other).toBeGreaterThan(40);
    });
  }
});
